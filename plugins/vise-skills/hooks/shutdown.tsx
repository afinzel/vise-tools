import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ShutdownRound, ShutdownSession, ShutdownStatus } from '../types'
import { drawPane } from './shutdown/pane'
import type { PaneActions } from './shutdown/pane'
import { OWN_HANDOFF_PROMPT, handoffPathIn, handoffRequest, parseReply, parseRoster, progressOf, sessionsFrom } from './shutdown/roster'
import { answeredOrDenied, toolArguments } from './tool-answers'

const PANE = 'shutdown'
const PANE_TITLE = 'Shutdown'
const TOOL_SESSIONS = 'mcp__vise-skills__shutdown_sessions'
const TOOL_SEND = 'mcp__vise-skills__shutdown_send'

const EMPTY_ROUND: ShutdownRound = { sessions: [], isPaneShown: false, error: null }

const round = atom({ plugin: 'vise-skills', key: 'shutdown' } as const, EMPTY_ROUND)

export const registerShutdownPane: Register = on => {
  on('tool.call', { tool: TOOL_SESSIONS }, async $ => answeredOrDenied('shutdown pane', async () => {
    await loadRoster($)
    const placement = await $.ui.open({ id: PANE, title: PANE_TITLE })
    await update($, round, current => ({ ...current, isPaneShown: placement.isPlaced }))
    return { result: sessionsForClaude(await read($, round)) }
  }))

  on('tool.call', { tool: TOOL_SEND }, async ($, e) => answeredOrDenied('shutdown pane', async () => {
    const { names } = toolArguments<{ names: string[] }>(e)
    await update($, round, current => ({
      ...current,
      sessions: current.sessions.map(session => ({ ...session, isSelected: names.includes(session.name) || (session.isThisSession && names.includes('this session')) })),
    }))
    const sent = await sendToSelected($)
    return { result: `Sent to ${sent.join(', ') || 'nobody'}. Replies arrive as each session reaches a clean point.` }
  }))

  on('session.receive', async ($, e, next) => {
    const reply = parseReply(e.text)
    if (reply === null || !(await isAwaitingReplyFrom($, reply.name))) return next(e)
    await recordAnswer($, reply.name, reply.handoffPath === null ? 'nothing-to-hand-off' : 'handed-off', reply.handoffPath)
    await announceWhenComplete($)
    if ((await read($, round)).isPaneShown) return { consumed: 'shown in the shutdown pane' }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    if (e.agentId === undefined && ownStatus(await read($, round)) === 'sent') {
      await recordOwnHandoffIfWritten($)
    }
    return completed
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => drawPane($.ui.resolve(e), await read($, round), paneActions($)))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const progress = progressOf((await read($, round)).sessions)
    if (e.props.hasSurvey || progress.sent === 0) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text dimColor>
          shutdown · {progress.isComplete ? 'all answered, safe to restart' : `${progress.answered}/${progress.sent} answered`}{' '}
        </Text>
        <Button key="open-shutdown-pane" onPress={() => $.ui.open({ id: PANE, title: PANE_TITLE })}>Pane</Button>
      </Box>
    )
  })
}

export async function registerShutdownTools($: EngineInterface) {
  await $.tool.register({
    name: 'shutdown_sessions',
    description: 'Lists this session and the other Claude sessions on this machine for /shutdown, and opens the shutdown pane where the user ticks which ones write a handoff. Says whether the pane is shown; when it is, the user sends from there and replies are tallied there.',
    inputSchema: { type: 'object', properties: {} },
    isDeferred: false,
  })
  await $.tool.register({
    name: 'shutdown_send',
    description: 'Sends the handoff request to the named sessions, as shutdown_sessions listed them; "this session" runs the handoff here too. Use only when the shutdown pane is not shown and the user picked in chat.',
    inputSchema: {
      type: 'object',
      required: ['names'],
      properties: { names: { type: 'array', items: { type: 'string' } } },
    },
    isDeferred: false,
  })
}

