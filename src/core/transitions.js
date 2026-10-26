// Page transitions between Home, Project and Archive (Barba same-document swaps), plus the "out" half used
// before a normal page load and the "in" half used when Back restores a page from the back/forward cache.
//
// Four variants, chosen by data-v4-transition on .page-wrapper (default "glide"); ?t=<name> in the URL
// overrides it on load. Direction follows the nav order: forward = toward Archive, back = toward Home.
// The nav, footer and frame never move. Under reduced motion every variant is a 0.2 s crossfade.
//
//   glide     the old page drifts 2.5% toward the exit side and fades (0.45 s, power2.in); the new one
//             starts 2.5% from the other side and settles (0.65 s, expo.out), overlapping by 0.15 s.
//   veil      a soft lavender veil wipes up over the content (0.5 s, power3.inOut), the page swaps
//             underneath, then the veil carries on up and off (0.55 s). Back runs it downward.
//   turn      a restrained page turn: up to 16° rotateY at 2400 px perspective, with a slight drift and
//             fade (0.7 s, power3.inOut) and a light shadow at the hinge.
//   dissolve  a crossfade with up to 4 px blur and 0.985 scale (0.5 s).

import { gsap } from 'gsap';
import { reduced } from './env.js';

export const VARIANTS = ['glide', 'veil', 'turn', 'dissolve'];
export const DEFAULT_VARIANT = 'glide';

const PAGE_PROPS = 'position,top,left,width,margin,zIndex,transform,transformOrigin,opacity,visibility,filter,willChange,pointerEvents';
const wrapperEl = () => document.querySelector('[data-barba="wrapper"]');
const shadowEl = () => document.querySelector('.page-flip_shadow');

/** The variant in effect: data-v4-transition on the wrapper, else the default. */
export function variantName() {
  const w = wrapperEl();
  const v = w ? w.getAttribute('data-v4-transition') : null;
  return VARIANTS.includes(v) ? v : DEFAULT_VARIANT;
}

/** ?t=<name> overrides the variant for review. The wrapper persists across Barba swaps, so it sticks. */
export function applyVariantParam() {
  let t = null;
  try { t = new URLSearchParams(window.location.search).get('t'); } catch (e) { /* no URL API */ }
  const w = wrapperEl();
  if (w && t && VARIANTS.includes(t)) w.setAttribute('data-v4-transition', t);
}

/** Pin a container where it currently appears, so the window can jump to the top underneath it. */
export function freeze(el) {
  const r = el.getBoundingClientRect();
  gsap.set(el, { position: 'fixed', top: r.top, left: r.left, width: r.width, margin: 0, pointerEvents: 'none' });
}

export function clearPage(el) {
  if (el) gsap.set(el, { clearProps: PAGE_PROPS });
}

export function hideShadow() {
  const sh = shadowEl();
  if (sh) {
    gsap.killTweensOf(sh);
    gsap.set(sh, { clearProps: 'all' });
  }
}

function veilEl() {
  let v = document.querySelector('.v4-veil');
  if (!v) {
    v = document.createElement('div');
    v.className = 'v4-veil';
    v.setAttribute('aria-hidden', 'true');
    (wrapperEl() || document.body).append(v);
  }
  return v;
}

export function hideVeil() {
  const v = document.querySelector('.v4-veil');
  if (v) {
    gsap.killTweensOf(v);
    gsap.set(v, { clearProps: 'all' });
  }
}

/** Origin at the viewport's vertical center (and the given x), wherever the element sits. */
const originAt = (el, x) => `${x} ${window.innerHeight / 2 - el.getBoundingClientRect().top}px`;

const timeline = (resolve) => gsap.timeline({ onComplete: resolve });

