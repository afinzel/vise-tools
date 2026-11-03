import type { CodeExcerpt, DeclinedFinding, DiscussedThread, FindingScope, FindingSeverity, FindingSource, FindingStatus, FindingsReviewKind, PullRequestRef, ReviewFinding, RuleTally } from '../../types'
import { referenceExcerpt } from '../review-comments/github-threads'
import type { GraphQlThread } from '../review-comments/github-threads'

/** A finding as a reviewer reports it: ReportFindings' shape, plus the Clean Code rule when there is one. */
export type ReportedFinding = {
  file: string
  line?: number
  summary: string
  short_summary?: string
  failure_scenario?: string
  category?: string
  rule?: string
  severity?: string
  suggested_fix?: string
  is_behaviour_change?: boolean
  scope?: string
  declined_before?: string
}

export type ReviewComment = { path: string; line: number; side: 'RIGHT'; body: string }
export type ReviewPayload = { commit_id: string; event: 'COMMENT'; body: string; comments: ReviewComment[] }

const SOURCE_LABELS: Record<FindingSource, string> = {
  claude: 'Claude code-review',
  matt: "Matt's code-review",
  'clean-code': 'Clean Code',
}

const SHORT_SUMMARY_LENGTH = 60
/** Enough of a thread for Claude to tell whether it declined something, without the whole conversation. */
const THREAD_TEXT_LENGTH = 300
const SEVERITIES: readonly FindingSeverity[] = ['high', 'medium', 'low']
const SCOPES: readonly FindingScope[] = ['introduced', 'worsened', 'pre-existing', 'off-card']
/** Scopes the PR does not own: shown apart as information, and left out of Tick all, Step through and the trivial batch. */
const INFO_SCOPES: readonly FindingScope[] = ['pre-existing', 'off-card']
export const SCOPE_LABELS: Record<FindingScope, string> = {
  introduced: 'introduced here',
  worsened: 'made worse here',
  'pre-existing': 'pre-existing',
  'off-card': 'off-card',
}
/** One icon per severity, the same in the pane, in chat and on GitHub: must fix, should fix, tidy-up. */
export const SEVERITY_ICONS: Record<FindingSeverity, string> = { high: '🔥', medium: '⚠️', low: '🧹' }

/** A low finding goes to GitHub as a nit, the reviewers' word for take-it-or-leave-it. */
const SEVERITY_BADGES: Record<FindingSeverity, string> = { high: '🔥 **High:**', medium: '⚠️ **Medium:**', low: '🧹 *nit:*' }

/** /code-review reports no severity, only a category; these say how much a category usually costs when it is wrong. */
const HIGH_CATEGORIES = ['correctness', 'security', 'data-loss', 'concurrency', 'bug']
const LOW_CATEGORIES = ['simplification', 'style', 'naming', 'readability', 'nit', 'standards']
const EXCERPT_CONTEXT_LINES = 3

/** A rule that raised at least this many findings, half or more of them dismissed, needs another look. */
const MINIMUM_RAISED_TO_JUDGE = 3
const DISMISSED_SHARE_TO_FLAG = 0.5

export function findingsFrom(source: FindingSource, reported: readonly ReportedFinding[], existing: readonly ReviewFinding[]): ReviewFinding[] {
  const taken = existing.filter(finding => finding.source === source).length
  return reported.map((finding, index) => ({
    id: `${source}-${taken + index + 1}`,
    source,
    file: finding.file,
    line: finding.line ?? null,
    summary: finding.summary,
    shortSummary: finding.short_summary ?? shortened(finding.summary),
    severity: severityOf(source, finding),
    suggestedFix: finding.suggested_fix?.trim() || null,
    isSuggestingFix: false,
    failureScenario: finding.failure_scenario?.trim() || null,
    isBehaviourChange: finding.is_behaviour_change ?? null,
    scope: scopeOf(finding.scope),
    declinedBefore: finding.declined_before?.trim() || null,
    category: finding.category ?? null,
    rule: finding.rule?.trim().toUpperCase() || null,
    status: finding.declined_before?.trim() ? 'declined-before' : 'open',
    isSelected: false,
    commentUrl: null,
    excerpt: null,
  }))
}

