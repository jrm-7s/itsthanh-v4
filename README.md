# itsthanh-v4

Front-end for the V4 redesign of [itsthanh.me](https://itsthanh.me) on Webflow: one script (`dist/v4.min.js`) and one
stylesheet (`dist/v4.min.css`), shared by the **Home**, **Project** and **Archive** pages and served from this repo
through jsDelivr. Project pages, About and 404 don't load it.

What it does:

- **Page flip** (Barba 2): the `main-wrapper` turns like a book page hinged on its left edge, while `.page-flip_shadow`
  sweeps across the page underneath. 0.9 s, `power2.inOut`. Going forward in nav order (Home → Project → Archive)
  turns right to left; going back turns left to right. It prefetches on hover, copies `<title>` and the description,
  keeps `w--current` in sync and starts each page at the top. Links to any other page on the site flip the page away
  and then load normally. Back/Forward from the browser cache resets the page and turns it back in. Under reduced
  motion it's a 0.2 s crossfade.
- **Lenis** smooth scroll on `gsap.ticker` (lerp 0.1, anchors, native touch), paused during the flip, off under
  reduced motion. It respects `data-lenis-prevent`.
- **Footer clock**: `HH-HH:MM` (Hanoi hour, Los Angeles hour, shared minutes) and PDT/PST from the browser's time zone
  data, ticking on the minute. It handles the switch to PST on Nov 1, 2026.
- **Home**: the preloader (fresh loads only) and the artwork grid with its synced flip wave.
- **Project**: lineup, then hover previews with the slat flip and text roll, a 0.2 s grace before the lineup returns,
  and prefetch. On touch, the first tap previews and the second tap opens.
- **Archive**: the camera-dial list (GSAP Observer + spring), blur by distance, cover color and ink, cover fade and a
  rolling counter.

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
```

`dist/` is committed, because jsDelivr serves files straight from the tagged commit.

## Layout

```
src/index.js            entry: registers Observer, starts Lenis, clock, router, and the page module
src/core/router.js      Barba, flip-out links, head/nav sync, pageshow reset
src/core/flip.js        the page flip, flip-out and flip-in
src/core/scroll.js      Lenis on gsap.ticker
src/core/clock.js       footer clock (clockParts() is pure and unit-tested)
src/core/modules.js     per-namespace lifecycle: init(container) → { destroy, restore }
src/pages/home.js       preloader + grid + wave
src/pages/project.js    lineup, previews, slats, text roll, prefetch, touch
src/pages/archive.js    dial, spring, blur, color/ink, cover, counter
src/v4.css              shared CSS (Lenis, root sizing, body fix, ink, script-built elements)
src/preloader-head.html Home-only head snippet (critical preloader CSS + fresh-load flag), 1,744 characters
fixtures/               the three pages built to the markup contract, a stand-in project page, webflow.css
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
  `div.page-flip_shadow` and `main.main-wrapper[data-barba="container"][data-barba-namespace="home|project|archive"]`.
  Only the container is swapped, so the nav, footer and shadow must stay outside it.
- **Nav links carry `data-flip-index`** (`0` Home `/`, `1` Project `/project`, `2` Archive `/archive`). The script reads
  the flip pages and directions from them, so a renamed slug only needs its `href` changed.
- **`data-ink` on each page's `page-wrapper`** sets that page's default ink (`dark` or `light`). The script carries it
  over on every flip, because Barba keeps the wrapper, and the Archive overrides it per cover.
- **The script sets `data-namespace`** on `page-wrapper` (`home`, `project` or `archive`). v4.css uses it for the footer
  rules, and Webflow CSS can use it too, e.g. for a different mobile ink:
  `.page-wrapper[data-namespace="project"][data-ink] { --_v4---ink: … }`. `data-ink` is a single value per page.
- **Every section paints an opaque background**: the turning page has to hide the one beneath it.
- **Nav and footer are `position: fixed`** with a z-index above the pages (100). During a flip the pages use z-index
  1–3, and the shadow gets `position: fixed` and z-index 2 inline. During the preloader its layers use 1000 and the
  nav 1001.
- **Home**: `[data-home-grid]` gets only position and size from Webflow; v4.css lays the cells out as a grid and the
  script builds them. The pool images can keep Webflow's default `loading="lazy"` (the script switches them to eager).
  Upload ~256 px square crops. The wordmark is `.nav_logo` itself: no copy, no extra wrapper.
- **Project**: previews hide with opacity and visibility, never `display: none`. `.project-preview_slats` is an empty
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

`dist/v4.min.js` is 158 KB minified and 56 KB gzipped. Most of it is the libraries: GSAP core with CSSPlugin is 70 KB,
Barba 32 KB, Lenis 19 KB and Observer 9 KB, plus 31 KB of our own code. `dist/v4.min.css` is 3.8 KB, 1.3 KB gzipped.

## Choices made where the spec left room

- **Hover intent (Project):** the 80 ms intent gates leaving the lineup and the prefetch. Once a preview is showing,
  moving between rows swaps at once (as in the approved mockup), and a fast sweep retargets the running slat flip.
- **First hover:** a crossfade from the lineup to the preview, opacity only, with no movement (the mockup's sliding
  image was dropped, per the brief).
- **Flip geometry:** the page lifts toward the viewer (rotateY 0 → −100°, perspective 3× the window width), with its
  back face hidden. The shadow's dark edge follows the page's projected outer edge and is strongest mid-turn.
- **Preloader timing** is measured from navigation start (`performance.now()`), so the 1.2 s minimum and 3 s cap
  count from the first paint, not from when the script arrives. The entrance fades each element to its own
  Webflow opacity (0.5 for a dimmed nav link), so nothing jumps afterwards.
- **Archive under reduced motion:** the dial snaps and the cover swaps instantly, and blur steps with the selection.
  The background color still eases over 0.7 s; that's a color change, not motion.
- **Archive starts on the first row** (counter 01), on load and after a flip.
- **Wheel at the ends of the dial:** v4.css switches Lenis's `overscroll-behavior: contain` off on the list, or the
  wheel couldn't pass through to page scroll.

## Runtime hooks

- `window.V4`: `version`, `ready`, `navigate(href)` (flip to any internal URL), `flipExit(href)`, `isBusy()`,
  `module()` (the active page module), `barba`.
- Events on `document`: `v4:ready` and `v4:pagechange` (`detail.namespace`), the latter after each flip.
- `data-v4-noflip` on a link, or on any of its ancestors, opts it out of the flip. `data-barba-prevent` works too.
- `window.V4_CONFIG = { webflowReinit: false }` before the script skips the `Webflow.destroy()/ready()/ix2.init()` that
  runs after each flip.
