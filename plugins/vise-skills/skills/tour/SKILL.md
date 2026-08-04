---
name: tour
description: Guided logical walkthrough of Claude's code changes — orders the changed files by functionality (entry point → core → supporting → tests), opens a before/after diff in VS Code at each stop with optional spoken narration, captures the user's review comments as you go, and posts them to the PR as inline threads so other reviewers see the trail.
argument-hint: "[PR number | branch | commit range] (optional — defaults to the current branch's changes)"
---

> **Windows-specific at present.** The git and VS Code steps are portable, but the
> narration path assumes PowerShell, a Windows venv layout, and a Kokoro model under
> the user's home directory. On macOS the built-in `say` command replaces Kokoro
> entirely, with no download — but that is not written yet.

Walk the user through a set of code changes the way an engineer walks a peer reviewer through their work: in **logical order, by functionality**, not alphabetically by filename. The user reads, asks questions, and leaves comments; you narrate, anchor their comments to code, and make them durable on the PR.

The user's workflow: Claude writes code → the user reviews it via this tour **before or instead of reading the raw diff on GitHub** → their comments become PR review threads → `/review-comments` (or this session directly) triages and addresses them.

## 1. Establish the review scope

Determine what's being reviewed, in this order:
- An explicit argument (PR number, branch name, or commit range) wins.
- Otherwise, the current branch's diff against its merge base with the default branch: `git diff --stat $(git merge-base HEAD origin/main)..HEAD` (detect the default branch; don't assume `main`).
- If the branch has no commits yet, fall back to the working tree diff (`git diff --stat` + `git status`).

Also detect whether an open PR exists for the branch (`gh pr view --json number,url` — tolerate failure). Remember the answer: it decides whether comments post live or queue locally (step 5).

## 2. Detect the display surface

Check once at the start:
- `$env:TERM_PROGRAM -eq 'vscode'` → running inside VS Code's integrated terminal; stops open in the user's current window.
- Not inside VS Code but the `code` CLI resolves → still works (separate window); mention this once and carry on.
- No VS Code → show the diff excerpt inline in chat at each stop instead. The tour is identical; only the display changes.

**Each stop shows a before/after diff, not just the final file.** Materialize the base version once per file into the scratchpad and open VS Code's side-by-side diff editor:

```powershell
git show <merge-base-or-base-sha>:<path> | Set-Content "$scratch\base__<flattened-name>"
code --diff "$scratch\base__<flattened-name>" <path>
```

- Changed regions are highlighted, so no line anchor is needed (the user navigates hunks with F7); when narration must point at one specific line among many hunks, additionally `code --goto <path>:<line>`.
- **New files** have no base — plain `code --goto` and say it's new. **Deleted files** — show the base version and say it's gone.
- No VS Code → show the unified diff hunk (`git diff <base>..<head> -- <path>`) inline in chat, trimmed to the relevant hunks.

**The last `code` call wins focus — so it must be the file you are about to narrate.** Each stop has exactly one *subject* file; anything else is a supporting tab. Open supporting files first, the subject file last, and never open a supporting file "while you're there" if it isn't earning its place — an extra tab is an extra chance to steal focus. When a stop genuinely has two subjects, that's two stops.

Aim `--goto` at the exact line the narration opens on, not near it. If you say "this switch decides the contract", the cursor sits on the `switch`, not on the call above it. Off-by-a-few silently costs the user the anchor the whole stop hangs on.

State in the stop message which file is active and roughly what they should be seeing ("bottom half of a ~50-line controller, guard clause just above the cursor"). You cannot see their screen; that sentence is the only way a focus mistake surfaces before the narration is wasted. If the user says the wrong thing is in front of them, re-issue `--goto` for the subject file and re-anchor before continuing — don't just carry on talking.

## 2a. The Claude Review panel (preferred surface when present)

When running inside VS Code, additionally drive the **Claude Review** extension (tree view in the Explorer sidebar) via a file contract in the workspace — no server. Always write the files when inside VS Code; they are harmless if the extension isn't installed, and the chat flow below remains fully authoritative either way. Keep `.claude-review/` out of the repo by appending it to `.git/info/exclude` (not `.gitignore` — don't touch tracked files).

**Skill → panel: `.claude-review/tour.json`.** Write it when presenting the itinerary (step 3), and rewrite it on every advance — the extension file-watches it and refreshes live:

