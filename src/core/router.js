// Barba 2 router for the three V4 pages, plus the leave path for every other internal link.
//
// - The Barba pages are read from the nav: every a[data-flip-index] is a page, and its index sets the
//   transition direction (0 Home, 1 Project, 2 Archive). Up in index is forward, down is back.
// - The transition itself lives in transitions.js (glide by default; see data-v4-transition).
// - Barba prefetches a page when its link is hovered (built in), updates <title>, and we copy the meta
//   description (and og/twitter/canonical), keep w--current in sync and scroll to the top.
// - Links to any other page on the site (project pages, archive entries) skip Barba: the current page
//   leaves with the same transition, then location.assign does a normal load. Page modules can leave
//   their own way instead (the Archive "expand") through exitWith().
// - The active page module sees every popstate and every V4 link click first (popstate / navigating hooks),
//   so the Project page can keep its in-place case entries away from Barba.
// - pageshow with persisted (Back/Forward from the cache) resets the page and turns it back in.

import barba from '@barba/core';
import { gsap } from 'gsap';
import { html } from './env.js';
import { freeze, clearPage, hideShadow, hideVeil, swapPages, leavePage, enterPage, variantName } from './transitions.js';
import { lockScroll, unlockScroll, scrollToTop } from './scroll.js';
import { mount, unmount, activeModule } from './modules.js';

const DEFAULT_PAGES = [['/', 0], ['/project', 1], ['/archive', 2]];
const HEAD_TAGS = [
  'meta[name="description"]',
  'meta[property="og:title"]',
  'meta[property="og:description"]',
  'meta[property="og:url"]',
  'meta[name="twitter:title"]',
  'meta[name="twitter:description"]',
  'link[rel="canonical"]',
];

let pages = new Map(DEFAULT_PAGES);
let hasBarba = false;
let busy = false;
let flipDir = 1;
let exitKind = null; // how the page was left for a normal load: 'transition' | 'expand' | null

const wrapperEl = () => document.querySelector('[data-barba="wrapper"]');
const containerEl = () => document.querySelector('[data-barba="container"]');

export function normPath(path) {
  const p = String(path || '/').replace(/\/index\.html?$/i, '/').replace(/\/+$/, '');
  return (p || '/').toLowerCase();
}

function toURL(href) {
  try { return new URL(href, window.location.href); } catch (e) { return null; }
}

export function isPage(href) {
  const u = toURL(href);
  return !!u && u.origin === window.location.origin && pages.has(normPath(u.pathname));
}

const indexOf = (href) => {
  const u = toURL(href);
  return (u && pages.get(normPath(u.pathname))) || 0;
};

function readPages() {
  const map = new Map();
  document.querySelectorAll('a[data-flip-index][href]').forEach((a) => {
    const u = toURL(a.getAttribute('href'));
    const i = parseInt(a.getAttribute('data-flip-index'), 10);
    if (u && u.origin === window.location.origin && !Number.isNaN(i)) map.set(normPath(u.pathname), i);
  });
  return map.size ? map : new Map(DEFAULT_PAGES);
}

/**
 * Copy title and description tags from the incoming page, and return that page's default ink: each page
 * sets data-ink on its own page-wrapper in Webflow, but Barba keeps the wrapper, so we carry it over.
 */
function syncHead(markup) {
  if (!markup) return 'dark';
  const doc = new DOMParser().parseFromString(markup, 'text/html');
  if (doc.title) document.title = doc.title;
  HEAD_TAGS.forEach((sel) => {
    const next = doc.head && doc.head.querySelector(sel);
    const cur = document.head.querySelector(sel);
    const attr = sel.startsWith('link') ? 'href' : 'content';
    if (next && cur) cur.setAttribute(attr, next.getAttribute(attr) || '');
    else if (next) document.head.appendChild(document.importNode(next, true));
    else if (cur) cur.remove();
  });
  const wfPage = doc.documentElement.getAttribute('data-wf-page');
  if (wfPage) html.setAttribute('data-wf-page', wfPage);
  const nextWrapper = doc.querySelector('[data-barba="wrapper"]');
  return (nextWrapper && nextWrapper.getAttribute('data-ink')) || 'dark';
}

