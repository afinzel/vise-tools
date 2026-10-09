import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, UiOpenResult } from 'claude-code'

import type { CodeReference, PullRequestRef, ReferenceExcerpt, ReviewSession, ReviewThread, ThreadOutcome, TriageInput } from '../types'
import {
  CURRENT_BRANCH_ARGV,
  REPOSITORY_ROOT_ARGV,
  currentLineOf,
  fileAtHeadArgv,
  parsePullRequest,
  parsePullRequestTarget,
  parseThreads,
  referenceExcerpt,
  pullRequestViewArgv,
  sortByLocation,
  threadsQueryArgv,
  toReviewThread,
} from './review-comments/github-threads'
import type { GraphQlThread, PullRequestTarget } from './review-comments/github-threads'
import { decisionPrompt, discussionPrompt, pushPrompt, quickFixPrompt } from './review-comments/decision-prompts'
import type { Decision } from './review-comments/decision-prompts'
import { drawSidebar } from './review-comments/sidebar'
import type { SidebarActions } from './review-comments/sidebar'
import { mergeIntoWorkingSet } from './review-comments/working-set'
import {
  nextToStepThrough,
  progressCounts,
  quickFixesAwaitingDecision,
  sectionsOf,
  viewsInWalkOrder,
} from './review-comments/walk-order'
import type { ThreadView } from './review-comments/walk-order'

const PANE = 'review-comments'
const PANE_TITLE = 'Review comments'
const TOOL_THREADS = 'mcp__vise-skills__review_threads'
const TOOL_TRIAGE = 'mcp__vise-skills__review_triage'
const TOOL_MARK = 'mcp__vise-skills__review_mark'

const EMPTY_REVIEW: ReviewSession = { pullRequest: null, threads: [], workingTreeRoot: null, error: null, isLoading: false }

const review = atom({ plugin: 'vise-skills', key: 'review' } as const, EMPTY_REVIEW)
const triage = atom({ plugin: 'vise-skills', key: 'triage' } as const, {})
const outcomes = atom({ plugin: 'vise-skills', key: 'outcomes' } as const, {})
const behaviourOverrides = atom({ plugin: 'vise-skills', key: 'behaviourOverrides' } as const, {})
const expandedThreadId = atom({ plugin: 'vise-skills', key: 'expandedThreadId' } as const, null)
const isDoneSectionOpen = atom({ plugin: 'vise-skills', key: 'isDoneSectionOpen' } as const, true)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await registerCommandAndTools($)
    return next(e)
  })

  on('command.run', { command: 'review-sidebar' }, async $ => {
    await $.ui.open({ id: PANE, title: PANE_TITLE })
    const loaded = await read($, review)
    return { text: loaded.pullRequest === null ? 'Review sidebar opened. Run /review-comments to load a PR.' : 'Review sidebar opened.' }
  })

  on('skill.prompt', async ($, e, next) => {
    if (isReviewCommentsSkill(e.skill)) {
      await startFreshWalk($)
    }
    return next(e)
  })

  on('tool.call', { tool: TOOL_THREADS }, async ($, e) => answeredOrDenied(async () => {
    const { pr, refresh } = toolArguments<{ pr?: string; refresh?: boolean }>(e)
    const requested = parsePullRequestTarget(pr ?? '')
    await loadInFlight
    const current = await read($, review)
    const isAnotherPullRequest = requested !== null && !isSamePullRequest(current.pullRequest, requested)
    if (current.pullRequest === null || isAnotherPullRequest || refresh === true) {
      const isFreshStart = current.pullRequest === null || isAnotherPullRequest
      await loadReviewOnce($, isFreshStart ? requested : current.pullRequest!.url, { isFreshStart })
    }
    const placement = await $.ui.open({ id: PANE, title: PANE_TITLE })
    const loaded = await read($, review)
    return loaded.error === null ? { result: threadsForClaude(loaded, placement) } : { deny: loaded.error }
  }))

  on('tool.call', { tool: TOOL_TRIAGE }, async ($, e) => answeredOrDenied(async () => {
    const { items } = toolArguments<{ items: TriageInput[] }>(e)
    const unknown = await recordTriage($, items)
    return { result: unknown.length === 0 ? `Triage recorded for ${items.length} threads.` : `Recorded; no thread numbered ${unknown.join(', ')}.` }
  }))

  on('tool.call', { tool: TOOL_MARK }, async ($, e) => answeredOrDenied(async () => {
    const { number, outcome } = toolArguments<{ number: number; outcome: ThreadOutcome }>(e)
    const thread = (await read($, review)).threads.find(candidate => candidate.number === number)
    if (thread === undefined) {
      return { deny: `No review thread numbered ${number}.` }
    }
    await update($, outcomes, all => ({ ...all, [thread.id]: outcome }))
    if (outcome === 'fixed' || outcome === 'pushed-back') {
      await refreshReview($)
    }
    return { result: `[${number}] marked ${outcome}.` }
  }))

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') {
      $.ui.toast('Review sidebar closed. /review-sidebar reopens it.')
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const model = {
      review: await read($, review),
      views: await currentViews($),
      expandedThreadId: await read($, expandedThreadId),
      isDoneSectionOpen: await read($, isDoneSectionOpen),
    }
    return drawSidebar($.ui.resolve(e), model, sidebarActions($))
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const loaded = await read($, review)
    if (e.props.hasSurvey || loaded.pullRequest === null) {
      return next(e)
    }
    const counts = progressCounts(await currentViews($))
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text dimColor>
          review #{loaded.pullRequest.number} · {counts.done}/{counts.total} done
          {counts.readyToPush > 0 ? ` · ${counts.readyToPush} ready to push` : ''}
          {counts.skipped > 0 ? ` · ${counts.skipped} skipped` : ''}{' '}
        </Text>
        <Button key="open-review-sidebar" onPress={() => $.ui.open({ id: PANE, title: PANE_TITLE })}>Sidebar</Button>
      </Box>
    )
  })
}

