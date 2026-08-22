# ADR-0003: Typed arrays and CSR adjacency, from day one

**Status:** Accepted
**Source:** PRD §4.3

## Context

The obvious model is `Segment { cells: Cell[], head: Cell, blockedBy: Segment[] }`.
At 100×100 with hundreds of segments and up to millions of blocking edges, the
per-object overhead is fatal — allocation, pointer chasing, and GC pressure in
exactly the code that has to run in under a second on a phone.

Retrofitting flat arrays later means rewriting every stage of the pipeline plus
the renderer, because the data shape is the interface between them.

## Decision

Every board array is flat and typed. Adjacency is CSR (compressed sparse row):
an offsets array of length n+1 and a flat targets array.

```
occupancy   Uint16Array[cells]      cell -> segment id (0 = empty)
segStart    Uint32Array[n+1]        CSR offsets into segCells
segCells    Uint32Array[totalCells] flattened polylines
segHead     Uint32Array[n]          head cell per segment
segDir      Uint8Array[n]           exit direction 0-3
edgeStart   Uint32Array[n+1]        CSR offsets into edgeTarget
edgeTarget  Uint32Array[edges]      flattened blocking edges
segColor    Uint8Array[n]           palette index
```

A cell is `y * width + x`, one number. No `{x, y}` objects in any hot path.

## Consequences

- Code is more index arithmetic and less object navigation. `grid.ts` exists so
  that arithmetic is written once and tested, rather than re-derived inline
  where it can silently wrap across rows.
- Segment ids are 1-based so that `0` can mean "empty" in `occupancy`.
- `Uint16Array` for occupancy caps segments at 65,535, far above any playable
  board.
- Serialising a board is cheap, which is what makes the offline persistence
  requirement simple.
