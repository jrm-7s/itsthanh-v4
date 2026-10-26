// Project: open a case study in place (Thanh's mockup "Project previews that open in place").
//
// Click a row (or tap it twice on a phone): no navigation. The preview stays as the stage's first screen, the
// stage becomes a vertical scroll container, the case body (fetched from the real page, see core/casefetch.js)
// is appended under it, and the URL becomes the project's real one (history.pushState).
//   - Scrolling the stage past 24 px slides the list panel away (−90 px and a fade) and widens the stage to the
//     whole window; back at the top the list slides back in. Phones open straight to the full-window state.
//   - While the list is away, an "← All projects" pill sits top-left. Esc, the pill and the browser's Back
//     close the case and return to /project, keeping that project's preview. "Next project →" at the end of
//     the body, a row click, or a link to another project inside the body swap cases in place.
//   - The stage scrolls with its own Lenis (the window's is paused); reduced motion uses native scroll and
//     switches without slides or fades.
// Barba also listens to popstate, so the router offers every popstate and every nav click to this viewer first.

import { gsap } from 'gsap';
import Lenis from 'lenis';
import { reduced, isMobile, bezier, rootRem } from '../core/env.js';
import { lockScroll, unlockScroll } from '../core/scroll.js';
import { normPath } from '../core/router.js';
import { loadCase, cachedCase } from '../core/casefetch.js';
import { backdropOf } from '../core/expand.js';
import { makeHint, copy } from '../core/hints.js';

const COLLAPSE_AT = 24;                 // px of stage scroll before the list slides away
const SLIDE = 0.65;                     // list away / stage widens
const slideEase = bezier(0.65, 0, 0.2, 1);
const ease = bezier(0.25, 0.1, 0.25, 1); // CSS "ease"
const Z = 95;                           // the pinned stage: above the page, under the nav (100) and the pill (101)
const PIN_PROPS = 'position,top,left,width,height,margin,zIndex,backgroundColor,borderRadius';

const samePage = (a, b) => {
  try {
    const x = new URL(a, window.location.href);
    const y = new URL(b, window.location.href);
    return x.origin === y.origin && normPath(x.pathname) === normPath(y.pathname);
  } catch (e) {
    return false;
  }
};

const SLOW_MS = 10000;                 // a page that takes longer than this is simply loaded instead
const SLOW = {};