/** Webflow marks the current page's links with w--current on full loads; keep that true after a flip. */
export function syncNav() {
  const here = normPath(window.location.pathname);
  document.querySelectorAll('.nav_component a[href], .footer_component a[href]').forEach((a) => {
    const u = toURL(a.getAttribute('href'));
    const on = !!u && u.origin === window.location.origin && normPath(u.pathname) === here;
    a.classList.toggle('w--current', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

/** Re-run Webflow's page code for the new container (interactions, forms) if Webflow is on the page. */
function webflowReinit() {
  const wf = window.Webflow;
  if (!wf || (window.V4_CONFIG && window.V4_CONFIG.webflowReinit === false)) return;
  try {
    if (typeof wf.destroy === 'function') wf.destroy();
    if (typeof wf.ready === 'function') wf.ready();
    const ix2 = typeof wf.require === 'function' ? wf.require('ix2') : null;
    if (ix2 && typeof ix2.init === 'function') ix2.init();
  } catch (e) {
    /* Webflow internals vary between sites; never block navigation on them. */
  }
}

/** The final hop to another document. Tests replace window.V4.assign to stay on the page. */
function assign(href) {
  const api = window.V4;
  if (api && typeof api.assign === 'function') api.assign(href);
  else window.location.assign(href);
}

/**
 * Leave for a normal page load with a custom animation (the Archive expand). `run` returns a
 * promise; when it settles the browser navigates. On a back/forward-cache restore the active module's
 * restore({ kind }) gets to reverse it.
 */
export function exitWith(run, href, kind = 'expand') {
  if (busy || !href) return false;
  busy = true;
  exitKind = kind;
  lockScroll();
  const w = wrapperEl();
  if (w) w.setAttribute('data-flip', kind);
  Promise.resolve()
    .then(run)
    .catch((err) => console.error('[v4] exit animation failed', err))
    .then(() => assign(href));
  return true;
}

/** Leave with the page transition's "out" half, then do a normal page load. */
export function flipExit(href) {
  if (busy) return;
  const w = wrapperEl();
  if (w) w.setAttribute('data-flip-variant', variantName());
  exitWith(() => leavePage(containerEl(), 1), href, 'transition');
  if (w) w.setAttribute('data-flip', 'out');
}

/** Let the active page react to a move to another V4 page first (e.g. close an in-place case). */
function offerToPage(href) {
  const mod = activeModule();
  if (!mod || typeof mod.navigating !== 'function') return false;
  try { return mod.navigating(href) === true; } catch (err) { console.error('[v4] navigating hook failed', err); return false; }
}

/** Go to any internal URL: the three V4 pages by Barba, everything else by a transition out + load. */
export function navigate(href) {
  if (busy || !href) return;
  const u = toURL(href);
  if (!u) return;
  if (hasBarba && isPage(u.href)) {
    if (offerToPage(u.href)) return;
    barba.go(u.href);
  } else flipExit(u.href);
}

export const isBusy = () => busy;

function onClick(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
  if (!a) return;
  if ((a.target && a.target !== '_self') || a.hasAttribute('download') || a.closest('[data-v4-noflip], [data-barba-prevent]')) return;
  const raw = a.getAttribute('href') || '';
  if (!raw || raw.charAt(0) === '#' || /^(mailto|tel|sms|javascript):/i.test(raw)) return;
  const u = toURL(raw);
  if (!u || u.origin !== window.location.origin) return;
  if (normPath(u.pathname) === normPath(window.location.pathname) && u.search === window.location.search) {
    if (u.hash) return; // same-page anchor: Lenis (anchors: true) or the browser handles it
    e.preventDefault(); // already here; Barba ignores same-URL clicks, which would otherwise reload
    return;
  }
  if (hasBarba && isPage(u.href)) {
    if (busy) { e.preventDefault(); return; }
    // The page goes first (this listener runs before Barba's): it may handle the click itself.
    if (offerToPage(u.href)) { e.preventDefault(); e.stopImmediatePropagation(); }
    return; // otherwise Barba takes it
  }
  e.preventDefault();
  flipExit(u.href);
}

// Every popstate goes to the active page first (registered before Barba's own listener). History entries a
// page pushed itself (the Project's in-place cases) never reach Barba, so Back never runs a page transition.
function onPopState(e) {
  const mod = activeModule();
  if (!mod || typeof mod.popstate !== 'function') return;
  let handled = false;
  try { handled = mod.popstate(e) === true; } catch (err) { console.error('[v4] popstate hook failed', err); }
  if (handled) e.stopImmediatePropagation();
}

// Back/Forward restored the page from the cache: undo however it was left.
function onPageShow(e) {
  if (!e.persisted) return;
  const kind = exitKind;
  exitKind = null;
  const el = containerEl();
  const w = wrapperEl();
  if (w) { w.removeAttribute('data-flip'); w.removeAttribute('data-flip-variant'); }
  html.classList.remove('v4-flipping');
  busy = false;
  syncNav();
  unlockScroll();
  const mod = activeModule();
  if (kind !== 'expand') {
    if (el) gsap.killTweensOf(el);
    clearPage(el);
    hideShadow();
    if (kind !== 'transition') hideVeil(); // a veil exit is undone by the veil itself
  }
  if (mod && typeof mod.restore === 'function') {
    try { mod.restore({ kind }); } catch (err) { console.error('[v4] restore failed', err); }
  }
  if (kind === 'transition') enterPage(el, -1);
}

const transition = {
  name: 'v4-page',
  sync: true,
  // Order in sync mode: next container added → beforeLeave → beforeEnter → leave + enter → after.
  beforeLeave(data) {
    busy = true;
    flipDir = indexOf(data.next.url.href) >= indexOf(data.current.url.href) ? 1 : -1;
    const w = wrapperEl();
    if (w) {
      w.setAttribute('data-flip', flipDir > 0 ? 'forward' : 'back');
      w.setAttribute('data-flip-variant', variantName());
    }
    html.classList.add('v4-flipping');
    unmount(); // stops the old page's timers; its visuals stay as they are while it leaves
    lockScroll();
    freeze(data.current.container);
    scrollToTop(); // the next page starts at the top
  },
  beforeEnter(data) {
    const ink = syncHead(data.next.html);
    syncNav();
    const w = wrapperEl();
    if (w) w.setAttribute('data-ink', ink); // the Archive module then sets it per cover
    mount(data.next.container, { arrival: 'flip' });
  },
  leave(data) {
    return swapPages({ from: data.current.container, to: data.next.container, dir: flipDir });
  },
  enter() {},
  after(data) {
    clearPage(data.next.container);
    hideShadow();
    hideVeil();
    const w = wrapperEl();
    if (w) { w.removeAttribute('data-flip'); w.removeAttribute('data-flip-variant'); }
    html.classList.remove('v4-flipping');
    webflowReinit();
    syncNav();
    unlockScroll();
    busy = false;
    document.dispatchEvent(new CustomEvent('v4:pagechange', { detail: { namespace: data.next.namespace } }));
  },
};

export function initRouter() {
  pages = readPages();
  try { window.history.scrollRestoration = 'manual'; } catch (e) { /* older browsers */ }
  document.addEventListener('click', onClick);
  window.addEventListener('popstate', onPopState); // before barba.init, so it runs first
  window.addEventListener('pageshow', onPageShow);

  const w = wrapperEl();
  if (!w || !containerEl()) return false;
  if (!w.hasAttribute('data-ink')) w.setAttribute('data-ink', 'dark');
  try {
    barba.init({
      timeout: 8000,
      preventRunning: true,
      prevent: ({ el, href }) => !isPage(href) || !!(el && el.closest && el.closest('[data-v4-noflip]')),
      transitions: [transition],
    });
    hasBarba = true;
  } catch (err) {
    console.warn('[v4] page transitions disabled:', err && err.message);
  }
  return hasBarba;
}

export { barba };
