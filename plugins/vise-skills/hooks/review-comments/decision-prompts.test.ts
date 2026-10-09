import { expect, test } from 'claude-code/testing'

import type { ReviewThread, ThreadTriage } from '../../types'
import { decisionPrompt, pushPrompt, quickFixPrompt } from './decision-prompts'
import type { ThreadView } from './walk-order'

function view(number: number, triage: Partial<ThreadTriage> = {}, isBehaviourFlagOverridden = false): ThreadView {
  const thread: ReviewThread = {
    id: `T${number}`, number, path: 'src/Rules.cs', line: 190, isOutdated: false, isResolved: false, url: '', comments: [], excerpt: null,
  }
  const fullTriage: ThreadTriage = { bucket: 'discuss', scope: 'M', scopeReason: '', summary: '', suggestion: '', isBehaviourChange: true, ...triage }
  return { thread, triage: fullTriage, outcome: undefined, isBehaviourFlagOverridden }
}

test('a fix names the thread and asks for a reply and resolve', async () => {
  expect(decisionPrompt(view(1), { kind: 'fix' }, []))
    .toBe('review-comments: fix [1] (src/Rules.cs:190) as suggested. Then mark it fixed-locally: do not reply on or resolve the thread, and do not commit or push, until I ask for the push.')
})

test('choosing an option names it, and the threads it settles too', async () => {
  const withOptions = view(2, { options: [{ key: 'a1', label: '(a) shared check, product+variant geo' }] })
  expect(decisionPrompt(withOptions, { kind: 'option', optionKey: 'a1' }, [view(3, { sameAs: 2 })])).toBe(
    'review-comments: for [2] (src/Rules.cs:190), go with (a) shared check, product+variant geo. '
    + 'This also settles [3], which share the root cause. Make the change. '
    + 'Then mark each fixed-locally: do not reply on or resolve the threads, and do not commit or push, until I ask for the push.',
  )
})

test('a behaviour flag the person changed is passed on', async () => {
  expect(decisionPrompt(view(1, { isBehaviourChange: false }, true), { kind: 'fix' }, []))
    .toContain('I\'ve marked it as not changing behaviour, so keep the fix to that.')
})

test('the quick-fix batch lists its threads', async () => {
  expect(quickFixPrompt([view(1), view(4)])).toBe(
    'review-comments: fix [1], [4] as suggested (trivial, no behaviour change). '
    + 'Then mark each fixed-locally: do not reply on or resolve the threads, and do not commit or push, until I ask for the push.',
  )
})

test('the push button asks for the commit and push, then the replies and resolves', async () => {
  expect(pushPrompt([view(1), view(4)])).toBe(
    'review-comments: commit and push the fixes for [1] (src/Rules.cs:190), [4] (src/Rules.cs:190). '
    + 'Once the push succeeds, reply on each of those threads with what changed and the commit it is in, resolve them, and mark them fixed.',
  )
})