async function registerCommandAndTools($: EngineInterface) {
  await $.command.register({
    name: 'review-sidebar',
    description: 'Reopen the review sidebar',
    immediate: true,
  })
  await $.tool.register({
    name: 'review_threads',
    description: 'The unresolved review threads of the PR in the review sidebar, numbered as the sidebar shows them, with each thread\'s comments verbatim. Loads the PR when none is loaded, or when `pr` names another; `refresh` re-reads GitHub.',
    inputSchema: {
      type: 'object',
      properties: {
        pr: { type: 'string', description: 'A PR number or GitHub PR URL; omit for the current branch\'s PR.' },
        refresh: { type: 'boolean' },
      },
    },
    isDeferred: false,
  })
  await $.tool.register({
    name: 'review_triage',
    description: 'Record your triage of review threads so the sidebar groups them and shows your suggestion. One item per thread, by its number.',
    inputSchema: {
      type: 'object',
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            required: ['number', 'bucket', 'scope', 'scopeReason', 'summary', 'suggestion', 'isBehaviourChange'],
            properties: {
              number: { type: 'number' },
              bucket: { enum: ['trivial', 'discuss', 'push-back'] },
              scope: { enum: ['S', 'M', 'L'] },
              scopeReason: { type: 'string', description: 'A few words on what drives the scope, e.g. "touches 3 call sites".' },
              summary: { type: 'string', description: 'The fix in one short line (under 60 characters), e.g. "Reject Unset after TryParse"; for push-back, "No change: <why>".' },
              suggestion: { type: 'string', description: 'Markdown: the concrete fix, the options with a recommendation, or the push-back reasoning.' },
              isBehaviourChange: { type: 'boolean', description: 'True when the fix changes what the code does at run time, not only its shape (names, comments, formatting, dead code).' },
              sameAs: { type: 'number', description: 'The number of a thread with the same root cause; deciding that one settles this one too.' },
              options: {
                type: 'array',
                description: 'For a thread that needs a decision, the ways to settle it, each a button in the sidebar. Leave out for a single clear fix.',
                items: {
                  type: 'object',
                  required: ['key', 'label'],
                  properties: {
                    key: { type: 'string', description: 'Short id, e.g. "a1".' },
                    label: { type: 'string', description: 'The button text, e.g. "(a) shared check, product+variant geo".' },
                    scope: { enum: ['S', 'M', 'L'] },
                    isBehaviourChange: { type: 'boolean' },
                    isRecommended: { type: 'boolean' },
                  },
                },
              },
              references: {
                type: 'array',
                description: 'Other code the decision depends on (another call site, the other side of a drift). The sidebar shows each excerpt under the thread\'s own code.',
                items: {
                  type: 'object',
                  required: ['path', 'startLine', 'endLine'],
                  properties: {
                    path: { type: 'string', description: 'Repository-relative path.' },
                    startLine: { type: 'number' },
                    endLine: { type: 'number' },
                    caption: { type: 'string', description: 'One line on why it matters, e.g. "The basket\'s version checks only the variant".' },
                  },
                },
              },
            },
          },
        },
      },
    },
    isDeferred: false,
  })
  await $.tool.register({
    name: 'review_mark',
    description: 'Record what happened to a review thread. `fixed-locally` once the change is made but not yet pushed; `fixed` only after the push, the reply and the resolve; `pushed-back` after the reply is posted. On `fixed` and `pushed-back` the sidebar re-reads GitHub.',
    inputSchema: {
      type: 'object',
      required: ['number', 'outcome'],
      properties: {
        number: { type: 'number' },
        outcome: { enum: ['in-progress', 'fixed-locally', 'fixed', 'pushed-back', 'skipped'] },
      },
    },
    isDeferred: false,
  })
}

