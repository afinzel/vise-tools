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

Skills are auto-discovered from the `skills/` directory — add a new
`skills/<name>/SKILL.md` to add another.
