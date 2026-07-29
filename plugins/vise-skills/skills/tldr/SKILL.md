---
name: tldr
description: Re-explain something so it actually lands — lead with what breaks in concrete terms, cut everything that isn't the point, and change approach rather than repeat yourself. Use whenever the user says /tldr, "tl;dr", "you rambled", "I still don't follow", "I'm not getting it", "explain that again", "in plain English", or otherwise signals a previous explanation missed. The job is comprehension, not word count.
argument-hint: "[what to re-explain]"
disable-model-invocation: true
---

# tldr

The previous answer did not land. Deliver the point.

## Diagnose before you rewrite

Explanations fail two different ways, and the fixes are opposite:

- **Rambling** — the answer is in there, buried under evidence, caveats, and the same point said
  three ways. Fix: cut.
- **Abstraction** — every sentence turns on a symbol (`IsConfiguredBand`, `OrdinalIgnoreCase`,
  `mapping.Id`) or on context the reader can't see from where they're sitting. Fix: **not** cutting.
  A shorter version of an opaque explanation is still opaque. Re-ground it in things that exist in
  the world — real values, real consequences.

Work out which one happened before writing a word. Most explanations that fail *repeatedly* fail the
second way, and treating them as the first is exactly why the third and fourth attempts also fail.

## The shape

1. **First line is the answer** — the conclusion, the decision, or what breaks. Nothing before it.
   No "sure", no "let me try again", no preview of what you're about to say.
2. **Say whether it matters before you say what it is.** *"This is a non-blocking comment, so we may
   not care"* is the most useful sentence in the reply, and it costs six words. Someone deciding
   whether to spend attention needs the stakes before the detail.
3. **Concrete before abstract.** Show it going wrong with real values: *"`u16` and `U16` become two
   separate bands with two separate price lists, and nothing tells you which one the console reads."*
   Name the code that does it afterwards, if at all.
4. **A name earns its place — and that includes plain English.** A class, method, or field appears
   only after the thing it names has been said in ordinary words. But abstraction is not only code:
   *the spelling from config*, *one enforcement point*, *the canonical form* are just as opaque, and
   worse, they look like they should be obvious. Any noun doing heavy lifting has to be cashed out
   into something the reader can picture.
5. **Say it once.** No second phrasing of the same point, no closing summary.
6. **Stop when the point is delivered.** No background, no "worth noting", no offer of next steps.

One line if one line holds it. A short list — one idea per line — if it doesn't. Plain sentences beat
bullets at two or three sentences.

## Write it the way you would say it out loud

This is where re-explanations most often fail, and it's subtle because the prose looks professional.
The failure is turning actions into nouns and deleting whoever performs them.

Plain does not mean sloppy. Write full, well-formed sentences with proper punctuation — just active
ones, about somebody doing something. You're aiming at how a good engineer explains a thing at a
whiteboard, not at how anyone types in a hurry. In each pair below, the second version is the one
that landed:

> "Sleeping in a backoff is billed at full Lambda duration; a message sitting invisible in the queue
> is free."
> → **"If we sleep in the Lambda we pay per second. If we throw it back to SQS it's free."**

> "One enforcement point, no impact on the classifier that stamps live membership data, and no change
> to what the API displays."
> → **"We'd only check in one place. Nothing else changes."**

> "Match case-insensitively, but store the spelling from config."
> → **"Accept `u16` or `U16`, but always write the one in settings."**

What that comes down to:

- **Give every sentence a subject and a real verb.** *We pay. It writes two rows. You get a
  duplicate.* Not *is billed*, *is performed*, *results in*, *is not impacted*.
- **Don't turn a verb into a noun.** "One enforcement point" means *we check in one place*. "No
  impact on the classifier" means *the classifier doesn't change*. The noun version reads as if it's
  been through a committee.
- **Chain cause to effect in one sentence with "so".** *"The value from the URL is used as the
  database id and it's case-sensitive, **so** `u16` and `U16` create two records."* One sentence the
  reader can follow beats two they have to join up themselves.
- **Use the words they'd use.** If they say *record*, don't say *document*. If they haven't said
  *canonicalise*, don't introduce it.
- **Check the word actually means what you need.** Under pressure to sound fluent you'll reach for a
  near-synonym that is quietly wrong, and the reader stops to work out why it's there. *"Store the
  spelling from config"* was wrong: `u16` and `U16` are the same spelling, so the word bought
  nothing and cost a re-read. Say *"use the value from config."* A word that nearly fits reads as
  noise, and the reader blames themselves for not following.

## If the question is a decision, not a mechanism

Someone asking "what should I do" does not need to be walked through how the code works. Give them:
**what breaks → the options → your recommendation → what it costs.** Four short beats. The mechanism
is only worth explaining where it's the reason an option is expensive.

## The second /tldr on the same topic

They're asking again, so your model of what's confusing is wrong. Compressing the same content again
is repeating a failed experiment. Do one of these instead — the first is usually right:

1. **Ask.** One short question that splits the space: *"Is it why this matters that's unclear, or how
   the code does it?"* / *"Do you have that file open, or should I explain it without referring to the
   code at all?"* One question, then stop and wait. Don't stack three.
2. **Change modality.** A worked example with real values start to finish. A before/after. A table of
   the two states. An analogy to something outside the codebase.
3. **Name your assumption.** The gap is usually context you have and they don't — a file you read, a
   line you saw. Say it: *"I've been assuming you can see that band names are used directly as the
   database key. That's the fact everything else hangs off."*

Asking is not stalling, and it doesn't need to wait for a second failure — reach for it any time you
genuinely can't find a different angle. One question that lands beats a fourth explanation that
doesn't. But if you *do* have a real alternative angle, try it rather than asking.

## Arguments

**With a prompt** (`/tldr explain the casing issue`) — that's the topic. Re-answer the question from
scratch. Do not summarise your previous answer; the previous answer is what failed.

**Without one** — re-explain the last substantive thing you said, and name the topic in the opening
words so they can see immediately if you locked onto the wrong thing: *"**The casing decision:** …"*
If the previous message covered several unrelated things, ask which one. That's one line, and it's
cheaper than re-explaining the wrong thing.

## What not to do

- **Don't apologise or diagnose out loud.** "I over-explained that" is more words about the words.
  Just give the better answer.
- **Don't hedge.** "It might potentially be worth considering that…" — if it's true, say it.
- **Don't introduce a word they haven't used**, unless it's the actual name of the thing being
  discussed. That covers invented shorthand as much as jargon — see the section above.
- **Don't drop what they need to decide.** Brevity serves the point; it doesn't outrank it. A caveat
  that would change their choice stays — as one line, at the end. Cutting a one-pager to two
  sentences is only a win if the two sentences carry the decision; otherwise it's data loss with a
  clean-looking finish.