async function loadReview($: EngineInterface, requested: PullRequestTarget, { isFreshStart }: { isFreshStart: boolean }) {
  await update($, review, current => ({ ...current, isLoading: true, error: null }))
  try {
    const fetched = await fetchReview($, requested)
    if (isFreshStart) {
      await resetWalk($)
    }
    await update($, review, current => ({
      pullRequest: fetched.pullRequest,
      threads: mergeIntoWorkingSet(isFreshStart ? [] : current.threads, fetched.threads),
      workingTreeRoot: fetched.workingTreeRoot,
      error: null,
      isLoading: false,
    }))
  } catch (error) {
    await update($, review, current => ({ ...current, isLoading: false, error: error instanceof Error ? error.message : String(error) }))
  }
}

type FetchedReview = { pullRequest: PullRequestRef; threads: ReviewThread[]; workingTreeRoot: string | null }

async function fetchReview($: EngineInterface, requested: PullRequestTarget): Promise<FetchedReview> {
  const pullRequest = parsePullRequest(await runOrThrow($, pullRequestViewArgv(requested)))
  const workingTreeRoot = await workingTreeOfBranch($, pullRequest.headBranch)
  const rawThreads = parseThreads(await runOrThrow($, threadsQueryArgv(pullRequest)))
  const threads = await Promise.all(
    rawThreads.map(async raw => toReviewThread(raw, await readAnchoredFile($, raw, pullRequest, workingTreeRoot))),
  )
  return { pullRequest, threads: sortByLocation(threads), workingTreeRoot }
}

/**
 * The repository root when the PR's branch is checked out, so excerpts show local fixes as they
 * land; null otherwise, when the working tree holds some other branch's code.
 */
async function workingTreeOfBranch($: EngineInterface, headBranch: string): Promise<string | null> {
  const currentBranch = await $.process.run(CURRENT_BRANCH_ARGV, { timeoutMs: 10_000 })
  if (currentBranch.exitCode !== 0 || currentBranch.stdout.trim() !== headBranch) return null
  return (await runOrThrow($, REPOSITORY_ROOT_ARGV)).trim()
}

async function readAnchoredFile(
  $: EngineInterface,
  raw: GraphQlThread,
  pullRequest: PullRequestRef,
  workingTreeRoot: string | null,
): Promise<string | null> {
  if (raw.isResolved || currentLineOf(raw) === null) return null
  return readReviewedFile($, raw.path, pullRequest, workingTreeRoot)
}

async function readReviewedFile(
  $: EngineInterface,
  path: string,
  pullRequest: PullRequestRef,
  workingTreeRoot: string | null,
): Promise<string | null> {
  try {
    if (workingTreeRoot !== null) return await $.fs.read(`${workingTreeRoot}/${path}`)
    return await runOrThrow($, fileAtHeadArgv(pullRequest, path))
  } catch {
    return null
  }
}

async function runOrThrow($: EngineInterface, argv: string[]): Promise<string> {
  const run = await $.process.run(argv, { timeoutMs: 30_000 })
  if (run.exitCode !== 0) {
    throw new Error(`${argv.slice(0, 3).join(' ')} failed: ${run.stderr.trim() || `exit ${run.exitCode}`}`)
  }
  return run.stdout
}

