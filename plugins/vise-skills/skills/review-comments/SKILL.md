---
name: review-comments
description: "Work through unresolved GitHub PR review comments — triage them (with a behaviour-change flag), fix the trivial no-behaviour-change ones in one go, then step through the rest one at a time: code, raw comment, suggestion, decision, reply, resolve. Uses the review sidebar when the vise-skills mod is loaded."
argument-hint: "[PR number or URL] (optional — auto-detects the current branch's PR if omitted)"
---

Help the user work through the **unresolved** review comments on a GitHub pull request. The user's workflow: Claude writes code, the user reviews on GitHub and leaves comments, then comes back here to triage and address them.

The point of this skill is to give the user the **raw** comments — their reviewers' actual words, not Claude's interpretation — with links they can click, so they can decide what to do. Claude paraphrasing or pre-digesting a comment that needs a decision is the failure mode this skill exists to prevent.

## The flow

1. Fetch every unresolved thread (step 1–2).
2. Read the code each one points at and triage it (step 3): a bucket, a scope, a suggestion, and whether the fix **changes behaviour**.
3. **Quick fixes first.** Trivial threads whose fix does not change behaviour can be fixed together on one go-ahead.
4. **Then step through the rest one at a time** — trivial ones that do change behaviour, then 💬 Discuss, then ⚠️ Push back. For each: the code, the comment verbatim, the suggestion, then the user's decision.
5. Act on each decision (step 5): change the code, reply on the thread, resolve it.

Do not change code, reply to a thread, or resolve anything until the user has said go for that thread.

### Where the walk happens

Pick the surface once, at the start. When the `mcp__vise-skills__review_threads` tool is available (the vise-skills mod is loaded), call it first (step 2) and read its `sidebar` field — the mod tried to open the sidebar and reports whether the user can see it:

- **Review sidebar** — `sidebar.isShown` is true, or false only because the terminal is narrow (the `reason` names a column count: tell the user `/review-sidebar` or the **Sidebar** button above the prompt opens it, and carry on in the sidebar). The sidebar lists every thread, grouped by bucket; clicking one shows its code, comment and suggestion with Fix / Push back / Discuss / Skip / Next buttons, and a **Fix N trivial (no behaviour change)** button sits at the top. Follow **Sidebar route** below.
- **VS Code** (`TERM_PROGRAM` is `vscode`) with no sidebar shown — the extension's chat panel runs the mod but draws no panes, so `isShown` is false for a reason other than width. Chat, plus the Claude Review panel and `code --goto`. Follow **Chat route** and **VS Code extras**. The mod's tools still work here: keep using them for numbering, triage and marks.
- **Anywhere else** without the sidebar — follow **Chat route**.

If the user says they can't see the sidebar, believe them over the flag and switch to the chat route.

## 1. Resolve the target PR

- If the user passed a PR number or URL as an argument, use it.
- Otherwise auto-detect the open PR for the current branch: `gh pr view --json number`.
- If no PR is found for the current branch, ask the user for the PR number rather than guessing.

## 2. Fetch unresolved review threads

**Sidebar route:** call `mcp__vise-skills__review_threads` (with `pr` when the user named one). It loads the PR into the sidebar and returns the threads, already numbered as the sidebar shows them — use those numbers everywhere. Then fetch the non-inline feedback below with `gh`.

**Otherwise, GraphQL.** GitHub's resolved/unresolved state lives on **review threads** and is only exposed via the GraphQL API — `gh pr view` and the REST comments endpoint do **not** report it. Get `owner`/`repo` with `gh repo view --json owner,name -q '.owner.login + "/" + .name'`, query, and filter to `isResolved: false`. Keep each thread's `id` — you need it to reply and resolve.

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

Each thread may have several comments (a back-and-forth) — preserve the whole thread. Note `isOutdated` threads (the code moved since the comment) and flag them, since the line link may not point where expected.

**Pagination:** the query caps at 100 threads / 50 comments per thread. If a PR has a full 100 threads, add `pageInfo { hasNextPage endCursor }` to the `reviewThreads` connection and follow the cursor rather than silently truncating.

### Also fetch non-inline feedback

