import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FindingSource, FindingStatus, FindingsReviewKind, FindingsRound, PullRequestRef, ReviewFinding, RuleTally } from '../types'
import { BEHAVIOUR_CHANGE_DEFINITION } from './behaviour-change'
import { REPOSITORY_ROOT_ARGV, fileAtHeadArgv, parsePullRequest, parsePullRequestTarget, pullRequestViewArgv } from './review-comments/github-threads'
import {
  bySeverity,
  commentableLines,
  explainPrompt,
  listLine,
  findingExcerpt,
  findingsFrom,
  fixPrompt,
  nextOpenAfter,
  oftenDismissedRules,
  pullRequestDiffArgv,
  suggestionPrompt,
  reviewPayload,
  reviewPostArgv,
  tallyDismissed,
  tallyRaised,
  withCurrentFields,
  withStatus,
} from './review-findings/findings'
import type { ReportedFinding } from './review-findings/findings'
import { drawPane } from './review-findings/pane'
import type { PaneActions } from './review-findings/pane'
import { answeredOrDenied, toolArguments } from './tool-answers'

const PANES: Record<FindingsReviewKind, { id: string; title: string }> = {
  ext: { id: 'ext-review', title: 'External review' },
  self: { id: 'self-review', title: 'Self review' },
}
const SOURCES_RUN: Record<FindingsReviewKind, FindingSource[]> = {
  ext: ['claude'],
  self: ['clean-code', 'matt', 'claude'],
}
const TOOL_START = 'mcp__vise-skills__findings_start'
const TOOL_RECORD = 'mcp__vise-skills__findings_record'
const TOOL_POST = 'mcp__vise-skills__findings_post'
const TOOL_MARK = 'mcp__vise-skills__findings_mark'
const STORE_RULE_TALLIES = 'cleanCodeRuleTallies'

const EMPTY_ROUND: FindingsRound = { pullRequest: null, commentableLines: {}, findings: [], sourcesPending: [], expandedId: null, isPaneShown: false, error: null }

const extRound = atom({ plugin: 'vise-skills', key: 'extReview' } as const, EMPTY_ROUND)
const selfRound = atom({ plugin: 'vise-skills', key: 'selfReview' } as const, EMPTY_ROUND)
const activeReview = atom({ plugin: 'vise-skills', key: 'activeFindingsReview' } as const, null)

export const registerFindingsPanes: Register = on => {
  on('tool.call', { tool: TOOL_START }, async ($, e) => answeredOrDenied('review findings pane', async () => {
    const { kind, pr } = toolArguments<{ kind: FindingsReviewKind; pr?: string }>(e)
    await startReview($, kind, pr ?? '')
    const placement = await $.ui.open(PANES[kind])
    await updateRound($, kind, current => ({ ...current, isPaneShown: placement.isPlaced }))
    return { result: await roundForClaude($, kind) }
  }))

  on('tool.call', { tool: TOOL_RECORD }, async ($, e) => answeredOrDenied('review findings pane', async () => {
    const { kind, source, findings } = toolArguments<{ kind: FindingsReviewKind; source: FindingSource; findings: ReportedFinding[] }>(e)
    const recorded = await recordFindings($, kind, source, findings)
    return { result: [`Recorded ${recorded.length} ${source} findings.`, ...recorded.map(listLine)].join('\n') }
  }))

  on('tool.call', { tool: TOOL_POST }, async ($, e) => answeredOrDenied('review findings pane', async () => {
    const { kind, items } = toolArguments<{ kind: FindingsReviewKind; items: { id: string; note?: string }[] }>(e)
    return { result: await postReview($, kind, items.map(item => item.id), Object.fromEntries(items.filter(item => item.note).map(item => [item.id, item.note!]))) }
  }))

  on('tool.call', { tool: TOOL_MARK }, async ($, e) => answeredOrDenied('review findings pane', async () => {
    const { kind, ids, status } = toolArguments<{ kind: FindingsReviewKind; ids: string[]; status: FindingStatus }>(e)
    await markFindings($, kind, ids, status)
    return { result: `Marked ${ids.join(', ')} ${status}.` }
  }))

  on('tool.call', { tool: 'ReportFindings' }, async ($, e, next) => {
    const reported = await next(e)
    await captureClaudeReview($, e.findings as ReportedFinding[] & { outcome?: string }[])
    return reported
  })

  on('ui.render', { component: 'Pane', requestId: 'ext-review' }, async ($, e) =>
    drawPane($.ui.resolve(e), 'ext', await readRound($, 'ext'), oftenDismissedRules(await ruleTallies($)), paneActions($, 'ext')))
  on('ui.render', { component: 'Pane', requestId: 'self-review' }, async ($, e) =>
    drawPane($.ui.resolve(e), 'self', await readRound($, 'self'), oftenDismissedRules(await ruleTallies($)), paneActions($, 'self')))
}

