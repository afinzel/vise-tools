# Buildvise Plugin

Build, test, and lint subagent for Claude Code with structured diagnostics.

## What It Does

Buildvise provides a **build subagent** that Claude spawns on demand. The subagent has access to build/test/lint tools via an MCP server, but those tool schemas only load in the subagent's context — keeping your main conversation clean.

Instead of raw console output (2,000-10,000+ tokens), you get structured diagnostics (50-200 tokens):

```
Main conversation (zero build-tool overhead)
    |
    └── Claude spawns "build" subagent when needed
         |
         ├── Subagent has buildvise MCP server
         ├── Calls dotnet_build, npm_test, eslint_lint, etc.
         └── Returns structured summary to main conversation
```

## Supported Tools

| Tool | Description |
|------|-------------|
| `dotnet_build` | Build .NET projects |
| `dotnet_test` | Run .NET tests |
| `npm_install` | Install npm packages |
| `npm_build` | Run npm build script |
| `npm_test` | Run npm test script |
| `npm_run` | Run npm scripts |
| `pnpm_install` | Install pnpm packages |
| `pnpm_build` | Run pnpm build script |
| `pnpm_test` | Run pnpm test script |
| `pnpm_run` | Run pnpm scripts |
| `eslint_lint` | Run ESLint on files |
| `run_raw` | Get raw log output by byte offset |
| `run_logRange` | Get log lines by line number |

## Installation

```bash
claude plugin marketplace add afinzel/vise-tools
claude plugin install buildvise@vise-tools
```

## More Info

See the [buildvise npm package](https://github.com/afinzel/buildvise) for full documentation.
