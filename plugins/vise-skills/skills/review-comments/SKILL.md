---
name: review-comments
description: Triage unresolved GitHub PR review comments — show them raw with clickable links, then organise them into act-now, discuss, and push-back buckets.
argument-hint: "[PR number] (optional — auto-detects the current branch's PR if omitted)"
---

Help the user work through the **unresolved** review comments on a GitHub pull request. The user's workflow: Claude writes code, the user reviews on GitHub and leaves comments, then comes back here to triage and address them.

The point of this skill is to give the user the **raw** comments — their reviewers' actual words, not Claude's interpretation — with links they can click, organised so they can decide what to do. Claude paraphrasing or pre-digesting the comments is the failure mode this skill exists to prevent.

## Default behaviour: triage, then stop

Run the triage (steps 1–4 below) and **then stop**. Do not change any code, reply to any thread, or resolve anything until the user tells you which comments to act on. The triage is a menu, not a to-do list you execute.

## 1. Resolve the target PR

- If the user passed a PR number as an argument, use it.
- Otherwise auto-detect the open PR for the current branch: `gh pr view --json number`.
- If no PR is found for the current branch, ask the user for the PR number rather than guessing.

Get the `owner` and `repo` the GraphQL query needs with `gh repo view --json owner,name -q '.owner.login + "/" + .name'` (or let `gh api graphql` resolve them however is simplest). The PR `number` plus owner/repo is all you need.

## 2. Fetch unresolved review threads (GraphQL)

GitHub's resolved/unresolved state lives on **review threads** and is only exposed via the GraphQL API — `gh pr view` and the REST comments endpoint do **not** report it. Always query GraphQL and filter to `isResolved: false`. Fetch each thread's `id` here too — you need it later to reply and resolve, and it lets the numbered list map straight to a thread.

```bash
gh api graphql -f query='
query($owner:String!, $repo:String!, $pr:Int!) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$pr) {
      reviewThreads(first:100) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          originalLine
          comments(first:50) {
            nodes { author { login } body url diffHunk createdAt }
          }
        }
      }
    }
  }
}' -F owner=OWNER -F repo=REPO -F pr=NUMBER
```

Keep only threads where `isResolved` is `false`. Each thread may have several comments (a back-and-forth) — preserve the whole thread so context is not lost. Note `isOutdated` threads (the code moved since the comment) and flag them, since the line link may not point where expected.

**Pagination:** the query caps at 100 threads / 50 comments per thread. One page covers almost every PR; if you hit a PR with a full 100 threads, add `pageInfo { hasNextPage endCursor }` to the `reviewThreads` connection and follow the cursor rather than silently truncating.

### Also fetch non-inline feedback

Inline `reviewThreads` miss two places reviewers leave important notes — pull these too so nothing is dropped:

- **Review summary bodies** — the text in the Approve / Request-changes box: `pullRequest { reviews(first:50) { nodes { author { login } body state url } } }`. Skip reviews with an empty `body`.
- **General conversation comments** — not anchored to code: `pullRequest { comments(first:100) { nodes { author { login } body url } } }`.

These have no resolved/unresolved state, so present any with content under a separate **"General feedback (not a code thread)"** heading. Don't try to resolve them.

If there are zero unresolved threads and no general feedback, say so plainly and stop.

## 3. Present each comment raw, with a clickable link

For every unresolved thread, output the reviewer's words **verbatim** as a Markdown blockquote — do not summarise, soften, or reinterpret. Use this shape:

```
### [N] `path/to/file.ext:LINE`  ·  @author  ·  [view on GitHub](COMMENT_URL)

> <the comment body, exactly as written>
```

- The `view on GitHub` link is the comment's `url` field — it opens the PR anchored to that comment. Always include it; it is the clickable link the user wants.
- For `LINE`, use `line`; if it is `null` (common on outdated or moved code), fall back to `originalLine`, and if that is also null, drop the `:LINE` suffix rather than printing `:null`.
- If the thread has multiple comments, render each in order so the discussion reads naturally.
- Mark outdated threads with `⚠️ outdated` next to the heading.
- Number the comments `[1]`, `[2]`, … so the user (and you) can refer to them later.