// ---------- Reduced motion: a 0.2 s crossfade for every variant ----------
const fade = {
  swap(from, to, dir, tl) {
    tl.to(from, { opacity: 0, duration: 0.2, ease: 'none' }, 0)
      .fromTo(to, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: 'none' }, 0);
  },
  out(el, dir, tl) { tl.to(el, { opacity: 0, duration: 0.2, ease: 'none' }); },
  in(el, dir, tl) { tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: 'none' }); },
};

// ---------- glide ----------
const DRIFT = 2.5;
const glide = {
  swap(from, to, dir, tl) {
    gsap.set(to, { opacity: 0 });
    tl.to(from, { xPercent: -DRIFT * dir, opacity: 0, duration: 0.45, ease: 'power2.in' }, 0)
      .fromTo(to, { xPercent: DRIFT * dir, opacity: 0 }, { xPercent: 0, opacity: 1, duration: 0.65, ease: 'expo.out' }, 0.3);
  },
  out(el, dir, tl) { tl.to(el, { xPercent: -DRIFT * dir, opacity: 0, duration: 0.45, ease: 'power2.in' }); },
  in(el, dir, tl) { tl.fromTo(el, { xPercent: DRIFT * dir, opacity: 0 }, { xPercent: 0, opacity: 1, duration: 0.65, ease: 'expo.out' }); },
};

// ---------- veil ----------
// Forward: rises from the bottom, then carries on up and off. Back: the same, downward.
const CLIP = { full: 'inset(0% 0% 0% 0%)', below: 'inset(100% 0% 0% 0%)', above: 'inset(0% 0% 100% 0%)' };
const veil = {
  cover(dir, tl) {
    const v = veilEl();
    gsap.killTweensOf(v);
    gsap.set(v, { display: 'block', clipPath: dir > 0 ? CLIP.below : CLIP.above });
    tl.to(v, { clipPath: CLIP.full, duration: 0.5, ease: 'power3.inOut' });
  },
  uncover(dir, tl, at) {
    const v = veilEl();
    tl.set(v, { display: 'block' }, at)
      .to(v, { clipPath: dir > 0 ? CLIP.above : CLIP.below, duration: 0.55, ease: 'power3.inOut' }, at)
      .set(v, { clearProps: 'all' });
  },
  swap(from, to, dir, tl) {
    this.cover(dir, tl);
    tl.set(from, { autoAlpha: 0 });
    const at = tl.duration();
    this.uncover(dir, tl, at);
    tl.fromTo(to, { y: 16 * dir }, { y: 0, duration: 0.6, ease: 'expo.out' }, at);
  },
  out(el, dir, tl) { this.cover(dir, tl); },
  in(el, dir, tl) {
    const v = veilEl();
    if (getComputedStyle(v).display === 'none') gsap.set(v, { display: 'block', clipPath: CLIP.full });
    this.uncover(dir, tl, 0);
    tl.fromTo(el, { y: 16 * dir }, { y: 0, duration: 0.6, ease: 'expo.out' }, 0);
  },
};

