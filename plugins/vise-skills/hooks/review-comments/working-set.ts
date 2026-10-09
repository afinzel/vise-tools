import type { ReviewThread } from '../../types'

/**
 * The working set is the threads that were unresolved when the review was loaded. A refresh keeps
 * them, so a thread resolved mid-walk stays visible as done, and their numbers stay stable so
 * "[3]" means the same thread to the person and to Claude for the whole walk.
 */
export function mergeIntoWorkingSet(workingSet: readonly ReviewThread[], fetched: readonly ReviewThread[]): ReviewThread[] {
  const fetchedById = new Map(fetched.map(thread => [thread.id, thread]))
  const kept = workingSet.map(known => {
    const latest = fetchedById.get(known.id)
    return latest === undefined ? known : { ...latest, number: known.number }
  })
  const knownIds = new Set(workingSet.map(thread => thread.id))
  const highestNumber = Math.max(0, ...workingSet.map(thread => thread.number))
  const added = fetched
    .filter(thread => !thread.isResolved && !knownIds.has(thread.id))
    .map((thread, index) => ({ ...thread, number: highestNumber + index + 1 }))

  return [...kept, ...added]
}
