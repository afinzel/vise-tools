---
name: self-review
description: "Review your own branch before anyone else does. Runs three reviewers over the diff: the Clean Code rules (the book's smells plus the user's code-style rules), Matt Pocock's code-review (standards and spec), and Claude Code's /code-review. Their findings land in one pane, where the user ticks them to fix, fix and comment, post as PR comments, dismiss, or ask about. Use when the user runs /self-review, or asks to review their own changes, branch or PR before requesting review."
argument-hint: "[PR number or URL] (optional — the current branch's PR, or just the branch when there is none)"
---

# /self-review — three reviewers, one list

Run the three reviewers over this branch's changes and collect their findings in the self-review pane. The user decides what happens to each finding. You fix only what they send you, and post nothing they did not choose.

## 1. Open the round

Call `mcp__vise-skills__findings_start` with `kind: "self"`, and `pr` when the user gave one. It loads the PR and its diff and opens the pane.

- A branch with no PR still gets a review. Posting is simply off.
- `oftenDismissedRules` in the answer lists the Clean Code rules the user keeps rejecting. Mention them in one line when there are any, as candidates to reword or drop in `clean-code-rules.md`.

**The tool is not there** (the mod did not load): run the reviewers below anyway, and present the merged findings in chat (see *No pane*).

**The fixed point:** use the PR's base branch, or the repository's default branch when there is no PR. Compare with `git diff <base>...HEAD` (three dots, against the merge-base).

## 2. Run the reviewers

Start all three, then record each one's findings as it finishes.

**Clean Code.**
- Spawn one `Agent` (general-purpose) in the background, and give it:
  - the diff command
  - the path of `clean-code-rules.md` in this skill's directory
  - this brief: *"Read the rules, then the diff and enough surrounding code to judge it. Report each place the change breaks a rule, as JSON lines: `{"file", "line", "rule", "severity", "summary", "short_summary", "failure_scenario", "suggested_fix"}`. `suggested_fix` is the change that would satisfy the rule, in at most three sentences or a short snippet. `severity` is `low` for style and readability, and `medium` when it would hide a bug or mislead the next change. `line` is the head-side line. `summary` is one sentence. `failure_scenario` says what it costs a reader or caller. Judge only lines the diff adds or changes. Skip anything a linter or formatter enforces. When unsure whether a rule is broken, leave it out."*
- When it answers, call `mcp__vise-skills__findings_record` with `source: "clean-code"`.

**Claude's /code-review.**
- Run Claude Code's built-in code review skill. This is the one that reports through `ReportFindings`, *not* `mattpocock-skills:code-review`.
- Its findings reach the pane by themselves. Do not record them again.
- If you cannot invoke it, ask the user to type `/code-review` themselves. The pane picks those findings up the same way.

**Matt's code-review.**
- Invoke `mattpocock-skills:code-review` as it is, with the fixed point above. Let it ask what it asks: a spec, or to run `/setup-matt-pocock-skills`.
- When its report is in, call `findings_record` with `source: "matt"`, one finding per point it raised.
  - `category` is `standards` or `spec`.
  - `severity`: `high` for a spec requirement missing or wrongly built, `medium` for a hard standards breach, `low` for a smell.
  - Name the smell or standard in the summary.
  - `suggested_fix`: Matt's fix line when its report gives one, else your own short one.
  - Points without a line take the file alone.

Record an empty list for a reviewer that found nothing, so the pane stops waiting on it.

## 3. Hand over

**Pane shown:** in one or two lines, say how many findings each reviewer raised, then that the user ticks findings in the pane and chooses:
- **Fix:** sends them to you to fix.
- **Fix + comment:** fix, commit, push, then post a comment per fix saying what changed.
- **Add to review:** build a review; **Submit review** posts it to the PR as one.
- **Dismiss:** drop them; a dismissed Clean Code finding counts against its rule.
- **More info:** on an expanded finding.

Or they press **Step through** to walk the open findings one at a time. Each one shows its code, severity and a suggested fix, with Fix, Add to review, Dismiss, More info and Next for that finding alone.

Then stop.

When a Fix prompt arrives from the pane, follow it as written. It ends with `findings_mark` (and, for Fix + comment, `findings_post` with a `note` per finding).

## No pane

The VS Code panel draws no panes. Here, list the findings in chat, grouped by reviewer, each with its severity icon (🔥 high, ⚠️ medium, 🧹 low), id, location and summary. Then ask with `AskUserQuestion` (`multiSelect: true`) which to fix and which to post. Act on the answer:
- `findings_post` for the ones to post.
- Fix the rest, then `findings_mark`.
- Mark the ones the user rejects `dismissed`. They count against their Clean Code rule.
- A finding you yourself find does not hold up is `withdrawn`, not `dismissed`. Only the user's rejections count against a rule.