/** The head-side line numbers of each file in a unified diff: context and added lines, the ones GitHub can anchor to. */
export function commentableLines(diff: string): Record<string, number[]> {
  const lines: Record<string, number[]> = {}
  let file: string | null = null
  let headLine = 0
  for (const text of diff.split('\n')) {
    const header = /^\+\+\+ (?:b\/)?(.+)$/.exec(text)
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text)
    if (text.startsWith('diff --git')) file = null
    else if (header !== null) file = header[1] === '/dev/null' ? null : (header[1] ?? null)
    else if (hunk !== null) headLine = Number(hunk[1])
    else if (file !== null && headLine > 0 && (text.startsWith('+') || text.startsWith(' '))) {
      ;(lines[file] ??= []).push(headLine++)
    }
  }
  return lines
}

/**
 * One review of inline comments. A finding whose line the diff does not show cannot be an inline
 * comment, so it goes in the review's body instead, with its file and line.
 */
export function reviewPayload(
  pullRequest: PullRequestRef,
  findings: readonly ReviewFinding[],
  commentable: Record<string, number[]>,
  notes: Record<string, string> = {},
): ReviewPayload {
  const isInline = (finding: ReviewFinding) => finding.line !== null && (commentable[finding.file] ?? []).includes(finding.line)
  const outsideDiff = findings.filter(finding => !isInline(finding))
  return {
    commit_id: pullRequest.headCommit,
    event: 'COMMENT',
    body: outsideDiff.map(finding => `**${locationOf(finding)}**: ${commentBody(finding, notes[finding.id])}`).join('\n\n'),
    comments: findings.filter(isInline).map(finding => ({ path: finding.file, line: finding.line!, side: 'RIGHT', body: commentBody(finding, notes[finding.id]) })),
  }
}

export function reviewPostArgv(pullRequest: PullRequestRef): string[] {
  return ['gh', 'api', '-X', 'POST', `repos/${pullRequest.owner}/${pullRequest.repo}/pulls/${pullRequest.number}/reviews`, '--input', '-']
}

export function pullRequestDiffArgv(pullRequest: PullRequestRef): string[] {
  return ['gh', 'pr', 'diff', String(pullRequest.number), '--repo', `${pullRequest.owner}/${pullRequest.repo}`]
}

/** A note, when given, says what was done about the finding and leads the comment. */
export function commentBody(finding: ReviewFinding, note?: string): string {
  const scenario = finding.failureScenario === null ? '' : `\n\n${finding.failureScenario}`
  const suggestion = finding.suggestedFix === null ? '' : `\n\n**Suggested fix:** ${finding.suggestedFix}`
  const rule = finding.rule === null ? '' : ` (Clean Code ${finding.rule})`
  const lead = note === undefined ? '' : `${note.trim()}\n\n> `
  const outsidePr = isInfo(finding) ? ` *(${SCOPE_LABELS[finding.scope!]}, not from this PR)*` : ''
  return `${lead}${SEVERITY_BADGES[finding.severity]} ${finding.summary}${rule}${outsidePr}${note === undefined ? `${scenario}${suggestion}` : ''}`
}

/** A finding as one line of chat: icon, id, where, and what; then whether it changes behaviour and whose it is, when judged. */
export function listLine(finding: ReviewFinding): string {
  const behaviour = finding.isBehaviourChange === true ? ' ⚡ behaviour change' : ''
  const scope = isInfo(finding) ? ` · info: ${SCOPE_LABELS[finding.scope!]}` : ''
  return `${SEVERITY_ICONS[finding.severity]} **${finding.id}** ${locationOf(finding)}: ${finding.summary}${behaviour}${scope}`
}

/** One store key per PR, so dismissals on one PR never hide findings on another. */
export function pullRequestKey(pullRequest: PullRequestRef): string {
  return `${pullRequest.owner}/${pullRequest.repo}#${pullRequest.number}`
}

/** What a later round needs to recognise a dismissed finding: where it was, what it said, and when. */
export function declinedFrom(findings: readonly ReviewFinding[], declinedOn: string): DeclinedFinding[] {
  return findings.map(finding => ({ file: finding.file, line: finding.line, summary: finding.summary, rule: finding.rule, declinedOn }))
}

/** Threads with a reply, cut short: a reply is where a finding gets declined in words. */
export function discussedThreads(threads: readonly GraphQlThread[]): DiscussedThread[] {
  return threads
    .filter(thread => thread.comments.nodes.length > 1)
    .map(thread => {
      const comments = thread.comments.nodes
      const last = comments[comments.length - 1]!
      return {
        path: thread.path,
        line: thread.line ?? thread.originalLine,
        isResolved: thread.isResolved,
        url: comments[0]!.url,
        raised: clipped(comments[0]!.body),
        lastReply: `${last.author?.login ?? 'unknown'}: ${clipped(last.body)}`,
      }
    })
}