```json
{
  "version": 2,
  "title": "PR #63 — forwarding rules",
  "kind": "tour",
  "parts": [
    {
      "id": "1",
      "title": "Entry point: the forwarding endpoint",
      "narration": "same text you narrate in chat (shown as tooltip)",
      "status": "current",
      "files": [
        { "path": "src/Api/ForwardingController.cs", "line": 42,
          "basePath": ".claude-review/base/ForwardingController.cs" }
      ]
    }
  ]
}
```

One part per stop; `status` is `pending | current | done | skipped`, exactly one `current`. Paths are workspace-relative. Materialize each changed file's base version into `.claude-review/base/` (`git show <base-sha>:<path>`) and set `basePath` — that powers the panel's before↔after diff. New files get no `basePath`.

**Panel → skill: `.claude-review/actions.jsonl`.** The extension appends one JSON line per user action: `{"at":"…","type":"opened|done|skip|comment","partId":"…","path":"…","body":"…"}`. The extension also writes `done`/`skip` statuses back into `tour.json` itself, so on advance re-read `tour.json` rather than blindly rewriting statuses you remember.

**Waiting on the panel.** At each wait point (step 4.3) the user may answer in chat *or* in the panel. Record the current line count of `actions.jsonl`, then start a background watcher (`run_in_background`) so a panel click ends the wait like a chat message would:

```powershell
$f = ".claude-review/actions.jsonl"
$n = <line count at wait start>
while (-not (Test-Path $f) -or (Get-Content $f).Count -le $n) { Start-Sleep -Milliseconds 500 }
Get-Content $f | Select-Object -Skip $n
```

Whichever arrives first wins; when the chat answers first, stop the watcher (TaskStop) before continuing so a stale wake-up can't fire mid-stop. Map panel actions onto the same responses as chat: `done` → "next"; `skip` → skip the stop; `comment` → a review comment at that stop (step 5 — post it verbatim exactly as if typed in chat, then stay on the stop); `opened` is informational (the user is looking around — fine, keep waiting).

When advancing, rewrite `tour.json`: current part → `done` (or `skipped`), next part → `current`. At tour end, set the last part's final status and leave the file in place — the panel then shows the completed tour as the session record.

## 2b. Voice narration (optional)

**Ask once at tour start: narrated or silent?** (Skip the question if the user already said — e.g. asked for a "narrated tour", passed `--voice`, or said "no voice".) Present it as a quick choice alongside the itinerary; default to silent if they don't care. Remember the answer for the whole tour.

**If narrated and `C:\Users\afinz\.claude\tts\kokoro` is missing, offer to install it** — say what it involves (~340MB download, self-contained folder, removable by deleting it) and on yes run:

```powershell
$k = "C:\Users\afinz\.claude\tts\kokoro"
New-Item -ItemType Directory -Force $k | Out-Null
python -m venv "$k\venv"
& "$k\venv\Scripts\pip.exe" install --quiet kokoro-onnx soundfile
Invoke-WebRequest "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx" -OutFile "$k\kokoro-v1.0.onnx"
Invoke-WebRequest "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin" -OutFile "$k\voices-v1.0.bin"
Copy-Item "<this skill's directory>\say.py" "$k\say.py"
```

