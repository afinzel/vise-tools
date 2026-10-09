import type { ElementTable } from 'claude-code'

import type { DecisionOption, ReferenceExcerpt, ReviewSession, TriageBucket } from '../../types'
import type { ThreadView } from './walk-order'
import {
  doneOutcomeLabel,
  isAwaitingDecision,
  isSettled,
  locationOf,
  progressCounts,
  quickFixesAwaitingDecision,
  sectionsOf,
} from './walk-order'

export type SidebarActions = {
  refresh: () => void
  fixQuickFixes: () => void
  commitAndPush: () => void
  stepThrough: () => void
  toggle: (threadId: string) => void
  toggleDoneSection: () => void
  toggleBehaviourChange: (threadId: string) => void
  fix: (threadId: string) => void
  choose: (threadId: string, optionKey: string) => void
  pushBack: (threadId: string) => void
  discuss: (threadId: string) => void
  skip: (threadId: string) => void
  next: (threadId: string) => void
}

export type SidebarModel = {
  review: ReviewSession
  views: ThreadView[]
  expandedThreadId: string | null
  isDoneSectionOpen: boolean
}

const GROUPS: { bucket: TriageBucket | undefined; title: string }[] = [
  { bucket: 'trivial', title: '✅ Trivial' },
  { bucket: 'discuss', title: '💬 Discuss' },
  { bucket: 'push-back', title: '⚠️ Push back' },
  { bucket: undefined, title: '… Not triaged yet' },
]

const OPTION_HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

export function drawSidebar(ui: ElementTable, model: SidebarModel, actions: SidebarActions) {
  const { Box, Text } = ui
  const { review } = model

  if (review.pullRequest === null) {
    return (
      <Box flexDirection="column">
        <Text dimColor>{review.isLoading ? 'Fetching review threads…' : review.error ?? 'No PR for this branch. Waiting for Claude to load one, or run /review-comments <PR number or URL>.'}</Text>
      </Box>
    )
  }

  const sections = sectionsOf(model.views)

  return (
    <Box flexDirection="column">
      {drawHeader(ui, model, actions)}
      {drawToDoSection(ui, model, actions, sections.toDo)}
      {drawReadyToPushSection(ui, model, actions, sections.readyToPush)}
      {drawSkippedSection(ui, model, actions, sections.skipped)}
      {drawDoneSection(ui, model, actions, sections.done)}
    </Box>
  )
}

function drawHeader(ui: ElementTable, model: SidebarModel, actions: SidebarActions) {
  const { Box, Text, Button } = ui
  const { review, views } = model
  const counts = progressCounts(views)
  const quickFixes = quickFixesAwaitingDecision(views)
  const hasSteppable = views.some(view => view.triage !== undefined && !isSettled(view))

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold wrap="truncate-end">#{review.pullRequest!.number} {review.pullRequest!.title}</Text>
      <Text dimColor>
        {counts.done}/{counts.total} done
        {counts.inProgress > 0 ? ` · ${counts.inProgress} in progress` : ''}
        {counts.readyToPush > 0 ? ` · ${counts.readyToPush} ready to push` : ''}
        {counts.skipped > 0 ? ` · ${counts.skipped} skipped` : ''}
        {review.isLoading ? ' · refreshing…' : ''}
      </Text>
      {review.error !== null && <Text color="red" wrap="wrap">{review.error}</Text>}
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {quickFixes.length > 0 && (
          <Button key="fix-quick" variant="primary" onPress={actions.fixQuickFixes}>
            Fix {quickFixes.length} trivial (no behaviour change)
          </Button>
        )}
        {hasSteppable && <Button key="step-through" onPress={actions.stepThrough}>Step through</Button>}
        <Button key="refresh" onPress={actions.refresh}>Refresh</Button>
      </Box>
    </Box>
  )
}

