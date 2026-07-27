---
name: second-mind
description: Adam's work knowledge vault (2nd-mind) — consult it for an already-solved failure mode before burning time debugging, and capture durable findings back into it. Use BEFORE investigating an unfamiliar error, a build/auth/NuGet/npm/terraform/infra failure, a flaky or silently-swallowed message, or a "why does this behave like this" question — the vault holds runbooks for problems solved once already. Also use when the user asks what the vault knows about something, or when a session produces a lesson, decision, or gotcha worth keeping. Read-only against the vault except one staging directory; it never edits vault pages.
argument-hint: "[check|ask|capture|sync] <question or finding>"
---

The **2nd-mind vault** is Adam's LLM-maintained work knowledge base: plain Markdown +
YAML frontmatter (an [OKF](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing)
bundle), holding solved failure modes, architectural decisions, vendor API specs, and
per-project worklogs. You are almost certainly running **outside** that repo. This skill is
how you use it from outside without damaging it.

## The one hard rule

**The only path you may write to is `<vault>/knowledge/inbox/`.**

Never create, edit, rename, or delete anything else in the vault. Never `git add`, `git
commit`, or `git push` in the vault. Never copy vault content into the repo you are
working in — not into a file, not into that repo's `CLAUDE.md`, not into a note-to-self.

The reason is not tidiness. The vault is git-crypt encrypted, and git-crypt encrypts file
*contents* but **not filenames or paths**. Real client names are therefore banned from
paths, filenames, and commit messages; the codename mapping lives in an encrypted file you
cannot see from here. A page you write directly would land at a leaking path, unlinked from
the graph you cannot see, and — because you have no idea what already exists — probably
duplicate a page. Capture instead; a session running inside the vault has the roster and
the graph in context and does the placement.

## 1. Locate the vault

In order, stop at the first hit:

1. `$SECOND_MIND_VAULT` (or `$env:SECOND_MIND_VAULT` on Windows).
2. Candidate paths, checked for a `knowledge/` directory and a `CLAUDE.md`:
   - `E:/work/2nd-mind` (Windows / "homer")
   - `~/work/2nd-mind`, `~/Developer/2nd-mind`, `~/2nd-mind` (macOS / Linux)
3. Nothing found → tell the user the vault isn't on this machine, and stop. Do not clone
   it, and do not offer to. If they want it found, ask them for the path and suggest they
   set `SECOND_MIND_VAULT` so this is a one-time cost.

## 2. Check whether it is readable

The vault is encrypted at rest. On a machine without the git-crypt key, every file under
`knowledge/**` is binary noise beginning with the bytes `\0GITCRYPT`.

Test it: read the first few bytes of `<vault>/knowledge/index.md`. If it starts with
`GITCRYPT`, the repo is **locked**.

When locked: say so plainly — "the vault is on this machine but locked (no git-crypt key),
so I can't read it." Do **not** try to interpret the binary, do not grep it for fragments,
and do not guess at content. Only `CLAUDE.md`, `README.md`, `.gitattributes`, `.gitignore`
and `.githooks/` are plaintext. Capture still works (the inbox is unencrypted and
gitignored), so offer that.

## 3. Operations

Pick by intent. `check` is the one that pays for the vault existing, and it is the one you
should reach for unprompted.

### `check` — look before you solve

Before spending real effort on a diagnosis, spend one search. Start with the gotcha
runbooks, which are indexed by failure mode:

- `knowledge/reference/gotchas/index.md` — **portable** lessons (behave the same anywhere):
  Mongo/LINQ, NuGet/CodeArtifact, SQS idempotency, terraform/cold-start, auth.
- `knowledge/work/stadion/gotchas/index.md` — Stadion-platform-specific.
- `knowledge/work/stadion/clients/*/gotchas/` — one client's account or config.

Search on the *symptom* (the error string, the status code, the observed behaviour), not
your hypothesis about the cause — the pages are written from the symptom inward. Then widen
to `knowledge/**` if nothing lands.

If you find a hit, say so before you start work and cite the page path. If you find
nothing, say nothing and carry on — a silent miss costs the user nothing, a noisy one
trains them to ignore you.

### `ask` — answer from the vault

Navigate, don't crawl. `knowledge/index.md` is the master catalog (progressive disclosure),
then the area `index.md`, then the page. Every page carries `type`, `title`, and
`description` frontmatter, so `grep` on `type:` / `tags:` narrows hard before you read
anything whole.

High-value areas:

