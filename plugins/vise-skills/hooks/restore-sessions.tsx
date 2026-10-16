import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ReopenOutcome, RestoreCandidate, RestoreRound } from '../types'
import {
  candidatesFrom,
  findSessionsArgv,
  hoursIn,
  judgementPrompt,
  parseJudgements,
  reopenArgv,
  resumeCommand,
  withJudgements,
} from './restore-sessions/candidates'
import type { FoundSession } from './restore-sessions/candidates'
import { drawPane } from './restore-sessions/pane'
import type { PaneActions } from './restore-sessions/pane'
import { answeredOrDenied, toolArguments } from './tool-answers'

const PANE = 'restore-sessions'
const PANE_TITLE = 'Restore sessions'
const TOOL_FIND = 'mcp__vise-skills__restore_sessions'
const TOOL_REOPEN = 'mcp__vise-skills__restore_reopen'
const PYTHONS = ['python', 'python3']

const EMPTY_ROUND: RestoreRound = { hours: 24, phase: 'idle', candidates: [], judgementProblem: null, error: null, isPaneShown: false }

const round = atom({ plugin: 'vise-skills', key: 'restore' } as const, EMPTY_ROUND)

export const registerRestorePane: Register = on => {
  on('tool.call', { tool: TOOL_FIND }, async ($, e) => answeredOrDenied('restore pane', async () => {
    const { window } = toolArguments<{ window?: string }>(e)
    await update($, round, () => ({ ...EMPTY_ROUND, hours: hoursIn(window), phase: 'finding' }))
    const placement = await $.ui.open({ id: PANE, title: PANE_TITLE })
    await update($, round, current => ({ ...current, isPaneShown: placement.isPlaced }))
    await findAndJudge($)
    return { result: candidatesForClaude(await read($, round)) }
  }))

  on('tool.call', { tool: TOOL_REOPEN }, async ($, e) => answeredOrDenied('restore pane', async () => {
    const { ids } = toolArguments<{ ids: string[] }>(e)
    await updateCandidates($, candidates => candidates.map(candidate => ({ ...candidate, isSelected: ids.includes(candidate.id) })))
    await reopenSelected($)
    return { result: reopenReport((await read($, round)).candidates.filter(candidate => ids.includes(candidate.id))) }
  }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => drawPane($.ui.resolve(e), await read($, round), paneActions($)))
}

export async function registerRestoreTools($: EngineInterface) {
  await $.tool.register({
    name: 'restore_sessions',
    description: 'Finds the Claude sessions active in a recent window from their transcripts, has Haiku judge which were mid-work, and opens the restore pane where the user ticks which to reopen. Says whether the pane is shown; when it is, the user reopens from there.',
    inputSchema: {
      type: 'object',
      properties: { window: { type: 'string', description: 'How far back to look: `12h`, `3d`, or hours as a number. Default 24h.' } },
    },
    isDeferred: false,
  })
  await $.tool.register({
    name: 'restore_reopen',
    description: 'Reopens the given sessions, by the ids restore_sessions returned, each in a new Windows Terminal tab with `claude --resume`. Use only when the restore pane is not shown and the user picked in chat.',
    inputSchema: {
      type: 'object',
      required: ['ids'],
      properties: { ids: { type: 'array', items: { type: 'string' } } },
    },
    isDeferred: false,
  })
}

async function findAndJudge($: EngineInterface) {
  const found = await findSessions($, (await read($, round)).hours)
  if (found === null) return
  await update($, round, (current): RestoreRound => ({ ...current, phase: found.length === 0 ? 'ready' : 'judging', candidates: candidatesFrom(found) }))
  if (found.length > 0) await judge($, found)
}

async function findSessions($: EngineInterface, hours: number): Promise<FoundSession[] | null> {
  const scriptPath = `${$.plugin.root}/skills/restore-sessions/find_sessions.py`
  const ownSessionId = await $.session.id()
  let failure = 'no Python on the path'
  for (const python of PYTHONS) {
    try {
      const run = await $.process.run(findSessionsArgv(python, scriptPath, hours, ownSessionId), { timeoutMs: 60_000 })
      if (run.exitCode === 0) return JSON.parse(run.stdout) as FoundSession[]
      failure = run.stderr.trim() || `${python} exited ${run.exitCode}`
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
    }
  }
  await update($, round, (current): RestoreRound => ({ ...current, phase: 'ready', error: `Could not read the transcripts: ${failure}` }))
  return null
}

async function judge($: EngineInterface, found: FoundSession[]) {
  const reply = await $.model.complete({ model: 'haiku', prompt: judgementPrompt(found) } as never)
  const judgements = reply.isAnswered ? parseJudgements(reply.text) : new Map()
  const judgementProblem = !reply.isAnswered ? `Haiku did not answer (${reply.reason})` : judgements.size === 0 ? 'Haiku\'s answer named no session' : null
  await update($, round, (current): RestoreRound => ({ ...current, phase: 'ready', judgementProblem, candidates: withJudgements(current.candidates, judgements) }))
}

function paneActions($: EngineInterface): PaneActions {
  return {
    toggle: id => void updateCandidates($, candidates => candidates.map(candidate => (candidate.id === id ? { ...candidate, isSelected: !candidate.isSelected } : candidate))),
    selectRecommended: () => void updateCandidates($, candidates => candidates.map(candidate => ({ ...candidate, isSelected: candidate.verdict === 'resume' }))),
    selectAll: () => void updateCandidates($, candidates => candidates.map(candidate => ({ ...candidate, isSelected: true }))),
    selectNone: () => void updateCandidates($, candidates => candidates.map(candidate => ({ ...candidate, isSelected: false }))),
    reopen: () => void reopenSelected($),
  }
}

async function reopenSelected($: EngineInterface) {
  const chosen = (await read($, round)).candidates.filter(candidate => candidate.isSelected && candidate.reopen === 'not-yet')
  for (const candidate of chosen) {
    const outcome = await reopen($, candidate)
    await updateCandidates($, candidates => candidates.map(other => (other.id === candidate.id ? { ...other, reopen: outcome, isSelected: false } : other)))
  }
}

async function reopen($: EngineInterface, candidate: RestoreCandidate): Promise<ReopenOutcome> {
  if (!(await $.fs.exists(candidate.cwd))) return 'missing-folder'
  try {
    const run = await $.process.run(reopenArgv(candidate), { timeoutMs: 15_000 })
    return run.exitCode === 0 ? 'reopened' : 'failed'
  } catch {
    return 'failed'
  }
}

async function updateCandidates($: EngineInterface, change: (candidates: RestoreCandidate[]) => RestoreCandidate[]) {
  await update($, round, current => ({ ...current, candidates: change(current.candidates) }))
}

function candidatesForClaude(current: RestoreRound): string {
  return JSON.stringify({
    pane: { isShown: current.isPaneShown },
    hours: current.hours,
    error: current.error,
    judgementProblem: current.judgementProblem,
    candidates: current.candidates.map(({ id, label, cwd, lastActive, verdict, summary, handoffPath, isPossiblyStillOpen }) => ({
      id, label, cwd, lastActive, verdict, summary, handoffPath, isPossiblyStillOpen,
    })),
  })
}

function reopenReport(candidates: readonly RestoreCandidate[]): string {
  return candidates.map(candidate => {
    if (candidate.reopen === 'reopened') return `${candidate.label}: reopened`
    if (candidate.reopen === 'missing-folder') return `${candidate.label}: skipped, ${candidate.cwd} is gone`
    return `${candidate.label}: could not open a tab; run \`${resumeCommand(candidate)}\``
  }).join('\n')
}
