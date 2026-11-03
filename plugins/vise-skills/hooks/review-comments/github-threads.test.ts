import { expect, test } from 'claude-code/testing'

import { parseGeneralFeedback, toGeneralPoint } from './github-threads'

const RESPONSE = JSON.stringify({
  data: {
    repository: {
      pullRequest: {
        reviewThreads: { nodes: [] },
        reviews: {
          nodes: [
            { id: 'R1', author: { login: 'ana' }, body: '1. Rename the flag\n2. Add a test', url: 'u/r1' },
            { id: 'R2', author: { login: 'ana' }, body: '', url: 'u/r2' },
          ],
        },
        comments: {
          nodes: [
            { id: 'C1', author: null, body: '  Why a new table?  ', url: 'u/c1' },
            { id: 'C2', author: { login: 'adam' }, body: '🤖 Claude: kept as is', url: 'u/c2' },
          ],
        },
      },
    },
  },
})

test('general feedback keeps review summaries and comments with words, and drops Claude\'s own', async () => {
  expect(parseGeneralFeedback(RESPONSE)).toEqual([
    { id: 'R1', kind: 'review-summary', author: 'ana', body: '1. Rename the flag\n2. Add a test', url: 'u/r1' },
    { id: 'C1', kind: 'conversation', author: 'ghost', body: 'Why a new table?', url: 'u/c1' },
  ])
})

test('a general point quotes its own words and reads the code it names', async () => {
  const [source] = parseGeneralFeedback(RESPONSE)
  const fileText = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n')
  const point = toGeneralPoint(source!, { sourceId: 'R1', quote: '2. Add a test', path: 'src/A.ts', line: 10 }, 'R1#2', fileText)

  expect(point.comments).toEqual([{ author: 'ana', body: '2. Add a test', url: 'u/r1' }])
  expect(point.generalSource).toBe('review-summary')
  expect(point.excerpt?.startLine).toBe(6)
})

test('a general point naming no code has no path and no excerpt', async () => {
  const [, source] = parseGeneralFeedback(RESPONSE)
  const point = toGeneralPoint(source!, { sourceId: 'C1', quote: 'Why a new table?' }, 'C1#1', null)

  expect(point.path).toBe('')
  expect(point.excerpt).toBeNull()
})
