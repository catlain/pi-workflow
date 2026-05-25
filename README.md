# pi-workflow

Workflow orchestration extension for [pi-coding-agent](https://github.com/earendil-works/pi-coding-agent) — subagent spawning, research workflow, and output capture.

## What It Does

Complex AI tasks often need structured multi-step workflows — search → evaluate → synthesize → conclude. pi-workflow provides the building blocks for these workflows:

- **Subagent spawning** — Launch child pi processes with isolated context for independent tasks
- **Research pipeline** — Structured multi-round research with search, evaluation, synthesis, and conclusion phases
- **Output capture** — Save and retrieve subagent outputs for downstream processing
- **State management** — Track workflow state across steps with automatic persistence

## Installation

```bash
pi install git:github.com/catlain/pi-workflow
```

## Tool: `workflow`

The extension registers a `workflow` tool with multiple actions for the research pipeline:

| Action | Description |
|--------|-------------|
| `start` | Start a new research workflow with a topic |
| `search` | Execute a search round |
| `evaluate` | Evaluate search results for relevance |
| `synthesize` | Synthesize findings from multiple rounds |
| `conclude` | Generate final conclusions |

## How Subagents Work

```
Main Agent
  └── workflow tool → runSubagent()
        └── Child pi process (isolated context)
              ├── Own tools and system prompt
              ├── Own context window
              └── Result → saved to file
```

Key features:
- **Isolation** — Each subagent runs in its own context window, doesn't pollute the main conversation
- **Model selection** — Subagents can use different (cheaper) models
- **Output persistence** — Results saved to disk for later retrieval
- **Status tracking** — Main agent can check subagent success/failure

## Use Cases

- **Literature research** — Search multiple sources → evaluate quality → synthesize findings
- **Multi-perspective analysis** — Spawn subagents with different viewpoints on the same question
- **Parallel investigation** — Run multiple independent research threads simultaneously

## Dependencies

- `@earendil-works/pi-coding-agent` — ExtensionAPI (peer)

## License

MIT
