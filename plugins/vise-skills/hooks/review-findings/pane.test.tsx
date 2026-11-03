import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PULL_REQUEST_VIEW = JSON.stringify({ number: 12, title: 'Orders', url: 'https://github.com/afinzel/vise-tools/pull/12', headRefName: 'feat/orders', headRefOid: 'abc123' })

const DIFF = [
  'diff --git a/src/orders.ts b/src/orders.ts',
  '--- a/src/orders.ts',
  '+++ b/src/orders.ts',
  '@@ -10,2 +10,3 @@',
  '   const order = load()',
  '+  if (order.isPaid) send(order)',
  '   return order',
].join('\n')

const THREADS = JSON.stringify({
  data: {
    repository: {
      pullRequest: {
        reviewThreads: {
          nodes: [
            {
              id: 't1', isResolved: false, isOutdated: false, path: 'src/orders.ts', line: 11, originalLine: 11,
              comments: { nodes: [
                { author: { login: 'dan' }, body: 'Use the block time here.', url: 'https://github.com/afinzel/vise-tools/pull/12#discussion_r1', diffHunk: '' },
                { author: { login: 'afinzel' }, body: 'No: the send time is right for ordering.', url: 'https://github.com/afinzel/vise-tools/pull/12#discussion_r2', diffHunk: '' },
              ] },
            },
            {
              id: 't2', isResolved: false, isOutdated: false, path: 'src/orders.ts', line: 12, originalLine: 12,
              comments: { nodes: [{ author: { login: 'dan' }, body: 'Nobody answered this.', url: 'https://github.com/afinzel/vise-tools/pull/12#discussion_r3', diffHunk: '' }] },
            },
          ],
        },
      },
    },
  },
})

const ORDERS_SOURCE =Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n')

const PANE_PROPS = {
  title: 'Review',
  isFocused: true,
  bodyColumns: 100,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
}

