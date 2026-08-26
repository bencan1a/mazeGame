# Spike: silhouettes from line art

Answers [#120](https://github.com/bencan1a/mazeGame/issues/120). Ink is the
drawing and stays empty; the enclosed faces between strokes become the lobes
the player fills.

**Verdict: it works, and it needs no change to `src/`.** 730 of 736 attempted
boards passed `validateBoard` with coverage 1.000. The binding constraints are
a **stroke width of 4 board cells** and a **grid size of 60 or more**. The
weakness is not the pipeline — it is that this model draws the faces, not the
lines, so a drawing whose identity lives in its strokes comes out unrecognisable.

## What was run

18 line icons (Lucide) and 5 solid glyphs (Material Design Icons), rasterised
through Chromium at 4 grid sizes × 4 stroke widths × 2 repair profiles, each
put through the real generator — `repairMask`, `buildRegionPaths`,
`peelSegments`, blocking digraph, colouring, `validateBoard`, `computeMetrics`.

- Code: [`spikes/line-art/`](../../../spikes/line-art/). `fetch.sh` pulls the
  corpus, `run.ts` produces both artefacts here, `bake.ts` answers the
  resolution and bundle questions.
- Data: [`results.csv`](results.csv), 736 rows.
- **[`contact-sheet.png`](contact-sheet.png) is the deliverable to actually
  look at** — every shape, every size, rendered as the board the generator
  produced.

No third-party art is vendored; `fetch.sh` pulls it on demand.

## 1. The importer is ~40 lines, and the pipeline accepts its output

`fillHoles` already floods inward from the border to separate enclosed voids
from background. The importer is that same flood with ink as the barrier:
whatever it cannot reach is a face, and the faces become `inside`. Hand the
result to `repairMask` and every downstream invariant is re-established for
free.

730 of 736 boards built and validated. All six failures were `gridSize` 40 with
a 6-cell stroke, where the ink eats the drawing — repair reports it cleanly
rather than producing a bad board.

One importer obligation worth knowing: repair rejects a blob with anything in
the leftover row or column of an odd grid, so the importer clears those.

## 2. Stroke width 4 cells is the threshold

Faces surviving repair, as `regions after repair / faces in the raster`, mean
over 18 shapes:

| grid | stroke 2  | stroke 3  | stroke 4      | stroke 6  |
| ---- | --------- | --------- | ------------- | --------- |
| 40   | 1.6 / 3.0 | 2.4 / 3.0 | 2.2 / 3.2     | 1.4 / 4.5 |
| 60   | 1.3 / 3.1 | 2.4 / 3.0 | **2.9 / 3.1** | 2.4 / 3.1 |
| 78   | 1.2 / 3.4 | 2.6 / 3.0 | **2.9 / 3.0** | 2.9 / 3.0 |
| 100  | 1.3 / 3.6 | 2.6 / 3.4 | **3.0 / 3.1** | 2.9 / 3.0 |

At 2 cells the faces merge into one — the drawing becomes a blob. At 3 it is
lossy and shape-dependent. At 4 essentially every face survives from grid 60
up, and 6 buys nothing while costing board area.

The mechanism is not the morphological open. `repairMask` downsamples with
**any-inside**: a 2×2 block containing any face cell becomes a face cell. So
faces dilate and ink erodes by up to one half-resolution cell before anything
else runs, and a stroke under 4 full cells cannot reliably survive that plus
the lattice alignment.

## 3. The legibility floor is 60, and it is shape-dependent

This is my reading of the contact sheet, not a measurement — it is the part of
the spike that needs the human's eye.

- **At 40**: compact shapes still read — apple, cat, egg, ghost, house, car,
  leaf. Detailed ones do not: bike, turtle, fish, grape, snail, cherry and
  croissant come out as unrelated blobs.
- **At 60**: nearly everything reads.
- **At 78 and 100**: everything that reads at all reads comfortably.

So 60 is the floor and 78 — the shipped default — sits above it with margin.
Grid size stays a free parameter, which is the outcome the issue was most
worried about.

## 4. The model shows the faces, not the lines

The one shape that never reads at any size is the bicycle: its identity is in a
frame of strokes that enclose nothing, so the importer keeps two wheels and
discards the bicycle. That is not a bug to fix — it is the model's boundary.

> A drawing is usable only if its **enclosed areas** carry its identity.

The corollary matters for curation: five of the eighteen (apple, cat, egg,
ghost, leaf) reduce to exactly **one** face at every stroke width. Those play
fine — one big lobe — but the picture is only an outline, and it is where
generated cuts earn their place.

## 5. Cutting a solid shape is the weaker route on its own

Parallel chords across a solid glyph, at the same stroke width:

| grid | regions | path cells | segments | bendRate |
| ---- | ------- | ---------- | -------- | -------- |
| 60   | 7.0     | 674        | 45.8     | 0.473    |
| 78   | 8.2     | 1358       | 96.8     | 0.458    |
| 100  | 8.0     | 2510       | 166.6    | 0.437    |

It never leaks and it gives precise control over face count — both as predicted.
But on the contact sheet the striped cat and the striped rabbit are hard to tell
apart: a solid glyph carries only its outline, and arbitrary stripes add no
shape information. Line art wins on recognisability because its interior lines
_are_ information.

**They compose, and that is the recommendation**: source line art for identity,
then generate cuts inside faces that come out too large. The reference cup works
exactly that way — bands that follow the object's own structure, not an
arbitrary angle.

## 6. Repair's defaults do destroy gaps, mostly at marginal widths

`holeAreaThreshold: 0` against the default of 4, faces surviving at grid 78:

| stroke | default | authored |
| ------ | ------- | -------- |
| 2      | 1.1     | 1.2      |
| 3      | 1.7     | **2.6**  |
| 4      | 2.9     | 2.9      |
| 6      | 2.9     | 2.9      |

Real, and concentrated exactly where the stroke is marginal. At the recommended
4 cells it changes nothing, so treat it as a safety margin rather than a fix —
and note that under this model an interior stroke _is_ an enclosed void, which
is why the default hole-filling reaches for it at all.

## 7. One bake at 96×96 serves every grid size that matters

Region counts from a single canonical bake, resampled per grid size, against a
direct raster at that size — 72 shape-size pairs:

| bake resolution | agrees | disagreements                    | gzipped   | 300 shapes |
| --------------- | ------ | -------------------------------- | --------- | ---------- |
| 64×64           | 58/72  | across all sizes                 | 156 B ea. | ~46 KB     |
| **96×96**       | 65/72  | all at grid 40, plus the bicycle | 253 B ea. | **~74 KB** |
| 128×128         | 66/72  | same                             | 385 B ea. | ~113 KB    |

96×96 disagrees only below the legibility floor, so one bake per shape is
enough — no per-size bakes, no runtime rasteriser, and generation stays pure.

**Where those bytes live is a decision.** The JS budget is 220 KB gzipped with
~90 KB used, so 300 shapes in the bundle leaves ~56 KB of headroom. Shipping
them as a precached asset instead keeps them off the `npm run budget` gate —
same download, different accounting, and offline still works.

## 8. Line-art boards are shorter than procedural ones at the same grid size

Stroke 4, mean over the 18 shapes:

| grid | regions | path cells | segments | bendRate | dagDepth |
| ---- | ------- | ---------- | -------- | -------- | -------- |
| 40   | 2.2     | 332        | 22.6     | 0.457    | 6.0      |
| 60   | 2.9     | 976        | 72.9     | 0.416    | 11.2     |
| 78   | 2.9     | 1771       | 116.3    | 0.412    | 14.4     |
| 100  | 3.0     | 3105       | 210.7    | 0.405    | 20.9     |

A procedural board at 78 runs ~191 segments; a line-art board at the same size
runs ~116, because the ink takes the area. In clear time that is roughly 66
seconds of animation against 110. **So a shape board at 78 plays noticeably
shorter than the tuned default**, and matching the current feel means a larger
grid or a shorter mean piece length. Whether shorter is worse is a playtest
question.

`bendRate` sits slightly above the procedural 0.403 and climbs as the board
shrinks — the predicted thin-face effect, present but mild.

## 9. Licences: verify, do not recall

- **Lucide is ISC**, not MIT — which is what I would have written from memory.
- **Material Design Icons** ship under the Pictogrammers Free License, icons
  under Apache 2.0, with an explicit note that some are redistributed under
  their own licences.

Both are permissive. Neither matched the assumption, which is the point: the
per-glyph provenance caveat in the MDI licence is exactly the kind of thing that
needs reading before a set ships, and attribution obligations for a shipped
build are a question for a person, not for this spike.

## What this did not settle

- **Recognisability is judgement, not measurement.** Section 3 is my reading of
  the contact sheet.
- **The predicted leak never fired.** Not one of the 18 icons had an open outer
  contour. Expect it in more decorative sets; detection stays free — no
  enclosed face at all means it leaked.
- **Arrowhead legibility** at these grid sizes is a separate, older constraint
  and is untouched here.
- **Curation at 300 shapes** — this ran 18.
- **Whether a long thin band plays well**, which is what the reference cup is
  made of and what generated cuts would produce.

## Recommended next steps

1. A `contract-change` for a seam in `generate.ts` that accepts a supplied
   `Blob` instead of always calling `generateBlob`. Everything else in this
   spike lives outside `src/core/`.
2. The bake pipeline, and the decision on where the bytes live.
3. Cut generation _inside_ oversized faces, which is what makes single-face
   shapes into boards that look like the reference art.
4. A curation run over a full set, using the automated rejects this spike
   already implements: leaked, repaired to nothing, or face count collapsed.
