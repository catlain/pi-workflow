[中文文档](README.md) | English

# pi-workflow

[Source Code](https://github.com/catlain/pi-workflow) | [npm](https://www.npmjs.com/package/pi-ate-workflow)

Workflow orchestration extension for [pi](https://github.com/earendil-works/pi-coding-agent) — subagent spawning, research workflow, and output capture.

## Why You Need It

Complex AI tasks often need structured multi-step workflows — search → evaluate → synthesize → conclude. A single agent context can't handle this well: it loses track, mixes concerns, or runs out of tokens.

pi-workflow solves this by providing **subagent spawning** and **structured research pipelines** where each step runs in a focused, isolated context.

**Use it when**: Your task is too complex for a single agent pass — research, multi-perspective analysis, or parallel investigation.

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

| Scenario | How It Works |
|----------|-------------|
| **Literature research** | Search → Evaluate → Synthesize → Conclude pipeline |
| **Multi-perspective analysis** | Spawn subagents with different viewpoints |
| **Parallel investigation** | Run independent research threads simultaneously |
| **Factor research** | Search indicators → Evaluate quality → Combine signals |

## Best Practices

### ✅ Recommended
- Use subagents for tasks > 30 minutes — they keep context fresh
- Choose cheaper models for subagents when possible (e.g., Haiku for search rounds)
- Always check subagent output before synthesizing — catch failures early
- Save workflow state between steps for resumability

### ❌ Not Recommended
- Don't use subagents for simple tasks (< 5 minutes) — overhead isn't worth it
- Don't spawn too many subagents simultaneously — resource contention
- Don't pass huge contexts to subagents — that defeats the isolation purpose

## Limitations

| Limitation | Detail |
|------------|--------|
| Subagent overhead | Each spawn takes time to initialize |
| No streaming | Subagent output is available only after completion |
| File-based output | Results are saved to disk, not streamed back |
| Sequential pipeline | Research pipeline steps run one at a time |

## Architecture

```
pi-workflow/
├── index.ts         # Entry: register workflow tool
├── subagent.ts      # Subagent spawning + output capture
├── pipeline.ts      # Research pipeline (search → evaluate → synthesize → conclude)
├── state.ts         # Workflow state management + persistence
└── package.json
```

**Dependencies**:
- `@earendil-works/pi-coding-agent` — ExtensionAPI (peer)

## License

MIT