async function loadRoster($: EngineInterface) {
  const listing = await $.tool.call({ tool: 'ListAgents' } as never)
  if ('deny' in listing && listing.deny !== undefined) {
    await update($, round, current => ({ ...current, sessions: [], error: `ListAgents refused: ${listing.deny}` }))
    return
  }
  await update($, round, current => ({ ...current, sessions: sessionsFrom(parseRoster(listing.text ?? '')), error: null }))
}

function paneActions($: EngineInterface): PaneActions {
  return {
    toggle: name => void updateSessions($, sessions => sessions.map(session => (session.name === name ? { ...session, isSelected: !session.isSelected } : session))),
    selectAll: () => void updateSessions($, sessions => sessions.map(session => ({ ...session, isSelected: true }))),
    selectNone: () => void updateSessions($, sessions => sessions.map(session => ({ ...session, isSelected: false }))),
    send: () => void sendToSelected($),
    refresh: () => void loadRoster($),
  }
}

async function sendToSelected($: EngineInterface): Promise<string[]> {
  const { sessions } = await read($, round)
  const coordinator = sessions.find(session => session.isThisSession)?.name ?? 'the coordinating session'
  const chosen = sessions.filter(session => session.isSelected)
  for (const peer of chosen.filter(session => !session.isThisSession)) {
    await $.session.send({ to: peer.address, text: handoffRequest(peer.name, coordinator) })
    await setStatus($, peer.name, 'sent')
  }
  if (chosen.some(session => session.isThisSession)) {
    await setOwnStatus($, 'sent')
    await $.prompt.submit({ text: OWN_HANDOFF_PROMPT, asUser: true })
  }
  return chosen.map(session => session.name)
}

async function isAwaitingReplyFrom($: EngineInterface, name: string): Promise<boolean> {
  return (await read($, round)).sessions.some(session => session.name === name && session.status === 'sent')
}

async function recordAnswer($: EngineInterface, name: string, status: ShutdownStatus, handoffPath: string | null) {
  await updateSessions($, sessions => sessions.map(session => (session.name === name ? { ...session, status, handoffPath } : session)))
}

/**
 * The handoff skill ends by printing its path, so a turn whose last answer names a handoff file
 * is the one that wrote it. A turn already running when Send was pressed ends without one.
 */
async function recordOwnHandoffIfWritten($: EngineInterface) {
  const lastAnswer = (await $.session.messages()).filter(message => message.role === 'assistant').at(-1)
  const handoffPath = handoffPathIn(lastAnswer?.text ?? '')
  const thisSession = (await read($, round)).sessions.find(session => session.isThisSession)
  if (handoffPath === null || thisSession === undefined) return
  await recordAnswer($, thisSession.name, 'handed-off', handoffPath)
  await announceWhenComplete($)
}

async function announceWhenComplete($: EngineInterface) {
  const progress = progressOf((await read($, round)).sessions)
  if (progress.isComplete) $.ui.toast(`All ${progress.sent} sessions answered — safe to restart.`)
}

async function setStatus($: EngineInterface, name: string, status: ShutdownStatus) {
  await updateSessions($, sessions => sessions.map(session => (session.name === name ? { ...session, status } : session)))
}

async function setOwnStatus($: EngineInterface, status: ShutdownStatus) {
  await updateSessions($, sessions => sessions.map(session => (session.isThisSession ? { ...session, status } : session)))
}

function ownStatus(current: ShutdownRound): ShutdownStatus | undefined {
  return current.sessions.find(session => session.isThisSession)?.status
}

async function updateSessions($: EngineInterface, change: (sessions: ShutdownSession[]) => ShutdownSession[]) {
  await update($, round, current => ({ ...current, sessions: change(current.sessions) }))
}

function sessionsForClaude(current: ShutdownRound): string {
  return JSON.stringify({
    pane: { isShown: current.isPaneShown },
    error: current.error,
    sessions: current.sessions.map(({ name, details, isThisSession }) => ({ name: isThisSession ? 'this session' : name, details: isThisSession ? `${name}, this session` : details })),
  })
}