Inline `reviewThreads` miss two places reviewers leave important notes — pull these too so nothing is dropped:

- **Review summary bodies** — the text in the Approve / Request-changes box: `pullRequest { reviews(first:50) { nodes { author { login } body state url } } }`. Skip reviews with an empty `body`.
- **General conversation comments** — not anchored to code: `pullRequest { comments(first:100) { nodes { author { login } body url } } }`.

These have no resolved/unresolved state. Show any with content once, up front, under **"General feedback (not a code thread)"**. They don't go into the sidebar or the walk, and are never resolved.

If there are zero unresolved threads and no general feedback, say so plainly and stop.

## 3. Triage

**Before triaging, read the code each comment refers to.** Open the `path` at the referenced `line` and look at the surrounding code — the scope, the fix and the behaviour flag are guesses otherwise. The reviewer's `diffHunk` shows what they were looking at; the current file shows whether it still applies.

Keep the comment's author in view. Some reviews come from AI reviewers (e.g. `@Copilot`, `@coderabbitai`) that the user requested deliberately — treat them as real feedback, but attribute clearly so a bot's nit can be weighed against a human's concern.

For every thread, decide:

- **Bucket** — exactly one, the most honest one:
  - ✅ **Trivial** — you agree and the change is clear and low-risk.
  - 💬 **Discuss** — needs a decision, has a tradeoff, is ambiguous, or touches something the user should weigh in on. If you're unsure whether something is trivial, it belongs here.
  - ⚠️ **Push back** — you think the comment is wrong, unnecessary, or would make things worse. **You may push back on the user's own comments too** — but only when you genuinely disagree. An empty push-back bucket is fine.
