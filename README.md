# itsthanh-v4

Front-end for the V4 redesign of [itsthanh.me](https://itsthanh.me) on Webflow: one script (`dist/v4.min.js`) and one
stylesheet (`dist/v4.min.css`), shared by the **Home**, **Project** and **Archive** pages and served from this repo
through jsDelivr. Project pages, About and 404 don't load it.

What it does:

- **Page transitions** (Barba 2) between Home, Project and Archive. The nav, footer and frame stay still while the
  content changes. There are four variants (below), glide by default. Direction follows the nav order: toward Archive
  is forward, toward Home is back. The script prefetches on hover, copies `<title>` and the description, keeps
  `w--current` in sync and starts each page at the top. Links to any other page on the site leave with the same
  transition, then load normally. Back/Forward from the browser cache brings the page back in. Under reduced motion
  every variant is a 0.2 s crossfade.
- **Opening a project or archive entry** doesn't use the page transition: the preview stage (or the Archive cover)
  expands to fill the window, the list slides away, and the page fades to the case study's ground; then the page
  loads. Back from the cache reverses it.
- **Lenis** smooth scroll on `gsap.ticker` (lerp 0.1, anchors, native touch), paused during transitions, off under
  reduced motion. It respects `data-lenis-prevent`.
- **Footer clock**: `HH-HH:MM` (Hanoi hour, Los Angeles hour, shared minutes) and PDT/PST from the browser's time zone
  data, ticking on the minute. It handles the switch to PST on Nov 1, 2026.
- **Home**: the preloader (fresh loads only) and the artwork grid with its synced flip wave.
- **Project**: lineup, then hover previews with the slat flip and text roll, a 0.2 s grace before the lineup returns,
  and prefetch. On touch, the first tap previews and the second tap opens.
- **Archive**: the camera-dial list (GSAP Observer + spring), blur by distance, cover color and ink, cover fade and a
  rolling counter.

### Transition variants

Chosen by `data-v4-transition` on `.page-wrapper` (set it on each page in Webflow, or once on the shared component);
`?t=<name>` in the URL overrides it for review, e.g. `itsthanh.me/project?t=veil`. Unknown names fall back to glide.

| Variant | What moves |
|---|---|
| `glide` (default) | The old content drifts 2.5 % toward the exit side and fades (0.45 s, power2.in). The new content starts 2.5 % from the other side and settles (0.65 s, expo.out), overlapping by 0.15 s. No 3D. |
| `veil` | A soft lavender veil (`--_v4---preloader-wash` with a little grain) wipes up over the content (0.5 s, power3.inOut). The page swaps underneath, then the veil carries on up and off (0.55 s). Back runs it downward. |
| `turn` | A restrained page turn: up to 16° rotateY at 2400 px perspective, with a slight drift and fade (0.7 s, power3.inOut) and a light shadow at the hinge. Forward turns the old page away; back turns the new one in. |
| `dissolve` | A crossfade with up to 4 px blur and 0.985 scale (0.5 s); the scale leans toward the direction of travel. |

### The expand

- **Project:** a click (desktop), a second tap (touch) or Enter opens a project. The list panel slides left and fades,
  along with the V4 nav and footer, which belong to this page and not to the case study. The active preview stage is
  pinned `position: fixed` at its rect and its box grows to fill the window (0.7 s, power3.inOut). Its content
  re-lays out like the full-width case-study opening rather than being scaled. In the last 0.22 s the page fades to
  `--v4-case-ground` (cream `#f7f5f0`, the ground of the LFLA-layout pages); then the prefetched page loads. Total
  0.84 s.
- **Archive:** a second click (or Enter) on the centered row with a page grows the cover the same way, then fades to
  the row's `data-color`.
- **Overrides:** any row can set `data-ground` to override the fade colour.
- **Back:** a restore from the browser cache reverses it, collapsing to the list and then (Project) the lineup.
- **Reduced motion:** the expand is a 0.2 s fade to the ground.
- `@view-transition { navigation: auto; }` in v4.css: when the destination page opts in too, the browser crossfades
  between documents instead of flashing. Barba's swaps are same-document, so they never trigger it.

## Versions

Pinned exactly in `package.json`. Every version is at least two weeks old (as of Oct 26, 2026):

| Package | Version | Published |
|---|---|---|
| gsap (core, CSSPlugin, Observer) | 3.13.0 | 2025-04-30 |
| @barba/core | 2.10.3 | 2024-08-12 |
| lenis | 1.3.26 | 2026-08-05 (1.3.27 is from Oct 15, so too new) |
| esbuild (build only) | 0.28.2 | 2026-08-08 |

Tests use the Playwright and Chromium already installed on the machine (`require('playwright')`). Playwright isn't a
dependency.

## Commands

```sh
npm install
npm run build      # dist/v4.min.js (+ .map), dist/v4.min.css, dist/preloader-head.html, and fixtures/*.html
npm test           # Node test runner + Playwright against the fixtures (writes tests/screenshots/)
npm run serve      # fixtures on http://127.0.0.1:4173 (/, /project, /archive). IMG_DELAY=1500 slows the artworks
npm run sri        # prints the integrity hashes for the embed snippets
npm run images     # regenerates the stand-in images in fixtures/img (canvas, in Chromium)
npm run demo -- <dir>   # static review demo: relative links, dist/, img/, a transition picker (demo only)
```

`dist/` is committed, because jsDelivr serves files straight from the tagged commit.

## Layout

```
src/index.js            entry: registers Observer, starts Lenis, clock, router, and the page module
src/core/router.js      Barba, leave/expand exits, head/nav sync, pageshow restore
src/core/transitions.js glide / veil / turn / dissolve, plus the out and in halves
src/core/expand.js      the expand (and collapse) used to open projects and archive entries
src/core/scroll.js      Lenis on gsap.ticker
src/core/clock.js       footer clock (clockParts() is pure and unit-tested)
src/core/modules.js     per-namespace lifecycle: init(container) → { destroy, restore }
src/pages/home.js       preloader + grid + wave
src/pages/project.js    lineup, previews, slats, text roll, prefetch, touch
src/pages/archive.js    dial, spring, blur, color/ink, cover, counter
src/v4.css              shared CSS (Lenis, root sizing, body fix, ink, script-built elements)
src/preloader-head.html Home-only head snippet (critical preloader CSS + fresh-load flag), 1,744 characters
fixtures/               the three pages built to the markup contract, an LFLA-style case page, webflow.css
tests/                  clock unit test + browser suite
```

## Webflow setup

### jsDelivr URLs

Create a release tag, then load the files by tag, never by branch: branch URLs are cached for up to 12 hours and can't
carry an integrity hash.

```
https://cdn.jsdelivr.net/gh/<owner>/itsthanh-v4@<tag>/dist/v4.min.js
https://cdn.jsdelivr.net/gh/<owner>/itsthanh-v4@<tag>/dist/v4.min.css
```

e.g. `<tag>` = `v4.0.1`. After each new tag, run `npm run sri` and paste the new hashes. Without npm:

```sh
openssl dgst -sha384 -binary dist/v4.min.js  | openssl base64 -A   # prefix the output with "sha384-"
openssl dgst -sha384 -binary dist/v4.min.css | openssl base64 -A
```

`crossorigin="anonymous"` is required for SRI to work. A hash that doesn't match blocks the file entirely, so update
the hash and the tag together.

### 1. Shared head: Home, Project and Archive (Page settings → Custom code → Inside `<head>`)

Put it on these three pages only, not in site-wide code, so the LFLA page's own GSAP and Lenis don't load twice.
Remove the old `fluid-re` embed from these three pages.

```html
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/<owner>/itsthanh-v4@<tag>/dist/v4.min.css"
      integrity="sha384-<css hash>" crossorigin="anonymous">
```

### 2. Home head: Home only (Inside `<head>`, after the shared head)

Paste the contents of `dist/preloader-head.html` (1,744 characters). It flags a fresh load (`html.is-preloading`)
and paints the preloader from CSS before any script runs. If `v4.js` hasn't arrived after 8 s, it removes the flag
so the page is never stuck behind the preloader.

### 3. Footer: Home, Project and Archive (Before `</body>` tag)

```html
<script src="https://cdn.jsdelivr.net/gh/<owner>/itsthanh-v4@<tag>/dist/v4.min.js"
        integrity="sha384-<js hash>" crossorigin="anonymous"></script>
```

Remove from these pages: the old 10 s loader script and its GSAP 3.10.4, Splide and the Lottie handler, the old clock
scripts, and the `5wq322.csb.app` script.

## What the Webflow build must provide

The class names and attributes in `v4-contract.md`, exactly. These are the details the code depends on:

- **Barba structure** on all three pages: `div.page-wrapper[data-barba="wrapper"]` holding the nav, footer,
  `div.page-flip_shadow` (used by the turn variant) and
  `main.main-wrapper[data-barba="container"][data-barba-namespace="home|project|archive"]`.
  Only the container is swapped, so the nav, footer and shadow must stay outside it.
- **Nav links carry `data-flip-index`** (`0` Home `/`, `1` Project `/project`, `2` Archive `/archive`). The script reads
  the Barba pages and the transition direction from them, so a renamed slug only needs its `href` changed.
- **`data-ink` on each page's `page-wrapper`** sets that page's default ink (`dark` or `light`). The script carries it
  over on every transition, because Barba keeps the wrapper, and the Archive overrides it per cover.
- **The script sets `data-namespace`** on `page-wrapper` (`home`, `project` or `archive`). v4.css uses it for the footer
  rules, and Webflow CSS can use it too, e.g. for a different mobile ink:
  `.page-wrapper[data-namespace="project"][data-ink] { --_v4---ink: … }`. `data-ink` is a single value per page.
- **Every section paints an opaque background**: during a transition one page sits on top of the other.
- **Nav and footer are `position: fixed`** with a z-index above the pages (100). Layer order:
  - pages during a transition: 1–3; the turn shadow gets z-index 2 inline;
  - the veil and the expanding stage or cover: 90–95, under the nav;
  - the preloader: 1000, with the nav at 1001 while it runs;
  - the expand's ground fade: 1100, over everything.
- **Home**: `[data-home-grid]` gets only position and size from Webflow; v4.css lays the cells out as a grid and the
  script builds them. The pool images can keep Webflow's default `loading="lazy"` (the script switches them to eager).
  Upload ~256 px square crops. The wordmark is `.nav_logo` itself: no copy, no extra wrapper.
- **Project**: the preview stage (`[data-project-stage]`) is what expands, so its previews should read as the
  opening of the case study when it fills the window. Previews hide with opacity and visibility, never
  `display: none`. `.project-preview_slats` is an empty
  absolute layer; the script aligns it to the active preview's strip, so its exact position doesn't matter. Each
  `project-list_row` is an `<a>` to the project page with `data-project` and `data-index`. Webflow styles the states
  `.project-list_row.is-active` (indent) and `.project-list_rule.is-active` (rule draws in).
- **Archive**: `section_archive` paints `background: var(--_v4---archive-bg)`. The script tweens that variable (and the
  contract's `--archive-bg`) inline on the section. The list wrapper has a fixed height and `overflow: hidden`; the
  script only translates `.archive_list` and centers rows on the wrapper's middle. Rows without a page use
  `div.archive_link` and never open. The script replaces the contents of `.archive_counter-current` with rolling
  digits and rewrites `.archive_counter-total` from the row count.

v4.css adds `.nav_link.w--current { opacity: 1 }`, the ink swap
`.page-wrapper[data-ink="light"] { --_v4---ink: var(--_v4---ink-light) }`, and the footer rule from Figma: over a dark
cover, desktop Archive flips only `.footer_version` to the light ink (the clock stays `quiet` on the white panel), and
mobile Archive flips the whole footer. The wordmark is a gradient and never follows the ink.

## Bundle size

`dist/v4.min.js` is 165 KB minified and 58 KB gzipped. Most of it is the libraries: GSAP core with CSSPlugin is 70 KB,
Barba 32 KB, Lenis 19 KB and Observer 9 KB, plus about 38 KB of our own code. `dist/v4.min.css` is 5.0 KB, 1.7 KB
gzipped.

## Choices made where the spec left room

- **Hover intent (Project):** the 80 ms intent gates leaving the lineup and the prefetch. Once a preview is showing,
  moving between rows swaps at once (as in the approved mockup), and a fast sweep retargets the running slat flip.
- **First hover:** a crossfade from the lineup to the preview, opacity only, with no movement (the mockup's sliding
  image was dropped, per the brief).
- **Expand ground:** cream (`#f7f5f0`), not the row's `data-color`. The fade's last frame should match the destination's
  first paint, and the LFLA-layout case pages open on cream; a brand colour would be one more flash. Archive entries
  fade to their cover colour instead, since that's the colour that just filled the window.
- **Directions without a side:** veil runs up for forward and down for back; dissolve leans its scale the same way.
- **Preloader timing** is measured from navigation start (`performance.now()`), so the 1.2 s minimum and 3 s cap
  count from the first paint, not from when the script arrives. The entrance fades each element to its own
  Webflow opacity (0.5 for a dimmed nav link), so nothing jumps afterwards.
- **Archive under reduced motion:** the dial snaps and the cover swaps instantly, and blur steps with the selection.
  The background color still eases over 0.7 s; that's a color change, not motion.
- **Archive starts on the first row** (counter 01), on load and after a transition.
- **Wheel at the ends of the dial:** v4.css switches Lenis's `overscroll-behavior: contain` off on the list, or the
  wheel couldn't pass through to page scroll.

## Runtime hooks

- `window.V4`:
  - `version`, `ready`, `isBusy()`, `module()` (the active page module), `barba`;
  - `navigate(href)` (any internal URL), `flipExit(href)` (leave with the transition), `exitWith(run, href)` (leave with
    a custom animation);
  - `transition()` (the variant in effect), `transitions`;
  - `assign(href)`, the final hop to another document, replaceable (the tests stub it).
- `.page-wrapper` attributes while something moves:
  - `data-flip`: `forward`, `back`, `out` or `expand`;
  - `data-flip-variant`: the variant in use.
- Events on `document`: `v4:ready` and `v4:pagechange` (`detail.namespace`), the latter after each transition.
- `data-v4-noflip` on a link, or on any of its ancestors, opts it out of the transition. `data-barba-prevent` works too.
- `window.V4_CONFIG = { webflowReinit: false }` before the script skips the `Webflow.destroy()/ready()/ix2.init()` that
  runs after each transition.
