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
5. Answer explicitly: does the parameter space have usable range, and does the
   clear-time floor (`segmentCount` × animation duration) make the largest grid
   sizes impractical (R3)?
6. Do not claim anything about whether the game is _fun_. The harness cannot
   measure that; only playtesting can.
