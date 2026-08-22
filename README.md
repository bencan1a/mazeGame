# Arrow Maze

An offline, phone-first puzzle. A silhouette is tiled by one space-filling path
cut into segments, each with an arrowhead at one end. Tap a segment: if the
forward ray from its head to the board edge is clear, it snakes out and leaves
the board. If anything sits on that ray, it bounces and costs a life. Clear
every segment to win.

![Example board](docs/reference/example-board.jpg)

Proof of concept. Full spec: [`docs/PRD.md`](docs/PRD.md).

## Status

Scaffolding. The generator, renderer, and game loop are open issues — see
[`docs/backlog.md`](docs/backlog.md).

## Quick start

```sh
npm install
npm run dev       # dev server
npm run verify    # format + lint + typecheck + tests + coverage
npm run harness   # headless generator sweep (once the generator lands)
```

Node 22+.

## Why it is tractable

Removing a segment can only ever _unblock_ others, so the blocking relation is a
static digraph and the puzzle is solvable exactly when that digraph is acyclic.
No search, no dead ends, no undo stack — any greedy order works.

Difficulty is therefore not combinatorial. It is visual search: tracing a long
ray across a dense field and judging whether one thin segment crosses it. The
generator is tuned by measurement, not intuition — see
[`docs/METRICS.md`](docs/METRICS.md).

## Docs

|                                      |                                                     |
| ------------------------------------ | --------------------------------------------------- |
| [PRD](docs/PRD.md)                   | The specification                                   |
| [Plan](docs/PLAN.md)                 | Phases, milestones, parallel work streams           |
| [Architecture](docs/ARCHITECTURE.md) | Module map and the rules the build enforces         |
| [Contracts](docs/CONTRACTS.md)       | Interfaces every stream codes against               |
| [Workflow](docs/WORKFLOW.md)         | How one human and several agents share this repo    |
| [Metrics](docs/METRICS.md)           | What the tuning harness measures and how to read it |
| [Backlog](docs/backlog.md)           | The work, seeded into GitHub Issues                 |
| [ADRs](docs/adr/)                    | Decisions and why the alternatives lost             |

Agents: start with [`CLAUDE.md`](CLAUDE.md).

## License

[MIT](LICENSE)