async function refreshReview($: EngineInterface) {
  const loaded = await read($, review)
  if (loaded.pullRequest !== null) await loadReview($, loaded.pullRequest.url, { isFreshStart: false })
}

async function resetWalk($: EngineInterface) {
  await update($, triage, () => ({}))
  await update($, outcomes, () => ({}))
  await update($, behaviourOverrides, () => ({}))
  await update($, expandedThreadId, () => null)
}

async function recordTriage($: EngineInterface, items: TriageInput[]): Promise<number[]> {
  const threads = (await read($, review)).threads
  const idByNumber = new Map(threads.map(thread => [thread.number, thread.id]))
  const unknown = items.filter(item => !idByNumber.has(item.number)).map(item => item.number)
  const triaged = await Promise.all(items.map(async ({ number, references, ...itemTriage }) => ({
    threadId: idByNumber.get(number),
    threadTriage: { ...itemTriage, references: await readReferences($, references ?? []) },
  })))
  await update($, triage, all => {
    const recorded = { ...all }
    for (const { threadId, threadTriage } of triaged) {
      if (threadId !== undefined) recorded[threadId] = threadTriage
    }
    return recorded
  })
  return unknown
}

async function readReferences($: EngineInterface, references: CodeReference[]): Promise<ReferenceExcerpt[]> {
  const loaded = await read($, review)
  if (loaded.pullRequest === null) return []
  return Promise.all(references.map(async reference => {
    const fileText = await readReviewedFile($, reference.path, loaded.pullRequest!, loaded.workingTreeRoot)
    return {
      path: reference.path,
      caption: reference.caption,
      excerpt: fileText === null ? null : referenceExcerpt(fileText, reference.startLine, reference.endLine),
    }
  }))
}

async function currentViews($: EngineInterface): Promise<ThreadView[]> {
  return viewsInWalkOrder((await read($, review)).threads, await read($, triage), await read($, outcomes), await read($, behaviourOverrides))
}

function sidebarActions($: EngineInterface): SidebarActions {
  return {
    refresh: () => void refreshReview($),
    fixQuickFixes: () => void submitQuickFixes($),
    commitAndPush: () => void submitPush($),
    stepThrough: () => void expandNextAfter($, null),
    toggle: threadId => void update($, expandedThreadId, current => (current === threadId ? null : threadId)),
    toggleDoneSection: () => void update($, isDoneSectionOpen, isOpen => !isOpen),
    toggleBehaviourChange: threadId => void toggleBehaviourChange($, threadId),
    fix: threadId => void decide($, threadId, { kind: 'fix' }),
    choose: (threadId, optionKey) => void decide($, threadId, { kind: 'option', optionKey }),
    pushBack: threadId => void decide($, threadId, { kind: 'push-back' }),
    discuss: threadId => void startDiscussion($, threadId),
    skip: threadId => void skipThread($, threadId),
    next: threadId => void expandNextAfter($, threadId),
  }
}

async function submitQuickFixes($: EngineInterface) {
  const quickFixes = quickFixesAwaitingDecision(await currentViews($))
  if (quickFixes.length === 0) return
  await markInProgress($, quickFixes.map(view => view.thread.id))
  await $.prompt.submit({ text: quickFixPrompt(quickFixes), asUser: true })
  await expandNextAfter($, null)
}

async function submitPush($: EngineInterface) {
  const readyToPush = sectionsOf(await currentViews($)).readyToPush
  if (readyToPush.length === 0) return
  await $.prompt.submit({ text: pushPrompt(readyToPush), asUser: true })
}

async function toggleBehaviourChange($: EngineInterface, threadId: string) {
  const view = (await currentViews($)).find(candidate => candidate.thread.id === threadId)
  if (view?.triage === undefined) return
  const isBehaviourChange = !view.triage.isBehaviourChange
  await update($, behaviourOverrides, all => ({ ...all, [threadId]: isBehaviourChange }))
}

async function decide($: EngineInterface, threadId: string, decision: Decision) {
  const views = await currentViews($)
  const view = views.find(candidate => candidate.thread.id === threadId)
  if (view === undefined) return
  const settledToo = threadsSettledBy(views, view)
  await markInProgress($, [threadId, ...settledToo.map(linked => linked.thread.id)])
  await $.prompt.submit({ text: decisionPrompt(view, decision, settledToo), asUser: true })
  await expandNextAfter($, threadId)
}

