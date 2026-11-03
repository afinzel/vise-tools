/**
 * What decides whether a review finding is the PR's to fix. A real bug is not enough: a defect the
 * base branch already had, or work the ticket never asked for, grows the PR when it is fixed there.
 */
export const FINDING_SCOPE_DEFINITION =
  '`introduced` when the change causes it. `worsened` when the base branch already has it and the change makes it more likely or worse. ' +
  '`pre-existing` when the base branch has the same code and the change leaves it as it was: quote that code from the base branch as evidence. ' +
  '`off-card` when it is new, but fixing it delivers something the ticket\'s acceptance criteria do not ask for, ' +
  'such as a promise the PR description makes and the ticket does not. When in doubt between two, choose the one nearer the PR: introduced, then worsened, then off-card, then pre-existing.'