// settle(i, { animate }): the Project page shows row i's preview and nothing else (lineup hidden, timers and
// fades cancelled). closed(i): a case was closed and the page is in charge again.
export function caseViewer({ comp, stage, panel, items, slatsBox, settle, closed, changed = () => {} }) {
  const pageUrl = window.location.href;
  const pageTitle = document.title;
  let baseState = window.history.state; // the /project entry's own state (Barba's), restored when leaving
  let openIdx = -1;   // whose case is open
  let lastIdx = -1;   // the last one opened (focus returns to its row)
  let pending = -1;   // whose case is loading
  let token = 0;      // bumped by every open/close, so late fetches do nothing
  let closing = false;
  let closeJob = null; // the running close: { tween, finish }
  let wheelBuf = 0;    // wheel distance collected while a case loads, applied once it opens
  let wheelOn = false;
  let caseEl = null;
  let lenis = null;
  let tick = null;
  let collapsed = false;
  let pinned = false;
  let slot = null;
  let radius = '';
  let tl = null;
  let tlDone = null;
  let progress = null;
  const live = [];    // listeners that exist while a case is open

  const key = (i) => items[i].row.getAttribute('data-project');
  const nameOf = (i) => {
    const n = items[i].row.querySelector('.project-list_name');
    return (n ? n.textContent : items[i].row.textContent).trim();
  };
  const frame = () => [...document.querySelectorAll('.nav_component, .footer_component')];
  const viewport = () => ({ top: 0, left: 0, width: document.documentElement.clientWidth, height: window.innerHeight });

  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'v4-case_back';
  pill.textContent = '← All projects';
  comp.append(pill);
  gsap.set(pill, { autoAlpha: 0 });
  pill.addEventListener('click', () => requestClose());

  // "Scroll to read ↓" at the bottom of the stage, while an open case sits at its top.
  const cue = makeHint('v4-case_cue');
  comp.append(cue.el);
  let cueArmed = false;
  let cueTimer = 0;
  function placeCue() {
    const el = cue.el;
    const r = stage.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight || 12;
    const cx = r.left + r.width / 2;
    const pad = 8;
    let off = 1.5 * rootRem();
    // Keep clear of the preview's Client / Sector / Duration row: below it if there's room, else above it.
    const meta = stage.querySelector('.project-preview_item.is-active .project-preview_meta');
    const m = meta && meta.getBoundingClientRect();
    if (m && m.height) {
      const y1 = r.bottom - off;
      const hitX = cx + w / 2 + pad > m.left && cx - w / 2 - pad < m.right;
      const hitY = y1 + pad > m.top && y1 - h - pad < m.bottom;
      if (hitX && hitY) {
        const below = r.bottom - m.bottom;
        off = below >= h + 2 * pad ? Math.max(pad, (below - h) / 2) : r.bottom - m.top + 12;
      }
    }
    const bottom = Math.round(window.innerHeight - r.bottom + off);
    el.style.left = `${Math.round(cx)}px`;
    el.style.bottom = isMobile() ? `calc(${bottom}px + env(safe-area-inset-bottom, 0px))` : `${bottom}px`;
  }
  function updateCue() {
    const show = openIdx >= 0 && !closing && cueArmed && !tl && stage.scrollTop < COLLAPSE_AT && (isMobile() || !collapsed);
    if (show) {
      const text = copy(panel, 'scroll', 'Scroll to read ↓');
      if (cue.text() !== text) cue.el.querySelector('.v4-hint_text').textContent = text; // measure the real copy
      placeCue();
    }
    cue.set(show ? copy(panel, 'scroll', 'Scroll to read ↓') : '');
  }
  function armCue() {
    cueArmed = false;
    clearTimeout(cueTimer);
    cueTimer = setTimeout(() => { cueArmed = true; updateCue(); }, 500);
  }
  function disarmCue() {
    cueArmed = false;
    clearTimeout(cueTimer);
    cue.set('');
  }
  // Esc closes an open case, and cancels one that is still loading.
  const onKey = (e) => {
    if (e.key === 'Escape' && (openIdx >= 0 || pending >= 0)) { e.preventDefault(); requestClose(); }
  };
  document.addEventListener('keydown', onKey);

  // ---------- Pinning: the stage leaves the layout (a hidden slot keeps its place) and can grow ----------
  function pin() {
    if (pinned) return;
    pinned = true;
    const r = stage.getBoundingClientRect();
    const cs = getComputedStyle(stage);
    const fill = backdropOf(stage);
    radius = cs.borderRadius;
    slot = document.createElement('div');
    slot.className = 'v4-case_slot';
    slot.setAttribute('aria-hidden', 'true');
    slot.style.cssText = `height:${r.height}px;margin:${cs.margin};flex:0 0 auto;grid-column:${cs.gridColumn};grid-row:${cs.gridRow};visibility:hidden;pointer-events:none;`;
    const y = stage.scrollTop;
    stage.parentNode.insertBefore(slot, stage);
    gsap.set(stage, { position: 'fixed', top: r.top, left: r.left, width: r.width, height: r.height, margin: 0, zIndex: Z, backgroundColor: fill });
    stage.scrollTop = y;
  }

  function unpin() {
    if (!pinned) return;
    pinned = false;
    const y = stage.scrollTop;
    gsap.set(stage, { clearProps: PIN_PROPS });
    if (slot) { slot.remove(); slot = null; }
    stage.scrollTop = y;
  }

  function restoreChrome() {
    if (panel) gsap.set(panel, { clearProps: 'transform,opacity,visibility' });
    gsap.set(frame(), { clearProps: 'opacity,visibility' });
    gsap.set(pill, { autoAlpha: 0, y: 0 });
  }

  // Collapsed = the list is away and the stage fills the window (always the case on phones while open).
  function setCollapsed(c) {
    if (c === collapsed) return Promise.resolve();
    collapsed = c;
    if (tl) { tl.kill(); tl = null; }
    if (tlDone) { const d = tlDone; tlDone = null; d(); }
    const out = isMobile() ? { x: 0, y: 60 } : { x: -90, y: 0 };
    const chrome = frame();
    return new Promise((resolve) => {
      if (reduced()) {
        if (c) {
          pin();
          gsap.set(stage, { ...viewport(), borderRadius: 0 });
          if (panel) gsap.set(panel, { ...out, autoAlpha: 0 });
          gsap.set(chrome, { autoAlpha: 0 });
          gsap.set(pill, { autoAlpha: 1, y: 0 });
        } else {
          unpin();
          restoreChrome();
        }
        resolve();
        updateCue();
        return;
      }
      tlDone = resolve;
      tl = gsap.timeline({
        onComplete: () => {
          tl = null;
          tlDone = null;
          if (!c) { unpin(); restoreChrome(); }
          resolve();
          updateCue();
        },
      });
      if (c) {
        pin();
        tl.to(stage, { ...viewport(), borderRadius: 0, duration: SLIDE, ease: slideEase }, 0);
        if (panel) tl.to(panel, { ...out, duration: SLIDE, ease: slideEase }, 0).to(panel, { autoAlpha: 0, duration: 0.45, ease }, 0);
        tl.to(chrome, { autoAlpha: 0, duration: 0.45, ease }, 0)
          .fromTo(pill, { autoAlpha: 0, y: -6 }, { autoAlpha: 1, y: 0, duration: 0.3, ease }, 0.3);
      } else {
        const r = (slot || stage).getBoundingClientRect();
        tl.to(stage, { top: r.top, left: r.left, width: r.width, height: r.height, borderRadius: radius, duration: SLIDE, ease: slideEase }, 0);
        if (panel) tl.to(panel, { x: 0, y: 0, duration: SLIDE, ease: slideEase }, 0).to(panel, { autoAlpha: 1, duration: 0.45, ease }, 0.15);
        tl.to(chrome, { autoAlpha: 1, duration: 0.45, ease }, 0.15)
          .to(pill, { autoAlpha: 0, y: -6, duration: 0.2, ease }, 0);
      }
    });
  }

  // ---------- The stage's own scroll ----------
  function startLenis() {
    if (reduced() || lenis) return;
    lenis = new Lenis({
      wrapper: stage, content: caseEl, eventsTarget: comp, // the wheel over the list scrolls the case too
      lerp: 0.1, smoothWheel: true, syncTouch: false, autoRaf: false, naiveDimensions: true,
    });
    tick = (t) => { if (lenis) lenis.raf(t * 1000); };
    gsap.ticker.add(tick);
  }

  function stopLenis() {
    if (tick) gsap.ticker.remove(tick);
    tick = null;
    if (lenis) { lenis.destroy(); lenis = null; }
  }

  function scrollTop(y) {
    if (lenis) lenis.scrollTo(y, { immediate: true, force: true });
    stage.scrollTop = y;
  }

  const onScroll = () => {
    if (openIdx < 0 || closing) return;
    if (!isMobile()) setCollapsed(stage.scrollTop > COLLAPSE_AT);
    updateCue();
  };
  // "Next project →" and links to other projects inside the body open in place.
  const onCaseClick = (e) => {
    if (e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || !caseEl || !caseEl.contains(a)) return;
    if (closing) { e.preventDefault(); return; }
    const i = items.findIndex((it) => samePage(it.row.href, a.href));
    if (i < 0) return; // anything else: the router's usual handling
    e.preventDefault();
    open(i, 'replace');
  };

  // ---------- A wheel while the page loads still counts ----------
  const onPendingWheel = (e) => {
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? stage.clientHeight : 1;
    wheelBuf = Math.max(0, wheelBuf + e.deltaY * unit);
  };
  function collectWheel(on) {
    if (on === wheelOn) return;
    wheelOn = on;
    if (on) { wheelBuf = 0; comp.addEventListener('wheel', onPendingWheel, { passive: true }); }
    else comp.removeEventListener('wheel', onPendingWheel);
  }
  function applyWheel() {
    const y = Math.min(wheelBuf, Math.max(0, stage.scrollHeight - stage.clientHeight));
    wheelBuf = 0;
    if (y <= 0) return;
    if (lenis) lenis.scrollTo(y);
    else { stage.scrollTop = y; onScroll(); }
  }

  // ---------- Loading bar across the top of the stage ----------
  function showProgress() {
    if (progress) return;
    progress = document.createElement('div');
    progress.className = 'v4-case_progress';
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-label', 'Loading project');
    stage.append(progress);
    if (reduced()) gsap.set(progress, { scaleX: 0.85 });
    else gsap.fromTo(progress, { scaleX: 0 }, { scaleX: 0.85, duration: 0.24, ease: 'power2.out' });
  }

  // Resolves once the bar is full; it then fades on its own.
  function finishProgress(instant) {
    const p = progress;
    progress = null;
    if (!p) return Promise.resolve();
    gsap.killTweensOf(p);
    if (instant || reduced()) { p.remove(); return Promise.resolve(); }
    return new Promise((resolve) => {
      gsap.timeline({ onComplete: () => p.remove() })
        .to(p, { scaleX: 1, duration: 0.12, ease: 'power1.out', onComplete: resolve })
        .to(p, { opacity: 0, duration: 0.26, ease });
    });
  }

  // ---------- Body ----------
  function build(i, data) {
    const frag = document.createDocumentFragment();
    const body = document.createElement('div');
    body.className = 'v4-case_body';
    body.append(data.fragment.cloneNode(true));
    const n = (i + 1) % items.length;
    const next = document.createElement('a');
    next.className = 'v4-case_next';
    next.href = items[n].row.getAttribute('href');
    next.setAttribute('data-next-index', String(n));
    const label = document.createElement('span');
    label.className = 'v4-case_next-label';
    label.textContent = 'Next project';
    const title = document.createElement('span');
    title.className = 'v4-case_next-name';
    title.textContent = `${nameOf(n)} →`;
    next.append(label, title);
    frag.append(body, next);
    return frag;
  }

  // Background videos and Lottie don't start by themselves once injected.
  function wake(root) {
    root.querySelectorAll('video').forEach((v) => {
      if (!v.hasAttribute('autoplay')) return;
      v.muted = true;
      v.playsInline = true;
      try {
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
      } catch (e) { /* no source */ }
    });
    if (root.querySelector('[data-animation-type="lottie"]')) {
      try {
        const wf = window.Webflow;
        const lottie = wf && typeof wf.require === 'function' ? wf.require('lottie') : null;
        if (lottie && typeof lottie.init === 'function') lottie.init();
      } catch (e) { /* leave it static */ }
    }
  }

  function fadeIn() {
    if (!reduced() && caseEl) gsap.fromTo(caseEl, { opacity: 0 }, { opacity: 1, duration: 0.3, ease });
  }

  function mount(i, data) {
    caseEl = document.createElement('div');
    caseEl.className = 'v4-case';
    caseEl.setAttribute('data-case-for', key(i));
    caseEl.append(build(i, data));
    stage.append(caseEl);
    stage.setAttribute('data-case', 'open');
    stage.setAttribute('data-lenis-prevent', '');
    stage.setAttribute('tabindex', '-1'); // focus moves into the case, so keys (Space, arrows) scroll it
    stage.scrollTop = 0;
    if (slatsBox) gsap.set(slatsBox, { autoAlpha: 0 }); // the preview's own strip shows the same image
    lockScroll(); // the window's Lenis stands still while the stage scrolls
    startLenis();
    const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); live.push(() => t.removeEventListener(type, fn, o)); };
    on(stage, 'scroll', onScroll, { passive: true });
    on(caseEl, 'click', onCaseClick);
    wake(caseEl);
    fadeIn();
    try { stage.focus({ preventScroll: true }); } catch (e) { /* old browsers */ }
    if (isMobile()) setCollapsed(true);
    armCue();
  }

  function swap(i, data) {
    scrollTop(0);
    caseEl.replaceChildren(build(i, data));
    caseEl.setAttribute('data-case-for', key(i));
    wake(caseEl);
    if (!isMobile()) setCollapsed(false);
    fadeIn();
    armCue();
  }

  function teardown(unlock = true) {
    disarmCue();
    const a = document.activeElement;
    const hadFocus = !!a && (stage.contains(a) || a === pill);
    live.splice(0).forEach((off) => off());
    if (tl) { tl.kill(); tl = null; }
    if (tlDone) { const d = tlDone; tlDone = null; d(); }
    stopLenis();
    if (caseEl) { gsap.killTweensOf(caseEl); caseEl.remove(); caseEl = null; }
    stage.removeAttribute('data-case');
    stage.removeAttribute('data-lenis-prevent');
    stage.removeAttribute('tabindex');
    stage.scrollTop = 0;
    unpin();
    restoreChrome();
    collapsed = false;
    if (unlock) {
      unlockScroll();
      // Back to the row of the project that was open (not during a Barba leave: that page is going away).
      const row = items[lastIdx] && items[lastIdx].row;
      if (hadFocus && row) { try { row.focus({ preventScroll: true }); } catch (e) { /* old browsers */ } }
    }
  }

  // ---------- Open / close ----------
  // how: 'push' (first open), 'replace' (swap while open), 'none' (arrived here through history)
  async function open(i, how = 'push') {
    const it = items[i];
    if (!it || !it.row.getAttribute('href')) return;
    if (closing) finishClose(); // Esc then a quick click: finish closing at once, then open
    if (i === openIdx || i === pending) return;
    const me = ++token;
    const swapping = openIdx >= 0;
    pending = i;
    settle(i, { animate: swapping }); // the preview, fully shown, before anything else
    let data = cachedCase(it.row.href);
    if (data === undefined) {
      showProgress();
      collectWheel(true);
      data = await Promise.race([loadCase(it.row.href), new Promise((r) => { setTimeout(() => r(SLOW), SLOW_MS); })]);
      if (me !== token) return;
      await finishProgress();
      if (me !== token) return;
    }
    pending = -1;
    collectWheel(false);
    if (!data || data === SLOW) { // the page couldn't be read in time: just go there
      const go = window.V4 && typeof window.V4.assign === 'function' ? window.V4.assign : (u) => window.location.assign(u);
      go(it.row.href);
      return;
    }
    const entry = { v4case: { key: key(i), href: it.row.href } };
    if (how === 'push') {
      baseState = window.history.state;
      window.history.pushState(Object.assign({}, baseState, entry), '', it.row.href);
    } else if (how === 'replace') {
      window.history.replaceState(Object.assign({}, baseState, entry), '', it.row.href);
    }
    document.title = data.title || pageTitle;
    openIdx = i;
    lastIdx = i;
    if (swapping) swap(i, data);
    else mount(i, data);
    applyWheel();
    changed();
  }

  // A running close jumps to its end (another open, a hover or the lineup wants the page back).
  function finishClose() {
    if (!closeJob) return;
    const job = closeJob;
    if (job.tween) job.tween.kill();
    job.finish();
  }

  function close({ instant = false } = {}) {
    token++;
    finishProgress(true);
    collectWheel(false);
    const wasPending = pending >= 0;
    pending = -1;
    if (openIdx < 0) {
      if (wasPending) changed(); // a cancelled load: the page takes input again
      return Promise.resolve();
    }
    disarmCue();
    const was = openIdx;
    openIdx = -1;
    document.title = pageTitle;
    if (instant || reduced()) {
      teardown();
      closed(was);
      changed();
      return Promise.resolve();
    }
    closing = true;
    return new Promise((resolve) => {
      const job = {};
      job.finish = () => {
        if (closeJob !== job) return;
        closeJob = null;
        closing = false;
        teardown();
        closed(was);
        changed();
        resolve();
      };
      job.tween = gsap.to(caseEl, {
        opacity: 0,
        duration: 0.25,
        ease,
        onComplete: () => {
          job.tween = null;
          scrollTop(0);
          setCollapsed(false).then(job.finish);
        },
      });
      closeJob = job;
    });
  }

  // Esc and the pill step back in history, so Back/Forward stay in step with what's on screen.
  function requestClose() {
    const st = window.history.state;
    if (openIdx >= 0 && st && st.v4case) window.history.back();
    else close();
  }

  // ---------- Hooks the router calls first ----------
  // popstate: returns true when it was ours (the router then stops Barba from seeing it).
  function popstate(e) {
    const st = e.state && e.state.v4case;
    if (st) {
      const i = items.findIndex((it) => it.row.getAttribute('data-project') === st.key);
      if (i < 0) return false;
      if (i !== openIdx) open(i, 'none');
      return true;
    }
    if (openIdx >= 0 || pending >= 0) {
      if (samePage(window.location.href, pageUrl)) { close(); return true; }
      close({ instant: true }); // jumping further back: Barba takes it from here
    }
    return false;
  }

  // A click on a V4 page link (or V4.navigate). Returns true when handled here.
  function navigating(href) {
    if (openIdx < 0 && pending < 0) return false;
    if (samePage(href, pageUrl)) { requestClose(); return true; } // "Project" itself: just close
    // Leaving for Home or Archive: put /project back in this history entry, close at once, and let Barba run
    // the normal transition from the Project page.
    const st = window.history.state;
    if (st && st.v4case) window.history.replaceState(baseState, '', pageUrl);
    close({ instant: true });
    return false;
  }

  // Back/Forward restored the page from the browser cache. If its history entry is the open case, the case
  // stays (the window's Lenis is paused again); anything else closes at once. Returns whether it stayed.
  function restore() {
    const st = window.history.state && window.history.state.v4case;
    if (openIdx >= 0 && st && st.key === key(openIdx)) {
      lockScroll();
      return true;
    }
    finishClose();
    close({ instant: true });
    return false;
  }

  return {
    open,
    close,
    restore,
    requestClose,
    popstate,
    navigating,
    finishClose,
    // Cancel a case that is still loading (the reader moved on to another row).
    cancel: () => { if (openIdx < 0 && pending >= 0) close(); },
    isOpen: () => openIdx >= 0,
    isClosing: () => closing,
    isPending: () => pending >= 0,
    isActive: () => openIdx >= 0 || pending >= 0,
    openIndex: () => openIdx,
    pendingIndex: () => pending,
    destroy() {
      token++;
      finishProgress(true);
      collectWheel(false);
      if (closeJob && closeJob.tween) closeJob.tween.kill();
      closeJob = null;
      closing = false;
      pending = -1;
      // A Barba leave: the router owns the scroll lock now.
      if (openIdx >= 0 || caseEl) { openIdx = -1; teardown(false); }
      document.removeEventListener('keydown', onKey);
      pill.remove();
      clearTimeout(cueTimer);
      cue.destroy();
    },
  };
}