## 4. Triage into three buckets

**Before bucketing, read the code each comment refers to.** Open the `path` at the referenced `line` and look at the surrounding code — the scope tag and the proposed fix are guesses otherwise. The reviewer's `diffHunk` shows what they were looking at; the current file shows whether it still applies.

Keep the comment's author in view. Some reviews come from AI reviewers (e.g. `@Copilot`, `@coderabbitai`) that the user requested deliberately — treat them as real feedback and triage them the same way, but attribute clearly so a bot's nit can be weighed against a human's concern.

After listing the raw comments, organise them by **number** into three buckets. For each item give:

- a **scope tag** estimating how big the change is — `S` (a line or two), `M` (a few files), or `L` (larger change or refactor) — with a couple of words on what drives it, e.g. `M — touches 3 call sites`;
- a **one-line rationale** — not a rewrite of the comment, just why it landed in that bucket.

A large scope (`L`) on something otherwise simple is itself a reason to put it in 💬 Discuss rather than ✅ No-brainers.

- ✅ **No-brainers** — Claude agrees and the change is clear and low-risk. State briefly what you'd do.
- 💬 **Discuss** — needs a decision, has a tradeoff, is ambiguous, or touches something the user should weigh in on. State the question or the options.
- ⚠️ **Push back** — Claude thinks the comment is wrong, unnecessary, or would make things worse. **You have permission to push back on the user's own comments too** — but only when you genuinely disagree. Don't manufacture objections to seem rigorous; an empty push-back bucket is fine when you agree with everything. When you do push back, give your honest reasoning so the user can overrule you.

A comment can only sit in one bucket — pick the most honest one. If you are genuinely unsure whether something is a no-brainer, it belongs in Discuss.

### Suggest a fix for each actionable comment

For every comment in ✅ **No-brainers** and 💬 **Discuss**, propose the concrete fix you would make — the specific approach, and the key lines or function involved — so the user can approve it at a glance. **Describe the fix; do not implement it yet** (code changes only happen in step 5, once the user says go). For 💬 Discuss items where there's more than one reasonable fix, lay out the options rather than picking one silently. For ⚠️ Push-back items, no fix is needed — the recommendation is to not change anything.

End the triage by asking the user which comments they want to act on. Then stop.

## 5. Addressing comments (only once the user says go)

When the user picks comments to address:

1. Make the code change.
2. **Reply on the thread** explaining what was done (or, for push-backs the user accepted, why no change was made). Keep replies short and concrete.
3. **Resolve the thread.**

Replying and resolving use GraphQL mutations:

Both mutations take the thread's `id` from the step-2 query (the `pullRequestReviewThreadId` / `threadId` is that node `id` — there is no separate "reply-to comment" argument). Note `-f body=` (lowercase) to force the reply body to a string — `-F` would mis-coerce a body that looks like a number or `true`/`false`. If the reply succeeds but the resolve fails (or vice versa), say so — don't report the thread as fully handled:

```bash
# Reply on the thread
gh api graphql -f query='
mutation($threadId:ID!, $body:String!) {
  addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$threadId, body:$body}) {
    comment { url }
  }
}' -F threadId=THREAD_ID -f body="..."

# Resolve the thread
gh api graphql -f query='
mutation($threadId:ID!) {
  resolveReviewThread(input:{threadId:$threadId}) { thread { isResolved } }
}' -F threadId=THREAD_ID
```

Group related changes into sensible commits, but only commit/push when the user asks — follow the user's normal git conventions (never force-push).

## Quality bar

- **Never paraphrase a comment in place of showing it.** The raw quote and the link are the product.
- Keep the triage skimmable: numbered comments, three clearly-labelled buckets, one-line rationales.
- Be willing to disagree when you actually do — but don't invent disagreement. Agreeing with every comment is a fine outcome.