export async function registerFindingsTools($: EngineInterface) {
  await $.tool.register({
    name: 'findings_start',
    description: 'Starts an /ext-review or /self-review: loads the PR and its diff, clears the last round, and opens the findings pane. Claude\'s /code-review findings then reach the pane by themselves; record the other reviewers\' with findings_record.',
    inputSchema: {
      type: 'object',
      required: ['kind'],
      properties: {
        kind: { enum: ['ext', 'self'] },
        pr: { type: 'string', description: 'A PR number or URL; omit for the current branch\'s PR. Required for ext.' },
      },
    },
    isDeferred: false,
  })
  await $.tool.register({
    name: 'findings_record',
    description: 'Adds one reviewer\'s findings to the findings pane. Call once per reviewer when it finishes, with an empty list when it found nothing, so the pane stops waiting on it.',
    inputSchema: {
      type: 'object',
      required: ['kind', 'source', 'findings'],
      properties: {
        kind: { enum: ['ext', 'self'] },
        source: { enum: ['clean-code', 'matt', 'claude'] },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            required: ['file', 'summary'],
            properties: {
              file: { type: 'string', description: 'Repository-relative path.' },
              line: { type: 'number', description: 'The head-side line it anchors to.' },
              summary: { type: 'string', description: 'One sentence: the defect.' },
              short_summary: { type: 'string', description: 'Under 60 characters, the claim alone.' },
              failure_scenario: { type: 'string', description: 'What goes wrong and when; for a style rule, what it costs the reader.' },
              category: { type: 'string' },
              rule: { type: 'string', description: 'Clean Code findings only: the rule id from clean-code-rules.md, e.g. G30.' },
              suggested_fix: { type: 'string', description: 'The change that would settle it: at most three sentences, or a short snippet with one line on what it changes.' },
              severity: { enum: ['high', 'medium', 'low'], description: 'high: wrong behaviour, data loss or a security hole; medium: a real cost a reviewer would ask to fix; low: style and readability.' },
              is_behaviour_change: { type: 'boolean', description: `${BEHAVIOUR_CHANGE_DEFINITION} Leave out when the reviewer did not judge it.` },
            },
          },
        },
      },
    },
    isDeferred: false,
  })
  await $.tool.register({
    name: 'findings_post',
    description: 'Posts findings to the PR as one GitHub review under the user\'s name: inline where the diff shows the line, in the review body otherwise. A `note` leads the comment, e.g. what a fix changed. Post only what the user chose.',
    inputSchema: {
      type: 'object',
      required: ['kind', 'items'],
      properties: {
        kind: { enum: ['ext', 'self'] },
        items: {
          type: 'array',
          items: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, note: { type: 'string' } } },
        },
      },
    },
    isDeferred: false,
  })
  await $.tool.register({
    name: 'findings_mark',
    description: 'Records what happened to findings: `fixed` once the change is made; `dismissed` only when the user rejects it, which counts against its Clean Code rule; `withdrawn` when you find it does not hold up, which does not.',
    inputSchema: {
      type: 'object',
      required: ['kind', 'ids', 'status'],
      properties: {
        kind: { enum: ['ext', 'self'] },
        ids: { type: 'array', items: { type: 'string' } },
        status: { enum: ['fixed', 'dismissed', 'withdrawn'] },
      },
    },
    isDeferred: false,
  })
}

