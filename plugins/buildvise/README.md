# Buildvise Plugin

Single MCP tool for structured build, test, and lint diagnostics with 10-50x token reduction.

## What It Does

Buildvise registers a single `build` MCP tool that handles all operations — build, test, lint, log retrieval, and tool listing — through one endpoint. Instead of raw console output (2,000-10,000+ tokens), you get structured diagnostics (50-200 tokens).

### Why Single Tool MCP

| Approach | Token Cost per Invocation |
|----------|--------------------------|
| Subagent | ~20,000-30,000 |
| Many MCP tools | ~2,000-5,000 |
| **Single MCP tool** | **~200** |

## The `build` Tool

| Action | Description | Required Params |
|--------|-------------|-----------------|
| `exec` | Run a build/test/lint tool | `tool` |
| `log` | View log lines from a previous run | `runId` |
| `list` | Show available tools | (none) |

### Available Tools (for `exec`)

`dotnet.build`, `dotnet.test`, `npm.install`, `npm.build`, `npm.test`, `npm.run`, `pnpm.install`, `pnpm.build`, `pnpm.test`, `pnpm.run`, `eslint.lint`

## Installation

```bash
claude plugin marketplace add afinzel/vise-tools
claude plugin install buildvise@vise-tools
```

## More Info

See the [buildvise npm package](https://github.com/afinzel/buildvise) for full documentation.
