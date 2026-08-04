---
name: tour
description: Guided logical walkthrough of Claude's code changes — orders the changed files by functionality (entry point → core → supporting → tests), opens a before/after diff in VS Code at each stop with optional spoken narration, captures the user's review comments as you go, and posts them to the PR as inline threads so other reviewers see the trail.
argument-hint: "[PR number | branch | commit range] (optional — defaults to the current branch's changes)"
---

Walk the user through a set of code changes the way an engineer walks a peer reviewer through their work: in **logical order, by functionality**, not alphabetically by filename. The user reads, asks questions, and leaves comments; you narrate, anchor their comments to code, and make them durable on the PR.

The user's workflow: Claude writes code → the user reviews it via this tour **before or instead of reading the raw diff on GitHub** → their comments become PR review threads → `/review-comments` (or this session directly) triages and addresses them.

## 0. Detect the platform once

Everything below that touches the shell has a POSIX form and a PowerShell form. Detect once at the start and use the matching column throughout; never emit both.

| | macOS / Linux | Windows |
|---|---|---|
| inside VS Code? | `[ "$TERM_PROGRAM" = vscode ]` | `$env:TERM_PROGRAM -eq 'vscode'` |
| write a base file | `git show <sha>:<path> > <out>` | `git show <sha>:<path> \| Set-Content <out>` |
| TTS root | `~/.claude/tts/kokoro` | `C:\Users\<user>\.claude\tts\kokoro` |
| venv python | `<root>/venv/bin/python` | `<root>\venv\Scripts\python.exe` |
| play a wav | `afplay <wav>` (Linux: `aplay`/`paplay`) | `(New-Object Media.SoundPlayer <wav>).PlaySync()` |
| download | `curl -sL -o <file> <url>` | `Invoke-WebRequest <url> -OutFile <file>` |

## 1. Establish the review scope

Determine what's being reviewed, in this order:
- An explicit argument (PR number, branch name, or commit range) wins.
- Otherwise, the current branch's diff against its merge base with the default branch: `git diff --stat $(git merge-base HEAD origin/main)..HEAD` (detect the default branch; don't assume `main`).
- If the branch has no commits yet, fall back to the working tree diff (`git diff --stat` + `git status`).

Also detect whether an open PR exists for the branch (`gh pr view --json number,url` — tolerate failure). Remember the answer: it decides whether comments post live or queue locally (step 5).

## 2. Detect the display surface

- Inside VS Code's integrated terminal (see step 0) → stops open in the user's current window.
- Not inside VS Code but the `code` CLI resolves → still works (separate window); mention this once and carry on.
- No VS Code → show the diff excerpt inline in chat at each stop instead. The tour is identical; only the display changes.

**Each stop shows a before/after diff, not just the final file.** Materialize the base version once per file (never once per beat — a file visited five times is materialized once) and open VS Code's side-by-side diff editor:

```bash
git show <merge-base-or-base-sha>:<path> > .claude-review/base/<flattened-name>
code --diff .claude-review/base/<flattened-name> <path>
```

- Changed regions are highlighted, so hunk-level navigation is free (F7); the beat's `line` is what puts the cursor on the exact thing being said.
- **New files** have no base — plain `code --goto` and say it's new. **Deleted files** — show the base version and say it's gone.
- No VS Code → show the unified diff hunk (`git diff <base>..<head> -- <path>`) inline in chat, trimmed to the relevant hunks.

**The last `code` call wins focus — so it must be the file the current beat points at.** Open supporting files first, the beat's file last, and never open a file "while you're there" if it isn't earning its place — an extra tab is an extra chance to steal focus.

State in the stop message which file is active and roughly what they should be seeing ("bottom half of a ~50-line controller, guard clause just above the cursor"). You cannot see their screen; that sentence is the only way a focus mistake surfaces before the narration is wasted. If the user says the wrong thing is in front of them, re-issue `--goto` and re-anchor before continuing — don't just carry on talking.

## 2a. The Claude Review panel (preferred surface when present)

When running inside VS Code, drive the **Claude Review** extension (tree view in the Explorer sidebar) via a file contract in the workspace — no server. Always write the files when inside VS Code; they are harmless if the extension isn't installed, and the chat flow below remains authoritative either way. Keep `.claude-review/` out of the repo by appending it to `.git/info/exclude` (not `.gitignore` — don't touch tracked files).

### The schema: routes and beats

