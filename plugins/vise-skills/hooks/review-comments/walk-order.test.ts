import { expect, test } from 'claude-code/testing'

import type { ReviewThread, ThreadOutcome, ThreadTriage } from '../../types'
import { parsePullRequest, parsePullRequestTarget } from './github-threads'
import { nextToStepThrough, progressCounts, quickFixesAwaitingDecision, viewsInWalkOrder } from './walk-order'
import { mergeIntoWorkingSet } from './working-set'

function thread(id: string, number: number, overrides: Partial<ReviewThread> = {}): ReviewThread {
  return { id, number, path: `src/${id}.cs`, line: 10, isOutdated: false, isResolved: false, url: '', comments: [], excerpt: null, ...overrides }
}

function triaged(bucket: ThreadTriage['bucket'], isBehaviourChange = false): ThreadTriage {
  return { bucket, scope: 'S', scopeReason: '', summary: '', suggestion: '', isBehaviourChange }
}

const threads = [thread('a', 1), thread('b', 2), thread('c', 3), thread('d', 4)]
const triage: Record<string, ThreadTriage> = {
  a: triaged('discuss'),
  b: triaged('trivial'),
  c: triaged('trivial', true),
  d: triaged('push-back'),
}

test('walk order is trivial, then discuss, then push back', async () => {
  const order = viewsInWalkOrder(threads, triage, {}).map(view => view.thread.id)
  expect(order).toEqual(['b', 'c', 'a', 'd'])
})

test('quick fixes are trivial threads that do not change behaviour', async () => {
  const quick = quickFixesAwaitingDecision(viewsInWalkOrder(threads, triage, {})).map(view => view.thread.id)
  expect(quick).toEqual(['b'])
})

test('stepping through skips quick fixes and settled threads', async () => {
  const outcomes: Record<string, ThreadOutcome> = { a: 'skipped' }
  const views = viewsInWalkOrder(threads, triage, outcomes)
  expect(nextToStepThrough(views, null)?.thread.id).toBe('c')
  expect(nextToStepThrough(views, 'c')?.thread.id).toBe('d')
  expect(nextToStepThrough(views, 'd')?.thread.id).toBe('c')
})

test('progress counts a resolved thread as done and a skipped one apart', async () => {
  const views = viewsInWalkOrder([thread('a', 1, { isResolved: true }), thread('b', 2)], triage, { b: 'skipped' })
  expect(progressCounts(views)).toEqual({ total: 2, done: 1, skipped: 1, inProgress: 0, readyToPush: 0 })
})

test('a refresh keeps numbers and resolved threads, and appends new unresolved ones', async () => {
  const workingSet = mergeIntoWorkingSet([], [thread('a', 0), thread('b', 0), thread('x', 0, { isResolved: true })])
  expect(workingSet.map(one => [one.id, one.number])).toEqual([['a', 1], ['b', 2]])

  const refreshed = mergeIntoWorkingSet(workingSet, [thread('a', 0, { isResolved: true }), thread('b', 0), thread('n', 0)])
  expect(refreshed.map(one => [one.id, one.number, one.isResolved])).toEqual([['a', 1, true], ['b', 2, false], ['n', 3, false]])
})

test('a PR is named by number, #number or URL, and owner and repo come from its URL', async () => {
  expect(parsePullRequestTarget('279')).toBe('279')
  expect(parsePullRequestTarget('#279')).toBe('279')
  expect(parsePullRequestTarget('https://github.com/stadionHQ/onebasket-products/pull/279')).toBe('https://github.com/stadionHQ/onebasket-products/pull/279')
  expect(parsePullRequestTarget('')).toBe(null)

  const pullRequest = parsePullRequest(JSON.stringify({
    number: 279, title: 't', url: 'https://github.com/stadionHQ/onebasket-products/pull/279', headRefName: 'feat/x', headRefOid: 'abc',
  }))
  expect([pullRequest.owner, pullRequest.repo, pullRequest.headCommit]).toEqual(['stadionHQ', 'onebasket-products', 'abc'])
})
