---
name: thanks
description: End-of-session close-out check. Sweeps for anything left dangling before the user closes the chat — uncommitted work, processes still running, work that was interrupted rather than finished, reasoning that would evaporate, outward-facing loose ends. Read-only: it reports and waits for acknowledgement, it never acts. Use ONLY when the user explicitly runs /thanks. Do NOT trigger on "thanks!", "I'm done", "that's me for the day", or any other wrap-up phrasing — this fires when asked for by name and at no other time.
---

# /thanks — the close-out check

The user is about to close this chat and wants to know it's safe to walk away.

Your job is to go and **look**, then tell them what you found. You do not fix anything. You do not commit, push, delete, kill, or write files. The user reads your report, acknowledges what's there, and decides for themselves. If they want something handled they will ask in a follow-up.

## Why this exists, and the one way it fails

The check is only worth running if it's honest. A cheerful "all clear ✅" that didn't actually go and look is **worse than no check at all**, because it manufactures confidence at the exact moment the user has stopped paying attention. They close the tab believing you looked.

So: silence must mean *verified clean*. Never report a check as clean by assumption or by vibe. The user's trust in the silence is the whole product.

Keep three states apart, and don't let the last two collapse into the first:
- **Clean** — you looked, there's nothing. Silent.
- **Not applicable** — the check doesn't apply here at all (a repo check outside a repo, a PR check with no remote). Also silent. Announcing it is noise.
- **Couldn't check** — it applies, you tried, you failed: the command errored, the transcript's compacted and the raw file isn't there, a tool wasn't available. **This is a finding.** Say so plainly. An unchecked box is not a ticked one.

## Where to actually look

Most of what you need is already in your context — the conversation is right there, so the transcript checks below cost attention, not work. Don't over-engineer them.

But there's a trap. On a long session the earlier conversation gets **compacted** into a summary to make room, and the raw detail goes with it: interruption markers, your exact phrasing of a promise, the question that got sidestepped. That's an ugly inversion — the longer and messier the session, the more this check matters and the less of it you can still see. Answering from a summary is exactly how you'd hand back a confident, wrong all-clear.

So when anything has been compacted, or you're unsure how much you're still holding, go to the raw record. Claude Code writes the full uncompacted session to disk as JSONL, live:

```
~/.claude/projects/<cwd-with-separators-as-dashes>/<session-id>.jsonl
```

The live session is the most recently modified `.jsonl` there. It's verbatim and immune to compaction.

**Do not grep it for bare substrings.** The transcript contains everything that crossed the wire — including this file, if it was ever read or edited, and including your own previous `/thanks` output. A search for `Request interrupted by user` therefore matches *this very sentence* explaining the marker. The check counts itself, and it gets worse the more you discuss what you found, because that discussion lands in the transcript too. Measured on the session that built this skill: naive substring grep reported 8 interruptions and 11 denied tool calls; the true figures were 1 and 1.

The escape is to use the structure rather than the text. A genuine interruption is a *user-role message whose own text* begins with the marker — not prose in a tool result, not a line in a file you read. Filter on that and the self-matches drop out:

```bash
F=$(ls -t ~/.claude/projects/<munged-cwd>/*.jsonl | head -1)

# real interruptions: user-role text messages starting with the marker
jq -r 'select(.type=="user") | .message.content
       | if type=="string" then . else (.[]? | select(.type=="text") | .text) end' "$F" \
  | grep -cE '^\[Request interrupted by user'

# real denials: the full sentence, and only inside tool results
jq -r 'select(.type=="user") | .message.content
       | if type=="array" then (.[]? | select(.type=="tool_result") | .content
       | if type=="string" then . else (.[]? | .text? // empty) end) else empty end' "$F" \
  | grep -c "The user doesn't want to proceed with this tool use"
```

Both were verified to return the correct count on a real session. Treat the general lesson as bigger than these two commands: **any pattern this file names in order to search for it is a pattern this file now contains.** When you add a check, filter by role and structure, and sanity-check a suspicious count by looking at the actual matches before you report a number.

Query it rather than reading it whole — these files run to hundreds of KB, and reading one in full to check whether you'd lost context would itself cost you the context. If the file can't be found, say so; that's a "couldn't check," not a clean bill.

## What actually matters

Sort by **what is genuinely lost if the tab closes right now**. Most of what a naive checklist would report isn't at risk at all — uncommitted code is still on disk tomorrow. Lead with what's irrecoverable, then what leaks, then what merely annoys.

Run these eight checks. Skip nothing silently.

### 1. Interrupted or abandoned work

The most valuable check, because it's the only *implicit* one. Everything else here is something someone said out loud. This is work that just… stopped: the user hit escape, redirected, you both moved on, and because nobody ever said "I'll come back to this," no promise-scan will ever catch it. It's the gap between *we finished* and *we stopped*.

Real anchors to look for, rather than guessing:
- Literal interruption markers in the transcript (`[Request interrupted by user]` and similar).
- Task-list items still sitting `in_progress` — check with TaskList.
- Partial mechanical sweeps: you edited three of five call sites and got redirected. A half-applied refactor is a broken state that looks like progress.
- A topic change immediately following a partial action.

For each, the question to put to the user is: *are we in the middle of this, or did we decide to drop it?* They often won't remember either.

