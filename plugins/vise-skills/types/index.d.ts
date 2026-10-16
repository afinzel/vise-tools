export type PullRequestRef = {
  owner: string
  repo: string
  number: number
  title: string
  url: string
  headBranch: string
  headCommit: string
}

export type ReviewComment = { author: string; body: string; url: string }

export type CodeExcerpt = { source: string; startLine?: number; format: 'source' | 'diff' }

export type ReviewThread = {
  id: string
  number: number
  path: string
  line: number | null
  isOutdated: boolean
  isResolved: boolean
  url: string
  comments: ReviewComment[]
  excerpt: CodeExcerpt | null
}

export type TriageBucket = 'trivial' | 'discuss' | 'push-back'

export type ChangeScope = 'S' | 'M' | 'L'

/** One way to settle a thread that needs a decision; each becomes a button in the sidebar. */
export type DecisionOption = {
  key: string
  label: string
  scope?: ChangeScope
  isBehaviourChange?: boolean
  isRecommended?: boolean
}

/** Code beyond the commented line that the decision depends on: another call site, the other side of a drift. */
export type CodeReference = { path: string; startLine: number; endLine: number; caption?: string }

export type ReferenceExcerpt = { path: string; caption?: string; excerpt: CodeExcerpt | null }

export type ThreadTriage = {
  bucket: TriageBucket
  scope: ChangeScope
  scopeReason: string
  summary: string
  suggestion: string
  isBehaviourChange: boolean
  sameAs?: number
  options?: DecisionOption[]
  references?: ReferenceExcerpt[]
}

/** What Claude sends to review_triage for one thread: references by location, read by the mod. */
export type TriageInput = Omit<ThreadTriage, 'references'> & { number: number; references?: CodeReference[] }

/** `fixed-locally`: the change is made but not pushed, so the thread is not replied to or resolved yet. */
export type ThreadOutcome = 'in-progress' | 'fixed-locally' | 'fixed' | 'pushed-back' | 'skipped'

export type ReviewSession = {
  pullRequest: PullRequestRef | null
  threads: ReviewThread[]
  /** Where to read code from: the repository root when the PR's branch is checked out, else null (read the PR head). */
  workingTreeRoot: string | null
  error: string | null
  isLoading: boolean
}

export type ShutdownStatus = 'not-sent' | 'sent' | 'handed-off' | 'nothing-to-hand-off'

export type ShutdownSession = {
  name: string
  /** What `$.session.send` addresses: the name, with its ref when two sessions share it. Empty for this session. */
  address: string
  details: string
  isThisSession: boolean
  isSelected: boolean
  status: ShutdownStatus
  handoffPath: string | null
}

export type ShutdownRound = {
  sessions: ShutdownSession[]
  /** Replies are taken out of the conversation only while the pane shows them. */
  isPaneShown: boolean
  error: string | null
}

export type RestoreVerdict = 'resume' | 'unclear' | 'done'

/** `missing-folder`: its working directory is gone, and `--resume` from anywhere else cannot find the transcript. */
export type ReopenOutcome = 'not-yet' | 'reopened' | 'failed' | 'missing-folder'

export type RestoreCandidate = {
  id: string
  cwd: string
  label: string
  lastActive: string
  /** Its transcript was written in the last two minutes: likely still running, not lost. */
  isPossiblyStillOpen: boolean
  handoffPath: string | null
  verdict: RestoreVerdict | null
  summary: string | null
  isSelected: boolean
  reopen: ReopenOutcome
}

export type RestorePhase = 'idle' | 'finding' | 'judging' | 'ready'

export type RestoreRound = {
  hours: number
  phase: RestorePhase
  candidates: RestoreCandidate[]
  /** Why Haiku gave no verdicts; the list still works, unordered and unticked. */
  judgementProblem: string | null
  error: string | null
  isPaneShown: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'vise-skills': {
      review: ReviewSession
      triage: Record<string, ThreadTriage>
      outcomes: Record<string, ThreadOutcome>
      behaviourOverrides: Record<string, boolean>
      expandedThreadId: string | null
      isDoneSectionOpen: boolean
      shutdown: ShutdownRound
      restore: RestoreRound
    }
  }
}
