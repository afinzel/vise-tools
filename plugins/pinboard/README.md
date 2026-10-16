# pinboard

A Claude Code mod that keeps tables, artifact links and answers in a **Pins** side pane, so the
figures you are working through stay in view instead of scrolling away.

Forked from [Young-in/pinboard](https://github.com/Young-in/pinboard). The difference: a pin has a
name, and pinning under that name again **replaces** it. When figures change mid-investigation Claude
re-pins the table under the same title, so the pane holds the current version and never a trail of
stale ones.

## Installation

```bash
claude plugin install pinboard@vise-tools
```

## How pins get there

- **Claude pins them.** The `pin` tool asks Claude to pin figures you are working through over several
  turns without being asked, and to re-pin under the same title when they change. You can also just
  say "pin this table".
- **You pin them.** `/pin` saves the mouse selection, or else the last answer's tables and artifact
  links. `/pin <title>` does the same under a title, replacing a pin of that title.
- **Candidates.** Tables and artifact links in answers show at the foot of the pane; one key pins one.

## Replacement rules

A new pin replaces an existing one only when all of these hold:

- its title was given (the tool's `title`, or `/pin <title>`), not derived from the content;
- the existing pin's title was given too, and matches ignoring case and spacing;
- both are in the same project, and from the same agent (or both from the main conversation).

The replaced pin keeps its id and moves to the top with the new content and time. Identical content
is never pinned twice. Pins live in the mod's store across sessions and projects; the pane's
**This project** and **This session** tabs narrow them.

## Commands

| Command | Does |
|---|---|
| `/pin [title]` | Pin the selection, else the last answer's tables and links (else the whole answer) |
| `/pin all [title]` | Pin the whole last answer |
| `/pin tables` \| `links` | Pin only the last answer's tables \| links |
| `/pin rm <n\|last>`, `/unpin <n>` | Remove pin n (the pane's number) or the latest |
| `/pin undo` | Undo the last remove or clear |
| `/pin show <n>` | Print pin n into the conversation, where Claude reads it too |
| `/pin clear` | Remove all, after confirming |
| `/pin export` | Write every pin to `~/.claude/pins/pins-<date>.md` |
| `/pin auto on\|off` | Open the pane on session start and when new candidates appear (off until turned on) |
| `/pins` | Open or close the pane |

In the pane (focus it with `ctrl+x tab`): `1`–`9` select, `a s d g h` pin a candidate, `c` copy,
`p` insert into the prompt, `x` remove, `u` undo, `f` next filter.

Claude's tools: `pin` (`markdown`, `title`, `kind`), `unpin` (`id`, `index` or `title`), `list`.

## Limits

- The pane docks right of the transcript only in the fullscreen layout (110+ columns); elsewhere it
  opens above the prompt, and `/pin` can't read a mouse selection.
- Each installed copy has its own store: pins from the marketplace install and from a
  `--plugin-dir` working copy don't see each other.
- The store has no compare-and-set, so two sessions saving within the same few milliseconds can drop
  one write.

## Developing

```bash
claude plugin validate plugins/pinboard
claude plugin test plugins/pinboard
claude --plugin-dir plugins/pinboard   # a session with this working copy loaded
```

Code that uses `$` stays in `hooks/register.tsx`, because the engine follows `$` only through
functions in the hooks module itself; `extract.ts` and `format.ts` hold the pure functions.

## License

MIT. Original work © 2026 Young-in; see [LICENSE](./LICENSE).
