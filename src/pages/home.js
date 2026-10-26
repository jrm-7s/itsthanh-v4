// Home: the preloader (fresh loads only) and the artwork grid with its synced flip wave.
// Ported from preloader-demo.html and homepage-wave-test.html; the numbers are the approved ones.

import { gsap } from 'gsap';
import { html, reduced, isMobile, mqMobile, mqReduce, onMQ, rootRem, bag } from '../core/env.js';
import { lockScroll, unlockScroll } from '../core/scroll.js';

const LAYOUT = { desktop: { cols: 11, rows: 5 }, mobile: { cols: 4, rows: 7 } };
const FLIP_MS = 640;      // one square's flip
const MID = 0.42;         // the moment the square is edge-on and its artwork swaps
const STEP_MS = 90;       // wave delay per square of distance
const WAVE_EVERY = 4000;  // one synced wave every 4 s
const MIN_MS = 1200;      // preloader: the rise stays visible at least this long…
const CAP_MS = 3000;      // …and is forced to 100% by this time
const SHEEN = typeof KeyframeEffect !== 'undefined' && 'pseudoElement' in KeyframeEffect.prototype;

const pickOne = (list) => list[Math.floor(Math.random() * list.length)];

export default function home(container, { arrival = 'load' } = {}) {
  const gridEl = container.querySelector('[data-home-grid]');
  const intro = container.querySelector('.home-intro_text');
  const introFade = container.querySelector('.home-intro_fade');
  const poolImgs = [...container.querySelectorAll('.home-grid_pool img')];
  const offs = bag();

  let alive = true;
  let run = 0;          // bumped on every rebuild so stale flip timers do nothing
  let cells = [];
  let waveTimer = 0;
  let quietTimer = 0;
  let wavesOn = false;  // waves start once the entrance is done
  let entered = false;
  let preloadTick = null;
  let pre = null;       // preloader elements while it runs

  // The pool is display:none; Webflow marks images lazy by default, which would never load there.
  poolImgs.forEach((img) => { if (img.loading === 'lazy') img.loading = 'eager'; });
  const arts = [];
  const seen = new Set();
  poolImgs.forEach((img) => {
    const key = img.getAttribute('src') || img.currentSrc;
    if (key && !seen.has(key)) { seen.add(key); arts.push(img); }
  });
  // currentSrc reuses whichever srcset variant the pool already downloaded: no extra requests.
  const srcOf = (i) => (arts[i] ? arts[i].currentSrc || arts[i].src : '');

  // ---------- Grid ----------
  const layout = () => (isMobile() ? LAYOUT.mobile : LAYOUT.desktop);
  const cellEls = () => cells.map((c) => c.el);

  function makeFace(back) {
    const el = document.createElement('div');
    el.className = back ? 'home-grid_face is-back' : 'home-grid_face';
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    el.append(img);
    return { el, img };
  }

  function setFace(cell, k, idx) {
    const src = srcOf(idx);
    const img = cell.faces[k].img;
    if (src && img.getAttribute('src') !== src) img.src = src;
  }

  function swapFaces(cell) {
    cell.faces[cell.front].el.classList.add('is-back');
    cell.faces[1 - cell.front].el.classList.remove('is-back');
    cell.front = 1 - cell.front;
  }

  function pickInitial(cell) {
    const taken = new Set(cell.neighbors.map((n) => n.art));
    const free = [];
    for (let i = 0; i < arts.length; i++) if (!taken.has(i)) free.push(i);
    return free.length ? pickOne(free) : Math.floor(Math.random() * arts.length);
  }

  // Neighbors never land on the same artwork. First try the demo's strict rule (avoid what neighbors show
  // now and what they will show); with a small pool, fall back to avoiding only their final artworks.
  function pickNext(cell) {
    const n = arts.length;
    const strict = new Set([cell.art]);
    cell.neighbors.forEach((o) => { strict.add(o.art); if (o.next !== undefined) strict.add(o.next); });
    let free = [];
    for (let i = 0; i < n; i++) if (!strict.has(i)) free.push(i);
    if (!free.length) {
      const loose = new Set([cell.art]);
      cell.neighbors.forEach((o) => {
        if (o.next !== undefined) loose.add(o.next);
        else if (o.quiet || o.moving) loose.add(o.art);
      });
      for (let i = 0; i < n; i++) if (!loose.has(i)) free.push(i);
    }
    if (!free.length) for (let i = 0; i < n; i++) if (i !== cell.art) free.push(i);
    return free.length ? pickOne(free) : cell.art;
  }

  function build() {
    if (!gridEl) return;
    run++;
    clearTimeout(waveTimer);
    cells.forEach((c) => c.el.getAnimations && c.el.getAnimations().forEach((a) => a.cancel()));
    const { cols, rows } = layout();
    gridEl.textContent = '';
    gridEl.style.setProperty('--home-grid-cols', cols);
    gridEl.style.setProperty('--home-grid-rows', rows);
    gridEl.setAttribute('data-layout', `${cols}x${rows}`);
    const frag = document.createDocumentFragment();
    cells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const el = document.createElement('div');
        el.className = 'home-grid_item';
        const faces = [makeFace(false), makeFace(true)];
        el.append(faces[0].el, faces[1].el);
        frag.append(el);
        cells.push({ el, faces, front: 0, art: -1, next: undefined, gx: c, gy: r, moving: false, quiet: false, neighbors: [] });
      }
    }
    gridEl.append(frag);
    cells.forEach((c) => { c.neighbors = cells.filter((o) => o !== c && Math.hypot(o.gx - c.gx, o.gy - c.gy) < 1.5); });
    if (arts.length) cells.forEach((c) => { c.art = pickInitial(c); setFace(c, 0, c.art); });
    markQuiet();
  }

  // Squares behind a line of the intro stay still, so the motion never competes with the words.
  // Cell boxes come from offsets (they ignore transforms, so a square that is mid-flip still reports its
  // resting box); the text's line boxes come from a Range, minus any entrance offset on the intro.
  function markQuiet() {
    if (!gridEl || !intro || !cells.length) return;
    if (html.classList.contains('v4-flipping')) return; // re-run on v4:pagechange
    const range = document.createRange();
    range.selectNodeContents(intro);
    const rem = rootRem();
    const padX = rem;          // 16 px at the 1560 frame
    const padY = 0.75 * rem;   // 12 px at the 1560 frame
    const tx = Number(gsap.getProperty(intro, 'x')) || 0;
    const ty = Number(gsap.getProperty(intro, 'y')) || 0;
    const lines = [...range.getClientRects()]
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({ l: r.left - tx - padX, t: r.top - ty - padY, r: r.right - tx + padX, b: r.bottom - ty + padY }));
    const gr = gridEl.getBoundingClientRect();
    cells.forEach((c) => {
      const el = c.el;
      let x = el.offsetLeft;
      let y = el.offsetTop;
      if (el.offsetParent === gridEl) { x += gr.left + gridEl.clientLeft; y += gr.top + gridEl.clientTop; }
      else { x += gr.left - gridEl.offsetLeft; y += gr.top - gridEl.offsetTop; }
      const w = el.offsetWidth, h = el.offsetHeight;
      c.quiet = lines.some((L) => x < L.r && x + w > L.l && y < L.b && y + h > L.t);
      el.classList.toggle('is-quiet', c.quiet);
    });
  }

  const remarkSoon = () => {
    clearTimeout(quietTimer);
    quietTimer = setTimeout(() => { if (alive) markQuiet(); }, 150);
  };

  // A card flip: the square turns edge-on, the new artwork takes its place, and it turns back to face you.
  function flip(cell, axis, onMid, delay) {
    const me = run;
    cell.moving = true;
    const rot = (deg) => `perspective(420px) rotate3d(${axis}, ${deg}deg)`;
    cell.el.animate([
      { transform: rot(0), easing: 'cubic-bezier(.5,0,.85,.4)' },
      { transform: rot(90), offset: MID },
      { transform: rot(-90), offset: MID, easing: 'cubic-bezier(.2,.65,.3,1)' },
      { transform: rot(6), offset: 0.8 },
      { transform: rot(0) },
    ], { duration: FLIP_MS, delay });
    if (SHEEN) {
      cell.el.animate([{ opacity: 0 }, { opacity: 0.35, offset: MID }, { opacity: 0 }],
        { duration: FLIP_MS, delay, easing: 'ease-in-out', pseudoElement: '::after' });
    }
    setTimeout(() => { if (me === run) onMid(); }, delay + FLIP_MS * MID);
    setTimeout(() => { if (me === run) cell.moving = false; }, delay + FLIP_MS + 30);
  }

  // One synced wave: it starts from a random square and rolls across the grid; every moving square flips
  // to a new artwork as the ring reaches it, turning on the axis facing away from the start.
  function syncWave() {
    const act = cells.filter((c) => !c.quiet);
    if (!act.length || arts.length < 2) return;
    const src = pickOne(act);
    act.forEach((c) => { c.next = undefined; });
    act.forEach((c) => {
      if (c.moving) return;
      const idx = pickNext(c);
      c.next = idx;
      const dx = c.gx - src.gx, dy = c.gy - src.gy, d = Math.hypot(dx, dy);
      const axis = d < 0.01 ? '0, 1, 0' : `${(-dy / d).toFixed(3)}, ${(dx / d).toFixed(3)}, 0`;
      setFace(c, 1 - c.front, idx);
      flip(c, axis, () => { swapFaces(c); c.art = idx; }, d * STEP_MS);
    });
  }

  function scheduleWaves(firstDelay) {
    clearTimeout(waveTimer);
    if (!alive || !wavesOn || reduced() || document.hidden || arts.length < 2) return;
    const cycle = () => {
      if (!alive || !wavesOn || reduced() || document.hidden) return;
      syncWave();
      waveTimer = setTimeout(cycle, WAVE_EVERY);
    };
    waveTimer = setTimeout(cycle, firstDelay);
  }

  // ---------- Entrances ----------
  function hideCellsForEntrance() {
    if (reduced()) gsap.set(cellEls(), { opacity: 0 });
    else gsap.set(cellEls(), { transformPerspective: 420, rotationY: 90, opacity: 0 });
  }

  // Arriving by a page transition (or when the preloader was skipped): the grid is there at once, the wave starts.
  function quickEntrance() {
    entered = true;
    wavesOn = true;
    if (intro && !reduced()) {
      gsap.fromTo(intro, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.6, delay: 0.3, ease: 'power3.out', clearProps: 'opacity,transform' });
    }
    scheduleWaves(1200);
  }

  function finishPreloader() {
    const p = pre;
    if (!p) return;
    pre = null;
    if (preloadTick) { gsap.ticker.remove(preloadTick); preloadTick = null; }
    if (p.tl) p.tl.kill();
    gsap.set(p.pl, { display: 'none' });
    gsap.set(p.enterEls, { clearProps: 'opacity,visibility,transition,transform' });
    gsap.set(cellEls(), { clearProps: 'transform,opacity' });
    if (p.logo) gsap.set(p.logo, { clearProps: 'transform' });
    html.classList.remove('is-preloading');
    unlockScroll();
  }

  function preloader() {
    const pl = document.querySelector('.preloader_component');
    const logo = document.querySelector('.nav_logo');
    if (!pl) {
      html.classList.remove('is-preloading');
      quickEntrance();
      return;
    }
    const links = gsap.utils.toArray('.nav_component .nav_link');
    const foot = gsap.utils.toArray('.footer_clock, .footer_version');
    pre = {
      pl,
      logo,
      wash: pl.querySelector('.preloader_wash'),
      glow: pl.querySelector('.preloader_glow'),
      grain: pl.querySelector('.preloader_grain'),
      links,
      foot,
      enterEls: [...links, ...foot, introFade, intro].filter(Boolean),
      tl: null,
    };
    lockScroll();
    // The head CSS hides these with visibility, so their own (Webflow) opacity is still readable: each one
    // fades to that value, e.g. 0.5 for a dimmed nav link, and nothing jumps when the inline styles go.
    // CSS transitions are off meanwhile so they don't fight the tween.
    pre.enterEls.forEach((el) => {
      const o = parseFloat(getComputedStyle(el).opacity);
      el.__v4Opacity = Number.isNaN(o) ? 1 : o;
    });
    gsap.set(pre.enterEls, { opacity: 0, visibility: 'visible', transition: 'none' });
    hideCellsForEntrance();

    // Progress = fonts + every artwork in the pool, counted as each one settles.
    let loaded = 0;
    const total = 1 + poolImgs.length;
    const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    fontsReady.then(() => { loaded++; }, () => { loaded++; });
    poolImgs.forEach((img) => {
      if (img.complete) { loaded++; return; }
      let done = false;
      const settle = () => { if (!done) { done = true; loaded++; } };
      img.addEventListener('load', settle, { once: true });
      img.addEventListener('error', settle, { once: true });
    });
    // Times are measured from navigation start: the preloader has been on screen since the first paint.
    const progress = (t) => (t >= CAP_MS ? 1 : loaded / total);

    if (reduced() || !logo) {
      // Reduced motion: the wordmark is already in place; wait for the load, then a short fade.
      preloadTick = () => {
        const t = performance.now();
        if (t < 600 || progress(t) < 1) return;
        gsap.ticker.remove(preloadTick);
        preloadTick = null;
        exitReduced();
      };
      gsap.ticker.add(preloadTick);
      return;
    }

    // The wordmark is the nav's own. The head CSS parks it near the vertical center; measure where it
    // really sits and where it lands, then let load progress pull it up through quickTo.
    if (getComputedStyle(logo).display === 'inline') logo.style.display = 'inline-block';
    const parkedTop = logo.getBoundingClientRect().top;
    gsap.set(logo, { y: 0 });
    const home = logo.getBoundingClientRect();
    const offset = window.innerHeight / 2 - home.height / 2 - home.top;
    const startY = parkedTop - home.top;
    gsap.set(logo, { y: startY });
    const yTo = gsap.quickTo(logo, 'y', { duration: 0.65, ease: 'power3.out' });
    yTo(startY, startY);
    preloadTick = () => {
      const t = performance.now();
      const target = Math.min(progress(t), t / MIN_MS);
      yTo(offset * (1 - target));
      const y = Number(gsap.getProperty(logo, 'y'));
      if (target >= 1 && Math.abs(y) < 0.4) {
        gsap.ticker.remove(preloadTick);
        preloadTick = null;
        gsap.set(logo, { y: 0 });
        exit();
      }
    };
    gsap.ticker.add(preloadTick);
  }

  // At 100%, one timeline: the wash and grain fade, the glow sinks and shrinks, then nav links, footer,
  // the grid (column by column) and the intro enter.
  function exit() {
    const p = pre;
    if (!p) return;
    markQuiet();
    const { cols, rows } = layout();
    const tl = gsap.timeline({
      onComplete: () => {
        finishPreloader();
        entered = true;
        wavesOn = true;
        scheduleWaves(1800);
      },
    });
    p.tl = tl;
    const fade = [p.wash, p.grain].filter(Boolean);
    if (fade.length) tl.to(fade, { opacity: 0, duration: 0.9, ease: 'power2.inOut' }, 0);
    if (p.glow) {
      tl.to(p.glow, { scale: 0.36, yPercent: 8, duration: 1.5, ease: 'power3.inOut' }, 0)
        .to(p.glow, { opacity: 0, duration: 0.8, ease: 'power2.in' }, 0.7);
    }
    tl.set(p.pl, { display: 'none' }, 1.55);
    const natural = (i, el) => el.__v4Opacity;
    if (p.links.length) tl.fromTo(p.links, { opacity: 0, y: 8 }, { opacity: natural, y: 0, duration: 0.7, ease: 'power3.out', stagger: 0.08 }, 0.75);
    if (p.foot.length) tl.to(p.foot, { opacity: natural, duration: 0.7, ease: 'power2.out' }, 0.9);
    if (introFade) tl.to(introFade, { opacity: natural, duration: 0.6, ease: 'power1.out' }, 1.0);
    if (cells.length) {
      tl.fromTo(cellEls(), { rotationY: 90, opacity: 0 }, {
        rotationY: 0, opacity: 1, duration: 0.8, ease: 'power3.out',
        stagger: { each: 0.035, grid: [rows, cols], axis: 'x', from: 'start' },
      }, 1.0);
    }
    if (intro) tl.fromTo(intro, { opacity: 0, y: 18 }, { opacity: natural, y: 0, duration: 0.9, ease: 'power3.out' }, 1.6);
  }

  function exitReduced() {
    const p = pre;
    if (!p) return;
    markQuiet();
    p.tl = gsap.timeline({ onComplete: () => { finishPreloader(); entered = true; } })
      .to(p.pl, { opacity: 0, duration: 0.3, ease: 'none' }, 0)
      .to(p.enterEls, { opacity: (i, el) => el.__v4Opacity, duration: 0.3, ease: 'none' }, 0)
      .to(cellEls(), { opacity: 1, duration: 0.3, ease: 'none' }, 0);
  }

  // ---------- Start ----------
  build();

  if (arrival === 'load' && html.classList.contains('is-preloading')) preloader();
  else {
    html.classList.remove('is-preloading');
    quickEntrance();
  }

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (alive) markQuiet(); });
  offs.on(window, 'resize', remarkSoon);
  offs.on(document, 'v4:pagechange', () => markQuiet());
  offs.on(document, 'visibilitychange', () => {
    if (document.hidden) clearTimeout(waveTimer);
    else scheduleWaves(700);
  });
  offs.add(onMQ(mqReduce, () => scheduleWaves(700)));
  offs.add(onMQ(mqMobile, () => {
    build();
    if (!entered && pre && !pre.tl) hideCellsForEntrance();
    scheduleWaves(700);
  }));

  return {
    destroy() {
      alive = false;
      wavesOn = false;
      clearTimeout(waveTimer);
      clearTimeout(quietTimer);
      offs.flush();
      if (pre) finishPreloader(); // never leave the shared nav and footer hidden
    },
    restore() { scheduleWaves(700); },
  };
}
