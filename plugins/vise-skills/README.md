# vise-skills

Skills for Claude Code development workflows.

## Installation

```bash
claude plugin install vise-skills@vise-tools
```

## Skills

### handoff

Compacts the current conversation into a handoff document (written to the OS
temp dir) so a fresh agent can pick up the work. Pass a description of what the
next session will focus on to tailor the doc.

### review-comments

Works through the **unresolved** review comments on a GitHub PR. Auto-detects the
current branch's PR (or pass a PR number or URL), and triages each thread into
✅ trivial, 💬 discuss and ⚠️ push back, with an `S/M/L` scope tag and a
**behaviour-change flag**. The trivial fixes that don't change behaviour go in one
batch; the rest are stepped through one at a time — code, the reviewer's words
**raw**, Claude's suggestion — and nothing changes until you decide. On a go-ahead
it makes the change, replies on the thread, and resolves it.

With the review sidebar (below) the walk happens in a pane; without it, in chat,
plus the Claude Review panel in VS Code. The mod reports whether the sidebar is
actually visible (the VS Code extension's chat panel draws no panes), so the skill
picks the route from that. In chat and VS Code the walk can be narrated, using the
`tour` skill's voice.

### thanks

An end-of-session close-out check. Run `/thanks` before closing a chat and it
sweeps for anything left dangling — interrupted or abandoned work, things still
running (background tasks, servers, crons, `/loop`s, worktrees), uncommitted or
unpushed repo state and temporary edits meant to be reverted, unanswered
questions, promised loose ends, un-opened PRs, and reasoning worth persisting to
memory. It's **read-only**: it reports, ranks findings by what's actually lost if
the tab closes, asks you to acknowledge, and never fixes anything itself. Clean
checks stay silent. Fires only when invoked by name.

### second-mind

Lets a Claude working in **any** repo use the 2nd-mind knowledge vault safely. Four
operations: `check` (search the gotcha runbooks for an already-solved failure mode
*before* debugging — fires unprompted), `ask` (answer from the vault, with page
citations), `capture` (stage a finding in the vault's gitignored inbox with a full
provenance block — repo, branch, commit, transcript path), and `sync` (fast-forward the
local clone and report pending captures).

It is **capture-only**: the sole writable path is `knowledge/inbox/`, and it never
commits or pushes. That is deliberate — the vault is git-crypt encrypted, filenames and
paths are *not* encrypted, and the codename mapping lives in a file an outside session
can't read. A foreign agent writing pages directly produces unlinked duplicates at
leaking paths; capturing with provenance lets a session inside the vault do the
placement and linking. It also detects a locked (unkeyed) vault and says so instead of
interpreting encrypted bytes.

Set `SECOND_MIND_VAULT` if the vault isn't at one of the default paths.

Skills are auto-discovered from the `skills/` directory — add a new
`skills/<name>/SKILL.md` to add another.

## Mods

### review sidebar

`hooks/review-comments.tsx` is a [mod](https://code.claude.com/docs/en/plugins/mods/overview)
that gives `review-comments` a sidebar. Running `/review-comments` opens a pane beside
the transcript, which fills with the PR's unresolved threads: **To do** (grouped by
bucket once Claude has triaged them), **Ready to push**, **Skipped**, and a foldable
**Done**. A fix is made locally and waits in Ready to push; **Commit & push** commits and
pushes them, and only then does Claude reply on and resolve each thread, citing the commit. Closed it?
`/review-sidebar` reopens it, even while Claude is working. Click a thread to see its code, comment and
suggestion, with **Fix**, **Push back**, **Discuss**, **Skip** and **Next** buttons
(hotkeys `f` `p` `d` `s` `n`). A thread with several possible fixes gets one button per
option instead of **Fix** (hotkeys `1`–`9`, the recommended one highlighted), and shows
any other code the decision depends on. Each row has a **behaviour change** checkbox that
starts as Claude's call and is yours to flip. **Fix N trivial (no behaviour change)** sends the batch,
and **Step through** opens the next thread waiting on you. A band above the prompt
shows progress.

The buttons send your decision to Claude as a prompt; Claude reports back through the
mod's `review_triage` and `review_mark` tools, and the sidebar re-reads GitHub after
each fix so a tick means a resolved thread. It reads code from your working tree when
the PR's branch is checked out, and from the PR's head commit otherwise.

Needs Claude Code 2.1.287 or later and `gh` signed in. The pane docks in the
fullscreen terminal from 110 columns, and sits above the prompt otherwise. Tests:
`claude plugin test plugins/vise-skills`.

## Hooks

### clean-code checks

`hooks/clean_code_hook.py` runs on every `Write`/`Edit`/`MultiEdit` to a source
file (`.cs`, `.ts`, `.tsx`, `.js`, `.jsx`, `.java`, `.go`) and checks three
clean-code rules:

| Rule | Check |
|---|---|
| A comment is a private method waiting to be named | Non-doc comment indented inside a body |
| Names complete a sentence at the call site | Type-prefixed (`strName`) and placeholder (`data`, `temp`) names |
| A comment carries its own context | Comment referencing `A1`, `section 3.2`, a ticket key, or "see spec" |

**It never blocks.** `PreToolUse` only records; `PostToolUse` re-reads the file
that actually landed and reports back, so the fix is an edit rather than a
regenerate. Everything found is appended to `~/.claude/clean-code-findings.jsonl`.

Only rules listed in `RULES_REPORTED_TO_CLAUDE` are reported back to Claude —
currently just `doc-reference-comment`, the one that's cleanly decidable by
regex. The structural and naming heuristics log silently, so you can read the
log and promote one once you trust its hit rate.

Newspaper ordering is deliberately not checked: deciding whether callers precede
callees needs a real parse, and a regex that guesses would cry wolf often enough
to get the whole hook ignored. That rule lives in `CLAUDE.md` instead.