(`say.py` ships in this skill's directory.) Verify with a short spoken test line before starting the tour. If the user declines the install (or has no Python), fall back to Windows SAPI (`System.Speech`, voice "Microsoft Zira Desktop") — or go silent if they'd rather.

When narration is on, each stop's narration is spoken aloud as well as written:

```powershell
& "C:\Users\afinz\.claude\tts\kokoro\venv\Scripts\python.exe" `
  "C:\Users\afinz\.claude\tts\kokoro\say.py" "<narration>" af_heart "$scratch\stopN.wav" 1.2
```

then play the wav **in the background** (`run_in_background`, `(New-Object Media.SoundPlayer $wav).PlaySync()`) so the chat message and the audio land together — never make the user wait for playback to finish.

- **Hide the synthesis latency:** synthesize stop N+1's narration while the user is reading stop N (background call), so playback on "next" is instant. Synthesize stop 1 while presenting the itinerary.
- Keep spoken narration to the narrative sentences only — don't read out code, paths, or line numbers; those are on screen.

## 3. Plan the tour

Read the diff and order the stops by **how the functionality flows**, not by path. A good default shape:

1. **Orientation** — one short paragraph: what this change does as a whole and why (from commit messages / PR description / the conversation).
2. **Entry point** — where the new behaviour is triggered (endpoint, handler, command, UI event).
3. **Core change** — the heart of the logic, in call order. Drill down: if the entry point calls a new service which calls a new repository method, visit them in that order.
4. **Supporting changes** — config, DI registration, migrations, models, mappers.
5. **Tests** — last, framed as "here's how we prove it works"; call out what is and isn't covered.

Collapse trivial stops (formatting, generated files, lockfiles) into a single "also touched, nothing to see" mention rather than giving them stops. Present the planned itinerary as a numbered checklist before starting so the user sees the shape of the tour and can reorder or skip.

## 4. Conduct the tour, one stop at a time

For each stop:

1. Open the before/after diff (`code --diff`, per step 2) or show the diff hunks inline — subject file last so it holds focus, cursor on the line the narration opens on.
2. Narrate briefly — 2–5 sentences: what changed here, why, and how it connects to the previous stop. Point at specific lines. If narration is on, speak these sentences aloud (step 2b) while they appear in chat. Honest narration: if something is a hack, a shortcut, or a decision you (Claude) made unilaterally while writing it, say so — this is the moment the user gets to catch it.
3. **Wait.** Do not advance until the user responds — in chat or via the Claude Review panel (start the actions.jsonl watcher, step 2a). Their response is one of:
   - **"next" / "ok"** → check the stop off, move on.
   - **A question** → answer it, stay on the stop.
   - **A comment** (a critique, a request, a doubt) → capture it (step 5), then ask whether to fix now or queue it, and stay on the stop until they say move on.
   - **"skip the rest" / "jump to X"** → obey.
4. Show progress on each stop header: `[3/7] src/Services/ForwardingService.cs`.

Never batch multiple stops into one message. One stop, one message, wait.

## 5. Capture and post comments

When the user makes a review comment at a stop — typed in chat or added via the panel's 💬 button (a `comment` line in `actions.jsonl`) — record it verbatim with its anchor (path, line, commit SHA of the diff side being reviewed). Panel comments carry their own `path`; comments on the part itself anchor to the stop's subject file.

**If a PR exists:** post it immediately as a real inline review comment so the trail is visible to other reviewers:

```bash
gh api repos/{owner}/{repo}/pulls/<PR>/comments \
  -f body="..." -f commit_id="<head-sha>" -f path="<path>" \
  -F line=<line> -f side=RIGHT
```

Post the user's words **verbatim** — do not rewrite or polish them. It's their review, under their account.

**If no PR exists yet:** queue comments locally (a simple numbered list you maintain in the conversation). At the end of the tour, if a PR gets opened, offer to post the queue in one pass; if the fixes all land before anything is pushed, the queue simply dissolves — nothing worth recording.

**When a comment is fixed during the tour** (user said "fix it now"): make the change, then reply on the thread describing what was done, prefixed so authorship is obvious — e.g. `🤖 resolved by Claude: extracted into NotificationHelper` — and resolve the thread (same GraphQL mutations as `/review-comments` step 5). Everything posts under the user's GitHub account; the prefix is what keeps the dialogue readable to teammates.

## 6. End of tour

Finish with a short summary:
- Stops visited / skipped.
- Comments made: fixed during the tour vs still open (with links if posted to a PR).
- Anything you flagged yourself during narration that the user didn't react to.

If open comments remain on a PR, point the user at `/review-comments` as the follow-up for triaging them later — that skill is the consumer of what this one produces.

## Quality bar

- The ordering is the product. If the tour visits files in the same order GitHub lists them, this skill has failed.
- Narration is a colleague explaining, not a diff describing. "This is where we decide whether to retry" beats "modified the retry logic".
- Narration and screen must agree. Every stop narrates the file that is actually in front of the user, at the line they are actually looking at — a stop that describes a background tab is not a stop, it's a monologue.
- Never advance without the user's say-so. The wait is the review.
- User comments are posted verbatim, always attributed correctly, and never silently dropped — a queued comment that never gets posted or actioned must appear in the end-of-tour summary as open.