function drawToDoSection(ui: ElementTable, model: SidebarModel, actions: SidebarActions, toDo: ThreadView[]) {
  const { Box, Text } = ui

  return (
    <Box key="section-to-do" flexDirection="column" marginBottom={1}>
      <Text bold underline>To do ({toDo.length})</Text>
      {toDo.length === 0 && <Text dimColor>Nothing left to decide.</Text>}
      {GROUPS.map(group => drawGroup(ui, model, actions, toDo, group.bucket, group.title))}
    </Box>
  )
}

function drawGroup(
  ui: ElementTable,
  model: SidebarModel,
  actions: SidebarActions,
  views: ThreadView[],
  bucket: TriageBucket | undefined,
  title: string,
) {
  const { Box, Text } = ui
  const members = views.filter(view => view.triage?.bucket === bucket)
  if (members.length === 0) {
    return null
  }

  return (
    <Box key={`group-${bucket ?? 'untriaged'}`} flexDirection="column" marginTop={1}>
      <Text bold>{title}</Text>
      {members.map(view => drawThread(ui, model, actions, view))}
    </Box>
  )
}

function drawReadyToPushSection(ui: ElementTable, model: SidebarModel, actions: SidebarActions, readyToPush: ThreadView[]) {
  const { Box, Button, Text } = ui
  if (readyToPush.length === 0) {
    return null
  }

  return (
    <Box key="section-ready-to-push" flexDirection="column" marginBottom={1}>
      <Text bold underline>Ready to push ({readyToPush.length})</Text>
      <Text dimColor>Fixed locally. Each thread is answered and resolved once the fix is pushed.</Text>
      <Button key="commit-and-push" variant="primary" onPress={actions.commitAndPush}>
        Commit & push {readyToPush.length} {readyToPush.length === 1 ? 'fix' : 'fixes'}
      </Button>
      {readyToPush.map(view => drawCompactThread(ui, model, actions, view, '◆', 'fixed locally', 'warning'))}
    </Box>
  )
}

function drawSkippedSection(ui: ElementTable, model: SidebarModel, actions: SidebarActions, skipped: ThreadView[]) {
  const { Box, Text } = ui
  if (skipped.length === 0) {
    return null
  }

  return (
    <Box key="section-skipped" flexDirection="column" marginBottom={1}>
      <Text bold underline>Skipped ({skipped.length})</Text>
      {skipped.map(view => drawThread(ui, model, actions, view))}
    </Box>
  )
}

function drawDoneSection(ui: ElementTable, model: SidebarModel, actions: SidebarActions, done: ThreadView[]) {
  const { Box, Button, Text } = ui
  if (done.length === 0) {
    return null
  }

  return (
    <Box key="section-done" flexDirection="column">
      <Button key="toggle-done" plain onPress={actions.toggleDoneSection}>
        <Text bold underline>{model.isDoneSectionOpen ? '▾' : '▸'} Done ({done.length})</Text>
      </Button>
      {model.isDoneSectionOpen && done.map(view => drawCompactThread(ui, model, actions, view, '✓', doneOutcomeLabel(view), 'success'))}
    </Box>
  )
}

/** One line per thread past its decision, still clickable to look back at what was decided. */
function drawCompactThread(
  ui: ElementTable,
  model: SidebarModel,
  actions: SidebarActions,
  view: ThreadView,
  mark: string,
  outcomeLabel: string,
  outcomeColor: 'success' | 'warning',
) {
  const { Box, Button, Text } = ui
  const { thread } = view
  const isExpanded = model.expandedThreadId === thread.id

  return (
    <Box key={`thread-${thread.id}`} flexDirection="column">
      <Button key={`row-${thread.id}`} plain onPress={() => actions.toggle(thread.id)}>
        <Text dimColor>{mark} [{thread.number}] {fileNameAndLine(thread.path, thread.line)}</Text>
        <Text color={outcomeColor}> · {outcomeLabel}</Text>
      </Button>
      {isExpanded && drawDetail(ui, model, actions, view)}
    </Box>
  )
}