/** Threads that named this one as their root cause: deciding this one settles them too. */
function threadsSettledBy(views: readonly ThreadView[], view: ThreadView): ThreadView[] {
  return views.filter(other => other.triage?.sameAs === view.thread.number && other.outcome === undefined && !other.thread.isResolved)
}

async function startDiscussion($: EngineInterface, threadId: string) {
  const view = (await currentViews($)).find(candidate => candidate.thread.id === threadId)
  if (view === undefined) return
  await $.prompt.fill({ text: discussionPrompt(view), mode: 'insert' })
}

async function skipThread($: EngineInterface, threadId: string) {
  await update($, outcomes, all => ({ ...all, [threadId]: 'skipped' as const }))
  await expandNextAfter($, threadId)
}

async function markInProgress($: EngineInterface, threadIds: string[]) {
  await update($, outcomes, all => ({ ...all, ...Object.fromEntries(threadIds.map(id => [id, 'in-progress' as const])) }))
}

async function expandNextAfter($: EngineInterface, threadId: string | null) {
  const upcoming = nextToStepThrough(await currentViews($), threadId)
  await update($, expandedThreadId, () => upcoming?.thread.id ?? null)
}

function isReviewCommentsSkill(skill: string): boolean {
  return skill.split(':').pop() === 'review-comments'
}

/**
 * Each run of the skill is a new look at the PR, so the last run's threads and outcomes are
 * dropped and the sidebar loads GitHub afresh by itself, without waiting for Claude to call
 * review_threads: the PR the last run had, else the current branch's. With neither, it waits for
 * Claude to name one.
 */
async function startFreshWalk($: EngineInterface) {
  const previousPullRequestUrl = (await read($, review)).pullRequest?.url ?? null
  await resetWalk($)
  await update($, review, () => ({ ...EMPTY_REVIEW, isLoading: true }))
  void $.ui.open({ id: PANE, title: PANE_TITLE })
  $.clock.after(0, () => void loadOnSkillStart($, previousPullRequestUrl))
}

async function loadOnSkillStart($: EngineInterface, previousPullRequestUrl: string | null) {
  const hasPullRequest = previousPullRequestUrl !== null || (await $.process.run(pullRequestViewArgv(null), { timeoutMs: 15_000 })).exitCode === 0
  if (!hasPullRequest) {
    await update($, review, current => ({ ...current, isLoading: false }))
    return
  }
  await loadReviewOnce($, previousPullRequestUrl, { isFreshStart: true })
}

/** One load at a time: a review_threads call made while the skill's own load runs waits for it. */
let loadInFlight: Promise<void> | null = null

async function loadReviewOnce($: EngineInterface, requested: PullRequestTarget, options: { isFreshStart: boolean }) {
  loadInFlight = loadReview($, requested, options).finally(() => {
    loadInFlight = null
  })
  await loadInFlight
}

/** A registered tool's arguments arrive as fields of the call itself, beside `tool` and `tool_use_id`. */
function toolArguments<Arguments>(call: object): Arguments {
  return call as Arguments
}

/**
 * A tool hook that throws is skipped, and Claude then sees only "no hook answered", so every
 * failure comes back as a refusal that says what went wrong.
 */
async function answeredOrDenied(work: () => Promise<{ result: string } | { deny: string }>) {
  try {
    return await work()
  } catch (error) {
    return { deny: `The review sidebar failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * The threads, plus whether the person can see the sidebar: the skill walks in the sidebar only
 * when it is shown, and in chat otherwise (as in the VS Code extension's panel, which draws no panes).
 */
function threadsForClaude(loaded: ReviewSession, placement: UiOpenResult): string {
  return JSON.stringify({
    sidebar: placement.isPlaced ? { isShown: true } : { isShown: false, reason: placement.reason },
    pullRequest: loaded.pullRequest,
    threads: loaded.threads.map(({ excerpt, ...thread }) => thread),
  })
}

function isSamePullRequest(loaded: PullRequestRef | null, requested: string): boolean {
  return loaded !== null && (requested === String(loaded.number) || requested === loaded.url)
}
