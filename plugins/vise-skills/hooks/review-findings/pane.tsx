import type { ElementTable } from 'claude-code'

import type { FindingSeverity, FindingStatus, FindingsReviewKind, FindingsRound, ReviewFinding } from '../../types'
import { SEVERITY_ICONS, locationOf, sourceLabel } from './findings'
import type { OftenDismissedRule } from './findings'

export type PaneActions = {
  toggle: (id: string) => void
  expand: (id: string) => void
  selectAll: () => void
  selectNone: () => void
  queue: () => void
  fix: () => void
  fixAndComment: () => void
  dismiss: () => void
  explain: (id: string) => void
  stepThrough: () => void
  next: (id: string) => void
  fixOne: (id: string) => void
  queueOne: (id: string) => void
  dismissOne: (id: string) => void
  unqueue: (id: string) => void
  submitReview: () => void
}

/** Colour as well as the icon, so severity reads at a glance down the list. */
const SEVERITY_COLOURS: Record<FindingSeverity, string> = { high: 'red', medium: 'yellow', low: 'cyan' }

const STATUS_LABELS: Record<FindingStatus, string> = {
  open: '',
  queued: 'in the review',
  fixing: 'fixing…',
  fixed: 'fixed',
  posted: 'posted',
  dismissed: 'dismissed',
  withdrawn: 'withdrawn by Claude',
}

export function drawPane(ui: ElementTable, kind: FindingsReviewKind, round: FindingsRound, oftenDismissed: readonly OftenDismissedRule[], actions: PaneActions) {
  const { Box, Text } = ui
  if (round.error !== null) {
    return <Text color="red">{round.error}</Text>
  }
  const open = round.findings.filter(finding => finding.status === 'open' || finding.status === 'fixing')
  const queued = round.findings.filter(finding => finding.status === 'queued')
  const settled = round.findings.filter(finding => !open.includes(finding) && !queued.includes(finding))
  return (
    <Box flexDirection="column">
      {drawHeader(ui, round)}
      {drawButtons(ui, kind, round, actions)}
      {open.map(finding => drawFinding(ui, kind, round, finding, actions))}
      {queued.length > 0 && drawReviewToPost(ui, queued, actions)}
      {settled.length > 0 && <Text dimColor>{`── done (${settled.length}) ──`}</Text>}
      {settled.map(finding => drawSettled(ui, finding))}
      {kind === 'self' && oftenDismissed.length > 0 && drawOftenDismissed(ui, oftenDismissed)}
    </Box>
  )
}

function drawHeader(ui: ElementTable, round: FindingsRound) {
  const { Box, Text } = ui
  const target = round.pullRequest === null ? 'this branch (no PR: posting is off)' : `#${round.pullRequest.number} ${round.pullRequest.title}`
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>{target}</Text>
      <Text dimColor>
        {round.findings.length} findings
        {round.sourcesPending.length > 0 ? ` · waiting on ${round.sourcesPending.map(sourceLabel).join(', ')}` : ''}
      </Text>
    </Box>
  )
}

/** One action per line, so the list fits a narrow pane. */
function drawButtons(ui: ElementTable, kind: FindingsReviewKind, round: FindingsRound, actions: PaneActions) {
  const { Box, Button } = ui
  const ticked = round.findings.filter(finding => finding.isSelected).length
  const canPost = round.pullRequest !== null
  const queuedCount = round.findings.filter(finding => finding.status === 'queued').length
  const hasOpen = round.findings.some(finding => finding.status === 'open')
  return (
    <Box flexDirection="column" marginBottom={1}>
      {canPost && queuedCount > 0 && <Button key="submit-review" hotkey="s" variant="primary" onPress={actions.submitReview}>{`Submit review (${queuedCount})`}</Button>}
      {hasOpen && ticked === 0 && <Button key="step-through" hotkey="t" onPress={actions.stepThrough}>Step through</Button>}
      <Button key="select-all" hotkey="a" onPress={actions.selectAll}>Tick all</Button>
      {ticked > 0 && <Button key="select-none" hotkey="u" onPress={actions.selectNone}>Untick all</Button>}
      {kind === 'self' && ticked > 0 && <Button key="fix" hotkey="f" onPress={actions.fix}>{`Fix ${ticked}`}</Button>}
      {kind === 'self' && ticked > 0 && canPost && <Button key="fix-and-comment" hotkey="c" onPress={actions.fixAndComment}>{`Fix + comment ${ticked}`}</Button>}
      {ticked > 0 && canPost && <Button key="queue" hotkey="r" onPress={actions.queue}>{`Add ${ticked} to review`}</Button>}
      {ticked > 0 && <Button key="dismiss" hotkey="d" onPress={actions.dismiss}>{`Dismiss ${ticked}`}</Button>}
    </Box>
  )
}

