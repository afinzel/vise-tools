---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up.
argument-hint: "What will the next session be used for?"
---

Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the user's OS — not the current workspace.

Include a "Suggested skills" section in the document, which suggests skills that the agent should invoke.

Do not duplicate content already captured in other artifacts (PRDs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.

## Where to save

Resolve the OS temp directory and write a uniquely named file there:

- macOS / Linux: `$TMPDIR` (fallback `/tmp`)
- Windows: `%TEMP%`

Use a descriptive, timestamped filename, e.g. `handoff-<short-topic>-YYYYMMDD-HHMMSS.md`. Print the absolute path when done so the user can hand it off.

## Final output: paste-ready prompt

After writing the file, end your response with a fenced code block containing a prompt the user can copy and paste into a fresh Claude session. Put nothing after the code block so it is easy to select. Use this template, with the real absolute path substituted in:

````
```
Read the handoff document at <ABSOLUTE_PATH> and continue the work described in it. Start by summarising the current status and your planned next steps, then proceed.
```
````

If the user gave arguments describing the next session's focus, append a sentence reflecting that focus to the pasteable prompt.

## Document structure

Produce a single Markdown file with these sections:

1. **Objective** — one or two sentences on what the work is and the desired end state. If arguments were passed, frame this around the next session's focus.
2. **Current status** — what is done, what is in progress, what is blocked.
3. **Key context** — decisions made and the reasoning behind them; constraints; anything non-obvious a fresh agent would otherwise have to rediscover.
4. **Relevant artifacts** — paths and URLs to files, PRDs, plans, ADRs, issues, commits, and diffs. Reference, do not restate.
5. **Next steps** — an ordered, concrete checklist the next agent can act on immediately.
6. **Open questions / risks** — unresolved decisions and known pitfalls.
7. **Suggested skills** — skills the next agent should invoke, each with a one-line reason.
8. **Source transcript** — the absolute path to this session's transcript (see below), so the next agent can consult the full history when the summary is not enough.

## Source transcript

Claude Code records each session as a JSONL transcript at:

```
~/.claude/projects/<cwd-as-dashes>/<session-id>.jsonl
```

- `<cwd-as-dashes>` is the working directory with every `/` replaced by `-` (e.g. `/Users/me/work/app` → `-Users-me-work-app`).
- `<session-id>` is the current session's UUID; the filename is `<session-id>.jsonl`.

Resolve and verify this path, then include it in the document. Tell the next agent: **if data is missing or unclear in this handoff, read the source transcript for the full conversation.**

If this session itself started from a handoff document (i.e. the work was picked up from a prior handoff), link that prior handoff's path too, so the chain back to the original context is preserved.

## Quality bar

- Be specific. Prefer file paths, symbol names, and commands over prose.
- Keep it skimmable: short sections, bullets over paragraphs.
- Write so an agent with zero prior context can resume without asking the user to re-explain.
- Verify every referenced path or URL actually exists before citing it.
- Redact secrets and PII; never copy credential values into the document.
