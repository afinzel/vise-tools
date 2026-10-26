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

**Ask which mode.** Before starting the reviewers, ask with `AskUserQuestion` (header "Mode"):
- **Standard:** Claude's /code-review runs once, as below.
- **Voting (trial):** the same bug review runs three times in parallel with no cap on findings, then three voters judge every finding. Nothing is dropped; each finding says how many runs raised it and how many voters think it is real. Slower, and costs more.

Clean Code and Matt run the same way in both modes.

## 2. Run the reviewers

Start all three, then record each one's findings as it finishes.

**Behaviour change.** Every finding you record says, in `is_behaviour_change`, whether fixing it would change what callers, users or other systems can rely on. Paste this definition into each brief that asks for it: *"`is_behaviour_change` is true when the fix changes a return value or shape, makes an operation no longer atomic, changes an exception or when it is thrown, changes data persisted or sent, reorders side effects, or changes retry, timeout or config defaults. It is false for names, comments, formatting, dead code, a pure refactor, and log wording, levels or extra log lines, unless something depends on that log: an alert or metric built on it, an audit trail, a structured field someone queries. When in doubt, true."*

**Clean Code.**
- Spawn one `Agent` (general-purpose) in the background, and give it:
  - the diff command
  - the path of `clean-code-rules.md` in this skill's directory
  - the behaviour-change definition above
  - this brief: *"Read the rules, then the diff and enough surrounding code to judge it. Report each place the change breaks a rule, as JSON lines: `{"file", "line", "rule", "severity", "summary", "short_summary", "failure_scenario", "suggested_fix", "is_behaviour_change"}`. `suggested_fix` is the change that would satisfy the rule, in at most three sentences or a short snippet. `severity` is `low` for style and readability, and `medium` when it would hide a bug or mislead the next change. `line` is the head-side line. `summary` is one sentence. `failure_scenario` says what it costs a reader or caller. Judge only lines the diff adds or changes. Skip anything a linter or formatter enforces. When unsure whether a rule is broken, leave it out."*
- When it answers, call `mcp__vise-skills__findings_record` with `source: "clean-code"`.

**Claude's /code-review.** In voting mode, run *Voting mode* below instead.
- Run Claude Code's built-in code review skill. This is the one that reports through `ReportFindings`, *not* `mattpocock-skills:code-review`.
- Its findings reach the pane by themselves. Do not record them again.
- If you cannot invoke it, ask the user to type `/code-review` themselves. The pane picks those findings up the same way.
- Its findings carry no behaviour-change flag: `ReportFindings` has no field for one. That is expected, not a gap to fill.

**Matt's code-review.**
- Invoke `mattpocock-skills:code-review` as it is, with the fixed point above. Let it ask what it asks: a spec, or to run `/setup-matt-pocock-skills`.
- When its report is in, call `findings_record` with `source: "matt"`, one finding per point it raised.
  - `category` is `standards` or `spec`.
  - `severity`: `high` for a spec requirement missing or wrongly built, `medium` for a hard standards breach, `low` for a smell.
  - Name the smell or standard in the summary.
  - `suggested_fix`: Matt's fix line when its report gives one, else your own short one.
  - `is_behaviour_change`: your own call on that fix, by the definition above.
  - Points without a line take the file alone.

Record an empty list for a reviewer that found nothing, so the pane stops waiting on it.

### Voting mode

This takes the place of Claude's /code-review, and records under its source, `claude`. Separate agents find; separate agents judge. The vote labels each finding and never drops one: on your own branch a false positive costs one Dismiss, a dropped bug costs more.

Two numbers come out of it. **Raised** is how many of the three runs found it: one review run several times finds a different set each time, so a finding most runs agree on is likely solid. **Real** is how many voters, checking it against the code, think it holds. Real is the main signal. A finding raised by one run but judged real by all three voters is a real bug only one run happened to catch.

**1. Three reviewers.** Spawn three general-purpose `Agent`s in the background, in one message, each with the diff command and the same brief. Do not give them different focuses: the runs must be comparable for Raised to mean anything.

Brief: *"Read the diff and as much surrounding code as you need. Report every defect the change introduces or exposes, with no cap, including ones you are unsure of. Defects only: skip style, naming and cleanup. Answer as JSON lines: `{"file", "line", "quote", "severity", "summary", "short_summary", "failure_scenario", "suggested_fix"}`. `line` is the line number in the file at HEAD, never a position in the diff. `quote` is that line's text, copied exactly. `severity` is `high` for wrong behaviour, data loss or a security hole, `medium` for a real cost a reviewer would ask to fix, `low` otherwise."*

**2. Merge.** When all three have answered, merge the findings that are the same defect told two ways. The runs word things differently and often anchor the same defect to different lines (the call site, the method), so match on meaning, not text or line.
- **Narrow first:** only findings in the same file, or touching the same method or call chain, are candidates for a merge.
- **The test:** two findings merge only when they share both the cause and the fix. Same line, same file or the same topic is not enough: two different problems on one line stay two findings.
- **Name the shared cause:** for each merge, write one sentence stating the cause both findings share. If that sentence needs an "and", they are two defects; keep them apart.
- **When unsure, keep them apart.** A missed merge shows a near-duplicate, which costs one Dismiss. A wrong merge buries one bug inside another and inflates Raised.
- Number the results `v1`, `v2`, … Keep, for each, the clearest wording, the shared-cause sentence, Raised (how many runs found it, at most 3), and which run findings it came from.

**3. Three voters.** Spawn three `Agent`s with `model: "haiku"` in the background, in one message. Give each the diff command, the merged list (id, file, line, quote, summary, failure_scenario, suggested_fix, and for a merged finding its shared-cause sentence and the original findings it came from), the behaviour-change definition above, and this brief: *"Judge every finding on its own, against the code at HEAD. Try to disprove it. Answer as JSON lines: `{"id", "isReal", "isOneDefect", "tag", "is_behaviour_change", "line", "quote", "reason"}`. `isOneDefect` is for a merged finding only: true when its originals really are one defect with one cause and one fix. `is_behaviour_change` is about the suggested fix. `isReal` is true only when the code does what the finding says and it matters. `tag` is `important` for a defect this change introduces, `nit` for a real but minor one, `pre-existing` for one that predates this change. `line` and `quote` are the line the finding belongs on, read from the file at HEAD. `reason` is one sentence."*

**4. Split what the voters reject.** A merged finding most voters mark `isOneDefect: false` goes back to its originals, each with Raised 1 and a note in its failure_scenario that the merge was undone. Do not re-vote them; carry the votes the merged finding got.

**5. Record.** Call `findings_record` once with `source: "claude"` and every finding:
- `short_summary`: lead with both numbers and the majority tag, then the claim, e.g. `2/3 raised · 3/3 real · important: breaker shared`. Keep the claim short enough to read in the pane.
- `line`: the line most voters gave, when their quote matches the file at that line; otherwise the reviewer's line, when its quote matches. When neither matches, leave `line` out and say so in the summary.
- `failure_scenario`: the reviewer's, then a last line with the vote and any dissenting voter's reason, e.g. `Vote 2/3. Dissent: the caller already retries.` For a merged finding, also its shared-cause sentence.
- `severity`: the reviewer's, unchanged.
- `is_behaviour_change`: the majority of the voters.

## 3. Hand over

**Pane shown:** in one or two lines, say how many findings each reviewer raised (in voting mode, also how many most voters judged real, and how many of those only one run raised), then that the user ticks findings in the pane and chooses:
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