function drawFinding(ui: ElementTable, kind: FindingsReviewKind, round: FindingsRound, finding: ReviewFinding, actions: PaneActions) {
  const { Box, Button, Text } = ui
  const isExpanded = round.expandedId === finding.id
  return (
    <Box key={`finding-${finding.id}`} flexDirection="column">
      <Box gap={1}>
        <Button key={`toggle-${finding.id}`} plain onPress={() => actions.toggle(finding.id)}>
          {finding.isSelected ? '[x]' : '[ ]'}
        </Button>
        <Button key={`expand-${finding.id}`} plain onPress={() => actions.expand(finding.id)}>
          {drawSeverity(ui, finding)}{' · '}
          {finding.isBehaviourChange === true ? '⚡ ' : ''}
          {finding.shortSummary} <Text dimColor>{`${locationOf(finding)} · ${tagOf(finding)}${finding.status === 'fixing' ? ' · fixing…' : ''}`}</Text>
        </Button>
      </Box>
      {isExpanded && drawDetail(ui, kind, round, finding, actions)}
    </Box>
  )
}

/** One finding opened, as the step-through walk shows it: its code, what is wrong, and what to do about it alone. */
function drawDetail(ui: ElementTable, kind: FindingsReviewKind, round: FindingsRound, finding: ReviewFinding, actions: PaneActions) {
  const { Box, Code, Text } = ui
  const openFindings = round.findings.filter(other => other.status === 'open')
  const position = openFindings.findIndex(other => other.id === finding.id) + 1
  return (
    <Box flexDirection="column" marginLeft={2} marginBottom={1}>
      {position > 0 && <Text dimColor>{`${position} of ${openFindings.length} open`}</Text>}
      {finding.excerpt !== null && <Code source={finding.excerpt.source} path={finding.file} startLine={finding.excerpt.startLine} format={finding.excerpt.format} />}
      <Text>{finding.summary}</Text>
      {finding.failureScenario !== null && <Text dimColor>{finding.failureScenario}</Text>}
      {finding.isBehaviourChange === true && <Text color="yellow">⚡ Fixing it changes behaviour</Text>}
      {finding.isBehaviourChange === false && <Text dimColor>Fixing it leaves behaviour alone</Text>}
      {finding.isSuggestingFix && <Text dimColor>Suggesting a fix…</Text>}
      {finding.suggestedFix !== null && <Text bold>Suggested fix</Text>}
      {finding.suggestedFix !== null && <Text>{finding.suggestedFix}</Text>}
      {finding.status === 'open' && drawFindingButtons(ui, kind, round, finding, actions)}
    </Box>
  )
}

function drawFindingButtons(ui: ElementTable, kind: FindingsReviewKind, round: FindingsRound, finding: ReviewFinding, actions: PaneActions) {
  const { Box, Button } = ui
  const id = finding.id
  const hotkey = (key: string) => (round.findings.some(other => other.isSelected) ? undefined : key)
  return (
    <Box flexDirection="column" marginTop={1}>
      {kind === 'self' && <Button key={`fix-${id}`} hotkey={hotkey('f')} onPress={() => actions.fixOne(id)}>Fix</Button>}
      {round.pullRequest !== null && <Button key={`queue-${id}`} hotkey={hotkey('r')} onPress={() => actions.queueOne(id)}>Add to review</Button>}
      <Button key={`dismiss-${id}`} hotkey={hotkey('d')} onPress={() => actions.dismissOne(id)}>Dismiss</Button>
      <Button key={`explain-${id}`} hotkey={hotkey('i')} onPress={() => actions.explain(id)}>More info</Button>
      <Button key={`next-${id}`} hotkey={hotkey('n')} onPress={() => actions.next(id)}>Next</Button>
    </Box>
  )
}

/** The review being built: nothing reaches GitHub until Submit, and pressing a row takes it back out. */
function drawReviewToPost(ui: ElementTable, queued: readonly ReviewFinding[], actions: PaneActions) {
  const { Box, Button, Text } = ui
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>{`── in the review, not yet posted (${queued.length}) ──`}</Text>
      {queued.map(finding => (
        <Button key={`unqueue-${finding.id}`} plain onPress={() => actions.unqueue(finding.id)}>
          {`↩ `}{drawSeverity(ui, finding)}{` · ${finding.shortSummary}`} <Text dimColor>{locationOf(finding)}</Text>
        </Button>
      ))}
    </Box>
  )
}

function drawSettled(ui: ElementTable, finding: ReviewFinding) {
  const { Text } = ui
  return (
    <Text key={`settled-${finding.id}`} dimColor>
      {finding.status === 'dismissed' || finding.status === 'withdrawn' ? '–' : '✓'} {finding.shortSummary} · {STATUS_LABELS[finding.status]}
      {finding.commentUrl === null ? '' : ` ${finding.commentUrl}`}
    </Text>
  )
}

function drawOftenDismissed(ui: ElementTable, rules: readonly OftenDismissedRule[]) {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>Clean Code rules you often dismiss — worth rewording or dropping:</Text>
      {rules.map(rule => <Text key={`rule-${rule.rule}`} dimColor>{`  ${rule.rule}: ${rule.dismissed} of ${rule.raised} dismissed`}</Text>)}
    </Box>
  )
}

function drawSeverity(ui: ElementTable, finding: ReviewFinding) {
  const { Text } = ui
  return <Text color={SEVERITY_COLOURS[finding.severity]} bold={finding.severity === 'high'}>{`${SEVERITY_ICONS[finding.severity]} ${finding.severity}`}</Text>
}

function tagOf(finding: ReviewFinding): string {
  if (finding.rule !== null) return finding.rule
  return finding.category ?? sourceLabel(finding.source)
}
