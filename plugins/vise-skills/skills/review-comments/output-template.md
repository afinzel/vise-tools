# Review-comments output template

This is the exact shape for presenting the triage (skill step 3 + step 4).
It is tuned for the **terminal CLI**, whose markdown renderer is weak — design
for it, not for a rich web renderer.

## Grouping

Present the comments in three groups, in this order. Omit a group entirely if
it has no comments (an empty Push back group is a fine, common outcome).

```
## ✅ Trivial
## 💬 Discuss
## ⚠️ Push back
```

Within each group, render one block per comment, separated by a `---` rule.
Number comments `[1]`, `[2]`, … continuously across groups so each maps to one
review thread and the user can refer to them by number.

## Per-comment block

    [N] `file.ext:LINE` · @author · <✅|💬|⚠️>

    ```
    <the reviewer's words, verbatim — do not summarise or soften>
    ```

    **Fix:** `<the concrete fix, one line>` `<S|M|L>`

    <github-diff-link>

    ---

- Omit the `**Fix:**` line for ⚠️ Push back items (the recommendation is to make
  no change — say why in prose instead).
- For comments that share one root cause, render the first in full and have the
  others reference it (e.g. `💬 (same issue as [2])`) rather than repeating the
  whole fix. AI reviewers often repeat one nit across files.

## Terminal-CLI rendering rules

These are confirmed against a real terminal CLI — do not substitute "nicer"
markdown that renders flat or dead there:

- **Links must be a bare URL on their own line.** A `[text](url)` markdown link
  renders as dead, unclickable text; only raw URLs auto-link.
- **Link target = the PR Files-changed diff anchor at the code line**, so the
  link opens the code at that line:
  ```
  https://github.com/<owner>/<repo>/pull/<pr>/files#diff-<sha256(path)>R<line>
  ```
  The anchor hash is the SHA-256 of the file `path`; compute it with
  `printf "%s" "<path>" | sha256sum`. `R<line>` targets the right (current) side
  of the diff. Keep each thread's GraphQL `url` internally for replying/resolving
  in step 5 — it is just not the link shown to the user.
- **Quote goes in a fenced code block, not a `>` blockquote.** Blockquotes and
  headings render nearly flat in the terminal CLI; fenced code blocks and `---`
  rules are the only separators with real visual weight.
- **Colour comes from element type, not from anything you can set directly.**
  In the terminal CLI, **inline code spans render in an accent colour** — wrap
  the Fix text in `` `…` `` to highlight it. (` ```csharp ` blocks also
  syntax-highlight, if you want to colour a code snippet.) Headings and links
  stay default-coloured, so they are not colour levers.
- **No tables for quotes or links.** Table cells are single-line, and `<br>` and
  `&nbsp;` render as literal text. A table is acceptable only for a compact,
  link-free index — but plain blocks are preferred.
- **Truncate long ` ```suggestion ` blocks** to 2–3 lines plus
  `(full suggestion on GitHub)`. The reviewer's prose is the signal; a long
  inlined diff buries it.
- For `LINE`: use the thread's `line`; fall back to `originalLine`; if both are
  null, drop the `:LINE` suffix (and `R<line>` from the link) rather than
  printing `:null`. Mark outdated threads `⚠️ outdated` on the header line.

## Worked example (one block, as it should render)

[1] `Program.cs:6` · @copilot · ✅

```
using Stadion.Framework.Domain.Models; appears unused in this file.
Remove the unused using, or use a strongly-typed Option<CurrencyCode>
so the using is actually needed.
```

**Fix:** `Delete line 6 — no CurrencyCode reference in the file.` `S`

https://github.com/stadionHQ/platform-cybersource/pull/64/files#diff-afe4d91f9d414e760e344e7a127c0012ba1bf892d7d0063a817304eecbbd16d6R6