async function startReview($: EngineInterface, kind: FindingsReviewKind, pr: string) {
  await update($, activeReview, () => kind)
  await updateRound($, kind, () => ({ ...EMPTY_ROUND, sourcesPending: SOURCES_RUN[kind] }))
  const view = await $.process.run(pullRequestViewArgv(parsePullRequestTarget(pr)), { timeoutMs: 30_000 })
  if (view.exitCode !== 0) {
    if (kind === 'ext') await updateRound($, kind, current => ({ ...current, error: `No PR to review: ${view.stderr.trim() || 'gh pr view failed'}` }))
    return
  }
  const pullRequest = parsePullRequest(view.stdout)
  await updateRound($, kind, current => ({ ...current, pullRequest }))
  await loadCommentableLines($, kind, pullRequest)
}

async function loadCommentableLines($: EngineInterface, kind: FindingsReviewKind, pullRequest: PullRequestRef) {
  const diff = await $.process.run(pullRequestDiffArgv(pullRequest), { timeoutMs: 60_000 })
  if (diff.exitCode === 0) await updateRound($, kind, current => ({ ...current, commentableLines: commentableLines(diff.stdout) }))
}

async function recordFindings($: EngineInterface, kind: FindingsReviewKind, source: FindingSource, reported: readonly ReportedFinding[]): Promise<ReviewFinding[]> {
  const recorded = findingsFrom(source, reported, (await readRound($, kind)).findings)
  await updateRound($, kind, current => ({
    ...current,
    findings: bySeverity([...current.findings, ...recorded]),
    sourcesPending: current.sourcesPending.filter(pending => pending !== source),
  }))
  await $.store.set(STORE_RULE_TALLIES, tallyRaised(await ruleTallies($), recorded))
  return recorded
}

/** /code-review reports through ReportFindings; while a review round runs, its findings are that round's. A re-report after fixes carries outcomes and is skipped. */
async function captureClaudeReview($: EngineInterface, reported: readonly (ReportedFinding & { outcome?: string })[]) {
  const kind = await read($, activeReview)
  if (kind === null || reported.some(finding => finding.outcome !== undefined)) return
  if (!(await readRound($, kind)).sourcesPending.includes('claude')) return
  await recordFindings($, kind, 'claude', reported)
}

function paneActions($: EngineInterface, kind: FindingsReviewKind): PaneActions {
  const setSelected = (choose: (finding: ReviewFinding) => boolean) =>
    void updateFindings($, kind, findings => findings.map(finding => ({ ...finding, isSelected: isActionable(finding) && choose(finding) })))
  return {
    toggle: id => setSelected(finding => (finding.id === id ? !finding.isSelected : finding.isSelected)),
    expand: id => void toggleOpen($, kind, id),
    selectAll: () => setSelected(() => true),
    selectNone: () => setSelected(() => false),
    queue: () => void tickedIds($, kind).then(ids => updateFindings($, kind, findings => withStatus(findings, ids, 'queued'))),
    fix: () => void tickedIds($, kind).then(ids => submitFix($, kind, ids, { isCommenting: false })),
    fixAndComment: () => void tickedIds($, kind).then(ids => submitFix($, kind, ids, { isCommenting: true })),
    dismiss: () => void tickedIds($, kind).then(ids => markFindings($, kind, ids, 'dismissed')),
    explain: id => void explain($, kind, id),
    stepThrough: () => void openNextAfter($, kind, null),
    next: id => void openNextAfter($, kind, id),
    fixOne: id => void submitFix($, kind, [id], { isCommenting: false }).then(() => openNextAfter($, kind, id)),
    queueOne: id => void updateFindings($, kind, findings => withStatus(findings, [id], 'queued')).then(() => openNextAfter($, kind, id)),
    unqueue: id => void updateFindings($, kind, findings => withStatus(findings, [id], 'open')),
    submitReview: () => void submitQueued($, kind),
    dismissOne: id => void markFindings($, kind, [id], 'dismissed').then(() => openNextAfter($, kind, id)),
  }
}