- **Scope** — `S` (a line or two), `M` (a few files) or `L` (larger change or refactor), with a few words on what drives it, e.g. `M — touches 3 call sites`. A large scope on something otherwise simple is itself a reason for 💬 Discuss.
- **Behaviour change** — does the fix change what the code does at run time (a different result, error, query, side effect, ordering, timing), rather than only its shape (names, comments, formatting, dead code, usings, a pure refactor)? When in doubt, it's a behaviour change. This flag decides what the quick-fix batch may touch, so be strict.
- **Summary** — the fix in one short line (under 60 characters), e.g. `Reject Unset after TryParse`; for ⚠️, `No change: <why>`. The sidebar shows it on the thread's row, under the opening line of the comment.
- **Suggestion** — the concrete fix (approach plus the key lines or function), or for 💬 the options with a recommendation, or for ⚠️ the honest reason for making no change. **Describe it; don't implement it yet.**
- **Same root cause** — when several comments share one cause (AI reviewers often repeat a nit across files), point the later ones at the first. Deciding the first settles the rest.
- **Options** — for a thread with more than one reasonable fix, the choices the user picks between, each with a short label (`(a) shared check, product+variant geo`), its own scope and behaviour flag, and one marked recommended. Sub-choices become options of their own (`(a) … product+variant geo`, `(a) … variant only`). Leave options out when there's one clear fix.
- **References** — other code the decision depends on, beyond the commented line: another call site, the other side of a drift (`CountryRules.cs:49`, the basket's version of the check). Give the path, line range and a one-line caption saying why it matters.

**Sidebar route:** record all of it with one `mcp__vise-skills__review_triage` call (`number`, `bucket`, `scope`, `scopeReason`, `summary`, `suggestion` as markdown, `isBehaviourChange`, `sameAs`, `options`, `references`). The sidebar shows each option as a button and reads each reference's code itself, so the suggestion text doesn't need to quote the code or repeat the option list as a question. Then post one short message in chat — the general feedback, if any, then the counts, e.g. `5 threads: 1 trivial without behaviour change, 1 trivial with, 2 discuss, 1 push back — they're in the sidebar.` — and stop. Don't render the comments in chat; the sidebar holds them.

## 4. Chat route: present it

Render using `output-template.md` (in this skill's directory). The essentials:

1. **Quick fixes first, as a summary.** Show the trivial, no-behaviour-change threads as a compact list (header line, one-line gist, the fix, the link), then ask **"Shall I fix these?"** and stop.
2. **Then step through the rest one at a time**, in walk order: trivial with behaviour change, then 💬, then ⚠️. For each: **Code** (a short line-numbered excerpt), **Comment** (verbatim, the whole thread), **Suggestion** (with scope, and `⚡ changes behaviour` when flagged), the link, then the decision question. **Stop and wait**; move on only after the user answers.

If the user asks for everything at once, render every thread with the template's full per-comment blocks.

Rendering rules, which the template covers in full:

- The visible link is a **bare URL on its own line** pointing at the PR Files-changed diff anchor — `https://github.com/<owner>/<repo>/pull/<pr>/files#diff-<sha256(path)>R<line>` (hash = `printf "%s" "<path>" | sha256sum`). A `[text](url)` link renders as dead text in the terminal CLI.
- The quote goes in a **fenced code block**, not a `>` blockquote.
- For `LINE`, use `line`, falling back to `originalLine`; if both are null, drop the `:LINE` suffix (and `R<line>`) rather than printing `:null`.
- Mark outdated threads `⚠️ outdated` on the header line. Number threads `[1]`, `[2]`, … so they can be referred to.

### VS Code extras

Inside VS Code without the sidebar, also open each thread's location with `code --goto <path>:<line>` as you reach it, and render the walk in the **Claude Review** panel via the file contract `/tour` uses (see that skill's step 2a for the schema, the platform table and the actions.jsonl watcher). Write `.claude-review/tour.json` with `kind: "comments"` — one beat per thread in walk order, `text` the comment verbatim, `path`/`line` the thread's, `url` the thread's GitHub URL, `status` kept in step with the walk (re-read the file on advance, since the extension writes `done`/`skip` back). One route per file is a natural grouping. Add `.claude-review/` to `.git/info/exclude`. A panel `done` means the user considers it handled — confirm the outcome before resolving; `skip` → skip; `goto` → follow them; `comment` → treat as their words in chat.

### Narration (optional)

On the chat route and the VS Code route each thread is its own turn, so it can be spoken as you reach it. **Ask once, at the start of the walk: narrated or silent?** Skip the question if the user already said (asked for a narrated review, said "no voice"). Default to silent if they don't care. Remember the answer for the whole walk.

Speech uses the `tour` skill's voice setup — follow its step 2b for the TTS install offer, the OS-voice fallback, calling `say.py`, playing **in the background** so the message and the audio land together, and synthesizing the next thread while the current one plays.

What to say for each thread, two or three sentences: who commented and the gist of what they asked; your suggestion in a sentence; and whether it changes behaviour. For a thread with options, name the recommended one. Speak no code, paths or line numbers — they're on screen. The spoken gist is in addition to the verbatim comment on screen, never instead of it.

The sidebar route doesn't narrate: the user steps through threads in the sidebar without a Claude turn, so there is no moment to speak.

## 5. Acting on decisions

Decisions arrive in chat. From the sidebar they arrive as prompts starting `review-comments:` — the user pressed a button. The `[N]` in them is the **sidebar's** number, which orders threads by file and line. If you numbered threads yourself (say the sidebar tools failed and you fell back to GraphQL), the `(path:line)` beside the number decides which thread is meant; switch to the sidebar's numbering from then on and say so once.

- `review-comments: fix [1], [4] as suggested (trivial, no behaviour change). Then mark each fixed-locally: …` — the quick-fix batch.
- `review-comments: fix [N] (…) as suggested. Then mark it fixed-locally: …`
- `review-comments: for [N] (…), go with <option label>. Make the change. Then mark it fixed-locally: …` — the user picked one of your options.
- `review-comments: push back on [N] (…): reply on the thread with the reasoning and leave it unresolved.`
- `review-comments: about [N] (…): <the user's words>` — the user wants to discuss, or gave their own direction. Discuss until settled, then act.
- `review-comments: commit and push the fixes for [1] (…), [4] (…). Once the push succeeds, reply on each …` — the user pressed **Commit & push**. This is the user asking for the commit and push.

Two notes can ride on a fix or an option:

- `This also settles [M], which share the root cause.` — act on those threads too, and mark each.
- `I've marked it as a behaviour change…` / `…as not changing behaviour…` — the user overrode your behaviour flag with the sidebar's checkbox. Their call stands: a fix they marked as not changing behaviour must not change it; if that's impossible, stop and say so rather than fix.

### A thread is answered only once its fix is pushed

Reviewers read a resolved thread as "this is fixed on the PR", so a fix is replied to and resolved only after it's pushed:

1. **Fix** — make the code change, preferably through a fix agent (below). Don't reply, resolve, commit or push. **Sidebar route:** once the change is in, call `mcp__vise-skills__review_mark` with `fixed-locally`; the thread moves to the sidebar's **Ready to push** section.
2. **Commit and push** — only when the user asks (the sidebar's **Commit & push** button, or in chat). Group related fixes into sensible commits following the user's git conventions; never force-push; if the branch is the repository's default branch, stop and ask.
3. **After the push succeeds**, for each of those threads: **reply** with what changed and the short commit hash, prefixed `🤖 resolved by Claude: …` so teammates can tell which side of the dialogue it was; then **resolve** it; then, on the sidebar route, `review_mark` it `fixed` (which re-reads GitHub). If the push fails, reply to nothing and say what failed.

### Prefer a fix agent for each fix

Hand each fix to a subagent (the Agent tool, `general-purpose`) rather than editing in the main conversation. The main conversation stays free for the next decision, and each fix gets a clean context focused on one thread.

- **One agent per thread** — except threads that share a root cause (`sameAs`, or a decision that settles several), which go to one agent together, and threads in the **same file**, which go to one agent together so two agents never edit one file at once.
- **Run agents for different files in parallel** — several Agent calls in one message. The quick-fix batch becomes one agent per file.
- **Give each agent everything it needs**, since it sees none of this conversation: the path and line; the reviewer's comment **verbatim**; the agreed fix (your suggestion, the option the user chose, or their own words from a discussion); whether the fix may change behaviour — a thread marked no behaviour change must not change behaviour, and the agent should stop and report if it can't keep to that; the repository's build and test commands if you know them. Tell it explicitly: **edit the code only — no commits, no pushes, no replies on GitHub, no resolving** — and finish by reporting the files it changed and a one-line summary per thread.
- **Check what came back** before marking anything: read the agent's report and look at the diff (`git diff -- <files>`). If it did something other than the agreed fix, or stopped, tell the user rather than marking the thread.
- **Then** `review_mark` each thread `fixed-locally`.

Fall back to fixing in the main conversation only when the Agent tool isn't available.

**Push back** needs no code, so it's answered straight away: reply with the reasoning, prefixed `🤖 Claude: …`, leave the thread unresolved unless the user says otherwise, and `review_mark` it `pushed-back`.

**Chat route:** the same rule. After fixing, list what's ready and ask whether to commit and push; reply and resolve only after the push.

If something fails, don't mark it — say what failed. A skipped thread stays unresolved on GitHub. Skips from the sidebar are recorded by the sidebar itself; skips in chat need nothing.

Both mutations take the thread's `id` (the `pullRequestReviewThreadId` / `threadId` is that node `id`). Use `-f body=` (lowercase) so a body that looks like a number or `true` stays a string. If the reply succeeds but the resolve fails (or vice versa), say so — don't report the thread as handled:

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


## 6. Wrap up

When every thread is settled (or the user stops): summarise fixed / pushed back / skipped, with links, and name the skipped ones explicitly so nothing silently falls through. Mention commits only if code changed.

## Quality bar

- **Never paraphrase a comment that needs a decision in place of showing it.** The raw quote and the link are the product. Only the quick-fix summary may give a one-line gist, and each still carries its link.
- The behaviour flag is a promise: the quick-fix batch must not change what the code does. When unsure, flag it.
- Your own commentary, next to the raw words, is held to the `/tldr` standards: whether it matters before what it is, concrete before abstract, one point said once.
- Be willing to disagree when you actually do — but don't invent disagreement. Agreeing with every comment is a fine outcome.
- Progress must tell the truth: a thread is done only when it's replied to and resolved on GitHub.
