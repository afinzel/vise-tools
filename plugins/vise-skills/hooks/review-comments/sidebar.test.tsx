import { expect, mock, test } from 'claude-code/testing'

const PULL_REQUEST = {
  number: 279,
  title: 'feat(upgrades): priced upgrade options endpoint',
  url: 'https://github.com/stadionHQ/onebasket-products/pull/279',
  headRefName: 'feat/upgrades',
  headRefOid: 'abc123',
}

const THREADS = {
  data: { repository: { pullRequest: { reviewThreads: { nodes: [
    {
      id: 'T1', isResolved: false, isOutdated: false, path: 'src/Api/CurrencyHeader.cs', line: 3, originalLine: 3,
      comments: { nodes: [{ author: { login: 'afinzel' }, body: '`CurrencyCode.Unset = 0` is a defined member.\n\nMore detail.', url: 'https://github.com/c/1', diffHunk: '' }] },
    },
    {
      id: 'T3', isResolved: false, isOutdated: false, path: 'src/Domain/UpgradeOptionsRules.cs', line: 4, originalLine: 4,
      comments: { nodes: [{ author: { login: 'afinzel' }, body: 'This redoes the basket checks by hand.', url: 'https://github.com/c/3', diffHunk: '' }] },
    },
    {
      id: 'T2', isResolved: false, isOutdated: false, path: 'src/Domain/Rules.cs', line: 2, originalLine: 2,
      comments: { nodes: [{ author: { login: 'afinzel' }, body: 'Keying the cache on CreditPolicy gains nothing.', url: 'https://github.com/c/2', diffHunk: '' }] },
    },
  ] } } } },
}

const FILE_TEXT = 'line one\nline two\nline three\nline four'

function fakeGitHub(argv: readonly string[]): string {
  if (argv[0] === 'git') return 'some-other-branch\n'
  if (argv[1] === 'pr') return JSON.stringify(PULL_REQUEST)
  if (argv[2] === 'graphql') return JSON.stringify(THREADS)
  return FILE_TEXT
}

