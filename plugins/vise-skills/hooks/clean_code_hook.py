#!/usr/bin/env python3
"""Advisory clean-code checks for Claude Code file edits.

Handles both PreToolUse and PostToolUse. Nothing here ever blocks a tool call:
PreToolUse only records what it saw, and PostToolUse reports findings back to
Claude after the write has already landed, so the fix is an edit rather than a
regenerate.

Three rules, in the order they were asked for:

  1. A comment inside a method body is usually a private method waiting to be
     named. Detected structurally (indented non-doc comment), which is a hint
     rather than a verdict.
  2. Names should complete a sentence at the call site. Only the crude cases
     are machine-detectable: type prefixes and placeholder nouns.
  3. A comment must carry its own context. References to an external document
     ("per A1", "see section 3.2", a bare ticket key) explain nothing to
     someone reading the code later.

Newspaper ordering is deliberately absent: deciding whether callers precede
callees needs a real parse, and a regex that guesses would cry wolf often
enough to get the whole hook ignored.
"""

import json
import os
import re
import sys
from datetime import datetime, timezone

# Findings in this set are reported back to Claude. Everything else is only
# written to the log, so a noisy heuristic can be trialled without cost.
RULES_REPORTED_TO_CLAUDE = {"doc-reference-comment"}

LOG_PATH = os.path.join(
    os.path.expanduser("~"), ".claude", "clean-code-findings.jsonl"
)

CHECKED_EXTENSIONS = {".cs", ".ts", ".tsx", ".js", ".jsx", ".java", ".go"}

# Enough indentation to be inside a method body rather than at class or file
# level, under either 4-space or 2-space house style.
BODY_INDENT_COLUMNS = 6

PLACEHOLDER_NAMES = {
    "data", "result", "temp", "tmp", "info", "val", "value", "obj", "item",
    "thing", "stuff", "foo", "bar", "res", "ret", "arr", "list1", "x1",
}

DOC_REFERENCE_PATTERNS = [
    # "per A1", "as in REQ12", "rule B3" — a letter-and-digit code standing in
    # for the rule it names.
    (r"\b[A-Z]{1,4}\d{1,3}\b(?!\w)", "a document code"),
    (r"\bsections?\s+\d+(?:\.\d+)*", "a document section number"),
    (r"\b(?:see|per|ref(?:er)?(?:ence)?|as\s+per)\s+"
     r"(?:the\s+)?(?:doc|document|spec|table|appendix|figure|diagram)\b",
     "an external document"),
    (r"\b[A-Z]{2,10}-\d+\b", "a ticket key"),
]

TYPE_PREFIXED_NAME = re.compile(
    r"\b(?:str|int|bl|bln|dbl|flt|obj|arr|lst|dct|sz|lp|psz)[A-Z]\w*"
)

DECLARATION_NAME = re.compile(
    r"\b(?:var|let|const|int|string|bool|double|decimal|float|long|object)\s+"
    r"([a-z_]\w*)\s*[=;)]"
)

STRING_LITERAL = re.compile(r'"(?:[^"\\]|\\.)*"' + r"|'(?:[^'\\]|\\.)*'")

LINE_COMMENT = re.compile(r"(?<!:)//(?!/)(.*)$")


def strip_string_literals(line):
    """Blank out quoted text so a "//" inside a string is not read as a comment."""
    return STRING_LITERAL.sub(lambda match: '"' * len(match.group(0)), line)


def find_doc_reference_comments(lines):
    """Rule 3 — comments whose meaning lives in a document the reader lacks."""
    findings = []
    for number, raw_line in enumerate(lines, start=1):
        comment = LINE_COMMENT.search(strip_string_literals(raw_line))
        if not comment:
            continue
        text = comment.group(1)
        for pattern, description in DOC_REFERENCE_PATTERNS:
            if re.search(pattern, text):
                findings.append({
                    "rule": "doc-reference-comment",
                    "line": number,
                    "detail": (
                        f"comment points at {description} instead of stating the "
                        f"rule: {text.strip()!r}"
                    ),
                })
                break
    return findings