```json
{
  "version": 3,
  "title": "PR #63 — forwarding rules",
  "kind": "tour",
  "activeRoute": "add-library",
  "routes": [
    {
      "id": "add-library",
      "title": "Add library",
      "status": "current",
      "beats": [
        { "id": "1", "path": "src/Api/ForwardingController.cs", "line": 42,
          "text": "The request lands here and we pick a rule.",
          "status": "current",
          "basePath": ".claude-review/base/ForwardingController.cs" },
        { "id": "2", "path": "src/Rules/RuleSet.cs", "line": 88,
          "text": "And this is the lookup it delegates to.",
          "status": "pending" }
      ]
    }
  ]
}
```

**A beat is one anchor: a file, a region of it, and what you say about that region.** One per thing worth pausing on — usually a function, a hunk, or a guard clause, not a single statement. Set `line` and `endLine` so the whole region highlights; a beat per line reads as twitchy and gives the user nothing to look at while you talk.

Split when the *subject* changes, not when the line number does. Three sentences about one function is one beat; one sentence each about three consecutive lines is one beat too — the same beat.

**A route is a named pass over the code** — a topic, not a file group: "Add library", "The happy path", "What happens when it fails". Two levels only, route → beat.

**The same file appears on many beats, across many routes, at different lines. This is normal, not a special case** — it's how a topic-shaped walk works. `basePath` and cached audio both dedupe underneath, so revisits are nearly free.

Rules: exactly one route `current`, exactly one beat within it `current`; `status` is `pending | current | done | skipped`; paths workspace-relative. New files get no `basePath`.

