# vise-tools

AI-powered development tools for Claude Code.

## Installation

Add this marketplace to Claude Code:

```bash
claude plugin marketplace add afinzel/vise-tools
```

Then install individual plugins:

```bash
claude plugin install buildvise@vise-tools
```

## Available Plugins

### [buildvise](./plugins/buildvise/)

Build, test, and lint subagent with structured diagnostics. Returns parsed errors, warnings, and test results instead of raw console output — achieving 10-50x token reduction.

**Supported ecosystems:** .NET, npm, pnpm, ESLint

## License

MIT
