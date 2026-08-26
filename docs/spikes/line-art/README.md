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

## 10. Orientation is a binary, and a portrait frame is worth ~30%

Follow-on run: bake thin at 256×256, rotate, fit to a frame, then dilate the ink
to the stroke width the player sees. 2150 of 2160 boards built.
[`orientation.csv`](orientation.csv),
[`orientation-sheet.png`](orientation-sheet.png).

**Off-axis rotation never wins.** Not once across 18 shapes × 5 frames × 2
stroke widths did an angle other than 0° or 90° maximise board area — the
bounding box grows faster than the fit improves. So orientation is a flag on the
bake, not an angle to search.

**A portrait frame is worth about a third more board at the same on-screen cell
size.** Comparing 60×100 against 60×60 — both 60 cells wide, so both fit a phone
identically — playable cells go from 1434 to 1872, and segments from 96 to 126.

**But rotation costs the shape its natural orientation.** Seven of eighteen
shapes want 90° in a portrait frame, and the gain is concentrated: car +187%,
turtle +198%, then fish, bird and snail around +27%. On the sheet, though, the
rotated car stands on its nose and the turtle swims sideways. They fill better
and read worse. **Rotation should be a per-shape opt-in, not an automatic
fill-maximiser.**

**Curation is the better lever.** The drawings that fill a portrait frame at 0°
are also the ones that read best — ghost 0.53, egg 0.49, cat 0.43, house 0.43,
apple 0.36, as a fraction of the frame. Choosing tall and compact shapes beats
rotating wide ones.

**Bake-thin-and-dilate beats rasterising at board size.** Setting stroke width
by dilation after the fit preserves faces equally at ~3 cells and ~5 (2.9
regions either way), where direct rasterisation needed 4 — and a 3-cell stroke
leaves about 20% more board to play. It also means one bake serves every stroke
width, not just every grid size.

**The generator is already dimension-agnostic below the mask.** `repairMask`,
`buildRegionPaths` and `peelSegments` all take a width and a height; only
`generateBlob` is square. Boards at 60×100, 72×120 and 52×92 all validated here
with no change to `src/`. What is square is `GenParams.gridSize`, a single
number — so a portrait board is a contract change and a renderer question, not a
generator problem.

## 11. Supply is not the constraint — curation is

A stride sample of 199 icons taken across the whole Lucide set, at grid 78, one
configuration, no hand-picking. [`yield.csv`](yield.csv),
[`yield-sheet.png`](yield-sheet.png).

| outcome                           | count |
| --------------------------------- | ----- |
| multi-face board                  | 65    |
| single-face board                 | 57    |
| too thin (under 15% of the frame) | 33    |
| failed to build                   | 44    |

**122 of 199 — 61% — build a valid board with no human involved**, at a median
fill of 0.51 and a median 215 segments. Scaled across the set that is roughly
1200 mechanically usable drawings from Lucide alone.

The catch the numbers do not show, and the sheet does: a large share of those
are interface glyphs. `chevron-left-circle` makes a perfectly good board and
nobody wants to play it. Eyeballing the 54 on the sheet, somewhere around 40% are
a _thing_ — alarm clock, barrel, beaker, bell, birdhouse, broccoli, camera, car,
cassette tape, chess knight, citrus, club, dice, droplet, flask. That puts
Lucide's object-like yield near a quarter of the set, so **~500 shapes from one
source**.

Set sizes and licences, verified rather than recalled:

| set            | icons  | licence      | fit                                     |
| -------------- | ------ | ------------ | --------------------------------------- |
| Lucide         | 2,035  | ISC          | line art — what this spike measured     |
| Tabler         | 11,314 | MIT          | line art, outline and filled variants   |
| Phosphor       | 9,072  | MIT          | line art across six weights             |
| Noto Emoji     | 3,710  | Apache 2.0   | filled colour — needs the variant below |
| Twemoji        | 3,988  | CC BY 4.0    | filled colour — same                    |
| OpenMoji       | 4,544  | CC BY-SA 4.0 | share-alike; probably avoid             |
| game-icons.net | 4,133  | CC BY 3.0    | solid silhouettes — needs the cut route |

**The emoji sets need one importer variant, untested here.** They are flat
filled colour rather than strokes, so the ink is not a stroke layer — it is the
**boundary between colour regions**. Each flat area becomes a face, which is
exactly the model, and emoji carry far more internal structure than line art
does. If it works it is the highest-yield source on the list by a wide margin.

So the question is not where to find hundreds of drawings. It is how many a
person is willing to look at: the automated filter already cuts 199 to 122, and
the contact sheet reviews ~54 at a glance.

## 12. Four sources, one blind sample each

47 icons per set, taken as a stride across the whole set, no hand-picking, all
at grid 78. Sheets in [`sets/`](sets/). Each set needs its own route to ink, so
the treatment differs even though the model does not.

