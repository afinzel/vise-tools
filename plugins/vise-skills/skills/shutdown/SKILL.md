---
name: shutdown
description: 'Get every Claude session on this machine ready for a restart — this one included — by asking each to write a handoff document at its next clean stopping point and report back, so nothing is lost when Windows reboots or the user closes the windows. Opens a pane where the user ticks which sessions take part, with live reply status. Use ONLY when the user explicitly runs /shutdown or asks to message all open Claude sessions to prepare for a restart. Pair with /restore-sessions afterwards.'
---

# /shutdown — get the sessions ready for a restart

The user is about to restart the machine, or close every Claude window, and wants each open session to leave behind enough to pick up from. You coordinate; each session writes its own handoff, because only it holds its context. This session counts too: a restart takes it down with the rest.

Reach is **this machine only**, unless Remote Control is connected — then sessions on other machines list too. Cloud sessions are left out: they survive a local restart, and cannot reply.

## 1. Open the pane

Call `mcp__vise-skills__shutdown_sessions`. It lists this session and its peers, and opens the shutdown pane: every session ticked, **All** / **None**, and **Send**. The answer says whether the pane is shown.

**Shown:** tell the user in one line to untick any session to leave out and press **Send** in the pane. Then stop. The pane does the rest — it sends the request, runs this session's handoff if it stayed ticked, and ticks each session off as its reply arrives, with a band above the prompt counting them and a toast when all are in. Replies do not reach you while the pane shows them, so there is nothing to tally.

**Not shown** (the VS Code panel draws no panes), or the tool is not there (the mod did not load): go on to step 2.

## 2. Let the user pick in chat

Ask with `AskUserQuestion`, `multiSelect: true`: *which sessions should hand off?* One option per session as `shutdown_sessions` listed them, this session first. A question holds four options and a call takes four questions, so sixteen fit; past that, ask in a second call. Ticking means *send*; if the user answers through "Other" with names to leave out, honour that instead.

Then call `mcp__vise-skills__shutdown_send` with the names ticked (`this session` for this one). It sends each peer the request and queues this session's handoff.

**Without the mod:** list sessions with `ListAgents`, and send each chosen peer this with `SendMessage`, names filled in:

> **Restart coming.** `<your name>` is getting every Claude session on this machine ready for a restart, or for the user closing the windows. Nothing needs rushing: if you are partway through something, finish the step you are on and stop at the next clean point. If you are waiting on the user, do this now.
>
> 1. Run the `vise-skills:handoff` skill with the argument "resume after a restart".
> 2. Do not commit, push, stash or kill anything to tidy up. Uncommitted work survives a restart on disk; name it in the handoff instead.
> 3. Reply to `<your name>` with SendMessage, one line and nothing else: `shutdown-reply <their name>: <the handoff's absolute path>`, or `shutdown-reply <their name>: nothing to hand off` if you hold no work in flight.
>
> If the user tells you to ignore this, do.

Then run `vise-skills:handoff` here with the same argument, if this session was ticked.

Tell the user in two or three lines who got it, who was left out, and that a busy session replies once it reaches a clean point. They can tell any session to ignore it.

## 3. Collect the replies (chat only)

Each `shutdown-reply` arrives as a message turn. Answer each with one short line — `platform-braze-87 handed off (2 of 4)` — not a recap.

When every chosen session has answered, say it is safe to restart, list the handoff paths, and remind the user that `/restore-sessions` brings the sessions back. Do not chase a session that has not answered; if the user asks, name it and leave the decision to restart with them.
