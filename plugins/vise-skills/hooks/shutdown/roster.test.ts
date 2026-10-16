import { expect, test } from 'claude-code/testing'

import { handoffPathIn, handoffRequest, parseReply, parseRoster, progressOf, sessionsFrom } from './roster'

const LISTING = [
  'This session is claude-e4 [c6df3e] — the name other sessions use to message it (it is not listed below; a message to it would be a message to yourself).',
  '',
  'Peer sessions (3):',
  '  platform-braze-87 [4755af]  ·  interactive  ·  busy  ·  started 37m ago',
  '  onebasket-orders [91ab02]  ·  interactive  ·  waiting  ·  started 2h ago',
  '  nightly-report [77cd10]  ·  cloud  ·  waiting  ·  started 5h ago',
  '',
  'Subagents (1):',
  '  researcher [a1b2c3]  ·  background  ·  busy',
].join('\n')

test('the roster keeps local peers and drops cloud sessions and subagents', async () => {
  const roster = parseRoster(LISTING)

  expect(roster.thisSessionName).toBe('claude-e4')
  expect(roster.peers.map(peer => peer.name)).toEqual(['platform-braze-87', 'onebasket-orders'])
  expect(roster.peers[0]?.details).toBe('interactive · busy · started 37m ago')
})

test('this session comes first and every session starts ticked', async () => {
  const sessions = sessionsFrom(parseRoster(LISTING))

  expect(sessions.map(session => [session.name, session.isThisSession, session.isSelected])).toEqual([
    ['claude-e4', true, true],
    ['platform-braze-87', false, true],
    ['onebasket-orders', false, true],
  ])
})

test('two sessions sharing a name are addressed by name and ref', async () => {
  const listing = 'Peer sessions (2):\n  api [aaaaaa]  ·  interactive  ·  busy\n  api [bbbbbb]  ·  interactive  ·  waiting'
  const addresses = sessionsFrom(parseRoster(listing)).filter(session => !session.isThisSession).map(session => session.address)

  expect(addresses).toEqual(['api [aaaaaa]', 'api [bbbbbb]'])
})

test('the request names the recipient in the reply it asks for', async () => {
  const request = handoffRequest('platform-braze-87', 'claude-e4')

  expect(request).toMatch(/shutdown-reply platform-braze-87: <the handoff's absolute path>/)
  expect(request).toMatch(/Reply to `claude-e4`/)
  expect(request).toMatch(/Do not commit, push/)
})

test('a reply gives the handoff path, or none when there was nothing to hand off', async () => {
  expect(parseReply('shutdown-reply platform-braze-87: C:\\Users\\a\\AppData\\Local\\Temp\\handoff-braze-20261016-101500.md')).toEqual({
    name: 'platform-braze-87',
    handoffPath: 'C:\\Users\\a\\AppData\\Local\\Temp\\handoff-braze-20261016-101500.md',
  })
  expect(parseReply('shutdown-reply onebasket-orders: nothing to hand off')).toEqual({ name: 'onebasket-orders', handoffPath: null })
  expect(parseReply('an unrelated message')).toBeNull()
})

test('a handoff path is found inside a longer answer', async () => {
  expect(handoffPathIn('Written to `/tmp/handoff-pins-20261016-1015.md` — paste the prompt below.')).toBe('/tmp/handoff-pins-20261016-1015.md')
  expect(handoffPathIn('No file here.')).toBeNull()
})

test('progress counts only sessions that were sent the request', async () => {
  const sessions = sessionsFrom(parseRoster(LISTING))
  const [thisSession, braze, orders] = sessions
  const sent = [
    { ...thisSession!, status: 'handed-off' as const },
    { ...braze!, status: 'sent' as const },
    { ...orders!, status: 'not-sent' as const },
  ]

  expect(progressOf(sent)).toEqual({ sent: 2, answered: 1, isComplete: false })
  expect(progressOf(sessions)).toEqual({ sent: 0, answered: 0, isComplete: false })
})
