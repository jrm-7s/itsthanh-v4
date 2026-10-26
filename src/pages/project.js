// Project: lineup → hover previews with the slat flip and text roll → back to the lineup.
// Ported from project-page-mockup-v2.html (its open-in-place and list-hiding parts were dropped).
// Opening a project doesn't use the page transition: the preview stage expands to fill the window and
// fades to the case study's ground, then the project page loads (see core/expand.js).

import { gsap } from 'gsap';
import { reduced, bag, bezier } from '../core/env.js';
import { exitWith } from '../core/router.js';
import { expand, collapse, caseGround, backdropOf } from '../core/expand.js';

const SLATS = 6;
const SLAT_MS = 560;       // each slat turns in 0.56 s…
const SLAT_STAGGER = 45;   // …45 ms after the one before
const SLAT_MID = 0.45;     // edge-on moment where the slat swaps image
const ROLL_MS = 520;       // text rolls in through its mask in about 0.5 s
const INTENT_MS = 80;      // hover intent before leaving the lineup, and before prefetching
const GRACE_MS = 200;      // after the pointer leaves the list, back to the lineup
const FADE = 0.38;         // lineup ⇄ preview crossfade (opacity only)
const ease = bezier(0.25, 0.1, 0.25, 1); // CSS "ease", as in the mockup
const rollEase = 'cubic-bezier(.2,.75,.15,1)';

