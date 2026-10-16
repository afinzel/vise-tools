import type { Register } from 'claude-code'

import { registerFindingsPanes, registerFindingsTools } from './review-findings'
import { registerRestorePane, registerRestoreTools } from './restore-sessions'
import { registerReviewSidebar, registerReviewSidebarCommandAndTools } from './review-comments'
import { registerShutdownPane, registerShutdownTools } from './shutdown'

/**
 * The engine takes one hooks module per plugin, and one unmatched hook per event, so each mod's
 * hooks register from here and their tools share the one session.start.
 */
export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await registerReviewSidebarCommandAndTools($)
    await registerShutdownTools($)
    await registerRestoreTools($)
    await registerFindingsTools($)
    return next(e)
  })
  registerReviewSidebar(on, options)
  registerShutdownPane(on, options)
  registerRestorePane(on, options)
  registerFindingsPanes(on, options)
}
