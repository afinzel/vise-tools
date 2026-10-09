import type { ThreadView } from './walk-order'
import { locationOf } from './walk-order'

const HOLD_UNTIL_PUSHED = 'Then mark it fixed-locally: do not reply on or resolve the thread, and do not commit or push, until I ask for the push.'
const HOLD_ALL_UNTIL_PUSHED = 'Then mark each fixed-locally: do not reply on or resolve the threads, and do not commit or push, until I ask for the push.'

export type Decision = { kind: 'fix' } | { kind: 'option'; optionKey: string } | { kind: 'push-back' }

/**
 * The prompt a sidebar button sends. Each starts `review-comments:` so the skill knows the person
 * decided through the sidebar, and names threads by the numbers the sidebar shows.
 */
export function decisionPrompt(view: ThreadView, decision: Decision, settledToo: readonly ThreadView[]): string {
  const label = `[${view.thread.number}] (${locationOf(view.thread)})`
  const notes = [settlesTooNote(settledToo), behaviourOverrideNote(view)].filter(Boolean).join(' ')
  const threadCount = 1 + settledToo.length

  switch (decision.kind) {
    case 'fix':
      return joinSentences(`review-comments: fix ${label} as suggested.`, notes, holdUntilPushed(threadCount))
    case 'option':
      return joinSentences(`review-comments: for ${label}, go with ${optionLabel(view, decision.optionKey)}.`, notes, 'Make the change.', holdUntilPushed(threadCount))
    case 'push-back':
      return joinSentences(`review-comments: push back on ${label}: reply on the thread with the reasoning and leave it unresolved.`, settlesTooNote(settledToo))
  }
}

export function quickFixPrompt(quickFixes: readonly ThreadView[]): string {
  const numbers = quickFixes.map(view => `[${view.thread.number}]`).join(', ')
  return joinSentences(`review-comments: fix ${numbers} as suggested (trivial, no behaviour change).`, HOLD_ALL_UNTIL_PUSHED)
}

/** Pressing the push button is the person asking for the commit and push the fixes were held for. */
export function pushPrompt(readyToPush: readonly ThreadView[]): string {
  const threads = readyToPush.map(view => `[${view.thread.number}] (${locationOf(view.thread)})`).join(', ')
  return `review-comments: commit and push the fixes for ${threads}. Once the push succeeds, reply on each of those threads with what changed and the commit it is in, resolve them, and mark them fixed.`
}

export function discussionPrompt(view: ThreadView): string {
  return `review-comments: about [${view.thread.number}] (${locationOf(view.thread)}): `
}

function optionLabel(view: ThreadView, optionKey: string): string {
  return view.triage?.options?.find(option => option.key === optionKey)?.label ?? `option ${optionKey}`
}

function settlesTooNote(settledToo: readonly ThreadView[]): string {
  if (settledToo.length === 0) return ''
  return `This also settles ${settledToo.map(view => `[${view.thread.number}]`).join(', ')}, which share the root cause.`
}

function behaviourOverrideNote(view: ThreadView): string {
  if (!view.isBehaviourFlagOverridden || view.triage === undefined) return ''
  return view.triage.isBehaviourChange
    ? 'I\'ve marked it as a behaviour change, so treat it as one.'
    : 'I\'ve marked it as not changing behaviour, so keep the fix to that.'
}

function holdUntilPushed(threadCount: number): string {
  return threadCount === 1 ? HOLD_UNTIL_PUSHED : HOLD_ALL_UNTIL_PUSHED
}

function joinSentences(...sentences: string[]): string {
  return sentences.filter(Boolean).join(' ')
}
