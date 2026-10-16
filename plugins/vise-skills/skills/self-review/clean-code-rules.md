# Clean Code rules

The rules `/self-review` checks a diff against. They come from Robert C. Martin's *Clean Code*, Chapter 17's list of smells and heuristics, and keep the book's ids. The `V` rules come from this user's own code-style rules.

Each rule says what to flag. Judge it against the code around the diff, not in a vacuum, and report a finding only where a reader would actually be slowed down or misled.

**Ids are stable.** When the user dismisses a finding, the pane counts it against its rule, and a rule dismissed half the time or more is listed for rewording or dropping. When you edit a rule, keep its id. Retire an id rather than reuse it.

**Out of scope here:** anything a formatter, linter or the clean-code hook already enforces (comment-free method bodies, type prefixes and similar regex-decidable checks).

## Comments

- **C1 Inappropriate information:** a comment carrying what belongs in version control, the tracker or the PR: change history, authors, ticket chatter.
- **C2 Obsolete comment:** a comment the code beside it no longer matches.
- **C3 Redundant comment:** a comment that restates what the code already says plainly.
- **C5 Commented-out code:** dead code kept in a comment.

## Functions

- **F1 Too many arguments:** more than three parameters, or parameters that always travel together and want to be one type.
- **F2 Output arguments:** a parameter mutated to hand a result back, where a return value would do.
- **F3 Flag arguments:** a boolean parameter that picks between two behaviours. Two functions would read better.
- **F4 Dead function:** a function nothing calls.

## General

- **G2 Obvious behaviour unimplemented:** a function that does less than its name promises.
- **G5 Duplication:** the same logic, or the same shape of if/switch, written more than once in the change.
- **G6 Wrong level of abstraction:** high-level policy and low-level detail mixed in one function or class.
- **G8 Too much information:** a wide public surface; exposing what callers do not need.
- **G9 Dead code:** branches that cannot run, unused variables, unreachable cases.
- **G10 Vertical separation:** a variable declared far from its use, or a private function far from its caller.
- **G11 Inconsistency:** the same thing done or named two ways in the change.
- **G14 Feature envy:** a method that works mostly on another object's data.
- **G16 Obscured intent:** dense expressions, magic positions or clever tricks the reader must decode.
- **G17 Misplaced responsibility:** code put where it was convenient rather than where a reader would look for it.
- **G19 Explanatory variables missing:** a complex expression that a well-named intermediate would explain.
- **G20 Function names say what they do:** a name that hides a side effect or does not match the behaviour.
- **G23 If/else or switch chains where polymorphism fits:** the same type switch repeated, wanting one dispatch.
- **G25 Magic numbers:** unnamed literals whose meaning is not obvious at the use site.
- **G28 Encapsulate conditionals:** a compound condition that a named predicate would explain (`if (order.HasUnshippedLineItems())`).
- **G29 Negative conditionals:** `if (!isNotReady)` and other negatives that a positive form would say more simply.
- **G30 Functions do one thing:** a function whose description needs an "and".
- **G31 Hidden temporal coupling:** calls that must happen in an order nothing in their signatures enforces.
- **G34 One level of abstraction per function:** a function mixing *what* (a list of steps) with *how* (loops, string building).
- **G35 Configurable data at high levels:** a default or constant buried deep where it belongs near the top.
- **G36 Transitive navigation:** `a.b().c().d()` chains the caller should not depend on.

## Names

- **N1 Descriptive names:** a name that does not say what the thing holds or does.
- **N2 Name at the right level of abstraction:** a name describing the implementation rather than the intent.
- **N4 Unambiguous names:** a name that could reasonably mean two things.
- **N5 Long names for long scopes:** a short name used far from its declaration.
- **N7 Names describe side effects:** `getX` that also creates or saves.

## Tests

- **T1 Insufficient tests:** a behaviour the change adds or alters with no test.
- **T3 Trivial tests skipped:** an easy test case left out.
- **T5 Boundary conditions:** the edges (empty, one, max, null) untested.
- **T6 Exhaustive tests near bugs:** a bug fix without tests around the fix.
- **T9 Slow tests:** sleeps or real I/O where a fake would do.

## This user's rules

- **V1 Comment as an unnamed method:** a comment inside a method body labelling a block that wants extracting under that name. Comments that survive explain *why*.
- **V2 Newspaper order:** the public method is not first, or its private helpers are not below it in call order.
- **V3 Placeholder nouns:** `data`, `result`, `temp`, `info`, `item` and similar as names. Booleans not reading as assertions, collections not plural.
- **V4 Comment without its own context:** a comment whose whole explanation is an external id (`per A1`, `see 3.2`, a bare ticket key).
- **V5 Over-extraction:** a method shredded into two-liners that read worse than the original.
