import type { ReviewThread, ThreadOutcome, ThreadTriage, TriageBucket } from '../../types'

export type ThreadView = {
  thread: ReviewThread
  /** Claude's triage, with the behaviour flag the person set in its place when they set one. */
  triage: ThreadTriage | undefined
  outcome: ThreadOutcome | undefined
  isBehaviourFlagOverridden: boolean
}

const BUCKET_ORDER: readonly (TriageBucket | undefined)[] = ['trivial', 'discuss', 'push-back', undefined]

export function viewsInWalkOrder(
  threads: readonly ReviewThread[],
  triage: Record<string, ThreadTriage>,
  outcomes: Record<string, ThreadOutcome>,
  behaviourOverrides: Record<string, boolean> = {},
): ThreadView[] {
  const views = threads.map(thread => viewOf(thread, triage[thread.id], outcomes[thread.id], behaviourOverrides[thread.id]))

  return BUCKET_ORDER.flatMap(bucket => views.filter(view => view.triage?.bucket === bucket))
}

function viewOf(
  thread: ReviewThread,
  claudeTriage: ThreadTriage | undefined,
  outcome: ThreadOutcome | undefined,
  behaviourOverride: boolean | undefined,
): ThreadView {
  const isBehaviourFlagOverridden = claudeTriage !== undefined && behaviourOverride !== undefined && behaviourOverride !== claudeTriage.isBehaviourChange
  const triage = claudeTriage === undefined || !isBehaviourFlagOverridden
    ? claudeTriage
    : { ...claudeTriage, isBehaviourChange: behaviourOverride! }

  return { thread, triage, outcome, isBehaviourFlagOverridden }
}

export function isSettled(view: ThreadView): boolean {
  return view.thread.isResolved || view.outcome === 'fixed' || view.outcome === 'pushed-back' || view.outcome === 'skipped'
}

export function isDone(view: ThreadView): boolean {
  return isSettled(view) && !isSkipped(view)
}

export function isSkipped(view: ThreadView): boolean {
  return view.outcome === 'skipped' && !view.thread.isResolved
}

export function isReadyToPush(view: ThreadView): boolean {
  return view.outcome === 'fixed-locally' && !view.thread.isResolved
}

/**
 * To do holds what still needs the person or Claude, in progress included; ready to push holds
 * fixes made locally that wait for a push before their threads are answered; skipped is set
 * aside, not done.
 */
export function sectionsOf(views: readonly ThreadView[]) {
  return {
    toDo: views.filter(view => !isSettled(view) && !isReadyToPush(view)),
    readyToPush: views.filter(isReadyToPush),
    skipped: views.filter(isSkipped),
    done: views.filter(isDone),
  }
}

export function doneOutcomeLabel(view: ThreadView): string {
  if (view.outcome === 'fixed') return 'fixed'
  if (view.outcome === 'pushed-back') return 'pushed back'
  return 'resolved on GitHub'
}

export function isAwaitingDecision(view: ThreadView): boolean {
  return !isSettled(view) && view.outcome !== 'in-progress' && view.outcome !== 'fixed-locally'
}

export function isQuickFix(view: ThreadView): boolean {
  return view.triage?.bucket === 'trivial' && !view.triage.isBehaviourChange
}

export function quickFixesAwaitingDecision(views: readonly ThreadView[]): ThreadView[] {
  return views.filter(view => isQuickFix(view) && isAwaitingDecision(view))
}

export function nextToStepThrough(views: readonly ThreadView[], afterThreadId: string | null): ThreadView | undefined {
  const steppable = views.filter(view => !isQuickFix(view) || view.thread.id === afterThreadId)
  const start = steppable.findIndex(view => view.thread.id === afterThreadId) + 1
  const rotated = [...steppable.slice(start), ...steppable.slice(0, start)]

  return rotated.find(view => view.thread.id !== afterThreadId && isAwaitingDecision(view))
}

export function progressCounts(views: readonly ThreadView[]) {
  return {
    total: views.length,
    done: views.filter(view => isSettled(view) && view.outcome !== 'skipped').length,
    skipped: views.filter(view => view.outcome === 'skipped' && !view.thread.isResolved).length,
    inProgress: views.filter(view => view.outcome === 'in-progress' && !view.thread.isResolved).length,
    readyToPush: views.filter(isReadyToPush).length,
  }
}

export function locationOf(thread: ReviewThread): string {
  return thread.line === null ? thread.path : `${thread.path}:${thread.line}`
}
