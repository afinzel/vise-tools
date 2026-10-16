import { expect, test } from 'claude-code/testing'

const BRAZE = '916b1b15-0000-4000-8000-000000000001'
const PINS = '1586ee97-0000-4000-8000-000000000002'
const GONE = '6f51741e-0000-4000-8000-000000000003'

const FOUND = [
  { id: BRAZE, cwd: 'E:\\stadion\\platform-braze', title: 'Upgrade emails', lastActive: '2026-10-16T10:13+01:00', possiblyStillOpen: false, handoff: 'C:\\Temp\\handoff-braze.md', messages: [{ role: 'assistant', text: 'Two agents are working on it.' }] },
  { id: PINS, cwd: 'E:\\work\\claude', title: 'Pin lazy loading', lastActive: '2026-10-16T00:30+01:00', possiblyStillOpen: false, handoff: null, messages: [{ role: 'assistant', text: 'Nothing is lost if you close this now.' }] },
  { id: GONE, cwd: 'E:\\deleted-repo', title: 'Old worktree', lastActive: '2026-10-15T22:00+01:00', possiblyStillOpen: false, handoff: null, messages: [{ role: 'user', text: 'carry on' }] },
]

const VERDICTS = `${BRAZE} | resume | contract PR, agents mid-work\n${PINS} | done | pin pane shipped\n${GONE} | resume | worktree alignment`

const PANE_PROPS = {
  title: 'Restore sessions',
  isFocused: true,
  bodyColumns: 80,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

function processResult(stdout: string, exitCode = 0) {
  return { value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the resume ones come pre-ticked, and Reopen opens a tab for each that still has its folder (${surface})`, async ($, on) => {
    const launched: (readonly string[])[] = []
    on('ui.open', async () => ({ value: { isPlaced: true as const } }))
    on('session.id', async () => ({ value: 'this-session' }) as never)
    on('process.run', async ($, e) => {
      if (e.argv[0] === 'wt') {
        launched.push(e.argv)
        return processResult('')
      }
      return processResult(JSON.stringify(FOUND))
    })
    on('model.complete', async () => ({ value: { isAnswered: true, text: VERDICTS } }) as never)
    on('fs.exists', async ($, e) => ({ value: !String((e as { path: string }).path).includes('deleted-repo') }) as never)

    await $.tool.call({ tool: 'mcp__vise-skills__restore_sessions', window: '2d' } as never)
    const ui = await $.ui.mount({ plugin: 'vise-skills', surface, component: 'Pane', requestId: 'restore-sessions', props: PANE_PROPS })

    expect(await ui.find({ text: /3 sessions active in the last 48h/ })).toBeDefined()
    expect((await ui.find({ key: `toggle-${BRAZE}` }))?.text).toMatch(/^\[x\] Upgrade emails/)
    expect((await ui.find({ key: `toggle-${PINS}` }))?.text).toMatch(/^\[ \] Pin lazy loading/)
    expect(await ui.find({ text: /handoff: C:\\Temp\\handoff-braze\.md/ })).toBeDefined()
    expect((await ui.find({ key: 'reopen' }))?.text).toBe('Reopen 2')

    await ui.press({ key: 'reopen' })

    expect(launched).toEqual([['wt', '-w', '0', 'new-tab', '-d', 'E:\\stadion\\platform-braze', '--title', 'Upgrade emails', 'claude', '--resume', BRAZE]])
    expect(await ui.find({ text: /reopened in a new tab/ })).toBeDefined()
    expect(await ui.find({ text: /its folder is gone: E:\\deleted-repo/ })).toBeDefined()
  })
}

test('without Haiku the list still shows, unticked, and says why', async ($, on) => {
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('session.id', async () => ({ value: 'this-session' }) as never)
  on('process.run', async () => processResult(JSON.stringify(FOUND)))
  on('model.complete', async () => ({ value: { isAnswered: false, reason: 'api-error' } }) as never)

  await $.tool.call({ tool: 'mcp__vise-skills__restore_sessions' } as never)
  const ui = await $.ui.mount({ plugin: 'vise-skills', surface: 'terminal', component: 'Pane', requestId: 'restore-sessions', props: PANE_PROPS })

  expect(await ui.find({ text: /No verdicts: Haiku did not answer \(api-error\)/ })).toBeDefined()
  expect((await ui.find({ key: `toggle-${BRAZE}` }))?.text).toMatch(/^\[ \]/)
  expect(await ui.find({ key: 'reopen' })).toBeUndefined()
})

test('restore_sessions hands Claude the verdicts when nothing can show the pane', async ($, on) => {
  on('ui.open', async () => ({ value: { isPlaced: false as const, reason: 'no surface draws panes' } }) as never)
  on('session.id', async () => ({ value: 'this-session' }) as never)
  on('process.run', async () => processResult(JSON.stringify(FOUND)))
  on('model.complete', async () => ({ value: { isAnswered: true, text: VERDICTS } }) as never)

  const listed = await $.tool.call({ tool: 'mcp__vise-skills__restore_sessions' } as never)
  const answer = JSON.parse(String((listed as { result: unknown }).result))

  expect(answer.pane).toEqual({ isShown: false })
  expect(answer.candidates.map((candidate: { id: string; verdict: string }) => [candidate.id, candidate.verdict])).toEqual([
    [BRAZE, 'resume'],
    [GONE, 'resume'],
    [PINS, 'done'],
  ])
})
