import type { CodeExcerpt, PullRequestRef, ReviewComment, ReviewThread } from '../../types'

const EXCERPT_CONTEXT_LINES = 4

const THREADS_QUERY = `
query($owner:String!, $repo:String!, $pr:Int!) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$pr) {
      reviewThreads(first:100) {
        nodes {
          id isResolved isOutdated path line originalLine
          comments(first:50) { nodes { author { login } body url diffHunk } }
        }
      }
    }
  }
}`

export type GraphQlThread = {
  id: string
  isResolved: boolean
  isOutdated: boolean
  path: string
  line: number | null
  originalLine: number | null
  comments: { nodes: { author: { login: string } | null; body: string; url: string; diffHunk: string }[] }
}

export const REPOSITORY_ROOT_ARGV = ['git', 'rev-parse', '--show-toplevel']
export const CURRENT_BRANCH_ARGV = ['git', 'branch', '--show-current']

/** A PR number or URL as the person gave it; null means the current branch's PR. */
export type PullRequestTarget = string | null

export function parsePullRequestTarget(text: string): PullRequestTarget {
  const trimmed = text.trim()
  return /^(https:\/\/github\.com\/\S+\/pull\/\d+|#?\d+)$/.test(trimmed) ? trimmed.replace(/^#/, '') : null
}

export function pullRequestViewArgv(requested: PullRequestTarget): string[] {
  const target = requested === null ? [] : [requested]
  return ['gh', 'pr', 'view', ...target, '--json', 'number,title,url,headRefName,headRefOid']
}

export function fileAtHeadArgv(pullRequest: PullRequestRef, path: string): string[] {
  return [
    'gh', 'api',
    '-H', 'Accept: application/vnd.github.raw',
    `repos/${pullRequest.owner}/${pullRequest.repo}/contents/${path}?ref=${pullRequest.headCommit}`,
  ]
}

export function threadsQueryArgv(pullRequest: PullRequestRef): string[] {
  return [
    'gh', 'api', 'graphql',
    '-f', `query=${THREADS_QUERY}`,
    '-F', `owner=${pullRequest.owner}`,
    '-F', `repo=${pullRequest.repo}`,
    '-F', `pr=${pullRequest.number}`,
  ]
}

export function parsePullRequest(pullRequestJson: string): PullRequestRef {
  const pullRequest = JSON.parse(pullRequestJson)
  const [, owner = '', repo = ''] = /github\.com\/([^/]+)\/([^/]+)\/pull\//.exec(pullRequest.url) ?? []
  return {
    owner,
    repo,
    number: pullRequest.number,
    title: pullRequest.title,
    url: pullRequest.url,
    headBranch: pullRequest.headRefName,
    headCommit: pullRequest.headRefOid,
  }
}

export function parseThreads(responseJson: string): GraphQlThread[] {
  return JSON.parse(responseJson).data.repository.pullRequest.reviewThreads.nodes
}

/** The line the thread anchors to now, or null when only the original diff can show it. */
export function currentLineOf(raw: GraphQlThread): number | null {
  return raw.isOutdated ? null : raw.line ?? raw.originalLine
}

export function toReviewThread(raw: GraphQlThread, fileText: string | null): ReviewThread {
  const comments: ReviewComment[] = raw.comments.nodes.map(comment => ({
    author: comment.author?.login ?? 'ghost',
    body: comment.body,
    url: comment.url,
  }))
  const line = raw.line ?? raw.originalLine
  const currentLine = currentLineOf(raw)
  const excerpt = fileText !== null && currentLine !== null
    ? sourceExcerpt(fileText, currentLine)
    : diffExcerpt(raw.comments.nodes[0]?.diffHunk ?? '')

  return {
    id: raw.id,
    number: 0,
    path: raw.path,
    line,
    isOutdated: raw.isOutdated,
    isResolved: raw.isResolved,
    url: comments[0]?.url ?? '',
    comments,
    excerpt,
  }
}

export function sortByLocation(threads: ReviewThread[]): ReviewThread[] {
  return [...threads].sort((a, b) => a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0))
}

const MAX_REFERENCE_LINES = 40

function sourceExcerpt(fileText: string, line: number): CodeExcerpt {
  return linesExcerpt(fileText, line - EXCERPT_CONTEXT_LINES, line + EXCERPT_CONTEXT_LINES)
}

export function referenceExcerpt(fileText: string, startLine: number, endLine: number): CodeExcerpt {
  return linesExcerpt(fileText, startLine, Math.min(endLine, startLine + MAX_REFERENCE_LINES - 1))
}

function linesExcerpt(fileText: string, firstLine: number, lastLine: number): CodeExcerpt {
  const startLine = Math.max(1, firstLine)
  const source = fileText.split('\n').slice(startLine - 1, lastLine).join('\n')
  return { source, startLine, format: 'source' }
}

function diffExcerpt(diffHunk: string): CodeExcerpt | null {
  return diffHunk === '' ? null : { source: diffHunk, format: 'diff' }
}