/** Pre-existing or off-card: real, maybe, but not this PR's to fix. */
export function isInfo(finding: ReviewFinding): boolean {
  return finding.scope !== null && INFO_SCOPES.includes(finding.scope)
}

/** Open, the PR's own, and judged not to change behaviour: safe to fix in one batch without asking. */
export function isTrivialFix(finding: ReviewFinding): boolean {
  return finding.status === 'open' && finding.isBehaviourChange === false && !isInfo(finding)
}

export function locationOf(finding: ReviewFinding): string {
  return finding.line === null ? finding.file : `${finding.file}:${finding.line}`
}

export function sourceLabel(source: FindingSource): string {
  return SOURCE_LABELS[source]
}

/** For Haiku: one fix for one finding, from the code around it. */
export function suggestionPrompt(finding: ReviewFinding): string {
  return [
    `A code reviewer raised this at ${locationOf(finding)}: ${finding.summary}`,
    ...(finding.failureScenario === null ? [] : [`Why it matters: ${finding.failureScenario}`]),
    ...(finding.excerpt === null ? [] : ['', 'The code around it:', '```', finding.excerpt.source, '```']),
    '',
    'Suggest the fix in at most three sentences, or a short code snippet with one line saying what it changes. Answer with the fix alone: no preamble, no restating the problem.',
  ].join('\n')
}

export function explainPrompt(finding: ReviewFinding): string {
  return [
    `Tell me more about this ${SEVERITY_ICONS[finding.severity]} ${finding.severity} ${sourceLabel(finding.source)} finding at ${locationOf(finding)}${finding.rule === null ? '' : ` (rule ${finding.rule})`}:`,
    '',
    `> ${finding.summary}`,
    ...(finding.failureScenario === null ? [] : ['>', `> ${finding.failureScenario}`]),
    '',
    ...(finding.scope === null ? [] : [`Its reviewers judged it ${SCOPE_LABELS[finding.scope]}.`]),
    'Read the code around it, then say whether it holds up, what goes wrong and when, and the change you would make. Say whether this PR introduced it: compare with the base branch. Do not edit anything.',
  ].join('\n')
}

/** With `isCommenting`, each fix is also explained on the PR, in an inline comment that says what changed. */
export function fixPrompt(kind: FindingsReviewKind, findings: readonly ReviewFinding[], { isCommenting }: { isCommenting: boolean }): string {
  const ids = findings.map(finding => finding.id)
  const steps = isCommenting
    ? [
        'Fix each, then commit and push.',
        `Then call \`mcp__vise-skills__findings_post\` with kind \`${kind}\` and one item per id, its \`note\` one line on what you changed and why, so each lands on the PR as an inline comment.`,
      ]
    : ['Fix each.']
  return [
    `Fix these review findings (${ids.join(', ')}):`,
    '',
    ...findings.flatMap(finding => [
      `- ${listLine(finding)}`,
      ...(finding.isBehaviourChange === false ? ['  No behaviour change: callers must see exactly what they see today.'] : []),
      ...(finding.isBehaviourChange === true ? ['  Changes behaviour: say what callers will see differently.'] : []),
      ...(isInfo(finding) ? [`  ${SCOPE_LABELS[finding.scope!]}, not from this PR: fix this alone, and nothing next to it.`] : []),
      ...(finding.suggestedFix === null ? [] : [`  Suggested fix (a starting point, not a given): ${finding.suggestedFix}`]),
    ]),
    '',
    ...steps,
    `Call \`mcp__vise-skills__findings_mark\` with kind \`${kind}\`, status \`fixed\` and the ids you fixed. A finding that does not hold up on a closer look: say why and mark it \`withdrawn\` instead.`,
  ].join('\n')
}

/**
 * A finding recorded by an earlier version of the mod, still held in the session after a reload,
 * lacks the fields added since; each gets the value a fresh finding would start with.
 */
