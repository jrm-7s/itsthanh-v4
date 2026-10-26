// The page ground reaches the screen edges: html and body take the current page's ground colour, and
// <meta name="theme-color"> follows it, so the areas around the page (under the status bar and the browser's
// toolbars, the overscroll bounce) match instead of showing white. Each page starts from its first section's
// background; the Archive then follows its cover colour.

import { gsap } from 'gsap';
import { html } from './env.js';

let meta = null;

const clear = (c) => !c || c === 'transparent' || /rgba\([^)]*,\s*0(\.0+)?\)$/.test(c);

function toHex(c) {
  const m = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(c || '');
  if (!m) return c;
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
}

function themeMeta() {
  if (!meta || !meta.isConnected) {
    meta = document.querySelector('meta[name="theme-color"]:not([media])');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      document.head.append(meta);
    }
  }
  return meta;
}

/** The ground of a page container: its first painted section, else the container, else white. */
export function groundOf(container) {
  if (!container) return '#ffffff';
  const first = container.querySelector('[data-v4-ground], section, [class*="section_"]');
  for (const el of [first, container, container.firstElementChild]) {
    if (!el) continue;
    const c = getComputedStyle(el).backgroundColor;
    if (!clear(c)) return c;
  }
  return '#ffffff';
}

/** Set (or tween, over `duration` s) the edge colour. The theme colour goes straight to the target. */
export function setGround(color, duration = 0, ease = 'none') {
  if (!color) return;
  const targets = [html, document.body].filter(Boolean);
  gsap.killTweensOf(targets, 'backgroundColor');
  if (duration > 0) gsap.to(targets, { backgroundColor: color, duration, ease });
  else gsap.set(targets, { backgroundColor: color });
  themeMeta().setAttribute('content', toHex(color));
}