def find_comments_inside_method_bodies(lines):
    """Rule 1 — an explanatory comment is a private method that wasn't extracted."""
    findings = []
    for number, raw_line in enumerate(lines, start=1):
        stripped = raw_line.strip()
        if not stripped.startswith("//") or stripped.startswith("///"):
            continue
        if len(raw_line) - len(raw_line.lstrip()) < BODY_INDENT_COLUMNS:
            continue
        if is_pragma_or_directive(stripped):
            continue
        findings.append({
            "rule": "comment-inside-body",
            "line": number,
            "detail": (
                f"comment sits inside a body - consider extracting the block it "
                f"describes into a method named for it: {stripped[2:].strip()!r}"
            ),
        })
    return findings


def is_pragma_or_directive(comment):
    """Tool directives are instructions to a linter, not explanations to a reader."""
    directives = ("eslint", "ts-", "noinspection", "prettier", "@ts", "nolint",
                  "lint:", "istanbul", "c8 ", "biome-")
    body = comment.lstrip("/").strip().lower()
    return any(body.startswith(directive) for directive in directives)


def find_unclear_names(lines):
    """Rule 2 — names that force the reader to look up what they hold."""
    findings = []
    for number, raw_line in enumerate(lines, start=1):
        code = strip_string_literals(raw_line)
        if code.strip().startswith("//"):
            continue

        type_prefixed = TYPE_PREFIXED_NAME.search(code)
        if type_prefixed:
            findings.append({
                "rule": "type-prefixed-name",
                "line": number,
                "detail": (
                    f"{type_prefixed.group(0)!r} encodes its type in its name; "
                    f"name it for what it means instead"
                ),
            })

        for name in DECLARATION_NAME.findall(code):
            if name.lower() in PLACEHOLDER_NAMES:
                findings.append({
                    "rule": "placeholder-name",
                    "line": number,
                    "detail": (
                        f"{name!r} names a slot, not a meaning - say what it holds"
                    ),
                })
    return findings


def collect_findings(source):
    lines = source.splitlines()
    return (
        find_doc_reference_comments(lines)
        + find_comments_inside_method_bodies(lines)
        + find_unclear_names(lines)
    )


def is_checkable(file_path):
    return bool(file_path) and os.path.splitext(file_path)[1].lower() in CHECKED_EXTENSIONS


def read_written_text(tool_input):
    """The text this call puts into the file, across Write, Edit and MultiEdit."""
    if "content" in tool_input:
        return tool_input["content"]
    if "new_string" in tool_input:
        return tool_input["new_string"]
    edits = tool_input.get("edits") or []
    return "\n".join(edit.get("new_string", "") for edit in edits)


def append_to_log(event, file_path, findings):
    if not findings:
        return
    entry = {
        "at": datetime.now(timezone.utc).isoformat(),
        "event": event,
        "file": file_path,
        "findings": findings,
    }
    try:
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        with open(LOG_PATH, "a", encoding="utf-8") as log:
            log.write(json.dumps(entry) + "\n")
    except OSError:
        pass  # A hook that cannot log is still not a hook that should break a write.


def format_for_claude(file_path, findings):
    name = os.path.basename(file_path)
    header = f"Clean-code check on {name} - {len(findings)} finding(s) to fix:"
    body = "\n".join(f"  line {f['line']}: {f['detail']}" for f in findings)
    return f"{header}\n{body}"


def main():
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0

    event = payload.get("hook_event_name", "")
    tool_input = payload.get("tool_input") or {}
    file_path = tool_input.get("file_path", "")

    if not is_checkable(file_path):
        return 0

    if event == "PreToolUse":
        append_to_log(event, file_path, collect_findings(read_written_text(tool_input)))
        return 0

    # PostToolUse: the file exists now, so check what actually landed rather
    # than the fragment that was requested.
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as written_file:
            findings = collect_findings(written_file.read())
    except OSError:
        return 0

    append_to_log(event, file_path, findings)

    reportable = [f for f in findings if f["rule"] in RULES_REPORTED_TO_CLAUDE]
    if reportable:
        print(format_for_claude(file_path, reportable), file=sys.stderr)
        return 2  # Feeds stderr back to Claude. Does not undo the write.
    return 0


if __name__ == "__main__":
    sys.exit(main())
