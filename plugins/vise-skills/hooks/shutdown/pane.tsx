import type { ElementTable } from 'claude-code'

import type { ShutdownRound, ShutdownSession, ShutdownStatus } from '../../types'
import { progressOf } from './roster'

export type PaneActions = {
  toggle: (name: string) => void
  selectAll: () => void
  selectNone: () => void
  send: () => void
  refresh: () => void
}

const STATUS_LABELS: Record<ShutdownStatus, string> = {
  'not-sent': '',
  sent: 'waiting for its handoff',
  'handed-off': 'handed off',
  'nothing-to-hand-off': 'nothing to hand off',
}

export function drawPane(ui: ElementTable, round: ShutdownRound, actions: PaneActions) {
  const { Box, Text } = ui
  if (round.error !== null) {
    return <Text color="red">{round.error}</Text>
  }
  const hasSent = progressOf(round.sessions).sent > 0
  return (
    <Box flexDirection="column">
      {hasSent ? drawProgress(ui, round, actions) : drawSelection(ui, round, actions)}
      {round.sessions.map(session => (hasSent ? drawSentRow(ui, session) : drawSelectableRow(ui, session, actions)))}
    </Box>
  )
}

function drawSelection(ui: ElementTable, round: ShutdownRound, actions: PaneActions) {
  const { Box, Button, Text } = ui
  const selectedCount = round.sessions.filter(session => session.isSelected).length
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor>Ticked sessions write a handoff at their next clean point, then reply here.</Text>
      <Box gap={1}>
        <Button key="select-all" hotkey="a" onPress={actions.selectAll}>All</Button>
        <Button key="select-none" hotkey="n" onPress={actions.selectNone}>None</Button>
        {selectedCount > 0 && <Button key="send" hotkey="s" variant="primary" onPress={actions.send}>{`Send to ${selectedCount}`}</Button>}
        <Button key="refresh" hotkey="r" onPress={actions.refresh}>Refresh</Button>
      </Box>
    </Box>
  )
}

function drawSelectableRow(ui: ElementTable, session: ShutdownSession, actions: PaneActions) {
  const { Button, Text } = ui
  return (
    <Button key={`toggle-${session.name}`} plain onPress={() => actions.toggle(session.name)}>
      {session.isSelected ? '[x] ' : '[ ] '}
      {session.name} <Text dimColor>{session.details}</Text>
    </Button>
  )
}

function drawProgress(ui: ElementTable, round: ShutdownRound, actions: PaneActions) {
  const { Box, Button, Text } = ui
  const progress = progressOf(round.sessions)
  return (
    <Box flexDirection="column" marginBottom={1}>
      {progress.isComplete
        ? <Text color="green">All {progress.sent} answered — safe to restart. /restore-sessions brings them back.</Text>
        : <Text>{progress.answered} of {progress.sent} answered. A busy session replies once it reaches a clean point.</Text>}
      <Box>
        <Button key="refresh" hotkey="r" onPress={actions.refresh}>Start over</Button>
      </Box>
    </Box>
  )
}

function drawSentRow(ui: ElementTable, session: ShutdownSession) {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column">
      <Text dimColor={session.status === 'not-sent'}>
        {statusMark(session.status)} {session.name} <Text dimColor>{session.status === 'not-sent' ? 'left out' : STATUS_LABELS[session.status]}</Text>
      </Text>
      {session.handoffPath !== null && <Text dimColor>    {session.handoffPath}</Text>}
    </Box>
  )
}

function statusMark(status: ShutdownStatus): string {
  if (status === 'handed-off' || status === 'nothing-to-hand-off') return '✓'
  if (status === 'not-sent') return '–'
  return '…'
}
