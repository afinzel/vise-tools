---
name: walk-comments
description: Work through a PR's unresolved review comments as a live task list — each comment becomes a checklist item, gets opened in VS Code at the commented line, discussed with the user, fixed, replied to, and resolved on GitHub before ticking off and moving to the next.
argument-hint: "[PR number] (optional — auto-detects the current branch's PR if omitted)"
---

Walk the user through the **unresolved** review comments on a GitHub pull request, one at a time, with live progress. This is the interactive sibling of `/review-comments`: that skill triages and stops; this one drives the fix loop — comment by comment, with the file open in the editor and the decision made in chat.

## 1. Fetch the unresolved comments

Resolve the PR and fetch unresolved review threads exactly as `/review-comments` does: `gh pr view --json number` for the PR, then the GraphQL `reviewThreads` query filtered to `isResolved: false`, keeping each thread's `id` (needed to reply and resolve), `path`, `line`/`originalLine`, `isOutdated`, and every comment in the thread verbatim. Also fetch review summary bodies and general PR conversation comments; present any with content once, up front, as context — they have no resolved state and don't become tasks.

If there are zero unresolved threads, say so plainly and stop.

## 2. Build the task list

Create one task per unresolved thread with **TaskCreate**, subject line like:

```
[path:line] first ~8 words of the comment… (@author)
```

Mark outdated threads in the subject (`⚠️ outdated`). The task list renders as a live checklist in the Claude Code UI (including the VS Code extension) — it is the user's progress view for the whole session. Order tasks by file, following the code's logical flow where obvious, rather than by comment creation time.

The task list is progress UI only. The durable record is the PR threads on GitHub — every outcome must land there (step 4), not just in the checklist.

## 2b. The Claude Review panel (preferred surface when present)

When inside VS Code, also render the walk in the **Claude Review** extension via the same file contract `/tour` uses (see that skill's step 2a for the full v3 schema, the platform table, and the actions.jsonl watcher). Always write the files; they're harmless without the extension, and chat stays authoritative. Add `.claude-review/` to `.git/info/exclude`.

Write `.claude-review/tour.json` with `kind: "comments"` — **one beat per unresolved thread**, in the same order as the task list:

- `text`: the reviewer's comment verbatim (plus thread replies), shown as the tooltip. Never paraphrase it here either.
- `path` + `line`: the thread's, falling back to `originalLine`; no `basePath` unless you materialize the PR base for a useful diff.
- `url`: the thread's GitHub URL, so the panel can link back.
- `status`: `current` on the thread being discussed, `pending`/`done`/`skipped` for the rest — keep it in lockstep with the TaskUpdate calls, and re-read the file on advance since the extension writes `done`/`skip` back into it.

**Routes group the threads.** One route per file is the natural default when a PR has comments spread across many files; a single route is fine for a small PR. The same file legitimately hosts many beats — several unresolved threads in one file is the common case, not an edge case.

At each wait point (step 4.4) run the actions.jsonl background watcher alongside the chat wait: panel `done` means the user considers it handled — but a task/beat is only marked `done` once the thread is genuinely replied-to and resolved on GitHub, so on a panel `done` confirm the intended outcome (fix applied? push-back agreed?) before resolving. Panel `skip` → skip. Panel `goto` → the user jumped to another thread; follow them there. Panel `comment` → the user's instruction for this thread (e.g. "fix it but keep the old name") — treat exactly like the same words in chat.

## 3. Detect the display surface

- Inside VS Code (`[ "$TERM_PROGRAM" = vscode ]` on macOS/Linux, `$env:TERM_PROGRAM -eq 'vscode'` on Windows) → use `code --goto <path>:<line>` to open each comment's location in the user's current window.
- `code` CLI available but not inside VS Code → `--goto` opens a separate window; mention once, carry on.
- Neither → show the relevant code excerpt inline in chat instead.

For the line, use the thread's `line`, falling back to `originalLine`; for outdated threads warn that the anchor may have moved and show the `diffHunk` for orientation.

## 4. Walk the comments, one at a time

For each task, in order:

1. **TaskUpdate** → `in_progress`.
2. Open the file at the commented line (or show the excerpt).
3. Present the reviewer's words **verbatim** in a fenced code block — never paraphrased — with author attribution and the full thread if there was a back-and-forth. Then read the surrounding code and give your take: a proposed fix (with the specific approach), or honest push-back if you think the comment is wrong. You may disagree with the user's own comments — but only when you genuinely do.
4. **Wait.** Do not touch anything until the user decides — in chat or via the panel (step 2b). Their response is one of:
   - **"fix it" / "yes"** → make the change, then reply on the thread (short, concrete, prefixed `🤖 resolved by Claude: …` so teammates can tell which side of the dialogue it was) and resolve it — the same `addPullRequestReviewThreadReply` and `resolveReviewThread` GraphQL mutations `/review-comments` uses. If the reply succeeds but the resolve fails (or vice versa), say so and leave the task in progress.
   - **A different approach** → discuss until settled, then fix/reply/resolve as above.
   - **"push back"** → reply on the thread with the agreed reasoning; resolve only if the user says to.
   - **"skip" / "later"** → leave the thread untouched on GitHub, leave the task pending, move on.
5. **TaskUpdate** → `completed` only when the thread is genuinely replied-to and resolved (or the user explicitly closed it out). A skipped comment stays visibly unchecked — never tick a task to make the list look done.

One comment per message. Never advance without the user's say-so.

## 5. Wrap up

When the list is exhausted (or the user stops):
- Summarise: resolved / pushed back / skipped, with thread links.
- Remind about commits only if changes were made — group related fixes into sensible commits, but only commit/push when the user asks (never force-push).
- Skipped comments remain unresolved on GitHub and unchecked on the list; name them explicitly so nothing silently falls through.

## Quality bar

- The reviewer's raw words and the link are the product — never paraphrase in place of quoting.
- Your own take, next to those raw words, is held to the `/tldr` standards: whether it matters before what it is, concrete before abstract, one point said once. The quote is theirs and untouchable; the commentary is yours and has to earn its space.
- The checklist must tell the truth: a ticked task means a resolved thread on GitHub, nothing less.
- Don't manufacture disagreement to seem rigorous; agreeing with every comment is a fine outcome.
