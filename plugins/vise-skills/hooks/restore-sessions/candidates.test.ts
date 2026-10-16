import { expect, test } from 'claude-code/testing'

import { candidatesFrom, hoursIn, parseJudgements, reopenArgv, resumeCommand, whenActive, withJudgements } from './candidates'
import type { FoundSession } from './candidates'

const BRAZE = '916b1b15-0000-4000-8000-000000000001'
const PINS = '1586ee97-0000-4000-8000-000000000002'
const ORDERS = '6f51741e-0000-4000-8000-000000000003'

function found(id: string, overrides: Partial<FoundSession> = {}): FoundSession {
  return { id, cwd: 'E:\\stadion\\platform-braze', title: null, lastActive: '2026-10-16T10:13+01:00', possiblyStillOpen: false, handoff: null, messages: [], ...overrides }
}

test('the window reads hours or days, and falls back to a day', async () => {
  expect(hoursIn('12h')).toBe(12)
  expect(hoursIn('3d')).toBe(72)
  expect(hoursIn('6')).toBe(6)
  expect(hoursIn(undefined)).toBe(24)
  expect(hoursIn('last week')).toBe(24)
})

test('a candidate is labelled by its title, else its folder, and starts unticked', async () => {
  const candidates = candidatesFrom([found(BRAZE, { title: 'Upgrade emails discussion' }), found(PINS, { cwd: 'E:\\work\\claude' }), found(ORDERS, { cwd: null })])

  expect(candidates.map(candidate => [candidate.label, candidate.isSelected])).toEqual([
    ['Upgrade emails discussion', false],
    ['claude', false],
  ])
})

test('verdicts tick the resume ones and order resume, unclear, done', async () => {
  const candidates = candidatesFrom([found(BRAZE), found(PINS), found(ORDERS)])
  const judgements = parseJudgements([
    `${BRAZE} | done | merged and confirmed`,
    'some chatter Haiku added',
    `${PINS} | unclear | pin pane settings`,
    `${ORDERS} | RESUME | alignment PR mid-review`,
  ].join('\n'))

  const ordered = withJudgements(candidates, judgements)

  expect(ordered.map(candidate => [candidate.id, candidate.verdict, candidate.isSelected])).toEqual([
    [ORDERS, 'resume', true],
    [PINS, 'unclear', false],
    [BRAZE, 'done', false],
  ])
  expect(ordered[0]?.summary).toBe('alignment PR mid-review')
})

test('a session reopens as a tab in its own folder, or as a command to run', async () => {
  const [candidate] = candidatesFrom([found(BRAZE, { title: 'Upgrade emails' })])

  expect(reopenArgv(candidate!)).toEqual(['wt', '-w', '0', 'new-tab', '-d', 'E:\\stadion\\platform-braze', '--title', 'Upgrade emails', 'claude', '--resume', BRAZE])
  expect(resumeCommand(candidate!)).toBe(`cd "E:\\stadion\\platform-braze" && claude --resume ${BRAZE}`)
})

test('last activity reads as a local date and time', async () => {
  expect(whenActive('2026-10-16T10:13+01:00')).toBe('2026-10-16 10:13')
})
