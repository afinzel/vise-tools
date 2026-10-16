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

### shutdown

Run `/shutdown` before a restart, or before closing every Claude window. It opens a
pane listing this session and every other Claude session on this machine, all ticked;
untick any to leave out (**All** / **None**), and **Send**. Each ticked session gets a
message: at your next clean stopping point, run `handoff` and reply with its path. This
session runs its own handoff too. Nobody commits, pushes or kills anything to tidy up.
Rows tick off as replies arrive, a band above the prompt counts them, and a toast says
when it's safe to restart. Tell any session to ignore the message and it will.

Reach is per machine. Sessions on other machines show up only with Remote Control
connected, and cloud sessions are left out because they survive a local restart and
can't reply.

### restore-sessions

Run `/restore-sessions` after a restart, planned or not. It finds the sessions active
in a recent window (24h by default; pass `12h`, `3d`) from their JSONL transcripts,
pulls the last few messages of each with `find_sessions.py`, and has Haiku judge which
were mid-work and which had finished. A pane lists them mid-work first and pre-ticked,
with any handoff document that names them; **Reopen** opens each in its own Windows
Terminal tab with `claude --resume`. A session whose folder is gone is skipped and
says so; where no tab can be opened, the row shows the command to run instead.

Claude Code's `SessionEnd` hook isn't used: a forced Windows Update restart kills
the process before it fires, while the transcripts are already on disk.

Both work in chat too, where no pane is drawn (the VS Code extension's panel): the
skill asks with a picker instead, and falls back further to `ListAgents`/`SendMessage`
and the bundled script if the mod isn't loaded.

### self-review

Run `/self-review` on your own branch before asking anyone else. Three reviewers go
over the diff against its base:
- the Clean Code rules in `skills/self-review/clean-code-rules.md` (the book's
  Chapter 17 smells, by their ids, plus your code-style rules as `V1`–`V5`)
- Matt Pocock's `code-review`, run as it is
- Claude Code's `/code-review`

Their findings land in one pane. Tick findings, then choose:
- **Fix**: Claude fixes them.
- **Fix + comment**: Claude fixes, commits, pushes, and posts an inline comment per fix saying what changed.
- **Add to review**: puts them in a review you are building. Nothing reaches GitHub until
  **Submit review**, and pressing a queued finding takes it back out.
- **Dismiss**: drops them.
- **More info**: on an expanded finding, asks Claude about it.

**Step through** walks the open findings one at a time, as the review sidebar does. Each one shows
its code and a suggested fix, with Fix, Add to review, Dismiss, More info and Next for that
finding alone. Each finding is tagged 🔥 high (must fix), ⚠️ medium (should fix) or 🧹 low (tidy-up),
in the pane, in chat and in posted comments alike; on GitHub a low one reads `🧹 *nit:*`, and the list is ordered most severe
first. Claude's `/code-review` gives no severity or fix of its own: the severity comes from its
category, and Haiku suggests the fix the first time you open the finding. Posted comments lead
with the severity and end with the suggested fix.

Every dismissed Clean Code finding counts against its rule, across sessions. A rule
dismissed half the time or more, over three or more findings, is listed at the foot of
the pane as one to reword or drop.

### ext-review

Run `/ext-review <PR>` on someone else's pull request. Claude Code's `/code-review`
reviews it, and its findings land in a pane. Tick the ones worth saying and press
**Add to review**, then **Submit review**: they go out as one GitHub review under your name. A finding goes in as an
inline comment where the diff shows its line; otherwise it goes in the review body. Nothing is
posted until you choose.

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

The mods register from `hooks/register.tsx`: the engine takes one hooks module per
plugin, so each mod exports its hooks and its tools, and that module wires them in.

### shutdown and restore panes

`hooks/shutdown.tsx` and `hooks/restore-sessions.tsx` are the panes behind the two
skills above. The shutdown pane lists sessions with `ListAgents`, sends with
`$.session.send`, and reads replies on `session.receive`: a reply names its sender
(`shutdown-reply <name>: <path>`), because a delivery carries only text. While the pane
shows them, replies are taken out of the conversation so they cost no turns. The
restore pane runs `find_sessions.py`, asks Haiku through `$.model.complete`, and opens
tabs with `wt`.

### review findings panes

`hooks/review-findings.tsx` is the pane behind `/self-review` and `/ext-review`.

- **Claude's findings:** it catches `/code-review`'s findings on their way through the
  `ReportFindings` tool, while a review round is open. A re-report after fixes is
  skipped.
- **The other reviewers:** they reach it through `findings_record`.
- **Posting:** sends one `gh api …/reviews` call with the review as JSON on stdin.
- **Rule tallies:** kept in the plugin's store, so they last across sessions.

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
