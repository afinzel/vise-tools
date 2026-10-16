---
name: restore-sessions
description: 'Bring Claude sessions back after a restart — finds the sessions active in a recent window from their transcripts, has Haiku judge from the last few messages which were mid-work and which had finished, and reopens the ones the user picks, each in its own terminal tab with `claude --resume`. Opens a pane with the mid-work ones pre-ticked. Use when the user runs /restore-sessions, or asks to get back the chats they lost to a restart, crash, or Windows update. Works whether or not /shutdown ran first.'
argument-hint: "How far back to look, e.g. 12h or 3d (default 24h)"
---

# /restore-sessions — bring the sessions back

The machine restarted and the user's Claude windows went with it. The conversations are not lost: Claude Code writes every session to a JSONL transcript as it goes, so a hard kill loses nothing written before it. What is lost is the *list* — which sessions were open, and which of those still mattered. Rebuild that list, recommend, and reopen what the user picks.

The resumed conversation already holds everything that session said, any handoff it wrote included, so a reopened session needs no prompt.

## 1. Find and judge them

Call `mcp__vise-skills__restore_sessions`, passing the argument as `window` (`12h`, `3d`; default a day). It reads the transcripts, asks Haiku which sessions were mid-work, and opens the restore pane. Its answer lists the candidates with their verdicts and says whether the pane is shown.

**Shown:** tell the user in one line how many sessions it found and how many Haiku recommends, and that they tick and press **Reopen** in the pane. Then stop: the pane reopens each in a Windows Terminal tab and marks what it did.

**Not shown** (the VS Code panel draws no panes): go on to step 2. **The tool is not there** (the mod did not load): go to *Without the mod*.

No candidates either way? Say so with the window used, suggest a longer one, and stop.

## 2. Let the user pick in chat

Ask with `AskUserQuestion`, `multiSelect: true`: *which sessions should come back?*

- One option per candidate, in the order given (resume, unclear, done). The label is its `label`, trimmed to fit; the description its Haiku `summary`, folder and `lastActive`. Mark the `resume` ones `(Recommended)`, and an `isPossiblyStillOpen` one `— may still be open`.
- A question holds four options and a call takes four questions, so sixteen fit. With more, put the resume and unclear ones in the picker and list the done ones below it in plain text, so the user can still name one.

Then call `mcp__vise-skills__restore_reopen` with the chosen `id`s, and relay its report: a line per session, any handoff path beside it.

## Without the mod

Do the same by hand. Run the script bundled with this skill, writing its output to your scratchpad directory (it runs to tens of KB, so do not read it into context whole); `--exclude` takes this session's own id, the newest `.jsonl` in `~/.claude/projects/<cwd-with-separators-as-dashes>/`:

```
python "<this skill's directory>/find_sessions.py" --hours <N> --exclude <own-session-id> > <scratchpad>/sessions.json
```

Hand the file to one `Agent` call with `model: "haiku"`, asking for one line per session, exactly `<id> | <resume/done/unclear> | <what it was doing, under 12 words>`: **resume** when work was in flight, **done** when the last exchange closes it, **unclear** otherwise. Treat the verdicts as an order for the list, not a decision. Pick as in step 2, then for each chosen session:

- **Windows:** `wt -w 0 new-tab -d "<cwd>" --title "<label>" claude --resume <id>` — `-w 0` puts the tabs in the current window.
- **macOS / Linux:** there is no portable way to open a tab; print `cd "<cwd>" && claude --resume <id>` per session instead.

Skip a session whose `cwd` no longer exists, and say so — `--resume` from another folder cannot find its transcript.
