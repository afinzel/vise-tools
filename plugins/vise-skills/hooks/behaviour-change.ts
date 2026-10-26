/**
 * What counts as a behaviour change, for review threads and review findings alike. The test is what
 * others rely on, not whether anything at run time differs: a reworded log line runs differently
 * but breaks nobody, while a write that is no longer atomic breaks whoever counted on it.
 */
export const BEHAVIOUR_CHANGE_DEFINITION =
  'True when the fix changes what callers, users or other systems can rely on: a different return value or shape, ' +
  'an operation no longer atomic, a different exception or when it is thrown, different data persisted or sent, ' +
  'side effects in a different order, different retry, timeout or config defaults. ' +
  'False for names, comments, formatting, dead code, a pure refactor, and log wording, levels or extra log lines, ' +
  'unless something depends on that log: an alert or metric built on it, an audit trail, or a structured field someone queries.'
