// "Expand": how a project or an archive entry opens. Instead of the page transition, the element that
// previews the destination (the Project preview stage, the Archive cover) grows to fill the window, the
// list slides away, and the last moment fades the whole page to the destination's ground colour; then
// the browser loads the page. collapse() is the exact reverse, for a back/forward-cache restore.
//
// The element is pinned with position:fixed at its current rect and its box animates to the viewport
// (top/left/width/height rather than a scale transform), so text and images stay crisp and the content
// re-lays out the way the full-width page will. Total 0.84 s.

import { gsap } from 'gsap';
import { reduced } from './env.js';

export const CASE_GROUND = '#f7f5f0'; // the cream behind the LFLA-layout case-study pages
const GROW = 0.7;
const GROUND_AT = 0.62;
const GROUND_FOR = 0.22;
const Z = 95; // above the page, below the nav and footer (100)
const BOX = 'position,top,left,width,height,margin,zIndex,borderRadius,backgroundColor,transform';

function groundEl() {
  let g = document.querySelector('.v4-ground');
  if (!g) {
    g = document.createElement('div');
    g.className = 'v4-ground';
    g.setAttribute('aria-hidden', 'true');
    document.body.append(g);
  }
  return g;
}

const viewport = () => ({ top: 0, left: 0, width: document.documentElement.clientWidth, height: window.innerHeight });

/** The ground colour a page wants to fade to: --v4-case-ground (v4.css), else the cream. */
export function caseGround() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--v4-case-ground').trim();
  return v || CASE_GROUND;
}

/** The first opaque background behind an element, so pinning it changes nothing visually. */
export function backdropOf(el) {
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const c = getComputedStyle(n).backgroundColor;
    if (c && c !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(c)) return c;
  }
  return '#ffffff';
}

const list = (a) => (a || []).filter(Boolean);

export function expand(el, { ground = CASE_GROUND, fill = null, slide, fade } = {}) {
  const slideEls = list(slide);
  const fadeEls = list(fade);
  return new Promise((resolve) => {
    const g = groundEl();
    gsap.killTweensOf([el, g, ...slideEls, ...fadeEls]);
    gsap.set(g, { display: 'block', backgroundColor: ground, opacity: 0 });
    if (reduced()) {
      gsap.to(g, { opacity: 1, duration: 0.2, ease: 'none', onComplete: resolve });
      return;
    }
    const r = el.getBoundingClientRect();
    el.__v4Expanded = true;
    gsap.set(el, {
      position: 'fixed', top: r.top, left: r.left, width: r.width, height: r.height, margin: 0,
      x: 0, y: 0, xPercent: 0, yPercent: 0, zIndex: Z,
      ...(fill ? { backgroundColor: fill } : {}),
    });
    const tl = gsap.timeline({ onComplete: resolve });
    if (slideEls.length) tl.to(slideEls, { xPercent: -12, opacity: 0, duration: 0.5, ease: 'power3.in' }, 0);
    if (fadeEls.length) tl.to(fadeEls, { opacity: 0, duration: 0.35, ease: 'power1.out' }, 0);
    tl.to(el, { ...viewport(), borderRadius: 0, duration: GROW, ease: 'power3.inOut' }, 0)
      .to(g, { opacity: 1, duration: GROUND_FOR, ease: 'power1.in' }, GROUND_AT);
  });
}

export function collapse(el, { slide, fade } = {}) {
  const slideEls = list(slide);
  const fadeEls = list(fade);
  return new Promise((resolve) => {
    const g = document.querySelector('.v4-ground');
    const finish = () => {
      gsap.set(el, { clearProps: BOX });
      if (slideEls.length || fadeEls.length) gsap.set([...slideEls, ...fadeEls], { clearProps: 'opacity,transform' });
      if (g) gsap.set(g, { clearProps: 'all' });
      el.__v4Expanded = false;
      resolve();
    };
    gsap.killTweensOf([el, ...slideEls, ...fadeEls]);
    if (g) gsap.killTweensOf(g);
    if (reduced() || !el.__v4Expanded) {
      gsap.set(el, { clearProps: BOX });
      if (slideEls.length || fadeEls.length) gsap.set([...slideEls, ...fadeEls], { clearProps: 'opacity,transform' });
      if (g) gsap.to(g, { opacity: 0, duration: 0.2, ease: 'none', onComplete: finish });
      else finish();
      return;
    }
    // Where does it belong in the layout? Measure with the inline box off, then pin it full-window again.
    const fill = el.style.backgroundColor;
    gsap.set(el, { clearProps: BOX });
    const r = el.getBoundingClientRect();
    const radius = getComputedStyle(el).borderRadius;
    gsap.set(el, {
      position: 'fixed', ...viewport(), margin: 0, x: 0, y: 0, xPercent: 0, yPercent: 0, zIndex: Z, borderRadius: 0,
      ...(fill ? { backgroundColor: fill } : {}),
    });
    const tl = gsap.timeline({ onComplete: finish });
    if (g) tl.to(g, { opacity: 0, duration: 0.25, ease: 'power1.out' }, 0);
    tl.to(el, { top: r.top, left: r.left, width: r.width, height: r.height, borderRadius: radius, duration: 0.6, ease: 'power3.inOut' }, 0.1);
    if (slideEls.length) tl.to(slideEls, { xPercent: 0, opacity: 1, duration: 0.5, ease: 'power3.out' }, 0.35);
    if (fadeEls.length) tl.to(fadeEls, { opacity: 1, duration: 0.35, ease: 'power1.out' }, 0.45);
  });
}
