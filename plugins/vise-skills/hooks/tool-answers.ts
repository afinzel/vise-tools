/** A registered tool's arguments arrive as fields of the call itself, beside `tool` and `tool_use_id`. */
export function toolArguments<Arguments>(call: object): Arguments {
  return call as Arguments
}

/**
 * A tool hook that throws is skipped, and Claude then sees only "no hook answered", so every
 * failure comes back as a refusal that says what went wrong.
 */
export async function answeredOrDenied(paneName: string, work: () => Promise<{ result: string } | { deny: string }>) {
  try {
    return await work()
  } catch (error) {
    return { deny: `The ${paneName} failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}