export default function project(container) {
  const comp = container.querySelector('[data-project-list]');
  if (!comp) return {};
  const rows = [...comp.querySelectorAll('.project-list_row')];
  const list = comp.querySelector('.project-list_list') || comp.querySelector('.project-list_panel');
  const stage = comp.querySelector('[data-project-stage]') || comp;
  const panel = comp.querySelector('.project-list_panel');
  const lineup = comp.querySelector('[data-project-lineup]');
  const slatsBox = comp.querySelector('[data-project-slats]');
  const previewEls = [...comp.querySelectorAll('.project-preview_item')];
  // Webflow outputs loading="lazy" on images by default; these must be decoded before the first hover.
  comp.querySelectorAll('img').forEach((img) => { if (img.loading === 'lazy') img.loading = 'eager'; });
  const byKey = new Map(previewEls.map((el) => [el.getAttribute('data-project'), el]));
  const offs = bag();

  const items = rows.map((row, k) => {
    const preview = byKey.get(row.getAttribute('data-project')) || null;
    const index = parseInt(row.getAttribute('data-index'), 10);
    const strip = preview ? preview.querySelector('[data-project-strip]') || preview.querySelector('.project-preview_strip img') : null;
    return {
      row,
      preview,
      index: Number.isNaN(index) ? k : index,
      rule: row.querySelector('.project-list_rule'),
      strip,
      stripBox: preview ? preview.querySelector('.project-preview_strip') || (strip && strip.parentElement) : null,
      header: preview ? preview.querySelector('.project-preview_header') : null,
      rolls: preview ? [...preview.querySelectorAll('[data-roll]')] : [],
      color: preview ? preview.getAttribute('data-color') : null,
      prefetched: false,
    };
  });

  let alive = true;
  let state = 'lineup';
  let current = -1;
  let intentTimer = 0;
  let prefetchTimer = 0;
  let graceTimer = 0;
  let overList = false;
  let lastPointer = '';
  let lastPressAt = -Infinity;
  let opening = false; // the expand is running: hover and grace stand still
  let slatRun = 0;
  let slatTarget = -1;

  const stripSrc = (i) => (items[i] && items[i].strip ? items[i].strip.currentSrc || items[i].strip.src : '');

  // ---------- Slats: six vertical pieces of the strip, each holding every project's image ----------
  const slats = [];
  if (slatsBox) {
    slatsBox.textContent = '';
    slatsBox.setAttribute('aria-hidden', 'true');
    for (let k = 0; k < SLATS; k++) {
      const el = document.createElement('div');
      el.className = 'project-preview_slat';
      el.style.setProperty('--slat-i', k);
      const imgs = items.map(() => {
        const im = document.createElement('img');
        im.alt = '';
        im.decoding = 'async';
        im.draggable = false;
        el.append(im);
        return im;
      });
      const shade = document.createElement('div');
      shade.className = 'project-preview_slat-shade';
      el.append(shade);
      slatsBox.append(el);
      slats.push({ el, imgs, shade, shown: -1, busy: false });
    }
  }
  // Point every slat image at the strip variant the page already downloaded (no extra requests).
  function syncSlatSources(i) {
    const src = stripSrc(i);
    if (src) slats.forEach((s) => { if (s.imgs[i].getAttribute('src') !== src) s.imgs[i].src = src; });
  }
  items.forEach((it, i) => {
    syncSlatSources(i);
    if (it.strip && !it.strip.complete) offs.on(it.strip, 'load', () => syncSlatSources(i), { once: true });
  });

  function slatShow(s, i) {
    s.imgs.forEach((im, j) => im.classList.toggle('is-shown', j === i));
    s.shown = i;
  }

  function slatsSet(i) {
    slatRun++;
    slatTarget = i;
    slats.forEach((s) => {
      s.el.getAnimations().forEach((a) => a.cancel());
      s.shade.getAnimations().forEach((a) => a.cancel());
      s.busy = false;
      slatShow(s, i);
    });
  }

  // Each slat reads the latest target at its midpoint, so a fast sweep retargets instead of queuing.
  function flipSlat(s, delay) {
    const me = slatRun;
    s.busy = true;
    const rot = (d) => `perspective(800px) rotateY(${d}deg)`;
    s.el.animate([
      { transform: rot(0), easing: 'cubic-bezier(.5,0,.85,.4)' },
      { transform: rot(90), offset: SLAT_MID },
      { transform: rot(-90), offset: SLAT_MID, easing: 'cubic-bezier(.2,.65,.3,1)' },
      { transform: rot(0) },
    ], { duration: SLAT_MS, delay });
    s.shade.animate([{ opacity: 0 }, { opacity: 0.45, offset: SLAT_MID }, { opacity: 0 }], { duration: SLAT_MS, delay, easing: 'ease-in-out' });
    setTimeout(() => { if (me === slatRun) slatShow(s, slatTarget); }, delay + SLAT_MS * SLAT_MID);
    setTimeout(() => {
      if (me !== slatRun) return;
      s.busy = false;
      if (s.shown !== slatTarget) flipSlat(s, 0);
    }, delay + SLAT_MS + 15);
  }

  // Left to right when moving down the list, right to left when moving up.
  function slatsTo(i, dir) {
    slatTarget = i;
    slats.forEach((s, k) => { if (!s.busy) flipSlat(s, (dir >= 0 ? k : SLATS - 1 - k) * SLAT_STAGGER); });
  }

  // The slat layer sits exactly over the active preview's strip, wherever the layout puts it.
  function alignSlats(i) {
    const box = items[i] && items[i].stripBox;
    if (!slatsBox || !box) return;
    const parent = slatsBox.offsetParent || stage;
    const pr = parent.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    gsap.set(slatsBox, {
      position: 'absolute',
      left: br.left - pr.left - parent.clientLeft,
      top: br.top - pr.top - parent.clientTop,
      right: 'auto',
      bottom: 'auto',
      width: br.width,
      height: br.height,
    });
    slatsBox.style.setProperty('--slats-w', `${br.width}px`);
  }

  // ---------- Text roll ----------
  // Rolls in from the direction of travel. The clip-path keeps it inside its own box, so it works with or
  // without an overflow:hidden mask around it.
  function roll(el, dir, delay) {
    el.getAnimations().forEach((a) => a.cancel());
    const down = dir >= 0;
    el.animate([
      { transform: `translateY(${down ? 108 : -108}%)`, clipPath: down ? 'inset(0 0 108% 0)' : 'inset(108% 0 0 0)' },
      { transform: 'translateY(0)', clipPath: 'inset(0 0 0 0)' },
    ], { duration: ROLL_MS, delay, easing: rollEase, fill: 'backwards' });
  }

  // ---------- States ----------
  const allPreviews = () => items.map((it) => it.preview).filter(Boolean);

  function mark(i) {
    items.forEach((it, k) => {
      const on = k === i;
      it.row.classList.toggle('is-active', on);
      if (it.rule) it.rule.classList.toggle('is-active', on);
      if (it.preview) {
        it.preview.classList.toggle('is-active', on);
        it.preview.setAttribute('aria-hidden', on ? 'false' : 'true');
      }
    });
    const color = i >= 0 ? items[i].color : null;
    if (color) {
      stage.style.setProperty('--project-color', color);
      if (slatsBox) slatsBox.style.backgroundColor = color;
    }
  }

  function setLineupHidden(hidden) {
    if (!lineup) return;
    lineup.classList.toggle('is-hidden', hidden);
    lineup.setAttribute('aria-hidden', hidden ? 'true' : 'false');
  }

  function killFades() {
    gsap.killTweensOf([lineup, slatsBox, ...allPreviews()].filter(Boolean));
  }

  // First hover: the lineup fades to that project's preview. Opacity only, all at once, no movement.
  function leaveLineup(i) {
    clearTimeout(intentTimer);
    clearTimeout(graceTimer);
    state = 'browsing';
    current = i;
    mark(i);
    setLineupHidden(true);
    alignSlats(i);
    slatsSet(i);
    killFades();
    const show = [items[i].preview, slatsBox].filter(Boolean);
    gsap.set(allPreviews().filter((p) => p !== items[i].preview), { autoAlpha: 0 });
    if (reduced()) {
      if (lineup) gsap.set(lineup, { autoAlpha: 0 });
      gsap.set(show, { autoAlpha: 1 });
      return;
    }
    if (lineup) gsap.to(lineup, { autoAlpha: 0, duration: FADE, ease });
    gsap.to(show, { autoAlpha: 1, duration: FADE, ease });
  }

  // Moving between projects: preview swaps at once, text rolls, the strip turns over in slats.
  function showPreview(i) {
    if (i === current || current < 0) return;
    const dir = Math.sign(items[i].index - items[current].index) || 1;
    current = i;
    mark(i);
    killFades();
    gsap.set(allPreviews().filter((p) => p !== items[i].preview), { autoAlpha: 0 });
    if (items[i].preview) gsap.set(items[i].preview, { autoAlpha: 1 });
    if (slatsBox) gsap.set(slatsBox, { autoAlpha: 1 });
    alignSlats(i);
    if (reduced()) { slatsSet(i); return; }
    slatsTo(i, dir);
    let title = 0, meta = 0;
    items[i].rolls.forEach((el) => {
      const delay = el.closest('.project-preview_meta') ? 160 + 40 * meta++ : 120 * title++;
      roll(el, dir, delay);
    });
    if (items[i].header) {
      gsap.fromTo(items[i].header, { opacity: 0, y: dir * 14 }, { opacity: 1, y: 0, duration: 0.38, ease: bezier(0.2, 0.75, 0.15, 1), clearProps: 'opacity,transform' });
    }
  }

  // The reverse of the first hover.
  function returnToLineup(instant) {
    clearTimeout(intentTimer);
    clearTimeout(graceTimer);
    if (state === 'lineup' && !instant) return;
    state = 'lineup';
    current = -1;
    mark(-1);
    setLineupHidden(false);
    killFades();
    const hide = [...allPreviews(), slatsBox].filter(Boolean);
    if (instant || reduced()) {
      gsap.set(hide, { autoAlpha: 0 });
      if (lineup) gsap.set(lineup, { autoAlpha: 1 });
      slatsSet(-1);
      return;
    }
    gsap.to(hide, { autoAlpha: 0, duration: 0.3, ease });
    if (lineup) gsap.to(lineup, { autoAlpha: 1, duration: FADE, ease });
  }

  // ---------- Prefetch: once per row, the project page and its strip image ----------
  function prefetch(i) {
    const it = items[i];
    if (!alive || !it || it.prefetched) return;
    it.prefetched = true;
    const href = it.row.href;
    if (href && ![...document.head.querySelectorAll('link[rel="prefetch"]')].some((l) => l.href === href)) {
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = href;
      document.head.append(link);
    }
    const src = stripSrc(i);
    if (src) {
      const im = new Image();
      im.decoding = 'async';
      im.src = src;
      if (im.decode) im.decode().catch(() => {});
    }
  }

  // ---------- Input ----------
  function hover(i, how) {
    if (!alive || opening) return;
    clearTimeout(graceTimer);
    if (state === 'lineup') {
      clearTimeout(intentTimer);
      if (how === 'pointer') intentTimer = setTimeout(() => { if (alive) leaveLineup(i); }, INTENT_MS);
      else leaveLineup(i);
    } else if (i !== current) {
      showPreview(i);
    }
    clearTimeout(prefetchTimer);
    if (how === 'pointer') prefetchTimer = setTimeout(() => prefetch(i), INTENT_MS);
    else prefetch(i);
  }

  function scheduleGrace() {
    if (opening) return;
    clearTimeout(graceTimer);
    clearTimeout(intentTimer);
    graceTimer = setTimeout(() => { if (alive && !overList) returnToLineup(false); }, GRACE_MS);
  }

  // The V4 nav and footer belong to this page, not to the case study: they fade with the list.
  const frameEls = () => [...document.querySelectorAll('.nav_component, .footer_component')];

  // The preview for row i at once: no fade, no roll (a click can land before the hover intent).
  function showNow(i) {
    clearTimeout(intentTimer);
    clearTimeout(graceTimer);
    state = 'browsing';
    current = i;
    mark(i);
    setLineupHidden(true);
    killFades();
    allPreviews().forEach((p) => gsap.set(p, { autoAlpha: p === items[i].preview ? 1 : 0 }));
    if (lineup) gsap.set(lineup, { autoAlpha: 0 });
  }

  // Open: the list slides away, the preview stage grows to fill the window so it reads as the opening of
  // the case study, the page fades to the case-study ground, then the (prefetched) project page loads.
  function open(i) {
    const it = items[i];
    if (!it || !it.row.getAttribute('href') || opening) return;
    if (state !== 'browsing' || current !== i) showNow(i);
    clearTimeout(intentTimer);
    clearTimeout(graceTimer);
    prefetch(i);
    const ground = it.row.getAttribute('data-ground') || caseGround();
    const fill = backdropOf(stage);
    opening = exitWith(() => {
      if (slatsBox) gsap.set(slatsBox, { autoAlpha: 0 }); // the preview's own strip shows the same image
      return expand(stage, { ground, fill, slide: [panel], fade: frameEls() });
    }, it.row.href, 'expand');
  }

  const isTouchy = (type) => type === 'touch' || type === 'pen';

  items.forEach((it, i) => {
    offs.on(it.row, 'pointerdown', (e) => { lastPointer = e.pointerType; lastPressAt = performance.now(); });
    offs.on(it.row, 'pointerenter', (e) => { if (e.pointerType === 'mouse') hover(i, 'pointer'); });
    offs.on(it.row, 'pointerleave', (e) => {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(intentTimer);
      clearTimeout(prefetchTimer);
    });
    offs.on(it.row, 'click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0) return; // new tab etc.
      e.preventDefault();
      const touch = isTouchy(lastPointer);
      lastPointer = '';
      // Touch: the first tap previews, a second tap on the same row opens it.
      if (touch && !(state === 'browsing' && current === i)) { hover(i, 'tap'); return; }
      open(i);
    });
  });

  if (list) {
    offs.on(list, 'pointerenter', (e) => {
      if (e.pointerType !== 'mouse') return;
      overList = true;
      clearTimeout(graceTimer);
    });
    offs.on(list, 'pointerleave', (e) => {
      if (e.pointerType !== 'mouse') return;
      overList = false;
      scheduleGrace();
    });
    // Keyboard focus behaves like hover. Focus that comes with a press is left to the pointer logic, or a
    // tap would preview and open in one go.
    offs.on(list, 'focusin', (e) => {
      if (performance.now() - lastPressAt < 600) return;
      const i = items.findIndex((it) => it.row === e.target || it.row.contains(e.target));
      if (i >= 0) hover(i, 'focus');
    });
    offs.on(list, 'focusout', (e) => {
      if (!list.contains(e.relatedTarget) && !overList) scheduleGrace();
    });
  }

  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => { if (state === 'browsing' && current >= 0) alignSlats(current); });
    ro.observe(stage);
  }

  // ---------- Start on the lineup ----------
  gsap.set(allPreviews(), { autoAlpha: 0 });
  allPreviews().forEach((p) => p.setAttribute('aria-hidden', 'true'));
  if (slatsBox) gsap.set(slatsBox, { autoAlpha: 0 });
  if (lineup) gsap.set(lineup, { autoAlpha: 1 });
  setLineupHidden(false);

  return {
    destroy() {
      alive = false;
      slatRun++;
      clearTimeout(intentTimer);
      clearTimeout(prefetchTimer);
      clearTimeout(graceTimer);
      offs.flush();
      if (ro) ro.disconnect();
    },
    // Back from a project page (back/forward cache): reverse the expand, then return to the lineup.
    restore(info) {
      overList = false;
      if (info && info.kind === 'expand' && opening) {
        opening = false;
        collapse(stage, { slide: [panel], fade: frameEls() }).then(() => { if (alive) returnToLineup(false); });
        return;
      }
      opening = false;
      returnToLineup(true);
    },
  };
}