### 2. Claimed done, never observed

You assert "fixed" far more often than you run the thing and watch it work. This check asks: did we *confirm*, or did we just *say*? Distinguish "the types check" from "I drove the actual flow and saw the behaviour." A build that was never run isn't a green build — it's an unknown one. Flag anything reported as working on the strength of reasoning alone.

### 3. Things still running

These outlive the session, which is exactly why they matter — they keep going, or keep firing, after the user is gone.
- Background Bash tasks, servers, watchers you started.
- Unfinished subagents or workflows (TaskList).
- Scheduled things: crons (CronList) and any `/loop` set up this session. A loop the user forgot about is tomorrow's confusion.
- Worktrees created and not removed (`git worktree list`).

### 4. Repo state

Cheap, deterministic, near-zero false alarms. Not a git repo? Not applicable — stay quiet.
- `git status --porcelain` for uncommitted and untracked files.
- `git log @{u}.. --oneline` for unpushed commits.
- `git stash list` for stashes made this session and never popped.
- The session's diff, scanned for debug scaffolding: stray logging, a hardcoded test value, commented-out code, a skipped assertion.
- **Temporary edits meant to be reverted.** Anything switched into a throwaway state to get something working and never switched back — a flag flipped, a timeout inflated, a dependency pointed at a prerelease, an endpoint aimed at staging. These share a signature: they were deliberate, they worked, and that's precisely why nobody remembers them. They stay invisible until CI fails on someone else's machine. In this user's world the recurring one is a CodeArtifact `nuget-unstable` feed added to `NuGet.config` to test a framework change downstream, along with the prerelease pin in `Directory.Packages.props` that came with it (versions shaped like `0.3.93-ge82aae0a72`) — but look for the pattern, not just that instance.

### 5. Questions you asked that were never answered

You ask, the user replies about something else, you quietly pick a sensible default and carry on — and that guess is now load-bearing in the code. Surface the assumption while it's still cheap to correct. Report what you asked, what you assumed instead, and what depends on it.

### 6. Loose ends you promised

Scan back for your own unfulfilled commitments: "I'll circle back to that," "let's fix the test after," "leaving that for now." These live nowhere but the transcript. Narrow, but nothing else catches them.

### 7. Outward-facing loose ends

Reaches beyond the repo, so it's worth being precise.
- A branch pushed with no PR opened.
- A PR left in draft, or with an empty body.
- Review comments left unaddressed.
- A PR title that doesn't match the user's convention: `type(scope): description (TICKET)` — Conventional Commits, scope names the component, ticket key trailing in parens.

### 8. Knowledge worth persisting

The only genuinely irrecoverable thing here. The code survives on disk; the *reasoning* dies with the chat — the constraint discovered halfway through, the approach ruled out and why, the decision the user made that isn't written in any commit message.

Filter hard, because this check earns its keep by being rare. Do **not** propose saving anything the repo, git history, or CLAUDE.md already records. Ask: *would a competent person reading this codebase next month be unable to reconstruct this?* If they could, skip it. One genuinely good memory entry per several sessions is the right rate; a skill that proposes saving trivia every time gets ignored within a week.

When something does qualify, show the user **the content you'd save** — the actual text — so they can judge it. Don't write the file. That's their call.

## Reporting

**Clean checks are silent.** No "✅ nothing running", no roll call of what you looked at, no report structure at all when there's nothing to report. Resist the pull to show your work — an eight-point all-clear is you asking for credit for the checking, and it trains the user to skim exactly the report they'd one day need to read. Silence carries information here, but only because you never spend it on nothing.

For findings, write plain sentences a person can act on. Lead with what's lost, not with the check's name. "You've got two commits on `feat/forwarding` that only exist on this machine" beats "**Repo state:** unpushed commits detected." Group only if there are enough findings that grouping helps.

Rank by consequence, not by the order of the checks above.

**Report what they'd actually regret; count the rest.** A messy session can turn up a dozen things, and handing someone a dozen items at the moment they're trying to leave guarantees they skim all of them. So exercise judgment — lead with what genuinely matters and hold back the marginal.

But never hide the filtering. Close with a single line naming what you held back and how many, so the decision stays theirs: *"Plus 6 minor things — stray logging, some scratch files — say the word."* That way the report is short by default and complete on request. Silently deciding what they don't need to know is the one thing that would make this untrustworthy; telling them you decided, and letting them overrule it in one word, is what makes the brevity safe.

## The acknowledgement

This is the part that makes it a check rather than a wall of text.

Having reported, ask the user to acknowledge — not to *fix*, just to confirm they've seen it and are choosing to walk away from it. Something in the shape of: *any of these you want to deal with, or are you good to leave them?* Then wait.

Ask once. If they wave it off, they've made an informed decision and that was the entire point — don't nag, don't re-list, don't editorialise about the risk. Sign off.

## The sign-off

Only after a clean sweep, or after they've acknowledged.

One line. In your own voice, reflecting what actually happened this session — not a template, not a paragraph of gratitude, not an emoji parade. It should feel like a colleague saying goodnight, and it should still land on the fiftieth use, which means it has to vary and it has to be specific to the day.

If everything is clean, that's the whole response. Something with the energy of *"Everything's closed off. Night."*

And when the user says thanks — say something back. Mean it, briefly, and let them go.