function drawThread(ui: ElementTable, model: SidebarModel, actions: SidebarActions, view: ThreadView) {
  const { Box, Button, Text } = ui
  const { thread, triage } = view
  const isExpanded = model.expandedThreadId === thread.id
  const details = [thread.comments[0]?.author && `@${thread.comments[0].author}`, triage?.scope, thread.isOutdated && 'outdated']

  return (
    <Box key={`thread-${thread.id}`} flexDirection="column" marginBottom={isExpanded ? 0 : 1}>
      <Button key={`row-${thread.id}`} plain onPress={() => actions.toggle(thread.id)}>
        <Text bold={!isSettled(view)} dimColor={isSettled(view)}>
          {statusMark(view, isExpanded)} [{thread.number}] {fileNameAndLine(thread.path, thread.line)}
        </Text>
        <Text dimColor> · {details.filter(Boolean).join(' · ')}</Text>
      </Button>
      {!isExpanded && (
        <Box flexDirection="column" paddingLeft={2}>
          <Text dimColor wrap="truncate-end">"{openingLineOf(thread.comments[0]?.body ?? '')}"</Text>
          {triage !== undefined && <Text color="suggestion" wrap="truncate-end">→ {triage.summary}</Text>}
          {triage !== undefined && drawBehaviourCheckbox(ui, actions, view, 'row')}
        </Box>
      )}
      {isExpanded && drawDetail(ui, model, actions, view)}
    </Box>
  )
}

/** A checkbox while the person can still decide; the flag as plain text once the thread is settled. */
function drawBehaviourCheckbox(ui: ElementTable, actions: SidebarActions, view: ThreadView, place: 'row' | 'detail') {
  const { Button, Text } = ui
  const isBehaviourChange = view.triage!.isBehaviourChange
  const label = <Text color={isBehaviourChange ? 'warning' : 'success'}>{isBehaviourChange ? '[x] ⚡ behaviour change' : '[ ] behaviour change'}</Text>
  const setBy = view.isBehaviourFlagOverridden ? <Text dimColor> (you)</Text> : <Text dimColor> (Claude)</Text>

  if (!isAwaitingDecision(view)) {
    return <Text dimColor>{isBehaviourChange ? '⚡ behaviour change' : 'no behaviour change'}</Text>
  }
  return (
    <Button key={`behaviour-${place}-${view.thread.id}`} plain onPress={() => actions.toggleBehaviourChange(view.thread.id)}>
      {label}
      {setBy}
    </Button>
  )
}

function drawDetail(ui: ElementTable, model: SidebarModel, actions: SidebarActions, view: ThreadView) {
  const { Box, Code, Link, Markdown, Text } = ui
  const { thread, triage } = view

  return (
    <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
      <Text dimColor wrap="truncate-start">{locationOf(thread)}</Text>
      {(thread.excerpt !== null || (triage?.references?.length ?? 0) > 0) && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Code</Text>
          {thread.excerpt !== null && (
            <Code source={thread.excerpt.source} path={thread.path} startLine={thread.excerpt.startLine} format={thread.excerpt.format} />
          )}
          {triage?.references?.map((reference, index) => drawReference(ui, reference, `${thread.id}-${index}`))}
        </Box>
      )}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Comment</Text>
        {thread.comments.map((comment, index) => (
          <Box key={`comment-${thread.id}-${index}`} flexDirection="column">
            <Text color="cyan">@{comment.author}</Text>
            <Markdown text={comment.body} />
          </Box>
        ))}
      </Box>
      {triage !== undefined && (
        <Box flexDirection="column" marginTop={1} paddingX={1} borderStyle="round" borderColor="suggestion">
          <Text bold color="suggestion">Suggestion <Text dimColor>{triage.scope} — {triage.scopeReason}</Text></Text>
          <Text color="suggestion">→ {triage.summary}</Text>
          {drawBehaviourCheckbox(ui, actions, view, 'detail')}
          {drawRootCauseLinks(ui, model, view)}
          <Markdown text={triage.suggestion} />
        </Box>
      )}
      <Link href={thread.url} label="Open on GitHub" />
      {drawDecisionButtons(ui, actions, view)}
    </Box>
  )
}

