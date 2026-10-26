// The page flip: the main-wrapper turns like a book page hinged on its left edge, while .page-flip_shadow
// sweeps across the page underneath. Forward in nav order turns right to left (the current page lifts away
// and reveals the next one); back turns left to right (the next page swings in on top). One GSAP tween,
// 0.9 s power2.inOut. Under reduced motion it is a 0.2 s crossfade.

import { gsap } from 'gsap';
import { reduced } from './env.js';

export const FLIP = {
  duration: 0.9,
  ease: 'power2.inOut',
  // Past 90° the page is edge-on and its back face is hidden, so a little overshoot lets the last sliver
  // disappear while it is still moving instead of creeping into the hinge.
  angle: 100,
};

const PAGE_PROPS = 'position,top,left,width,margin,zIndex,transform,transformOrigin,opacity,backfaceVisibility,willChange,pointerEvents';

const shadowEl = () => document.querySelector('.page-flip_shadow');

/** Deep, gentle perspective: the page lifts toward the viewer without ballooning. */
const perspectiveFor = () => Math.max(1800, window.innerWidth * 3);

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

function prepShadow(z) {
  const sh = shadowEl();
  if (sh) gsap.set(sh, { position: 'fixed', top: 0, left: 0, width: '100%', height: '100vh', zIndex: z, x: 0, opacity: 0, pointerEvents: 'none' });
  return sh;
}

/** Hinge on the left edge at the viewport's vertical center, wherever the element sits. */
function prepTurn(el) {
  const P = perspectiveFor();
  const top = el.getBoundingClientRect().top;
  gsap.set(el, {
    transformPerspective: P,
    transformOrigin: `0px ${window.innerHeight / 2 - top}px`,
    backfaceVisibility: 'hidden',
    willChange: 'transform',
  });
  return P;
}

/**
 * The shadow's dark edge follows the turning page's projected outer edge, and it is strongest mid-turn.
 * For a page of width W rotated by a toward the viewer, the outer edge projects to W·cos a · P / (P − W·sin a).
 */
function shader(turning, sh, P) {
  if (!sh) return () => {};
  const left = turning.getBoundingClientRect().left;
  const W = turning.offsetWidth || window.innerWidth;
  return () => {
    const deg = Math.abs(gsap.getProperty(turning, 'rotationY'));
    const a = (Math.min(deg, 90) * Math.PI) / 180;
    const edge = deg >= 90 ? 0 : Math.min(window.innerWidth, (W * Math.cos(a) * P) / (P - W * Math.sin(a)));
    gsap.set(sh, { x: left + edge, opacity: Math.sin(a * 2) });
  };
}

function turn(el, from, to, onDone) {
  const P = prepTurn(el);
  const sh = prepShadow(2);
  const shade = shader(el, sh, P);
  gsap.fromTo(el, { rotationY: from }, {
    rotationY: to,
    duration: FLIP.duration,
    ease: FLIP.ease,
    onUpdate: shade,
    onComplete: onDone,
  });
  shade();
}

/** Barba page-to-page flip. `from` must already be frozen; `to` sits in flow at the top. */
export function flipPages({ from, to, dir }) {
  return new Promise((resolve) => {
    if (reduced()) {
      gsap.set(from, { zIndex: 2 });
      gsap.set(to, { position: 'relative', zIndex: 1 });
      gsap.timeline({ onComplete: resolve })
        .to(from, { opacity: 0, duration: 0.2, ease: 'none' }, 0)
        .fromTo(to, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: 'none' }, 0);
      return;
    }
    const forward = dir >= 0;
    const turning = forward ? from : to;
    const under = forward ? to : from;
    gsap.set(under, { zIndex: 1 });
    if (under === to) gsap.set(to, { position: 'relative' });
    gsap.set(turning, { zIndex: 3 });
    if (turning === to) gsap.set(to, { position: 'relative' });
    const done = () => { hideShadow(); resolve(); };
    if (forward) turn(turning, 0, -FLIP.angle, done);
    else turn(turning, -FLIP.angle, 0, done);
  });
}

/** Turn the current page away (right to left) before a normal page load. */
export function flipOut(el) {
  return new Promise((resolve) => {
    if (!el) { resolve(); return; }
    if (reduced()) {
      gsap.to(el, { opacity: 0, duration: 0.2, ease: 'none', onComplete: resolve });
      return;
    }
    gsap.set(el, { position: 'relative', zIndex: 3 });
    turn(el, 0, -FLIP.angle, resolve);
  });
}

/** Turn the current page back in (left to right), e.g. after Back restores it from the back/forward cache. */
export function flipIn(el) {
  return new Promise((resolve) => {
    if (!el) { resolve(); return; }
    const done = () => { clearPage(el); hideShadow(); resolve(); };
    if (reduced()) {
      gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: 'none', onComplete: done });
      return;
    }
    gsap.set(el, { position: 'relative', zIndex: 3 });
    turn(el, -FLIP.angle, 0, done);
  });
}
