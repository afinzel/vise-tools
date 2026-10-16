import { expect, test } from 'claude-code/testing'

const LISTING = [
  'This session is claude-e4 [c6df3e] — the name other sessions use to message it.',
  '',
  'Peer sessions (2):',
  '  platform-braze-87 [4755af]  ·  interactive  ·  busy  ·  started 37m ago',
  '  onebasket-orders [91ab02]  ·  interactive  ·  waiting  ·  started 2h ago',
].join('\n')

const PANE_PROPS = {
  title: 'Shutdown',
  isFocused: true,
  bodyColumns: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`unticked sessions are left out, the rest are sent the request, and replies tick them off (${surface})`, async ($, on) => {
    const sent: { to: string; text: string }[] = []
    const submitted: string[] = []
    on('tool.call', { tool: 'ListAgents' }, async () => ({ result: LISTING, text: LISTING }) as never)
    on('ui.open', async () => ({ value: { isPlaced: true as const } }))
    on('session.send', async ($, e) => {
      sent.push({ to: e.to, text: e.text })
      return { isDelivered: true as const }
    })
    on('prompt.submit', async ($, e) => {
      submitted.push(e.text)
      return { drop: 'captured by the test' }
    })

    await $.tool.call({ tool: 'mcp__vise-skills__shutdown_sessions' } as never)
    const ui = await $.ui.mount({ plugin: 'vise-skills', surface, component: 'Pane', requestId: 'shutdown', props: PANE_PROPS })

    expect((await ui.find({ key: 'send' }))?.text).toBe('Send to 3')
    await ui.press({ key: 'toggle-onebasket-orders' })
    expect((await ui.find({ key: 'toggle-onebasket-orders' }))?.text).toMatch(/^\[ \] onebasket-orders/)

    await ui.press({ key: 'send' })

    expect(sent.map(message => message.to)).toEqual(['platform-braze-87'])
    expect(sent[0]?.text).toMatch(/shutdown-reply platform-braze-87:/)
    expect(submitted).toHaveLength(1)
    expect(submitted[0]).toMatch(/vise-skills:handoff/)
    expect(await ui.find({ text: /0 of 2 answered/ })).toBeDefined()

    const received = await $.session.receive({ origin: { kind: 'peer' }, text: 'shutdown-reply platform-braze-87: C:\\Temp\\handoff-braze-1.md' } as never)

    expect(received).toEqual({ consumed: 'shown in the shutdown pane' })
    expect(await ui.find({ text: /1 of 2 answered/ })).toBeDefined()
    expect(await ui.find({ text: /C:\\Temp\\handoff-braze-1\.md/ })).toBeDefined()
  })
}

test('a reply from a session that was not asked passes through untouched', async ($, on) => {
  on('tool.call', { tool: 'ListAgents' }, async () => ({ result: LISTING, text: LISTING }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('session.receive', async ($, e) => ({ text: e.text }))
  await $.tool.call({ tool: 'mcp__vise-skills__shutdown_sessions' } as never)

  const received = await $.session.receive({ origin: { kind: 'peer' }, text: 'shutdown-reply platform-braze-87: nothing to hand off' } as never)

  expect(received).toMatchObject({ text: 'shutdown-reply platform-braze-87: nothing to hand off' })
})

test('shutdown_sessions tells Claude when nothing can show the pane', async ($, on) => {
  on('tool.call', { tool: 'ListAgents' }, async () => ({ result: LISTING, text: LISTING }) as never)
  on('ui.open', async () => ({ value: { isPlaced: false as const, reason: 'no surface draws panes' } }) as never)

  const listed = await $.tool.call({ tool: 'mcp__vise-skills__shutdown_sessions' } as never)
  const answer = JSON.parse(String((listed as { result: unknown }).result))

  expect(answer.pane).toEqual({ isShown: false })
  expect(answer.sessions.map((session: { name: string }) => session.name)).toEqual(['this session', 'platform-braze-87', 'onebasket-orders'])
})
