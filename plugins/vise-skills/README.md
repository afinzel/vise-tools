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

Triages the **unresolved** review comments on a GitHub PR. Auto-detects the
current branch's PR (or pass a PR number), fetches unresolved threads via the
GraphQL API, and shows each comment **raw** — the reviewer's actual words, with
a clickable link to the line. Then it organises them into ✅ no-brainers,
💬 discuss, and ⚠️ push-back buckets, each with an `S/M/L` scope tag, and stops
so you decide what to act on. When you give the go-ahead it makes the change,
replies on the thread, and resolves it.

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
