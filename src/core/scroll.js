// Lenis smooth scroll on GSAP's ticker, so scrolling and animation share one clock.
// Off under reduced motion (native scroll), and it follows the setting if it changes at runtime.

import Lenis from 'lenis';
import { gsap } from 'gsap';
import { mqReduce, onMQ } from './env.js';

let lenis = null;
let locked = false;

const raf = (time) => { if (lenis) lenis.raf(time * 1000); };

function create() {
  if (lenis) return;
  lenis = new Lenis({
    lerp: 0.1,          // Lenis default glide
    anchors: true,      // anchor links glide too
    smoothWheel: true,
    syncTouch: false,   // phones keep their native touch scrolling and momentum
    autoRaf: false,     // driven by gsap.ticker below
  });
  if (locked) lenis.stop();
}

function destroy() {
  if (!lenis) return;
  lenis.destroy();
  lenis = null;
}

export function initScroll() {
  gsap.ticker.lagSmoothing(0);
  gsap.ticker.add(raf);
  if (!mqReduce.matches) create();
  onMQ(mqReduce, () => (mqReduce.matches ? destroy() : create()));
}

export const getLenis = () => lenis;

/** Pause scrolling (page transitions, the expand, the preloader). */
export function lockScroll() {
  locked = true;
  if (lenis) lenis.stop();
}

export function unlockScroll() {
  locked = false;
  if (lenis) { lenis.start(); lenis.resize(); }
}

/** Jump to the top immediately, even while locked. */
export function scrollToTop() {
  if (lenis) lenis.scrollTo(0, { immediate: true, force: true });
  window.scrollTo(0, 0);
}