function drawReference(ui: ElementTable, reference: ReferenceExcerpt, key: string) {
  const { Box, Code, Text } = ui

  return (
    <Box key={`reference-${key}`} flexDirection="column" marginTop={1}>
      {reference.caption !== undefined && <Text italic>{reference.caption}</Text>}
      <Text dimColor wrap="truncate-start">{reference.path}</Text>
      {reference.excerpt === null
        ? <Text dimColor>(could not read this file)</Text>
        : <Code source={reference.excerpt.source} path={reference.path} startLine={reference.excerpt.startLine} />}
    </Box>
  )
}

function drawRootCauseLinks(ui: ElementTable, model: SidebarModel, view: ThreadView) {
  const { Text } = ui
  const settledHere = model.views.filter(other => other.triage?.sameAs === view.thread.number)
  const sameAs = view.triage?.sameAs

  if (sameAs !== undefined) {
    return <Text dimColor>Same root cause as [{sameAs}]: deciding that one settles this one.</Text>
  }
  if (settledHere.length > 0) {
    return <Text dimColor>{settledHere.map(other => `[${other.thread.number}]`).join(', ')} share this root cause: this decision settles them too.</Text>
  }
  return null
}

function drawDecisionButtons(ui: ElementTable, actions: SidebarActions, view: ThreadView) {
  const { Box, Button, Text } = ui
  const threadId = view.thread.id
  const options = view.triage?.options ?? []

  if (isSettled(view) && view.outcome !== 'skipped') {
    return <Text dimColor>Done.</Text>
  }
  if (view.outcome === 'in-progress') {
    return <Text dimColor>Claude is on it.</Text>
  }
  if (view.outcome === 'fixed-locally') {
    return <Text dimColor>Fixed locally. Waiting for the push before replying and resolving.</Text>
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {options.length > 0 && (
        <Box flexDirection="column">
          {options.map((option, index) => drawOptionButton(ui, actions, threadId, option, OPTION_HOTKEYS[index]))}
        </Box>
      )}
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={options.length > 0 ? 1 : 0}>
        {options.length === 0 && (
          <Button key={`fix-${threadId}`} variant="primary" hotkey="f" onPress={() => actions.fix(threadId)}>Fix</Button>
        )}
        <Button key={`push-back-${threadId}`} hotkey="p" onPress={() => actions.pushBack(threadId)}>Push back</Button>
        <Button key={`discuss-${threadId}`} hotkey="d" onPress={() => actions.discuss(threadId)}>Discuss</Button>
        <Button key={`skip-${threadId}`} hotkey="s" onPress={() => actions.skip(threadId)}>Skip</Button>
        <Button key={`next-${threadId}`} hotkey="n" onPress={() => actions.next(threadId)}>Next</Button>
      </Box>
    </Box>
  )
}

function drawOptionButton(ui: ElementTable, actions: SidebarActions, threadId: string, option: DecisionOption, hotkey: string | undefined) {
  const { Button, Text } = ui
  const facts = [option.scope, option.isBehaviourChange === true && '⚡', option.isRecommended === true && 'recommended']

  return (
    <Button
      key={`option-${threadId}-${option.key}`}
      variant={option.isRecommended === true ? 'primary' : undefined}
      hotkey={hotkey}
      onPress={() => actions.choose(threadId, option.key)}
    >
      {option.label}
      <Text dimColor> {facts.filter(Boolean).join(' · ')}</Text>
    </Button>
  )
}

function statusMark(view: ThreadView, isExpanded: boolean): string {
  if (view.outcome === 'skipped' && !view.thread.isResolved) return '–'
  if (isSettled(view)) return '✓'
  if (view.outcome === 'in-progress') return '…'
  return isExpanded ? '▾' : '▸'
}

function fileNameAndLine(path: string, line: number | null): string {
  const fileName = path.split('/').pop() ?? path
  return line === null ? fileName : `${fileName}:${line}`
}

function openingLineOf(body: string): string {
  return body.split('\n').find(line => line.trim() !== '')?.trim() ?? ''
}