function processResult(stdout: string, exitCode = 0) {
  return { value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
}

type Posted = { argv: readonly string[]; payload: { comments: { path: string; line: number; body: string }[]; body: string } }

function github(on: On) {
  const posted: Posted[] = []
  const store = new Map<string, unknown>()
  on('process.run', async ($, e) => {
    if (e.argv[1] === 'pr' && e.argv[2] === 'view') return processResult(PULL_REQUEST_VIEW)
    if (e.argv[1] === 'pr' && e.argv[2] === 'diff') return processResult(DIFF)
    if (e.argv[1] === 'api' && e.argv[2] === 'graphql') return processResult(THREADS)
    if (e.argv[0] === 'git' && e.argv[1] === 'rev-parse') return processResult('/repo\n')
    if (e.argv[1] === 'api' && e.argv[2] === '-H') return processResult(ORDERS_SOURCE)
    posted.push({ argv: e.argv, payload: JSON.parse(String(e.init?.stdin)) })
    return processResult(JSON.stringify({ html_url: 'https://github.com/afinzel/vise-tools/pull/12#pullrequestreview-1' }))
  })
  on('store.get', async ($, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', async ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined } as never
  })
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('fs.read', async () => ({ value: ORDERS_SOURCE }) as never)
  return { posted, store }
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`ext-review: /code-review's findings fill the pane, and the ticked ones post as one review (${surface})`, async ($, on) => {
    const { posted } = github(on)
    on('tool.call', { tool: 'ReportFindings' }, async () => ({ result: 'reported' }) as never)

    await $.tool.call({ tool: 'mcp__vise-skills__findings_start', kind: 'ext', pr: '12' } as never)
    await $.tool.call({
      tool: 'ReportFindings',
      findings: [
        { file: 'src/orders.ts', line: 90, summary: 'Retry never backs off.', short_summary: 'No backoff', failure_scenario: 'Hammering on outage.', category: 'efficiency' },
        { file: 'src/orders.ts', line: 11, summary: 'Unpaid orders are silently dropped.', short_summary: 'Unpaid orders dropped', failure_scenario: 'An unpaid order returns as shipped.', category: 'correctness' },
      ],
    } as never)
    const ui = await $.ui.mount({ plugin: 'vise-skills', surface, component: 'Pane', requestId: 'ext-review', props: PANE_PROPS })

    expect(await ui.find({ text: /#12 Orders/ })).toBeDefined()
    expect(await ui.find({ text: /2 findings/ })).toBeDefined()
    expect(await ui.find({ key: 'fix' })).toBeUndefined()
    expect((await ui.find({ key: 'expand-claude-2' }))?.text).toMatch(/^🔥 high · Unpaid orders dropped/)
    expect((await ui.find({ key: 'expand-claude-1' }))?.text).toMatch(/^⚠️ medium · No backoff/)

    await ui.press({ key: 'toggle-claude-2' })
    expect((await ui.find({ key: 'queue' }))?.text).toBe('Add 1 to review')
    await ui.press({ key: 'queue' })

    expect(posted).toHaveLength(0)
    expect(await ui.find({ text: /in the review, not yet posted \(1\)/ })).toBeDefined()
    await ui.press({ key: 'submit-review' })

    expect(posted).toHaveLength(1)
    expect(posted[0]!.argv).toEqual(['gh', 'api', '-X', 'POST', 'repos/afinzel/vise-tools/pulls/12/reviews', '--input', '-'])
    expect(posted[0]!.payload.comments).toEqual([{ path: 'src/orders.ts', line: 11, side: 'RIGHT', body: '🔥 **High:** Unpaid orders are silently dropped.\n\nAn unpaid order returns as shipped.' }])
    expect(await ui.find({ text: /Unpaid orders dropped · posted/ })).toBeDefined()
  })
}

test('ext-review: Step through opens one finding at a time with its code and a suggested fix, and Add to review moves on', async ($, on) => {
  const { posted } = github(on)
  const asked: string[] = []
  on('model.complete', async ($, e) => {
    asked.push(String((e as { prompt: string }).prompt))
    return { value: { isAnswered: true, text: 'Return early when the order is unpaid.' } } as never
  })
  on('tool.call', { tool: 'ReportFindings' }, async () => ({ result: 'reported' }) as never)

  await $.tool.call({ tool: 'mcp__vise-skills__findings_start', kind: 'ext', pr: '12' } as never)
  await $.tool.call({
    tool: 'ReportFindings',
    findings: [
      { file: 'src/orders.ts', line: 11, summary: 'Unpaid orders are silently dropped.', short_summary: 'Unpaid orders dropped', failure_scenario: 'x' },
      { file: 'src/orders.ts', line: 15, summary: 'Retry never backs off.', short_summary: 'No backoff', failure_scenario: 'y' },
    ],
  } as never)
  const ui = await $.ui.mount({ plugin: 'vise-skills', surface: 'terminal', component: 'Pane', requestId: 'ext-review', props: PANE_PROPS })

  await ui.press({ key: 'step-through' })
  expect(await ui.find({ text: /1 of 2 open/ })).toBeDefined()
  expect(await ui.find({ type: 'Code' })).toBeDefined()
  expect(await ui.find({ key: 'fix-claude-1' })).toBeUndefined()
  expect(await ui.find({ text: /Return early when the order is unpaid/ })).toBeDefined()
  expect(asked[0]).toMatch(/line 11/)

  await ui.press({ key: 'queue-claude-1' })

  expect(posted).toHaveLength(0)
  expect(await ui.find({ text: /1 of 1 open/ })).toBeDefined()
  expect(await ui.find({ key: 'next-claude-2' })).toBeDefined()

  await ui.press({ key: 'dismiss-claude-2' })
  expect(await ui.find({ key: 'step-through' })).toBeUndefined()
})

test('a finding taken back out of the review is open again, and nothing posts', async ($, on) => {
  const { posted } = github(on)
  await $.tool.call({ tool: 'mcp__vise-skills__findings_start', kind: 'ext', pr: '12' } as never)
  await $.tool.call({ tool: 'mcp__vise-skills__findings_record', kind: 'ext', source: 'claude', findings: [{ file: 'src/orders.ts', summary: 'x', short_summary: 'Dropped orders', suggested_fix: 'Check isPaid first.' }] } as never)
  const ui = await $.ui.mount({ plugin: 'vise-skills', surface: 'terminal', component: 'Pane', requestId: 'ext-review', props: PANE_PROPS })

  await ui.press({ key: 'step-through' })
  expect(await ui.find({ text: /Check isPaid first/ })).toBeDefined()
  await ui.press({ key: 'queue-claude-1' })
  await ui.press({ key: 'unqueue-claude-1' })

  expect(await ui.find({ key: 'submit-review' })).toBeUndefined()
  expect(await ui.find({ key: 'toggle-claude-1' })).toBeDefined()
  expect(posted).toHaveLength(0)
})

test('self-review: waits on each reviewer, fixes ticked findings through Claude, and asks about one', async ($, on) => {
  github(on)
  const submitted: string[] = []
  on('prompt.submit', async ($, e) => {
    submitted.push(e.text)
    return { drop: 'captured by the test' }
  })

  await $.tool.call({ tool: 'mcp__vise-skills__findings_start', kind: 'self' } as never)
  const ui = await $.ui.mount({ plugin: 'vise-skills', surface: 'terminal', component: 'Pane', requestId: 'self-review', props: PANE_PROPS })
  expect(await ui.find({ text: /waiting on Clean Code, Matt's code-review, Claude code-review/ })).toBeDefined()

  await $.tool.call({ tool: 'mcp__vise-skills__findings_record', kind: 'self', source: 'clean-code', findings: [{ file: 'src/orders.ts', line: 11, summary: 'ship loads and sends.', short_summary: 'ship does two things', rule: 'G30' }] } as never)
  await $.tool.call({ tool: 'mcp__vise-skills__findings_record', kind: 'self', source: 'matt', findings: [] } as never)
  expect(await ui.find({ text: /waiting on Claude code-review$/ })).toBeDefined()

  await ui.press({ key: 'expand-clean-code-1' })
  await ui.press({ key: 'explain-clean-code-1' })
  expect(submitted[0]).toMatch(/Tell me more about this 🧹 low Clean Code finding at src\/orders\.ts:11 \(rule G30\)/)

  await ui.press({ key: 'toggle-clean-code-1' })
  expect(await ui.find({ key: 'fix-and-comment' })).toBeDefined()
  await ui.press({ key: 'fix' })

  expect(submitted[1]).toMatch(/Fix these review findings \(clean-code-1\)/)
  expect(submitted[1]).toMatch(/- 🧹 \*\*clean-code-1\*\* src\/orders\.ts:11/)
  expect(submitted[1]).toMatch(/findings_mark/)
  expect(await ui.find({ text: /fixing…/ })).toBeDefined()

  await $.tool.call({ tool: 'mcp__vise-skills__findings_mark', kind: 'self', ids: ['clean-code-1'], status: 'fixed' } as never)
  expect(await ui.find({ text: /ship does two things · fixed/ })).toBeDefined()
})

test('self-review: a finding whose fix changes behaviour is marked ⚡, and an opened one says either way', async ($, on) => {
  github(on)

  await $.tool.call({ tool: 'mcp__vise-skills__findings_start', kind: 'self' } as never)
  await $.tool.call({
    tool: 'mcp__vise-skills__findings_record',
    kind: 'self',
    source: 'claude',
    findings: [
      { file: 'src/orders.ts', line: 11, summary: 'Writes are no longer atomic.', short_summary: 'Not atomic', severity: 'high', suggested_fix: 'x', is_behaviour_change: true },
      { file: 'src/orders.ts', line: 12, summary: 'Log line misspelt.', short_summary: 'Typo in log', severity: 'low', suggested_fix: 'x', is_behaviour_change: false },
      { file: 'src/orders.ts', line: 13, summary: 'Unjudged.', short_summary: 'Unjudged', severity: 'low', suggested_fix: 'x' },
    ],
  } as never)
  const ui = await $.ui.mount({ plugin: 'vise-skills', surface: 'terminal', component: 'Pane', requestId: 'self-review', props: PANE_PROPS })

  expect((await ui.find({ key: 'expand-claude-1' }))?.text).toMatch(/^🔥 high · ⚡ behaviour change · Not atomic/)
  expect((await ui.find({ key: 'expand-claude-2' }))?.text).toMatch(/^🧹 low · Typo in log/)
  expect(await ui.find({ text: /⚡ 1 open fix changes behaviour/ })).toBeDefined()

  await ui.press({ key: 'expand-claude-1' })
  expect(await ui.find({ text: /⚡ Fixing it changes behaviour/ })).toBeDefined()
  await ui.press({ key: 'expand-claude-2' })
  expect(await ui.find({ text: /Fixing it leaves behaviour alone/ })).toBeDefined()
  await ui.press({ key: 'expand-claude-3' })
  expect(await ui.find({ text: /Fixing it (changes|leaves) behaviour/ })).toBeUndefined()
})

test('self-review: findings from outside the PR show apart as information, and Tick all and Step through pass them by', async ($, on) => {
  github(on)

  await $.tool.call({ tool: 'mcp__vise-skills__findings_start', kind: 'self' } as never)
  await $.tool.call({
    tool: 'mcp__vise-skills__findings_record',
    kind: 'self',
    source: 'matt',
    findings: [
      { file: 'src/orders.ts', line: 11, summary: 'Old holder check.', short_summary: 'Old holder check', severity: 'high', scope: 'pre-existing' },
      { file: 'src/orders.ts', line: 12, summary: 'New window bug.', short_summary: 'New window bug', severity: 'medium', scope: 'introduced' },
      { file: 'src/orders.ts', line: 13, summary: 'Not on the ticket.', short_summary: 'Not on the ticket', severity: 'low', scope: 'off-card' },
    ],
  } as never)
  const ui = await $.ui.mount({ plugin: 'vise-skills', surface: 'terminal', component: 'Pane', requestId: 'self-review', props: PANE_PROPS })

  expect(await ui.find({ text: /3 findings · 2 info/ })).toBeDefined()
  expect(await ui.find({ text: /info: not from this PR \(2\)/ })).toBeDefined()
  expect((await ui.find({ key: 'expand-matt-1' }))?.text).toMatch(/pre-existing/)

  await ui.press({ key: 'select-all' })
  expect((await ui.find({ key: 'fix' }))?.text).toBe('Fix 1')
  await ui.press({ key: 'select-none' })

  await ui.press({ key: 'step-through' })
  expect(await ui.find({ key: 'fix-matt-2' })).toBeDefined()
  await ui.press({ key: 'expand-matt-1' })
  expect(await ui.find({ text: /Scope: pre-existing — information/ })).toBeDefined()
})

test('self-review: Fix trivial sends only the PR\'s own findings that leave behaviour alone', async ($, on) => {
  github(on)
  const submitted: string[] = []
  on('prompt.submit', async ($, e) => {
    submitted.push(e.text)
    return { drop: 'captured by the test' }
  })

  await $.tool.call({ tool: 'mcp__vise-skills__findings_start', kind: 'self' } as never)
  await $.tool.call({
    tool: 'mcp__vise-skills__findings_record',
    kind: 'self',
    source: 'clean-code',
    findings: [
      { file: 'src/orders.ts', line: 11, summary: 'Rename.', short_summary: 'Rename', rule: 'N1', is_behaviour_change: false },
      { file: 'src/orders.ts', line: 12, summary: 'Retry.', short_summary: 'Retry', rule: 'G1', is_behaviour_change: true },
      { file: 'src/orders.ts', line: 13, summary: 'Old rename.', short_summary: 'Old rename', rule: 'N1', is_behaviour_change: false, scope: 'pre-existing' },
      { file: 'src/orders.ts', line: 14, summary: 'Extract.', short_summary: 'Extract', rule: 'G30', is_behaviour_change: false },
    ],
  } as never)
  const ui = await $.ui.mount({ plugin: 'vise-skills', surface: 'terminal', component: 'Pane', requestId: 'self-review', props: PANE_PROPS })

  expect((await ui.find({ key: 'fix-trivial' }))?.text).toBe('Fix 2 trivial (no behaviour change)')
  await ui.press({ key: 'fix-trivial' })

  expect(submitted[0]).toMatch(/Fix these review findings \(clean-code-1, clean-code-4\)/)
  expect(await ui.find({ key: 'fix-trivial' })).toBeUndefined()
})

test('ext-review: no trivial fix button, since nothing is fixed there', async ($, on) => {
  github(on)

  await $.tool.call({ tool: 'mcp__vise-skills__findings_start', kind: 'ext', pr: '12' } as never)
  await $.tool.call({ tool: 'mcp__vise-skills__findings_record', kind: 'ext', source: 'claude', findings: [{ file: 'src/orders.ts', summary: 'Rename.', is_behaviour_change: false }] } as never)
  const ui = await $.ui.mount({ plugin: 'vise-skills', surface: 'terminal', component: 'Pane', requestId: 'ext-review', props: PANE_PROPS })

  expect(await ui.find({ key: 'fix-trivial' })).toBeUndefined()
})

test('self-review: a dismissed finding is remembered for the PR, and the next round is told about it and the answered threads', async ($, on) => {
  const { store } = github(on)

  await $.tool.call({ tool: 'mcp__vise-skills__findings_start', kind: 'self', pr: '12' } as never)
  await $.tool.call({ tool: 'mcp__vise-skills__findings_record', kind: 'self', source: 'matt', findings: [{ file: 'src/orders.ts', line: 11, summary: 'Holder uses the send time.' }] } as never)
  await $.tool.call({ tool: 'mcp__vise-skills__findings_mark', kind: 'self', ids: ['matt-1'], status: 'dismissed' } as never)

  expect((store.get('declinedFindings') as Record<string, unknown[]>)['afinzel/vise-tools#12']).toMatchObject([{ file: 'src/orders.ts', line: 11, summary: 'Holder uses the send time.', rule: null }])

  const started = await $.tool.call({ tool: 'mcp__vise-skills__findings_start', kind: 'self', pr: '12' } as never)
  const answer = JSON.parse(String((started as { result: unknown }).result))

  expect(answer.declinedBefore).toMatchObject([{ file: 'src/orders.ts', summary: 'Holder uses the send time.' }])
  expect(answer.discussedThreads).toEqual([{
    path: 'src/orders.ts',
    line: 11,
    isResolved: false,
    url: 'https://github.com/afinzel/vise-tools/pull/12#discussion_r1',
    raised: 'Use the block time here.',
    lastReply: 'afinzel: No: the send time is right for ordering.',
  }])
})

test('self-review: a finding declined before lands settled, with where and why, and is not counted against its rule again', async ($, on) => {
  const { store } = github(on)

  await $.tool.call({ tool: 'mcp__vise-skills__findings_start', kind: 'self', pr: '12' } as never)
  await $.tool.call({
    tool: 'mcp__vise-skills__findings_record',
    kind: 'self',
    source: 'clean-code',
    findings: [
      { file: 'src/orders.ts', line: 11, summary: 'Flag argument.', short_summary: 'Flag argument', rule: 'F3', declined_before: 'dismissed on 2026-11-03' },
      { file: 'src/orders.ts', line: 12, summary: 'Magic 30.', short_summary: 'Magic 30', rule: 'G25' },
    ],
  } as never)
  const ui = await $.ui.mount({ plugin: 'vise-skills', surface: 'terminal', component: 'Pane', requestId: 'self-review', props: PANE_PROPS })

  expect(await ui.find({ key: 'toggle-clean-code-1' })).toBeUndefined()
  expect(await ui.find({ text: /Flag argument · declined before: dismissed on 2026-11-03/ })).toBeDefined()
  expect(store.get('cleanCodeRuleTallies')).toEqual({ G25: { raised: 1, dismissed: 0 } })
})

test('self-review: a rule dismissed again and again is listed for rewording', async ($, on) => {
  const { store } = github(on)
  store.set('cleanCodeRuleTallies', { G25: { raised: 4, dismissed: 1 } })

  await $.tool.call({ tool: 'mcp__vise-skills__findings_start', kind: 'self' } as never)
  await $.tool.call({ tool: 'mcp__vise-skills__findings_record', kind: 'self', source: 'clean-code', findings: [{ file: 'a.ts', line: 1, summary: 'Magic 30.', rule: 'G25' }, { file: 'a.ts', line: 2, summary: 'Magic 7.', rule: 'G25' }] } as never)
  const ui = await $.ui.mount({ plugin: 'vise-skills', surface: 'terminal', component: 'Pane', requestId: 'self-review', props: PANE_PROPS })
  expect(await ui.find({ text: /rules you often dismiss/ })).toBeUndefined()

  await ui.press({ key: 'select-all' })
  await ui.press({ key: 'dismiss' })

  expect(store.get('cleanCodeRuleTallies')).toEqual({ G25: { raised: 6, dismissed: 3 } })
  expect(await ui.find({ text: /G25: 3 of 6 dismissed/ })).toBeDefined()
})

test('self-review: a finding Claude withdraws is shown apart and not counted against its rule', async ($, on) => {
  const { store } = github(on)

  await $.tool.call({ tool: 'mcp__vise-skills__findings_start', kind: 'self' } as never)
  await $.tool.call({ tool: 'mcp__vise-skills__findings_record', kind: 'self', source: 'clean-code', findings: [{ file: 'a.ts', line: 1, summary: 'Magic 30.', short_summary: 'Magic 30', rule: 'G25' }] } as never)
  await $.tool.call({ tool: 'mcp__vise-skills__findings_mark', kind: 'self', ids: ['clean-code-1'], status: 'withdrawn' } as never)
  const ui = await $.ui.mount({ plugin: 'vise-skills', surface: 'terminal', component: 'Pane', requestId: 'self-review', props: PANE_PROPS })

  expect(await ui.find({ text: /Magic 30 · withdrawn by Claude/ })).toBeDefined()
  expect(store.get('cleanCodeRuleTallies')).toEqual({ G25: { raised: 1, dismissed: 0 } })
})

test('a /code-review outside a review round, or re-reporting fixes, leaves the panes alone', async ($, on) => {
  github(on)
  on('tool.call', { tool: 'ReportFindings' }, async () => ({ result: 'reported' }) as never)

  await $.tool.call({ tool: 'ReportFindings', findings: [{ file: 'a.ts', summary: 'x', failure_scenario: 'y' }] } as never)
  await $.tool.call({ tool: 'mcp__vise-skills__findings_start', kind: 'ext', pr: '12' } as never)
  await $.tool.call({ tool: 'ReportFindings', findings: [{ file: 'a.ts', summary: 'x', failure_scenario: 'y', outcome: 'fixed' }] } as never)

  const ui = await $.ui.mount({ plugin: 'vise-skills', surface: 'terminal', component: 'Pane', requestId: 'ext-review', props: PANE_PROPS })
  expect(await ui.find({ text: /0 findings/ })).toBeDefined()
})