const PANE_PROPS = {
  title: 'Review comments',
  isFocused: true,
  bodyColumns: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`rows show the comment, the fix and the behaviour flag, and a press expands one (${surface})`, async ($, on) => {
    on('process.run', async ($, e) => ({
      value: { exitCode: 0, stdout: fakeGitHub(e.argv), stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }))
    on('ui.open', async () => ({ value: { isPlaced: true as const } }))

    await $.tool.call({ tool: 'mcp__vise-skills__review_threads' } as never)
    await $.tool.call({
      tool: 'mcp__vise-skills__review_triage',
      items: [
        { number: 1, bucket: 'trivial', scope: 'S', scopeReason: 'one line', summary: 'Reject Unset after TryParse', suggestion: 'Add `parsed != CurrencyCode.Unset`.', isBehaviourChange: true },
        { number: 2, bucket: 'trivial', scope: 'S', scopeReason: 'one line', summary: 'Drop CreditPolicy from the key', suggestion: 'Key on the variant alone.', isBehaviourChange: false },
        {
          number: 3, bucket: 'discuss', scope: 'M', scopeReason: 'two call sites', summary: 'Share one eligibility check', suggestion: 'Pick an option.', isBehaviourChange: true,
          options: [
            { key: 'a1', label: '(a) shared check, product+variant geo', scope: 'M', isBehaviourChange: true, isRecommended: true },
            { key: 'c', label: '(c) copy the basket as it is', scope: 'S' },
          ],
          references: [{ path: 'src/Domain/CountryRules.cs', startLine: 2, endLine: 3, caption: 'The basket checks only the variant' }],
        },
      ],
    } as never)

    const ui = await $.ui.mount({ plugin: 'vise-skills', surface, component: 'Pane', requestId: 'review-comments', props: PANE_PROPS })

    expect(await ui.find({ text: /CurrencyCode\.Unset = 0/ })).toBeDefined()
    expect(await ui.find({ text: /More detail/ })).toBeUndefined()
    expect(await ui.find({ text: '→ Reject Unset after TryParse' })).toBeDefined()
    expect((await ui.find({ key: 'behaviour-row-T1' }))?.text).toMatch(/\[x\] ⚡ behaviour change \(Claude\)/)
    expect((await ui.find({ key: 'behaviour-row-T2' }))?.text).toMatch(/\[ \] behaviour change \(Claude\)/)
    expect(await ui.find({ key: 'fix-quick' })).toMatchObject({ text: 'Fix 1 trivial (no behaviour change)' })

    await ui.press({ key: 'behaviour-row-T1' })

    expect((await ui.find({ key: 'behaviour-row-T1' }))?.text).toMatch(/\[ \] behaviour change \(you\)/)
    expect(await ui.find({ key: 'fix-quick' })).toMatchObject({ text: 'Fix 2 trivial (no behaviour change)' })

    await ui.press({ key: 'row-T1' })

    expect(await ui.find({ text: /More detail/ })).toBeDefined()
    expect(await ui.find({ key: 'fix-T1' })).toBeDefined()
  })

  test(`a skipped thread moves to Skipped and a fixed one to Done, which folds away (${surface})`, async ($, on) => {
    on('process.run', async ($, e) => ({
      value: { exitCode: 0, stdout: fakeGitHub(e.argv), stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }))
    on('ui.open', async () => ({ value: { isPlaced: true as const } }))
    await $.tool.call({ tool: 'mcp__vise-skills__review_threads' } as never)
    const ui = await $.ui.mount({ plugin: 'vise-skills', surface, component: 'Pane', requestId: 'review-comments', props: PANE_PROPS })
    expect(await ui.find({ text: 'To do (3)' })).toBeDefined()

    await ui.press({ key: 'row-T1' })
    await ui.press({ key: 'skip-T1' })
    await $.tool.call({ tool: 'mcp__vise-skills__review_mark', number: 2, outcome: 'fixed' } as never)

    expect(await ui.find({ text: 'To do (1)' })).toBeDefined()
    expect(await ui.find({ text: 'Skipped (1)' })).toBeDefined()
    expect((await ui.find({ key: 'toggle-done' }))?.text).toBe('▾ Done (1)')
    expect((await ui.find({ key: 'row-T2' }))?.text).toMatch(/✓ \[2\] Rules\.cs:2 · fixed/)

    await ui.press({ key: 'toggle-done' })

    expect((await ui.find({ key: 'toggle-done' }))?.text).toBe('▸ Done (1)')
    expect(await ui.find({ key: 'row-T2' })).toBeUndefined()
  })

  test(`a thread with options shows one button per option and the code it depends on (${surface})`, async ($, on) => {
    on('process.run', async ($, e) => ({
      value: { exitCode: 0, stdout: fakeGitHub(e.argv), stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }))
    on('ui.open', async () => ({ value: { isPlaced: true as const } }))
    await $.tool.call({ tool: 'mcp__vise-skills__review_threads' } as never)
    await $.tool.call({
      tool: 'mcp__vise-skills__review_triage',
      items: [{
        number: 3, bucket: 'discuss', scope: 'M', scopeReason: 'two call sites', summary: 'Share one eligibility check', suggestion: 'Pick an option.', isBehaviourChange: true,
        options: [
          { key: 'a1', label: '(a) shared check, product+variant geo', scope: 'M', isBehaviourChange: true, isRecommended: true },
          { key: 'c', label: '(c) copy the basket as it is', scope: 'S' },
        ],
        references: [{ path: 'src/Domain/CountryRules.cs', startLine: 2, endLine: 3, caption: 'The basket checks only the variant' }],
      }],
    } as never)
    const ui = await $.ui.mount({ plugin: 'vise-skills', surface, component: 'Pane', requestId: 'review-comments', props: PANE_PROPS })

    await ui.press({ key: 'row-T3' })

    expect((await ui.find({ key: 'option-T3-a1' }))?.text).toMatch(/\(a\) shared check, product\+variant geo M · ⚡ · recommended/)
    expect(await ui.find({ key: 'option-T3-c' })).toBeDefined()
    expect(await ui.find({ key: 'fix-T3' })).toBeUndefined()
    expect(await ui.find({ text: 'The basket checks only the variant' })).toBeDefined()
    expect(await ui.find({ text: 'src/Domain/CountryRules.cs' })).toBeDefined()
  })
}

test('/review-sidebar reopens the sidebar without a Claude turn', async ($, on) => {
  const opened: string[] = []
  on('ui.open', async ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })

  const ran = await $.command.run({ command: 'review-sidebar', args: '' } as never)

  expect(opened).toEqual(['review-comments'])
  expect(JSON.stringify(ran)).toContain('Review sidebar opened.')
})

test('rerunning the skill reloads the last PR by itself, without waiting for Claude', async ($, on) => {
  const clock = mock.clock(on)
  const threadQueries: string[] = []
  on('process.run', async ($, e) => {
    if (e.argv[2] === 'graphql') threadQueries.push('graphql')
    return { value: { exitCode: 0, stdout: fakeGitHub(e.argv), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('skill.prompt', async ($, e) => ({ text: e.text }))
  await $.tool.call({ tool: 'mcp__vise-skills__review_threads', pr: '279' } as never)

  await $.skill.prompt({ skill: 'vise-skills:review-comments', text: '' })
  await clock.advance(0)

  const ui = await $.ui.mount({ plugin: 'vise-skills', surface: 'terminal', component: 'Pane', requestId: 'review-comments', props: PANE_PROPS })
  expect(threadQueries).toHaveLength(2)
  expect(await ui.find({ text: 'To do (3)' })).toBeDefined()
})

test('a fix waits in Ready to push, and the push button asks for the commit', async ($, on) => {
  const submitted: string[] = []
  on('process.run', async ($, e) => ({
    value: { exitCode: 0, stdout: fakeGitHub(e.argv), stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('prompt.submit', async ($, e) => {
    submitted.push(e.text)
    return { drop: 'captured by the test' }
  })
  await $.tool.call({ tool: 'mcp__vise-skills__review_threads' } as never)
  await $.tool.call({ tool: 'mcp__vise-skills__review_mark', number: 1, outcome: 'fixed-locally' } as never)
  const ui = await $.ui.mount({ plugin: 'vise-skills', surface: 'terminal', component: 'Pane', requestId: 'review-comments', props: PANE_PROPS })

  expect(await ui.find({ text: 'To do (2)' })).toBeDefined()
  expect(await ui.find({ text: 'Ready to push (1)' })).toBeDefined()
  expect((await ui.find({ key: 'row-T1' }))?.text).toMatch(/◆ \[1\] CurrencyHeader\.cs:3 · fixed locally/)

  await ui.press({ key: 'commit-and-push' })

  expect(submitted).toHaveLength(1)
  expect(submitted[0]).toMatch(/^review-comments: commit and push the fixes for \[1\]/)
  expect(await ui.find({ text: 'Ready to push (1)' })).toBeDefined()
})