// ---------- turn ----------
const TURN = { angle: 16, perspective: 2400, duration: 0.7, ease: 'power3.inOut' };
function shade(tl, at) {
  const sh = shadowEl();
  if (!sh) return;
  gsap.set(sh, { position: 'fixed', top: 0, left: 0, width: '100%', height: '100vh', zIndex: 2, x: 0, opacity: 0, pointerEvents: 'none' });
  tl.to(sh, { opacity: 0.35, duration: TURN.duration / 2, ease: 'sine.out' }, at)
    .to(sh, { opacity: 0, duration: TURN.duration / 2, ease: 'sine.in' }, at + TURN.duration / 2);
}
const turn = {
  prep(el) {
    gsap.set(el, { transformPerspective: TURN.perspective, transformOrigin: originAt(el, '0px'), willChange: 'transform, opacity' });
  },
  swap(from, to, dir, tl) {
    if (dir > 0) {
      // The old page turns away on its left hinge and fades; the new one settles in underneath.
      gsap.set(from, { zIndex: 3 });
      this.prep(from);
      shade(tl, 0);
      tl.to(from, { rotationY: -TURN.angle, xPercent: -2, opacity: 0, duration: TURN.duration, ease: TURN.ease }, 0)
        .fromTo(to, { opacity: 0, xPercent: 1.5 }, { opacity: 1, xPercent: 0, duration: 0.55, ease: 'power3.out' }, 0.2);
    } else {
      // Back: the new page turns in on top, from the left; the old one fades underneath.
      gsap.set(to, { zIndex: 3 });
      this.prep(to);
      shade(tl, 0);
      tl.to(from, { opacity: 0, xPercent: 1.5, duration: 0.5, ease: 'power3.in' }, 0)
        .fromTo(to, { rotationY: -TURN.angle, xPercent: -2, opacity: 0 }, { rotationY: 0, xPercent: 0, opacity: 1, duration: TURN.duration, ease: TURN.ease }, 0);
    }
  },
  out(el, dir, tl) {
    this.prep(el);
    shade(tl, 0);
    tl.to(el, { rotationY: -TURN.angle, xPercent: -2, opacity: 0, duration: TURN.duration, ease: TURN.ease }, 0);
  },
  in(el, dir, tl) {
    this.prep(el);
    shade(tl, 0);
    tl.fromTo(el, { rotationY: -TURN.angle, xPercent: -2, opacity: 0 }, { rotationY: 0, xPercent: 0, opacity: 1, duration: TURN.duration, ease: TURN.ease }, 0);
  },
};

// ---------- dissolve ----------
const SOFT = { opacity: 0, filter: 'blur(4px)', scale: 0.985 };
const SHARP = { opacity: 1, filter: 'blur(0px)', scale: 1 };
const dissolve = {
  // The scale leans toward the direction of travel.
  swap(from, to, dir, tl) {
    gsap.set(from, { transformOrigin: originAt(from, dir > 0 ? '0%' : '100%') });
    gsap.set(to, { transformOrigin: originAt(to, dir > 0 ? '100%' : '0%') });
    tl.to(from, { ...SOFT, duration: 0.5, ease: 'power2.inOut' }, 0)
      .fromTo(to, SOFT, { ...SHARP, duration: 0.5, ease: 'power2.inOut' }, 0);
  },
  out(el, dir, tl) { tl.to(el, { ...SOFT, duration: 0.5, ease: 'power2.inOut' }); },
  in(el, dir, tl) { tl.fromTo(el, SOFT, { ...SHARP, duration: 0.5, ease: 'power2.inOut' }); },
};

const IMPL = { glide, veil, turn, dissolve };
const impl = () => (reduced() ? fade : IMPL[variantName()]);

/** Barba swap. `from` must already be frozen; `to` sits in flow at the top. dir: 1 forward, -1 back. */
export function swapPages({ from, to, dir }) {
  return new Promise((resolve) => {
    const d = dir >= 0 ? 1 : -1;
    gsap.set(from, { zIndex: 2 });
    gsap.set(to, { position: 'relative', zIndex: 1 });
    const tl = timeline(() => { hideShadow(); hideVeil(); resolve(); });
    impl().swap(from, to, d, tl);
  });
}

/** Before a normal page load: the current page leaves the same way. */
export function leavePage(el, dir = 1) {
  return new Promise((resolve) => {
    if (!el) { resolve(); return; }
    gsap.set(el, { position: 'relative', zIndex: 3 });
    const tl = timeline(resolve);
    impl().out(el, dir >= 0 ? 1 : -1, tl);
  });
}

/** Back from the cache: the page comes back in, the reverse way. */
export function enterPage(el, dir = -1) {
  return new Promise((resolve) => {
    if (!el) { resolve(); return; }
    gsap.set(el, { position: 'relative', zIndex: 3 });
    const tl = timeline(() => { clearPage(el); hideShadow(); hideVeil(); resolve(); });
    impl().in(el, dir >= 0 ? 1 : -1, tl);
  });
}
