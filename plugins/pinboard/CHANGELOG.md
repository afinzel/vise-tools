# Changelog

## 0.4.0

Forked from [Young-in/pinboard](https://github.com/Young-in/pinboard) at `fd8d395` (0.3.0).

- Pinning under a title that is already pinned in this project replaces that pin rather than adding
  another, keeping its id. This applies to Claude's `pin` tool and to `/pin <title>`. Only a pin whose
  title was chosen is replaced; a title derived from the content never matches.
- The `pin` tool tells Claude to pin, unasked, figures the user is working through over several turns,
  and to re-pin them under the same title when they change.
- Commands, pane text and messages are in English.

## 0.3.0 and earlier

Young-in's releases: pins grouped by session and agent, safe concurrent sessions, the pane's filter
tabs and detail card, `/pin`, `/pins`, `/unpin`, the model's `pin`/`unpin`/`list` tools, and table and
artifact-link detection in answers. See the upstream repository for their notes.
