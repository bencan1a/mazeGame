# Testing: what CI can settle, and what needs your phone

Short answer: **CI can guard against regressions; it cannot settle G3.** The
PoC's performance goal — generation under 1s, 60fps pan and zoom, buffer memory
inside a cap iOS Safari tolerates — is a claim about real hardware, and no
GitHub-hosted runner is real hardware in the sense that matters.

The split below exists so that "it passed CI" is never mistaken for "it works on
a phone", and so the manual runs are cheap and repeatable rather than ad hoc.

---

## What CI settles on its own

Automated, every PR, no human involved.

| Check                                                                      | Gate                        |
| -------------------------------------------------------------------------- | --------------------------- |
| Generator correctness — validation across 1000 seeds and every grid size   | Hard fail                   |
| Determinism — same `(seed, params)` → identical board                      | Hard fail                   |
| Property-based invariants (acyclicity, coverage, path validity, coloring)  | Hard fail                   |
| Types, lint, formatting, coverage on `src/core/`                           | Hard fail                   |
| The purity rules — no React, DOM, `Math.random`, `Date.now` in `src/core/` | Hard fail                   |
| **Bundle size budget** (`npm run budget`)                                  | Hard fail                   |
| **Generation time**, headless, as a relative regression check              | Warn, with a wide threshold |

That last one needs a caveat. GitHub runners are shared, noisy, and slower than
a modern phone at some things and faster at others. `generationMs` on a runner
is useful for catching "this PR made generation 4× slower" and useless as
evidence for "generation is under 1s on a phone". Set the CI threshold wide
enough that it only fires on real regressions, and read the absolute number off
a device.

## What CI can settle once there is an app to test

Not built yet — see the `browser-tests` issue. Headless Chromium via Playwright
runs on a Linux runner and can automate real behaviour:

| Check                                                                                         | Why it works headless                                               |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Offline: service worker registers, second load works with the network cut                     | Playwright's `context.setOffline(true)` is a real network cut       |
| PWA manifest, icons, scope, and `start_url` resolve under the deployed base path              | Static facts about the build                                        |
| Persistence: `(seed, params, removed, lives)` survives a reload                               | Real storage APIs                                                   |
| Hit testing and the tap radius: a synthetic tap at a known pixel selects the expected segment | Pure arithmetic over a fixture board — no rendering fidelity needed |
| Game loop: bounce costs a life, zero lives restarts the same seed, clearing wins              | Headless state machine plus a canvas                                |
| Visual regression on a fixture board                                                          | Deterministic board, deterministic render                           |

That last one is worth having and worth distrusting slightly: headless Chromium
on Linux is not Safari on an iPhone, and small antialiasing differences between
runner images make screenshot diffs flaky if the tolerance is tight.

**A frame-rate number from a headless Linux runner is not evidence about a
phone.** Different GPU, different compositor, different memory ceiling, no
thermal throttling. Do not add a CI gate that pretends otherwise.

## What needs a real device, always

These are the ones you run by hand. They are also, not coincidentally, the ones
that can invalidate an architectural decision.

| #   | Check                                                    | Risk | Why no machine can do it                                    |
| --- | -------------------------------------------------------- | ---- | ----------------------------------------------------------- |
| D1  | 60fps pan and zoom at 100×100                            | R3   | Real GPU, real compositor, real thermal throttling          |
| D2  | Peak memory, and where Safari drops the offscreen buffer | R5   | iOS memory limits are undocumented and enforced by eviction |
| D3  | Generation under 1s                                      | G3   | Phone CPU, not a runner                                     |
| D4  | Arrowhead legibility floor, in CSS px                    | R4   | A human deciding whether a 9px arrow reads as a direction   |
| D5  | Airplane-mode acceptance test (PRD §3.5)                 | —    | Force-quit and relaunch behaviour is OS-level               |
| D6  | Add to home screen, and standalone launch                | —    | iOS install flow has no automation surface                  |
| D7  | Is the game fun (G2)                                     | —    | Only playing tells you                                      |

**D1–D3 are the G3 gate.** They belong to the `perf-pass` issue at the end of
Wave 3, and the cheap early version of D1/D2 is the `canvas-perf-spike` — a bare
benchmark page needing no generator and no renderer, which is why it can run in
Wave 1, before anything is built on the assumption it validates.

### The third option, if you want D1–D3 automated later

Device clouds (BrowserStack, LambdaTest, Sauce Labs) run real iOS and Android
hardware and drive it from CI. That is genuine device coverage on a schedule,
and it is the only way to automate D1–D3 honestly.

Not recommended for the PoC: it is a paid account and a meaningful amount of
harness work, to replace a measurement you will take maybe five times total. Revisit
if this becomes a product with a release cadence and a regression history worth
protecting.

---

## Getting it onto your phone

### Deployed build — for anything involving the service worker

<https://bencan1a.github.io/mazeGame/>

Pushes to `main` deploy automatically. To put a _branch_ on your phone — an
agent's work you want to feel before merging — go to **Actions → Deploy to
GitHub Pages → Run workflow** and pick the branch. That replaces the live site
until the next push to `main`, which is fine for a PoC with one human.

**One-time setup, and it has to be you:** repo **Settings → Pages → Build and
deployment → Source → GitHub Actions**. Until that is set, the deploy workflow
fails at the last step.

Use this path for anything touching offline, install, or persistence — D5 and D6
above. Those need a real HTTPS origin and there is no way around it.

### Dev server over your local network — for fast iteration

```sh
npm run dev -- --host
```

Prints a LAN address; open it on a phone on the same wifi. Hot reload works, so
this is the fast loop for D1 and D4 — render performance and legibility.

**The catch:** `http://192.168.x.x` is not a secure context, so **service
workers do not register**. Offline, install-to-home-screen, and anything else
PWA-shaped will silently not work. That is not a bug to chase; it is the browser
security model. Use the deployed build for those.

### Which to use

| You are checking                                     | Use                                     |
| ---------------------------------------------------- | --------------------------------------- |
| Frame rate, legibility, feel, "does this look right" | Dev server over LAN                     |
| Offline, install, persistence, cold start            | Deployed build                          |
| A specific agent's branch, on device, before merge   | Deploy that branch from the Actions tab |

---

## Recording device runs

A measurement nobody wrote down did not happen — and with several agents
working, the next one to touch the renderer has no way to know what the last
device pass found.

Every device run goes in the issue it belongs to, with:

- **Device model and OS version.** "iPhone 13, iOS 17.4" — not "my phone".
  Numbers from different hardware are not comparable and combining them is worse
  than having one.
- Build: commit SHA, or the deploy run number.
- The numbers themselves, not an adjective. "52–58fps panning at 100×100", not
  "felt smooth".
- What you did to get them, in enough detail to repeat.

Playtest sessions go in `docs/playtest/` instead — same principle, different
questions. See that directory's README.