export function withCurrentFields(finding: ReviewFinding): ReviewFinding {
  const recorded: Partial<ReviewFinding> = finding
  return {
    ...finding,
    severity: recorded.severity ?? severityOf(finding.source, { file: finding.file, summary: finding.summary, category: finding.category ?? undefined }),
    suggestedFix: recorded.suggestedFix ?? null,
    isSuggestingFix: recorded.isSuggestingFix ?? false,
    excerpt: recorded.excerpt ?? null,
    isBehaviourChange: recorded.isBehaviourChange ?? null,
    scope: recorded.scope ?? null,
    declinedBefore: recorded.declinedBefore ?? null,
  }
}

/** Most severe first; within a severity, in the order the reviewers reported them. */
export function bySeverity(findings: readonly ReviewFinding[]): ReviewFinding[] {
  return [...findings].sort((left, right) => SEVERITIES.indexOf(left.severity) - SEVERITIES.indexOf(right.severity))
}

/** The next of the PR's own open findings after this one, wrapping round; the first when none is given. Information is skipped. */
export function nextOpenAfter(findings: readonly ReviewFinding[], afterId: string | null): ReviewFinding | undefined {
  const start = findings.findIndex(finding => finding.id === afterId) + 1
  const rotated = [...findings.slice(start), ...findings.slice(0, start)]
  return rotated.find(finding => finding.id !== afterId && finding.status === 'open' && !isInfo(finding))
}

export function findingExcerpt(fileText: string, line: number): CodeExcerpt {
  return referenceExcerpt(fileText, line - EXCERPT_CONTEXT_LINES, line + EXCERPT_CONTEXT_LINES)
}

export function withStatus(findings: readonly ReviewFinding[], ids: readonly string[], status: FindingStatus): ReviewFinding[] {
  return findings.map(finding => (ids.includes(finding.id) ? { ...finding, status, isSelected: false } : finding))
}

/** A finding declined before was counted when it was first raised; counting it again would skew its rule. */
export function tallyRaised(tallies: Record<string, RuleTally>, findings: readonly ReviewFinding[]): Record<string, RuleTally> {
  return tallyEach(tallies, findings.filter(finding => finding.status !== 'declined-before'), tally => ({ ...tally, raised: tally.raised + 1 }))
}

export function tallyDismissed(tallies: Record<string, RuleTally>, findings: readonly ReviewFinding[]): Record<string, RuleTally> {
  return tallyEach(tallies, findings, tally => ({ ...tally, dismissed: tally.dismissed + 1 }))
}

export type OftenDismissedRule = { rule: string; raised: number; dismissed: number }

export function oftenDismissedRules(tallies: Record<string, RuleTally>): OftenDismissedRule[] {
  return Object.entries(tallies)
    .filter(([, tally]) => tally.raised >= MINIMUM_RAISED_TO_JUDGE && tally.dismissed / tally.raised >= DISMISSED_SHARE_TO_FLAG)
    .map(([rule, tally]) => ({ rule, ...tally }))
    .sort((left, right) => right.dismissed / right.raised - left.dismissed / left.raised)
}

function tallyEach(tallies: Record<string, RuleTally>, findings: readonly ReviewFinding[], change: (tally: RuleTally) => RuleTally): Record<string, RuleTally> {
  const counted = { ...tallies }
  for (const finding of findings) {
    if (finding.source !== 'clean-code' || finding.rule === null) continue
    counted[finding.rule] = change(counted[finding.rule] ?? { raised: 0, dismissed: 0 })
  }
  return counted
}

/** A reviewer's own severity wins; otherwise Claude's comes from its category, and a style rule is low. */
function severityOf(source: FindingSource, finding: ReportedFinding): FindingSeverity {
  const stated = finding.severity?.trim().toLowerCase()
  if (SEVERITIES.includes(stated as FindingSeverity)) return stated as FindingSeverity
  if (source === 'clean-code') return 'low'
  const category = finding.category?.trim().toLowerCase() ?? ''
  if (HIGH_CATEGORIES.includes(category)) return 'high'
  if (LOW_CATEGORIES.includes(category)) return 'low'
  return 'medium'
}

function scopeOf(stated: string | undefined): FindingScope | null {
  const scope = stated?.trim().toLowerCase()
  return SCOPES.includes(scope as FindingScope) ? (scope as FindingScope) : null
}

function clipped(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= THREAD_TEXT_LENGTH ? flat : `${flat.slice(0, THREAD_TEXT_LENGTH - 1)}…`
}

function shortened(summary: string): string {
  return summary.length <= SHORT_SUMMARY_LENGTH ? summary : `${summary.slice(0, SHORT_SUMMARY_LENGTH - 1)}…`
}