| Path | Holds |
|---|---|
| `knowledge/reference/` | Non-confidential conventions, tooling, gotcha runbooks |
| `knowledge/work/stadion/reference/suppliers/**` | Vendor API specs transcribed **verbatim**, one page per entity — the field tables are authoritative, quirks preserved |
| `knowledge/work/stadion/**/decisions.md` | Architectural decisions, with superseded ones marked |
| `knowledge/**/worklog.md` | Per-project session history mined from past Claude transcripts |
| `knowledge/books/` | Reading notes |

**Cite the page path for every claim you take from the vault**, so the user can check you
and so a wrong page gets found and fixed. Never present a vault claim as your own
reasoning. Vault pages carry a `timestamp:` — if a page is old and the answer is
load-bearing, say when it was last touched.

### `capture` — stage a finding for ingestion

Write **one file per finding** to `<vault>/knowledge/inbox/`, named
`YYYY-MM-DD-agent-capture-<short-slug>.md`.

Use real names verbatim — the real repo, the real client, the real service. **Do not try to
apply codenames yourself.** You do not have the roster, and a wrong guess is worse than no
guess. `knowledge/inbox/` is gitignored, so nothing you write there ever reaches git; the
ingest step applies codenames before any committed page exists. That is the whole safety
model, and it only works if you write the truth and leave the renaming alone.

Frontmatter — the provenance block is what lets ingest place *and link* the page, which is
the step that gets skipped when an agent writes a page by hand:

```yaml
---
capture: agent
captured: 2026-07-27T14:03:00Z      # ISO 8601, UTC
kind: gotcha                        # gotcha | decision | reference | idea | note
title: TM 4xx silently ACKed leaves membership grant Pending
machine: homer                      # hostname
repo: chelsea-platform-infrastructure
repo_remote: git@github.com:stadionHQ/chelsea-platform-infrastructure.git
repo_path: /Users/adam/work/chelsea-platform-infrastructure
branch: fix/payment-cancelled
commit: 9f2c1ab
session_transcript: ~/.claude/projects/<cwd-as-dashes>/<session-id>.jsonl
relates_to: unknown                 # a vault page path if you're confident, else "unknown"
---
```

Fill every field you can actually determine; use `unknown` rather than inventing one.
`relates_to` is a hint, not a decision — leave it `unknown` unless you have genuinely read
the page you are naming. The `session_transcript` path is worth getting right: it is the
fallback when the capture turns out to be too terse to act on.

Body, in this order:

1. **Symptom** — what was observed, in the words someone would search for. Include the
   literal error text, status code, or log line.
2. **Root cause** — what was actually wrong, and how it was established.
3. **Fix** — what resolved it. Commands, `file:line` references, config keys.
4. **Why it generalises** — one or two sentences. If it does not generalise, say so; a
   one-off is still worth capturing but ingest will file it differently.
5. **Evidence** — links, PR/ticket URLs, the commands run.

Quality bar: capture what a competent engineer could **not** rederive in five minutes. Skip
anything already recorded in the repo you are working in — code structure, the commit you
just made, git history, that repo's `CLAUDE.md`. If a finding is only interesting inside
the current conversation, it is not a capture.

Redact secrets. Never copy a token, key, password, or connection string into a capture,
even though the inbox is uncommitted.

After writing, tell the user exactly this: the file path, and that it stays uncommitted
until they run `/ingest` **in the vault, on this machine**.

### `sync` — refresh and report pending

1. `git -C <vault> pull --ff-only` — keeps reads current. If it fails (dirty tree,
   divergence, no network), report and move on; never resolve it yourself.
2. Count files in `knowledge/inbox/` (excluding `README.md`) and list them.
3. Report. **Never push, never commit.**

Be explicit about what pending means, because this is the failure this skill exists to
prevent: captures are gitignored, so they live **only on this machine** until someone runs
`/ingest` here. A capture made on the Mac will never appear on the Windows box, and vice
versa. If there are pending captures, say which machine they are stranded on.

## What never to do

- Write anywhere in the vault except `knowledge/inbox/`.
- Commit or push in the vault. Ever. (Force-push is doubly banned — global rule.)
- Copy client-area content out of the vault into another repo, file, or scratch note.
- Put a real client name into anything you write **outside** `knowledge/inbox/` — including
  your own summary back to the user if it will be pasted somewhere, and any commit message
  in the repo you are actually working in.
- Invent a codename, or guess which codename maps to which client.
- Interpret encrypted bytes when the vault is locked.
- Announce a vault miss. Silence on no-hit; speak only on a hit.
