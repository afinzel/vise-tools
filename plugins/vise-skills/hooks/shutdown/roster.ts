import type { ShutdownSession } from '../../types'

export type RosterEntry = { name: string; ref: string; details: string }

export type Roster = { thisSessionName: string | null; peers: RosterEntry[] }

export type ShutdownReply = { name: string; handoffPath: string | null }

const THIS_SESSION_LINE = /^This session is (\S+)/
const SECTION_HEADER = /^\S.*:\s*$/
const ROSTER_ROW = /^\s+(\S+) \[([0-9a-f]+)\]\s+·\s+(.+)$/
const REPLY = /shutdown-reply\s+(\S+?):\s*(.+)/
const NOTHING_TO_HAND_OFF = /nothing to hand off/i
const HANDOFF_PATH = /(?:[A-Za-z]:[\\/]|\/)[^\s`'"<>|]*handoff-[^\s`'"<>|]*\.md/

/**
 * Reads ListAgents' text. Only rows under a sessions heading count: in-process subagents and
 * teammates go down with this session anyway, and cloud sessions survive a local restart and
 * cannot reply.
 */
export function parseRoster(listing: string): Roster {
  let thisSessionName: string | null = null
  let isInSessionSection = false
  const peers: RosterEntry[] = []
  for (const line of listing.split(/\r?\n/)) {
    thisSessionName ??= line.match(THIS_SESSION_LINE)?.[1] ?? null
    if (SECTION_HEADER.test(line)) {
      isInSessionSection = /session/i.test(line)
      continue
    }
    const [, name, ref, details] = line.match(ROSTER_ROW) ?? []
    if (name !== undefined && ref !== undefined && details !== undefined && isInSessionSection && !/\bcloud\b/i.test(details)) {
      peers.push({ name, ref, details: tidyDetails(details) })
    }
  }
  return { thisSessionName, peers }
}

function tidyDetails(details: string): string {
  return details.split('·').map(part => part.trim()).filter(Boolean).join(' · ')
}

/** Everyone starts ticked: the usual restart takes every window down, so leaving one out is the deliberate act. */
export function sessionsFrom(roster: Roster): ShutdownSession[] {
  const thisSession: ShutdownSession = {
    name: roster.thisSessionName ?? 'this session',
    address: '',
    details: 'this session',
    isThisSession: true,
    isSelected: true,
    status: 'not-sent',
    handoffPath: null,
  }
  return [thisSession, ...roster.peers.map(peer => peerSession(peer, roster.peers))]
}

function peerSession(peer: RosterEntry, peers: RosterEntry[]): ShutdownSession {
  const isNameShared = peers.filter(other => other.name === peer.name).length > 1
  return {
    name: peer.name,
    address: isNameShared ? `${peer.name} [${peer.ref}]` : peer.name,
    details: peer.details,
    isThisSession: false,
    isSelected: true,
    status: 'not-sent',
    handoffPath: null,
  }
}

/**
 * Names the recipient in the reply it asks for: a delivery reaches the mod as text alone, with
 * no sender, so the reply has to say who it is from.
 */
export function handoffRequest(recipient: string, coordinator: string): string {
  return [
    `**Restart coming.** ${coordinator} is getting every Claude session on this machine ready for a restart, or for the user closing the windows. Nothing needs rushing: if you are partway through something, finish the step you are on and stop at the next clean point. If you are waiting on the user, do this now.`,
    '',
    '1. Run the `vise-skills:handoff` skill with the argument "resume after a restart".',
    '2. Do not commit, push, stash or kill anything to tidy up. Uncommitted work survives a restart on disk; name it in the handoff instead.',
    `3. Reply to \`${coordinator}\` with SendMessage, one line and nothing else: \`shutdown-reply ${recipient}: <the handoff's absolute path>\`, or \`shutdown-reply ${recipient}: nothing to hand off\` if you hold no work in flight.`,
    '',
    'If the user tells you to ignore this, do.',
  ].join('\n')
}

export const OWN_HANDOFF_PROMPT = 'Run the `vise-skills:handoff` skill with the argument "resume after a restart" — the shutdown pane asked for this session\'s handoff along with the others.'

export function parseReply(text: string): ShutdownReply | null {
  const [, name, rawAnswer] = text.match(REPLY) ?? []
  if (name === undefined || rawAnswer === undefined) return null
  const answer = rawAnswer.trim()
  return { name, handoffPath: NOTHING_TO_HAND_OFF.test(answer) ? null : handoffPathIn(answer) ?? answer }
}

export function handoffPathIn(text: string): string | null {
  return text.match(HANDOFF_PATH)?.[0] ?? null
}

export function progressOf(sessions: readonly ShutdownSession[]) {
  const sent = sessions.filter(session => session.status !== 'not-sent')
  const answered = sent.filter(session => session.status === 'handed-off' || session.status === 'nothing-to-hand-off')
  return { sent: sent.length, answered: answered.length, isComplete: sent.length > 0 && answered.length === sent.length }
}