Other modes reuse the same shape — `kind: "comments"` (a beat is an unresolved PR thread, `text` the reviewer's verbatim words, plus `url`) and `kind: "review"` (a beat is a finding, plus `severity`, routes grouping by dimension).

### Panel → skill: `.claude-review/actions.jsonl`

The extension appends one JSON line per user action:
`{"at":"…","type":"opened|goto|done|skip|comment","routeId":"…","beatId":"…","path":"…","body":"…"}`

The extension also writes `done`/`skip`/`current` back into `tour.json`, so on advance **re-read the file** rather than blindly rewriting statuses you remember.

### Waiting on the panel

At each wait point (step 4.3) the user may answer in chat *or* in the panel. Record the current line count of `actions.jsonl`, then start a background watcher so a panel click ends the wait like a chat message would:

```bash
f=.claude-review/actions.jsonl; n=<line count at wait start>
while [ ! -f "$f" ] || [ "$(wc -l < "$f")" -le "$n" ]; do sleep 0.5; done
tail -n +$((n+1)) "$f"
```

```powershell
$f = ".claude-review/actions.jsonl"; $n = <line count at wait start>
while (-not (Test-Path $f) -or (Get-Content $f).Count -le $n) { Start-Sleep -Milliseconds 500 }
Get-Content $f | Select-Object -Skip $n
```

Whichever arrives first wins; when the chat answers first, stop the watcher (TaskStop) before continuing so a stale wake-up can't fire mid-stop. Map panel actions onto the same responses as chat:

- `done` → next beat. `skip` → skip it.
- `comment` → a review comment at that beat (step 5 — post verbatim, then stay put).
- `goto` → **the user has jumped.** They clicked a beat somewhere else, possibly on another route. Abandon the current position, make that beat current, play its narration, and carry on from there. Do not argue them back into sequence — the map is theirs to wander.
- `opened` → informational (they're looking around); keep waiting.

## 2b. Voice narration (optional)

**Ask once at tour start: narrated or silent?** (Skip if they already said — asked for a "narrated tour", passed `--voice`, said "no voice".) Default to silent if they don't care. Remember for the whole tour.

**If narrated and the TTS root (step 0) is missing, offer to install it** — say what it involves (~340MB download, self-contained folder, removable by deleting it) and on yes:

```bash
K=~/.claude/tts/kokoro
mkdir -p "$K" && python3 -m venv "$K/venv"
"$K/venv/bin/pip" install -q kokoro-onnx soundfile
curl -sL -o "$K/kokoro-v1.0.onnx" https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -sL -o "$K/voices-v1.0.bin"  https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
cp "<this skill's directory>/say.py" "$K/say.py"
```

```powershell
$k = "C:\Users\<user>\.claude\tts\kokoro"
New-Item -ItemType Directory -Force $k | Out-Null
python -m venv "$k\venv"
& "$k\venv\Scripts\pip.exe" install --quiet kokoro-onnx soundfile
Invoke-WebRequest "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx" -OutFile "$k\kokoro-v1.0.onnx"
Invoke-WebRequest "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin" -OutFile "$k\voices-v1.0.bin"
Copy-Item "<this skill's directory>\say.py" "$k\say.py"
```

Verify with a short spoken test line before starting. If the user declines the install (or has no Python), fall back to the OS voice — macOS `say -v Samantha -r 190 "…"`, Windows SAPI (`System.Speech`, "Microsoft Zira Desktop") — or go silent if they'd rather. Both are noticeably worse than Kokoro; say so rather than quietly downgrading.

**Synthesize one beat at a time:**

```bash
~/.claude/tts/kokoro/venv/bin/python ~/.claude/tts/kokoro/say.py "<beat text>" af_heart "" 1.2
```

It prints the wav path. Play it **in the background** so the chat message and the audio land together — never make the user wait for playback.

- **`say.py` caches on `text + voice + speed`.** A cache hit costs ~0.07s versus ~3s cold, because it skips the model load too. So a replayed beat, a re-walked tour, and narration repeated across routes are all free. Never hand-manage the cache; just call `say.py` and let it decide.
- **Prefetch during playback, not during reading.** Synthesize beat N+1 while beat N's audio is *playing*. Measured: ~2.3s of synthesis hides completely inside 5.5–7s of narration, with 0.04s of total overhead across a three-beat chain — so the user can hit "next" the instant audio stops and still wait for nothing. Don't rely on them reading slowly.
- **The only unhidden latency is the first beat** (~3.6s, model load included). Synthesize it while presenting the itinerary. On any re-run it's cached and instant.
- Keep spoken narration to the narrative sentences only — don't read out code, paths, or line numbers; those are on screen.

## 3. Plan the tour

Read the diff and build **routes**, ordered by how the functionality flows, not by path. For a single-pass review one route is fine; name it for what it covers, not "Tour".

A good default shape for the first route:

1. **Orientation** — one beat: what this change does as a whole and why (from commit messages / PR description / the conversation).
2. **Entry point** — where the new behaviour is triggered (endpoint, handler, command, UI event).
3. **Core change** — the heart of the logic, in call order. Drill down: if the entry point calls a new service which calls a new repository method, visit them in that order.
4. **Supporting changes** — config, DI registration, migrations, models, mappers.
5. **Tests** — last, framed as "here's how we prove it works"; call out what is and isn't covered.

Collapse trivial changes (formatting, generated files, lockfiles) into a single "also touched, nothing to see" beat rather than giving them one each.

**Additional routes are authored on demand.** When the user asks for another pass — "now walk me through what happens when it fails", "show me just the data model" — write a new route over the same code, at whatever lines that topic actually lives on. Base files and any repeated narration are already cached, so a second route is cheap. Don't pre-generate routes nobody asked for.

Write `tour.json` and present the itinerary before starting, so the user sees the shape and can reorder or skip.

## 4. Conduct the tour, one beat at a time

For each beat:

1. Open its file — before/after diff per step 2 — with the region `line..endLine` highlighted.
2. Narrate its text: what this region does and how it connects to the last beat. If narration is on, speak it (step 2b) while it appears in chat. Honest narration: if something is a hack, a shortcut, or a decision you made unilaterally while writing it, say so — this is the moment the user gets to catch it.

   **Tell the story. A tour is one continuous explanation, not a set of captions.** This is the failure mode to watch for, because captions look correct on the page: each beat is accurate about its own lines, and the tour as a whole says nothing. The test is whether the beats read as one person talking, or as a list of labels that happen to be in order.

   - **The first beat orients.** What is this thing, why does it exist, what problem was it built for. Not a file — a sentence like *"This is an extension we wrote so Claude can walk you through code out loud, instead of handing you a diff and hoping you read it."* Nobody can follow a walk through machinery they haven't been told the purpose of.
   - **Say "we" and "I".** Somebody built this, and that somebody is talking. *"We start off by registering the panel here"* beats *"activate() registers the tree view"*. The passive, subjectless version is what makes a tour sound like generated documentation.
   - **Every beat continues the one before it.** *"There is no server between us. I write a file, the extension reads it — this is the read."* Connective tissue is the difference between a story and an index; if a beat would read identically in any position, it isn't narrating, it's labelling.
   - **The route names are chapter titles**, so let them carry structure the beats don't have to restate: "What this is", "How a tour is put together", "What happens when you press play", "Talking back".
   - **Say what it's for before how it's done.** A beat that opens with a function name has already lost the listener; they're parsing a symbol instead of listening.

   **Pitch the depth to the listener — and don't confuse depth with voice.** These are separate knobs, and collapsing them is the easy mistake: going conversational, you drop the content too, and end up with something friendly that teaches nothing. Plain voice with full technical content is almost always the right answer:

   > ❌ *thin* — "We start off by registering the panel here, and then we sit and wait."
   > ❌ *unlistenable* — "`activate()` registers a `FileSystemWatcher` over `.claude-review/*` whose events fire `provider.refresh()`."
   > ✅ *both* — "We start off by registering the panel here, in activate. The part that actually matters is the watcher we put on the dot-claude-review folder: that's why the panel redraws the moment I rewrite the tour file, with nobody pressing refresh."

   The third keeps everything the second knows and still sounds like a person. Note the spoken forms too — say "dot claude review", not `.claude-review`; a listener can't hear punctuation, and reading symbols aloud is what makes narration sound like a screen reader.

   Calibrate on who is listening, and adjust the moment they react:

   - **Their own PR, codebase they know** — the most technical end. They're checking your judgement, so names, specifics, and the tradeoff you took belong in the narration.
   - **Code they didn't write, or a subsystem they're new to** — the why has to arrive first or the specifics don't stick.
   - **A pure refactor** — the mechanism *is* the story; go technical without apology.
   - **A behaviour change** — what breaks outranks how it's built, however clever the implementation.

   When unsure, pitch to the middle and say so once: one beat played tells them more than any question you could ask up front. If they say "more technical" or "you've lost me", change level for every remaining beat, not just the next one.

   **Write narration to the `/tldr` standards** — they are the house rules for making an explanation land, and they matter more here than anywhere else, because narration is literally spoken and nobody can re-read a wav. In particular: say whether it matters before you say what it is; go concrete before abstract, with real values; give every sentence a subject and a real verb; don't turn verbs into nouns ("one enforcement point" → *we check in one place*); chain cause to effect with "so"; and let a class or method name appear only after you've said in ordinary words what it does. Say it once and stop — a beat that keeps talking after the point has landed is dead air the user has to sit through.
3. **Wait.** Do not advance until the user responds — in chat or via the panel (start the watcher). Their response is one of:
   - **"next" / "ok"** → mark done, move on.
   - **A question** → answer it, stay put.
   - **A comment** → capture it (step 5), ask whether to fix now or queue, stay put.
   - **A jump** (`goto`, "go back to the retry bit", "skip to the tests") → obey, and re-anchor.
4. Show progress on each beat header: `[Add library 2/5] src/Rules/RuleSet.cs:88`.

Never batch multiple beats into one message. One beat, one message, wait.

Rewrite `tour.json` on every advance: current beat → `done`/`skipped`, next → `current`. Re-read first (the extension may have written statuses of its own).

## 5. Capture and post comments

When the user makes a review comment at a beat — typed in chat or via the panel's 💬 button — record it verbatim with its anchor (path, line, commit SHA of the diff side being reviewed). Panel comments carry their own `path` and `beatId`.

**If a PR exists:** post it immediately as a real inline review comment so the trail is visible to other reviewers:

```bash
gh api repos/{owner}/{repo}/pulls/<PR>/comments \
  -f body="..." -f commit_id="<head-sha>" -f path="<path>" \
  -F line=<line> -f side=RIGHT
```

Post the user's words **verbatim** — do not rewrite or polish them. It's their review, under their account.

**If no PR exists yet:** queue comments locally (a numbered list you maintain in the conversation). At the end, if a PR gets opened, offer to post the queue in one pass; if the fixes all land before anything is pushed, the queue dissolves.

**When a comment is fixed during the tour** (user said "fix it now"): make the change, reply on the thread prefixed so authorship is obvious — `🤖 resolved by Claude: extracted into NotificationHelper` — and resolve it (same GraphQL mutations as `/review-comments` step 5). Everything posts under the user's account; the prefix keeps the dialogue readable to teammates.

## 6. End of tour

Finish with a short summary:
- Beats visited / skipped, by route.
- Comments made: fixed during the tour vs still open (with links if posted).
- Anything you flagged yourself during narration that the user didn't react to.

Leave `tour.json` in place — the panel then shows the completed tour as the session record. If open comments remain on a PR, point at `/review-comments` as the follow-up.

## Quality bar

- The ordering is the product. If the tour visits files in the same order GitHub lists them, this skill has failed.
- Narration is a colleague explaining, not a diff describing. "This is where we decide whether to retry" beats "modified the retry logic". The `/tldr` standards are the bar — spoken narration is the hardest case for them, not an exemption.
- A beat is a thing worth stopping for. If you can't say why the user should look at this region, it isn't a beat.
- **Read the beats back to back with the code hidden.** If they still tell a story — someone explaining a thing they built, each sentence following from the last — the tour works. If they read as a list of accurate captions, it has failed, however correct each one is.
- Narration and screen must agree. Every beat narrates the line the cursor is actually on — a beat that describes a background tab is not a beat, it's a monologue.
- Never advance without the user's say-so. The wait is the review.
- The user may wander. A jump is not a mistake to correct; the route is a suggestion, not a rail.
- User comments are posted verbatim, always attributed correctly, and never silently dropped — a queued comment that never gets posted or actioned must appear in the end-of-tour summary as open.
