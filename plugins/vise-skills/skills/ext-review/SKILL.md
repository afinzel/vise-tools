---
name: ext-review
description: "Review someone else's pull request with Claude Code's /code-review and choose which findings to post. The findings land in a pane, where the user ticks the ones worth saying, asks about any, and posts the chosen ones as one GitHub review of inline comments under their own name. Use when the user runs /ext-review, or asks to review a colleague's or another team's PR."
argument-hint: "<PR number or URL>"
---

# /ext-review — review someone else's PR

Run Claude Code's code review over another person's PR and put its findings in the external-review pane. Nothing reaches GitHub until the user picks it. A posted review goes out under their name, to a colleague, so the user's choice is the only trigger.

## 1. Open the round

You need a PR. Take it from the argument; if there is none, ask for one.

Call `mcp__vise-skills__findings_start` with `kind: "ext"` and that `pr`. It loads the PR and its diff and opens the pane.
- If the answer has an `error`, relay it and stop.
- **The tool is not there** (the mod did not load): review anyway, and use *No pane* below.

## 2. Review it

Run Claude Code's built-in code review skill on that PR, passing the PR number. This is the one that reports through `ReportFindings`, *not* `mattpocock-skills:code-review`.
- Its findings reach the pane by themselves. Do not record them again.
- If you cannot invoke it, ask the user to type `/code-review <PR>` themselves. The pane picks those findings up the same way.

## 3. Hand over

**Pane shown:** say in one line how many findings it raised. Then tell the user they tick the ones worth saying and press **Add to review**, then **Submit review** to send them as one review. Nothing is posted before Submit. **More info** on an expanded finding asks you about it, and **Dismiss** drops a finding. **Step through** walks the findings one at a time, each with its code, severity and a suggested fix. Then stop.

When a **More info** prompt arrives, answer it in chat without editing anything. This is someone else's branch.

## No pane

The VS Code panel draws no panes. Here, list the findings in chat, each with its severity icon (🔥 high, ⚠️ medium, 🧹 low), id, location and summary. Then ask with `AskUserQuestion` (`multiSelect: true`) which to post. Call `mcp__vise-skills__findings_post` with exactly those, and give the user the review link from its answer.

Lines the PR's diff does not show cannot take an inline comment. Those go in the review's body with their file and line. Say so when it happens.
