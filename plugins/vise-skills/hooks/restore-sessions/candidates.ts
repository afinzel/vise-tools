import type { RestoreCandidate, RestoreVerdict } from '../../types'

/** One entry of find_sessions.py's output. */
export type FoundSession = {
  id: string
  cwd: string | null
  title: string | null
  lastActive: string
  possiblyStillOpen: boolean
  handoff: string | null
  messages: { role: string; text: string }[]
}

export type Judgement = { verdict: RestoreVerdict; summary: string }

const DEFAULT_HOURS = 24
const WINDOW = /^\s*(\d+(?:\.\d+)?)\s*([hd]?)\s*$/i
const JUDGEMENT_LINE = /^\s*([0-9a-f-]{36})\s*\|\s*(resume|done|unclear)\s*\|\s*(.+?)\s*$/i
const VERDICT_ORDER: Record<RestoreVerdict, number> = { resume: 0, unclear: 1, done: 2 }

/** `12h`, `3d` or a bare number of hours; anything else is the default day. */
export function hoursIn(window: string | undefined): number {
  const [, amount, unit] = (window ?? '').match(WINDOW) ?? []
  if (amount === undefined) return DEFAULT_HOURS
  return Number(amount) * (unit?.toLowerCase() === 'd' ? 24 : 1)
}

export function findSessionsArgv(python: string, scriptPath: string, hours: number, ownSessionId: string): string[] {
  return [python, scriptPath, '--hours', String(hours), '--exclude', ownSessionId]
}

export function candidatesFrom(found: readonly FoundSession[]): RestoreCandidate[] {
  return found
    .filter(session => session.cwd !== null)
    .map(session => ({
      id: session.id,
      cwd: session.cwd!,
      label: session.title ?? lastFolderOf(session.cwd!),
      lastActive: session.lastActive,
      isPossiblyStillOpen: session.possiblyStillOpen,
      handoffPath: session.handoff,
      verdict: null,
      summary: null,
      isSelected: false,
      reopen: 'not-yet',
    }))
}

function lastFolderOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

/**
 * The tail of a conversation is a weak signal and a small model reading it a weaker one, so the
 * verdict only orders the list and pre-ticks the likely ones; the user still picks.
 */
export function judgementPrompt(found: readonly FoundSession[]): string {
  const sessions = found.map(({ id, title, cwd, handoff, messages }) => ({ id, title, cwd, hasHandoff: handoff !== null, messages }))
  return [
    'Each entry below is a Claude Code session that was open before a restart; `messages` is the tail of its conversation. For each session decide:',
    '- resume: work was in flight — a task partway through, a question waiting for an answer, a plan agreed but not carried out, a handoff written for a restart.',
    '- done: the last exchange closes the work — merged, pushed and confirmed, a close-out check that came back clean, a question fully answered.',
    '- unclear: not enough to tell.',
    '',
    'Return one line per session, exactly `<id> | <resume/done/unclear> | <what it was doing, under 12 words>`, and no other text.',
    '',
    JSON.stringify(sessions),
  ].join('\n')
}

export function parseJudgements(reply: string): Map<string, Judgement> {
  const judgements = new Map<string, Judgement>()
  for (const line of reply.split(/\r?\n/)) {
    const [, id, verdict, summary] = line.match(JUDGEMENT_LINE) ?? []
    if (id !== undefined && verdict !== undefined && summary !== undefined) {
      judgements.set(id, { verdict: verdict.toLowerCase() as RestoreVerdict, summary })
    }
  }
  return judgements
}

/** Resume first, then unclear, then done; within each, the most recently active first, as found. */
export function withJudgements(candidates: readonly RestoreCandidate[], judgements: ReadonlyMap<string, Judgement>): RestoreCandidate[] {
  const judged = candidates.map(candidate => {
    const judgement = judgements.get(candidate.id)
    return judgement === undefined
      ? candidate
      : { ...candidate, verdict: judgement.verdict, summary: judgement.summary, isSelected: judgement.verdict === 'resume' }
  })
  return judged
    .map((candidate, foundOrder) => ({ candidate, foundOrder }))
    .sort((a, b) => verdictRank(a.candidate) - verdictRank(b.candidate) || a.foundOrder - b.foundOrder)
    .map(({ candidate }) => candidate)
}

function verdictRank(candidate: RestoreCandidate): number {
  return candidate.verdict === null ? VERDICT_ORDER.unclear : VERDICT_ORDER[candidate.verdict]
}

/** `-w 0` opens each as a tab of the current Windows Terminal window rather than a window apiece. */
export function reopenArgv(candidate: RestoreCandidate): string[] {
  return ['wt', '-w', '0', 'new-tab', '-d', candidate.cwd, '--title', candidate.label, 'claude', '--resume', candidate.id]
}

export function resumeCommand(candidate: RestoreCandidate): string {
  return `cd "${candidate.cwd}" && claude --resume ${candidate.id}`
}

export function whenActive(lastActive: string): string {
  return lastActive.replace('T', ' ').replace(/[+-]\d\d:\d\d$|Z$/, '')
}
