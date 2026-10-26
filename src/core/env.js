// Small shared helpers: media queries, root size, easing, DOM shortcuts.

export const html = document.documentElement;
export const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
export const mqMobile = matchMedia('(max-width: 767px)');
export const reduced = () => mqReduce.matches;
export const isMobile = () => mqMobile.matches;

/** Current root font size in px (the desktop rem scales with the viewport). */
export const rootRem = () => parseFloat(getComputedStyle(html).fontSize) || 16;

export const pad = (n, w = 2) => String(n).padStart(w, '0');
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Subscribe to a MediaQueryList change; returns an unsubscribe function. */
export function onMQ(mq, fn) {
  if (mq.addEventListener) {
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }
  mq.addListener(fn);
  return () => mq.removeListener(fn);
}

/** addEventListener that returns its own remover. */
export function listen(target, type, fn, opts) {
  target.addEventListener(type, fn, opts);
  return () => target.removeEventListener(type, fn, opts);
}

/** Collects cleanup functions so a page module can tear down in one call. */
export function bag() {
  const fns = [];
  return {
    add(fn) { fns.push(fn); return fn; },
    on(target, type, fn, opts) { fns.push(listen(target, type, fn, opts)); return fn; },
    flush() { while (fns.length) { try { fns.pop()(); } catch (e) { /* already gone */ } } },
  };
}

/**
 * CSS cubic-bezier() as a GSAP ease function, so GSAP tweens can use the exact curves from the demos
 * (which were written as CSS transitions) without pulling in CustomEase.
 */
export function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-6) return sy(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = x;
    while (hi - lo > 1e-7) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (x > v) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

/** Relative luminance of a #rgb / #rrggbb color (WCAG formula). */
export function luminance(hex) {
  let h = String(hex || '').trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return 1;
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
