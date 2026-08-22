---
description: Run a generator parameter sweep and summarise what the metrics say
argument-hint: [grid size] [seed count]
allowed-tools: Bash, Read, Write, Glob, Grep
---

Run a headless parameter sweep and interpret it. Arguments: $ARGUMENTS
(grid size, seed count — default to 40 and 200).

1. Run the harness across the parameter space.
2. Report, per parameter region: `dagDepth`, `meanFreeSetSize`,
   `minFreeSetSize`, `bendRate`, `coverage`, `generationMs`.
3. Interpret against `docs/METRICS.md`, and hold two things in mind:
   - **More free segments can be harder**, not easier — it is scan load, and the
     difficulty curve over it is not monotonic.
   - `bendProbability` trades against ray length, so "more bends = harder" is
     not reliably true. Steer by the numbers.
4. Flag any board that failed validation, with its seed.
5. Answer explicitly: does the parameter space have usable difficulty range,
   and does `generationMs` stay under 1s at the largest grid size swept?
6. Report `segmentCount` × animation duration as a clear-time estimate. It is a
   fact about a board at that size, not a verdict — grid size is a parameter the
   player turns down (ADR-0006).
7. Do not claim anything about whether the game is _fun_, or about frame rate
   and memory. The harness measures neither; playtesting and a device settle
   them.
