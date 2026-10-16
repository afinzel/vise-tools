"""List recent Claude Code sessions with the tail of each conversation.

Scans ~/.claude/projects/*/<session-id>.jsonl (top level only, so subagent
transcripts are skipped) for files modified within the window, and prints a
JSON array with one entry per session: id, cwd, title, last activity, any
handoff document that names the session, and its last few conversational
messages, trimmed so a small model can judge whether the work was finished.

Usage: python find_sessions.py [--hours 24] [--messages 6] [--exclude <id> ...]
"""

import argparse
import glob
import json
import os
import sys
import tempfile
import time
from datetime import datetime, timezone

MESSAGE_CHARACTER_LIMIT = 400
RECENTLY_WRITTEN_SECONDS = 120


def main():
    arguments = parse_arguments()
    cutoff = time.time() - arguments.hours * 3600
    handoffs = index_handoffs_by_session()
    sessions = [
        describe_session(path, arguments.messages, handoffs)
        for path in recent_transcripts(cutoff)
        if session_id_of(path) not in arguments.exclude
    ]
    sessions = [session for session in sessions if session["messages"]]
    sys.stdout.reconfigure(encoding="utf-8")
    json.dump(sessions, sys.stdout, indent=2, ensure_ascii=False)


def parse_arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument("--hours", type=float, default=24)
    parser.add_argument("--messages", type=int, default=6)
    parser.add_argument("--exclude", nargs="*", default=[])
    return parser.parse_args()


def recent_transcripts(cutoff):
    pattern = os.path.join(os.path.expanduser("~"), ".claude", "projects", "*", "*.jsonl")
    paths = [path for path in glob.glob(pattern) if os.path.getmtime(path) >= cutoff]
    return sorted(paths, key=os.path.getmtime, reverse=True)


def session_id_of(path):
    return os.path.splitext(os.path.basename(path))[0]


def index_handoffs_by_session():
    oldest_first = sorted(glob.glob(os.path.join(tempfile.gettempdir(), "handoff-*.md")), key=os.path.getmtime)
    return {
        session_id: path
        for path in oldest_first
        for session_id in sessions_named_in(read_text(path))
    }


def sessions_named_in(text):
    return {
        word[:-len(".jsonl")].rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
        for word in text.replace("`", " ").split()
        if word.endswith(".jsonl")
    }


def read_text(path):
    with open(path, encoding="utf-8", errors="replace") as file:
        return file.read()


def describe_session(path, message_count, handoffs):
    records = read_records(path)
    modified = os.path.getmtime(path)
    session_id = session_id_of(path)
    return {
        "id": session_id,
        "cwd": last_value(records, "cwd"),
        "title": title_of(records),
        "lastActive": datetime.fromtimestamp(modified, timezone.utc).astimezone().isoformat(timespec="minutes"),
        "possiblyStillOpen": time.time() - modified < RECENTLY_WRITTEN_SECONDS,
        "handoff": handoffs.get(session_id),
        "messages": conversational_messages(records)[-message_count:],
    }


def read_records(path):
    records = []
    with open(path, encoding="utf-8", errors="replace") as file:
        for line in file:
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return records


def last_value(records, key):
    return next((record[key] for record in reversed(records) if record.get(key)), None)


def title_of(records):
    return last_value(records, "customTitle") or last_value(records, "aiTitle")


def conversational_messages(records):
    messages = []
    for record in records:
        if record.get("isSidechain") or record.get("isMeta"):
            continue
        if record.get("type") == "user":
            text = user_typed_text(record)
        elif record.get("type") == "assistant":
            text = assistant_text(record)
        else:
            continue
        if text:
            messages.append({"role": record["type"], "text": trimmed(text)})
    return messages


def user_typed_text(record):
    text = joined_text(record.get("message", {}).get("content"))
    return None if text.lstrip().startswith("<") else text


def assistant_text(record):
    return joined_text(record.get("message", {}).get("content"))


def joined_text(content):
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        return "\n".join(block.get("text", "") for block in content if block.get("type") == "text").strip()
    return ""


def trimmed(text):
    if len(text) <= MESSAGE_CHARACTER_LIMIT:
        return text
    return text[:MESSAGE_CHARACTER_LIMIT] + " …"


if __name__ == "__main__":
    main()