async function toggleOpen($: EngineInterface, kind: FindingsReviewKind, id: string) {
  if ((await readRound($, kind)).expandedId === id) await updateRound($, kind, current => ({ ...current, expandedId: null }))
  else await openFinding($, kind, id)
}

async function openNextAfter($: EngineInterface, kind: FindingsReviewKind, id: string | null) {
  const upcoming = nextOpenAfter((await readRound($, kind)).findings, id)
  if (upcoming === undefined) await updateRound($, kind, current => ({ ...current, expandedId: null }))
  else await openFinding($, kind, upcoming.id)
}

async function openFinding($: EngineInterface, kind: FindingsReviewKind, id: string) {
  await updateRound($, kind, current => ({ ...current, expandedId: id }))
  const finding = (await readRound($, kind)).findings.find(candidate => candidate.id === id)
  if (finding === undefined) return
  if (finding.line === null || finding.excerpt !== null) {
    await suggestFixIfMissing($, kind, id)
    return
  }
  const fileText = await readReviewedFile($, kind, finding.file)
  if (fileText !== null) {
    const excerpt = findingExcerpt(fileText, finding.line)
    await updateFinding($, kind, id, other => ({ ...other, excerpt }))
  }
  await suggestFixIfMissing($, kind, id)
}

/** Claude's /code-review reports no fix, so the first time such a finding is opened Haiku suggests one from the code around it. */
async function suggestFixIfMissing($: EngineInterface, kind: FindingsReviewKind, id: string) {
  const finding = (await readRound($, kind)).findings.find(candidate => candidate.id === id)
  if (finding === undefined || finding.suggestedFix !== null || finding.isSuggestingFix) return
  await updateFinding($, kind, id, other => ({ ...other, isSuggestingFix: true }))
  const suggestedFix = await haikuSuggestion($, finding)
  await updateFinding($, kind, id, other => ({ ...other, suggestedFix, isSuggestingFix: false }))
}

async function haikuSuggestion($: EngineInterface, finding: ReviewFinding): Promise<string | null> {
  try {
    const reply = await $.model.complete({ model: 'haiku', prompt: suggestionPrompt(finding) } as never)
    return reply.isAnswered ? reply.text.trim() || null : null
  } catch {
    return null
  }
}

async function updateFinding($: EngineInterface, kind: FindingsReviewKind, id: string, change: (finding: ReviewFinding) => ReviewFinding) {
  await updateFindings($, kind, findings => findings.map(other => (other.id === id ? change(other) : other)))
}

/** Your own branch is read from the working tree, so the excerpt shows fixes as they land; someone else's from the PR head. */
async function readReviewedFile($: EngineInterface, kind: FindingsReviewKind, path: string): Promise<string | null> {
  try {
    const { pullRequest } = await readRound($, kind)
    if (kind === 'ext' && pullRequest !== null) return await stdoutOf($, fileAtHeadArgv(pullRequest, path))
    const root = await stdoutOf($, REPOSITORY_ROOT_ARGV)
    return root === null ? null : await $.fs.read(`${root.trim()}/${path}`)
  } catch {
    return null
  }
}

async function stdoutOf($: EngineInterface, argv: string[]): Promise<string | null> {
  const run = await $.process.run(argv, { timeoutMs: 30_000 })
  return run.exitCode === 0 ? run.stdout : null
}

async function submitQueued($: EngineInterface, kind: FindingsReviewKind) {
  const queuedIds = (await readRound($, kind)).findings.filter(finding => finding.status === 'queued').map(finding => finding.id)
  $.ui.toast(await postReview($, kind, queuedIds, {}))
}

