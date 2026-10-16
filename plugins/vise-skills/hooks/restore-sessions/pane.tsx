import type { ElementTable } from 'claude-code'

import type { RestoreCandidate, RestoreRound } from '../../types'
import { resumeCommand, whenActive } from './candidates'

export type PaneActions = {
  toggle: (id: string) => void
  selectRecommended: () => void
  selectAll: () => void
  selectNone: () => void
  reopen: () => void
}

const PHASE_LABELS = {
  idle: 'Run /restore-sessions to look for sessions.',
  finding: 'Reading transcripts…',
  judging: 'Asking Haiku which were mid-work…',
  ready: '',
}

export function drawPane(ui: ElementTable, round: RestoreRound, actions: PaneActions) {
  const { Box, Text } = ui
  if (round.error !== null) return <Text color="red">{round.error}</Text>
  if (round.phase === 'idle' || round.phase === 'finding') return <Text dimColor>{PHASE_LABELS[round.phase]}</Text>
  if (round.candidates.length === 0) {
    return <Text dimColor>No sessions were active in the last {round.hours}h. Run /restore-sessions with a longer window, e.g. 3d.</Text>
  }
  return (
    <Box flexDirection="column">
      {drawHeader(ui, round, actions)}
      {round.candidates.map(candidate => drawRow(ui, candidate, actions))}
    </Box>
  )
}

function drawHeader(ui: ElementTable, round: RestoreRound, actions: PaneActions) {
  const { Box, Button, Text } = ui
  const selectedCount = round.candidates.filter(candidate => candidate.isSelected && candidate.reopen === 'not-yet').length
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor>
        {round.candidates.length} sessions active in the last {round.hours}h. {PHASE_LABELS[round.phase]}
      </Text>
      {round.judgementProblem !== null && <Text color="yellow">No verdicts: {round.judgementProblem}</Text>}
      <Box gap={1}>
        <Button key="select-recommended" hotkey="r" onPress={actions.selectRecommended}>Recommended</Button>
        <Button key="select-all" hotkey="a" onPress={actions.selectAll}>All</Button>
        <Button key="select-none" hotkey="n" onPress={actions.selectNone}>None</Button>
        {selectedCount > 0 && <Button key="reopen" hotkey="o" variant="primary" onPress={actions.reopen}>{`Reopen ${selectedCount}`}</Button>}
      </Box>
    </Box>
  )
}

function drawRow(ui: ElementTable, candidate: RestoreCandidate, actions: PaneActions) {
  const { Box, Button, Text } = ui
  return (
    <Box flexDirection="column">
      {candidate.reopen === 'not-yet'
        ? (
          <Button key={`toggle-${candidate.id}`} plain onPress={() => actions.toggle(candidate.id)}>
            {candidate.isSelected ? '[x] ' : '[ ] '}
            {candidate.label} <Text dimColor>{rowDetails(candidate)}</Text>
          </Button>
        )
        : <Text>{reopenMark(candidate)} {candidate.label} <Text dimColor>{reopenLabel(candidate)}</Text></Text>}
      {candidate.summary !== null && <Text dimColor>    {candidate.summary}</Text>}
      {candidate.handoffPath !== null && <Text dimColor>    handoff: {candidate.handoffPath}</Text>}
      {candidate.reopen === 'failed' && <Text dimColor>    {resumeCommand(candidate)}</Text>}
    </Box>
  )
}

function rowDetails(candidate: RestoreCandidate): string {
  return [
    candidate.verdict,
    whenActive(candidate.lastActive),
    candidate.cwd,
    candidate.isPossiblyStillOpen ? 'may still be open' : null,
  ].filter(Boolean).join(' · ')
}

function reopenMark(candidate: RestoreCandidate): string {
  return candidate.reopen === 'reopened' ? '✓' : '✗'
}

function reopenLabel(candidate: RestoreCandidate): string {
  if (candidate.reopen === 'reopened') return 'reopened in a new tab'
  if (candidate.reopen === 'missing-folder') return `its folder is gone: ${candidate.cwd}`
  return 'could not open a tab — run this instead:'
}
