# The shape library

What the player browses on the home screen, and how it was chosen.

## How the set was cut down

| Stage                                                 | Left |
| ----------------------------------------------------- | ---- |
| Phosphor Icons, `thin` weight                         | 1512 |
| After the category rule in `tools/shapes/curate.ts`   | 406  |
| After the automated pass in `tools/shapes/approve.ts` | 309  |

The category rule drops brand marks, arrows, interface glyphs, editor and
design furniture, then keeps only nature, objects, games, travel, health and
weather — and drops letterforms, currency and trademark marks by name. Those
are the shapes a player would never want and the ones PRD §8 rules out.

The automated pass bakes each survivor, imports it, and runs the real generator
over the result at gridSize 78. Its rejections:

| Reason          | Count | What it means                                                      |
| --------------- | ----- | ------------------------------------------------------------------ |
| too thin        | 81    | The drawing fills under 18% of the frame — a doodle in a big board |
| leaked          | 14    | The outer contour is open, so there is no enclosed face to fill    |
| faces collapsed | 2     | Several faces in the drawing survived repair as one region         |

Reasons per shape are in [`rejected.csv`](rejected.csv).

## What is approved

[`approved.json`](approved.json) — 309 shapes, id and display name. The bake
reads this file, so pruning the library is an edit to it and nothing else.

The contact sheets are every approved shape as the board the generator actually
produces, 60 to a sheet: [`sheet-01.png`](sheet-01.png) through
[`sheet-06.png`](sheet-06.png).

**These are machine-approved, not eye-approved.** The automated pass can tell
that a drawing became a board; it cannot tell that the board still looks like a
bird. Pruning is a matter of deleting entries from `approved.json`, and the
sheets are what to prune from.

Reproduce either stage:

```sh
npx tsx tools/shapes/curate.ts --meta <phosphor index.mjs>   # 1512 -> 406
npx tsx tools/shapes/approve.ts --art <svg dir> --out docs/shapes
```

## The bake

```sh
npm run shapes             # rebake public/ and the notice
npm run shapes -- --check  # rebake in memory and diff against what is committed
npm run shapes -- --verify # also generate every shape's board at its shipped seed
```

`npm run shapes` fetches `@phosphor-icons/core` at the version and sha256
pinned in `tools/shapes/phosphor.ts`, rasterises each approved shape through
the same step curation judged, and writes four files:

| File                            | What it is                                                    |
| ------------------------------- | ------------------------------------------------------------- |
| `public/shapes-v1.bin`          | Every drawing, 96×96, one bit per cell: 348 kB, 58 kB gzipped |
| `public/shapes-v1.json`         | Id, display name and index per shape                          |
| `public/THIRD-PARTY-NOTICES.md` | The notice the built site serves                              |
| `THIRD-PARTY-NOTICES.md`        | The same text, in the repo                                    |

The notice is generated from the licence file inside the fetched tarball, so
it cannot describe a version other than the one baked. Nothing upstream is
vendored; what lands in the repo is the derived bitmap and the notice.

The asset, the manifest and the notice are all precached by the service
worker, so the library browses and plays offline after one visit, and none of
them counts against the JS bundle budget.

The bake is deterministic given the pinned tarball and the Chromium Playwright
installs — `--check` is what proves it, and what a rasteriser version bump
would fail. Rebake and commit the result whenever `approved.json` changes.
