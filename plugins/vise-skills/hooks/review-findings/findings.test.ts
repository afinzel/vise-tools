import { expect, test } from 'claude-code/testing'

import { commentableLines, commentBody, findingsFrom, fixPrompt, withCurrentFields,oftenDismissedRules, reviewPayload, tallyDismissed, tallyRaised } from './findings'

const PULL_REQUEST = { owner: 'afinzel', repo: 'vise-tools', number: 12, title: 'Orders', url: 'https://github.com/afinzel/vise-tools/pull/12', headBranch: 'feat/orders', headCommit: 'abc123' }

const DIFF = [
  'diff --git a/src/orders.ts b/src/orders.ts',
  'index 1111111..2222222 100644',
  '--- a/src/orders.ts',
  '+++ b/src/orders.ts',
  '@@ -10,3 +10,4 @@ export function ship() {',
  '   const order = load()',
  '-  send(order)',
  '+  if (order.isPaid) send(order)',
  '+  audit(order)',
  '   return order',
  'diff --git a/src/gone.ts b/src/gone.ts',
  '--- a/src/gone.ts',
  '+++ /dev/null',
  '@@ -1,1 +0,0 @@',
  '-export {}',
].join('\n')

test('the diff gives each file the head-side lines GitHub can anchor to', async () => {
  expect(commentableLines(DIFF)).toEqual({ 'src/orders.ts': [10, 11, 12, 13] })
})

test('findings get per-reviewer ids that carry on from the last batch, and rule ids read upper case', async () => {
  const first = findingsFrom('clean-code', [{ file: 'src/orders.ts', line: 11, summary: 'Flag argument', rule: 'f3' }], [])
  const second = findingsFrom('clean-code', [{ file: 'src/orders.ts', summary: 'Dead function' }], first)

  expect(first[0]).toMatchObject({ id: 'clean-code-1', rule: 'F3', line: 11, status: 'open', isSelected: false })
  expect(second[0]).toMatchObject({ id: 'clean-code-2', line: null, rule: null })
})

test('a finding on a line the diff shows is inline; any other goes in the review body', async () => {
  const findings = findingsFrom('claude', [
    { file: 'src/orders.ts', line: 11, summary: 'Unpaid orders are silently dropped.', failure_scenario: 'An unpaid order returns as if shipped.' },
    { file: 'src/orders.ts', line: 40, summary: 'Retry loop never backs off.' },
  ], [])

  const payload = reviewPayload(PULL_REQUEST, findings, commentableLines(DIFF))

  expect(payload.commit_id).toBe('abc123')
  expect(payload.event).toBe('COMMENT')
  expect(payload.comments).toEqual([{ path: 'src/orders.ts', line: 11, side: 'RIGHT', body: '⚠️ **Medium:** Unpaid orders are silently dropped.\n\nAn unpaid order returns as if shipped.' }])
  expect(payload.body).toBe('**src/orders.ts:40**: ⚠️ **Medium:** Retry loop never backs off.')
})

test('a note leads the comment and quotes the finding it answers', async () => {
  const [finding] = findingsFrom('clean-code', [{ file: 'a.ts', line: 3, summary: 'Does two things.', rule: 'G30' }], [])

  expect(commentBody(finding!, 'Split into load and ship.')).toBe('Split into load and ship.\n\n> 🧹 *nit:* Does two things. (Clean Code G30)')
})

test('a Clean Code rule dismissed half the time or more, over three or more findings, is flagged', async () => {
  const raised = findingsFrom('clean-code', [
    { file: 'a.ts', summary: 'x', rule: 'G25' },
    { file: 'a.ts', summary: 'x', rule: 'G25' },
    { file: 'a.ts', summary: 'x', rule: 'G25' },
    { file: 'a.ts', summary: 'x', rule: 'N1' },
    { file: 'a.ts', summary: 'x', rule: 'N1' },
    { file: 'a.ts', summary: 'x', rule: 'N1' },
  ], [])
  const fromClaude = findingsFrom('claude', [{ file: 'a.ts', summary: 'not a rule' }], [])

  let tallies = tallyRaised({}, [...raised, ...fromClaude])
  tallies = tallyDismissed(tallies, [raised[0]!, raised[1]!, raised[3]!])

  expect(tallies).toEqual({ G25: { raised: 3, dismissed: 2 }, N1: { raised: 3, dismissed: 1 } })
  expect(oftenDismissedRules(tallies)).toEqual([{ rule: 'G25', raised: 3, dismissed: 2 }])
})

test('a finding says whether fixing it changes behaviour, or nothing when its reviewer did not judge it', async () => {
  const findings = findingsFrom('claude', [
    { file: 'a.ts', summary: 'Writes are no longer atomic.', is_behaviour_change: true },
    { file: 'a.ts', summary: 'Log line misspelt.', is_behaviour_change: false },
    { file: 'a.ts', summary: 'Unjudged.' },
  ], [])

  expect(findings.map(finding => finding.isBehaviourChange)).toEqual([true, false, null])
})

test('a fix prompt holds a finding judged not to change behaviour to that', async () => {
  const findings = findingsFrom('clean-code', [
    { file: 'a.ts', line: 3, summary: 'Does two things.', is_behaviour_change: false },
    { file: 'a.ts', line: 9, summary: 'Returns the wrong array.', is_behaviour_change: true },
  ], [])

  const prompt = fixPrompt('self', findings, { isCommenting: false })

  expect(prompt).toMatch(/clean-code-1\*\* a\.ts:3: Does two things\.\n {2}No behaviour change: callers must see exactly what they see today\./)
  expect(prompt).not.toMatch(/a\.ts:9: Returns the wrong array\.\n {2}No behaviour change/)
})

test('a finding from before severity and suggested fixes existed still makes a comment', async () => {
  const [current] = findingsFrom('matt', [{ file: 'a.ts', line: 3, summary: 'Contradicts nullable.', category: 'standards' }], [])
  const { severity, suggestedFix, isSuggestingFix, excerpt, isBehaviourChange, ...older } = current!

  const upgraded = withCurrentFields(older as never)

  expect(upgraded).toMatchObject({ severity: 'low', suggestedFix: null, isSuggestingFix: false, excerpt: null, isBehaviourChange: null })
  expect(commentBody(upgraded, 'Dropped the ?.')).toBe('Dropped the ?.\n\n> 🧹 *nit:* Contradicts nullable.')
})