| set               | route to ink                    | built | reads?                  |
| ----------------- | ------------------------------- | ----- | ----------------------- |
| Tabler outline    | strokes                         | 22/47 | some, but a weak sample |
| **Phosphor thin** | the drawn fill _is_ the ink     | 37/47 | **best of the four**    |
| Noto Emoji        | boundaries between flat colours | 33/47 | almost none             |
| game-icons.net    | solid, cut into bands           | 46/47 | none                    |

**Phosphor thin wins.** Its art is drawn as a filled outline rather than a
stroke, so the ink needs no stroke-width handling at all — acorn, cowboy hat,
dog, ghost, hourglass, jeep, paw print, puzzle piece, rocket, student and tea bag
all read at 78. The cost is simplicity: most come out as one or two faces, so the
picture is an outline with a hole or two rather than a banded drawing.

**The first emoji result was unfair to the source, and the retest is in
section 13.** Colour boundaries do produce faces; what sank the first sheet was
a stride sample that was two-thirds people-with-skin-tone variants, plus a
boundary rule that fired on every shading step.

**Cuts across a solid are worse than the earlier test suggested.** On
game-icons' detailed silhouettes the bands shatter the shape into 12–30
confetti regions. Nothing on that sheet is recognisable.

**Every set carries brand marks and letterforms**, which PRD §8 rules out:
Adobe, NY Times, TypeScript and Creative Commons in the Tabler sample, Angular,
Behance, Messenger and Twitter in Phosphor's. Curation has to exclude brands,
letters, numbers and interface glyphs before taste even enters — and that is a
large fraction of any icon set.

Recommendation: **Phosphor thin as the primary source, Lucide second**, and
skip game-icons. On emoji, see the retest below.

## 13. Emoji, retested fairly

Two things were wrong with section 12's emoji run: the sample and the
treatment. **2,418 of Noto's 3,710 icons are People & Body**, mostly skin-tone
and gender variants of the same figure, so a blind stride mostly drew those. And
the boundary rule quantised colour to 16 levels per channel, so every shading
step inside one flat-looking area read as a line.

Retested on the object categories — Animals & Nature, Food & Drink, Objects,
Travel & Places, Activities, **861 icons in total** — with colour merged four
times more coarsely:

| run                                     | built | reads?                  |
| --------------------------------------- | ----- | ----------------------- |
| Noto, blind stride, fine quantisation   | 33/47 | almost none             |
| Noto, object categories, fine           | 29/47 | some                    |
| **Noto, object categories, coarse**     | 35/47 | **roughly a third**     |
| Fluent Emoji high contrast (MIT, 1,595) | 25/47 | some, builds less often |

[`sets/noto-objects-coarse.png`](sets/noto-objects-coarse.png) and
[`sets/fluent-monochrome.png`](sets/fluent-monochrome.png).

Balloon, crescent moon, baby chick, hiking boot, jeans, money bag, ox, peach,
pot of food, ring buoy, stop sign, telephone and chicken all read. Ant, gloves,
seal, sushi and house still come apart.

So the honest position is between the two earlier claims. Emoji are **worth
having and not the best source**: roughly a third read against a clear majority
for Phosphor, and the usable pool is 861 rather than 3,710 — of which Animals &
Nature is 160 and Food & Drink 131.

Two things argue for revisiting them rather than dropping them:

- **The treatment is not optimised.** Coarser merging alone moved the build rate
  from 29 to 35 of 47 and visibly improved what reads. Using only strong
  luminance edges, or only the outermost boundary plus the largest internal
  areas, has not been tried. Phosphor, by contrast, already works with no
  treatment at all — there is no headroom to find there.
- **Emoji are what a player would ask for by name.** A library of icon-set
  objects and a library of emoji are not interchangeable products, even at the
  same board quality.

## What this did not settle

- **Recognisability is judgement, not measurement.** Section 3 is my reading of
  the contact sheet.
- **The predicted leak never fired.** Not one of the 18 icons had an open outer
  contour. Expect it in more decorative sets; detection stays free — no
  enclosed face at all means it leaked.
- **Arrowhead legibility** at these grid sizes is a separate, older constraint
  and is untouched here.
- **Whether a different emoji treatment could work.** Section 12 rules out
  colour boundaries; it does not rule out, say, tracing only the outermost
  colour edges.
- **Whether a long thin band plays well**, which is what the reference cup is
  made of and what generated cuts would produce.
- **Whether a rotated shape is acceptable to a player.** Section 10 says it
  reads worse to me; that is a judgement on nine sideways drawings, not a test.

## Recommended next steps

1. A `contract-change` for a seam in `generate.ts` that accepts a supplied
   `Blob` instead of always calling `generateBlob`. Everything else in this
   spike lives outside `src/core/`. Worth deciding at the same time whether
   `gridSize` becomes a width and a height, since the generator already behaves
   and the gain on a phone is about a third more board.
2. The bake pipeline, and the decision on where the bytes live.
3. Cut generation _inside_ oversized faces, which is what makes single-face
   shapes into boards that look like the reference art.
4. A curation run over a full set, using the automated rejects this spike
   already implements: leaked, repaired to nothing, or face count collapsed.