async function postReview($: EngineInterface, kind: FindingsReviewKind, ids: readonly string[], notes: Record<string, string>): Promise<string> {
  const round = await readRound($, kind)
  if (round.pullRequest === null) return 'Nothing posted: this branch has no PR.'
  const chosen = round.findings.filter(finding => ids.includes(finding.id))
  if (chosen.length === 0) return 'Nothing posted: no finding has those ids.'
  const run = await $.process.run(reviewPostArgv(round.pullRequest), { stdin: JSON.stringify(reviewPayload(round.pullRequest, chosen, round.commentableLines, notes)), timeoutMs: 30_000 })
  if (run.exitCode !== 0) return `GitHub refused the review: ${run.stderr.trim() || `exit ${run.exitCode}`}`
  const reviewUrl = (JSON.parse(run.stdout) as { html_url?: string }).html_url ?? null
  await updateFindings($, kind, findings => findings.map(finding => (ids.includes(finding.id) ? { ...finding, status: 'posted', isSelected: false, commentUrl: reviewUrl } : finding)))
  return `Posted ${chosen.length} findings as a review${reviewUrl === null ? '' : `: ${reviewUrl}`}`
}

async function submitFix($: EngineInterface, kind: FindingsReviewKind, ids: readonly string[], options: { isCommenting: boolean }) {
  const chosen = (await readRound($, kind)).findings.filter(finding => ids.includes(finding.id))
  if (chosen.length === 0) return
  await updateFindings($, kind, findings => withStatus(findings, ids, 'fixing'))
  await $.prompt.submit({ text: fixPrompt(kind, chosen, options), asUser: true })
}

async function markFindings($: EngineInterface, kind: FindingsReviewKind, ids: readonly string[], status: FindingStatus) {
  const marked = (await readRound($, kind)).findings.filter(finding => ids.includes(finding.id) && finding.status !== status)
  await updateFindings($, kind, findings => withStatus(findings, ids, status))
  if (status === 'dismissed') await $.store.set(STORE_RULE_TALLIES, tallyDismissed(await ruleTallies($), marked))
}

async function explain($: EngineInterface, kind: FindingsReviewKind, id: string) {
  const finding = (await readRound($, kind)).findings.find(candidate => candidate.id === id)
  if (finding !== undefined) await $.prompt.submit({ text: explainPrompt(finding), asUser: true })
}

async function tickedIds($: EngineInterface, kind: FindingsReviewKind): Promise<string[]> {
  return (await readRound($, kind)).findings.filter(finding => finding.isSelected).map(finding => finding.id)
}

function isActionable(finding: ReviewFinding): boolean {
  return finding.status === 'open'
}

async function ruleTallies($: EngineInterface): Promise<Record<string, RuleTally>> {
  return ((await $.store.get(STORE_RULE_TALLIES)) as Record<string, RuleTally> | undefined) ?? {}
}

async function updateFindings($: EngineInterface, kind: FindingsReviewKind, change: (findings: ReviewFinding[]) => ReviewFinding[]) {
  await updateRound($, kind, current => ({ ...current, findings: change(current.findings) }))
}

/** The engine lists the state a module touches by reading each atom's name at its call site, so each kind's atom is named here. */
async function readRound($: EngineInterface, kind: FindingsReviewKind): Promise<FindingsRound> {
  const round = kind === 'ext' ? await read($, extRound) : await read($, selfRound)
  return { ...round, findings: round.findings.map(withCurrentFields) }
}

async function updateRound($: EngineInterface, kind: FindingsReviewKind, change: (current: FindingsRound) => FindingsRound) {
  const changeCurrent = (current: FindingsRound) => change({ ...current, findings: current.findings.map(withCurrentFields) })
  if (kind === 'ext') await update($, extRound, changeCurrent)
  else await update($, selfRound, changeCurrent)
}

async function roundForClaude($: EngineInterface, kind: FindingsReviewKind): Promise<string> {
  const round = await readRound($, kind)
  return JSON.stringify({
    pane: { isShown: round.isPaneShown },
    error: round.error,
    pullRequest: round.pullRequest,
    waitingOn: round.sourcesPending,
    oftenDismissedRules: kind === 'self' ? oftenDismissedRules(await ruleTallies($)) : [],
  })
}
