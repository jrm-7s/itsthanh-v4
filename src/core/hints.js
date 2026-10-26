// Small hint labels ("Hover a project to preview", "Scroll or drag to browse", "Scroll to read ↓").
// Script-built and styled in v4.css (.v4-hint), so Webflow needs no markup. Copy can be overridden with
// data-hint-* attributes on the page's panel. Hints are aria-hidden (they only describe pointer gestures; the
// rows are real links) and never take pointer events. A copy change is a quick fade (0.12 s out, 0.15 s in);
// under reduced motion it swaps at once.

import { gsap } from 'gsap';
import { reduced } from './env.js';

export const mqTouch = matchMedia('(hover: none)');
export const isTouch = () => mqTouch.matches;

/** Copy for `name`, from data-hint-<name>[-touch] on `panel`, else the default. */
export function copy(panel, name, fallback, touchFallback) {
  const touch = isTouch();
  const attr = (n) => (panel && panel.hasAttribute(`data-hint-${n}`) ? panel.getAttribute(`data-hint-${n}`) : null);
  if (touch) {
    const t = attr(`${name}-touch`);
    if (t !== null) return t;
    if (touchFallback !== undefined) return touchFallback;
  }
  const v = attr(name);
  return v !== null ? v : fallback;
}

export function makeHint(className = '') {
  const el = document.createElement('div');
  el.className = `v4-hint ${className}`.trim();
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('data-hint', '');
  const span = document.createElement('span');
  span.className = 'v4-hint_text';
  el.append(span);
  gsap.set(el, { autoAlpha: 0 });
  let text = '';

  /** Show `next` (empty hides). Returns true when it changed. */
  function set(next) {
    next = next || '';
    if (next === text) return false;
    const was = text;
    text = next;
    el.setAttribute('data-hint', next);
    gsap.killTweensOf([el, span]);
    if (reduced()) {
      if (next) span.textContent = next;
      gsap.set(span, { opacity: 1 });
      gsap.set(el, { autoAlpha: next ? 1 : 0 });
      return true;
    }
    if (!next) {
      gsap.to(el, { autoAlpha: 0, duration: 0.2, ease: 'power1.out' });
      return true;
    }
    if (!was || Number(gsap.getProperty(el, 'opacity')) < 0.05) {
      span.textContent = next;
      gsap.set(span, { opacity: 1 });
      gsap.to(el, { autoAlpha: 1, duration: 0.25, ease: 'power1.out' });
      return true;
    }
    gsap.set(el, { autoAlpha: 1 });
    gsap.timeline()
      .to(span, { opacity: 0, duration: 0.12, ease: 'power1.in', onComplete: () => { span.textContent = next; } })
      .to(span, { opacity: 1, duration: 0.15, ease: 'power1.out' });
    return true;
  }

  return {
    el,
    set,
    text: () => text,
    destroy() {
      gsap.killTweensOf([el, span]);
      el.remove();
    },
  };
}

const clockEl = () => document.querySelector('.footer_clock-time') || document.querySelector('.footer_clock');

/**
 * Desktop placement: inside `host` (positioned), right edge on `alignEl`'s right edge, baseline on the footer
 * clock's (same font size and line height, so equal bottoms mean equal baselines). Returns false when the clock
 * isn't beside the host (e.g. a stacked tablet layout), so the caller can use another placement.
 */
export function placeOnClock(el, host, alignEl) {
  const clock = clockEl();
  if (!clock || !host || !alignEl) return false;
  const hr = host.getBoundingClientRect();
  const cr = clock.getBoundingClientRect();
  const ar = alignEl.getBoundingClientRect();
  if (!cr.height || cr.top < hr.top || cr.bottom > hr.bottom || !ar.width) return false;
  const cs = getComputedStyle(clock);
  if (el.parentNode !== host) host.append(el);
  el.classList.remove('is-flow', 'is-centered');
  Object.assign(el.style, { position: 'absolute', top: 'auto', left: 'auto', fontSize: cs.fontSize, lineHeight: cs.lineHeight, transform: '' });
  // Offsets against whatever box the hint is positioned in (the panel, or an ancestor if the panel is static).
  const box = containingBox(el);
  el.style.right = `${Math.round(box.right - ar.right)}px`;
  el.style.bottom = `${Math.round((box.bottom - cr.bottom) * 100) / 100}px`;
  return true;
}

/** The padding box an absolutely positioned `el` is placed in, in viewport coordinates. */
function containingBox(el) {
  const op = el.offsetParent;
  if (!op || op === document.body || op === document.documentElement) {
    const d = document.documentElement;
    return { left: -window.scrollX, top: -window.scrollY, right: d.clientWidth - window.scrollX, bottom: Math.max(d.clientHeight, window.innerHeight) - window.scrollY };
  }
  const r = op.getBoundingClientRect();
  const s = getComputedStyle(op);
  return {
    left: r.left + parseFloat(s.borderLeftWidth || 0),
    top: r.top + parseFloat(s.borderTopWidth || 0),
    right: r.right - parseFloat(s.borderRightWidth || 0),
    bottom: r.bottom - parseFloat(s.borderBottomWidth || 0),
  };
}

/** In the flow, right after `after` (phones and stacked tablets). */
export function placeInFlow(el, after) {
  if (!after) return;
  if (after.nextSibling !== el) after.after(el);
  el.classList.add('is-flow');
  el.classList.remove('is-centered');
  Object.assign(el.style, { position: '', top: '', left: '', right: '', bottom: '', fontSize: '', lineHeight: '', transform: '' });
}

/** Centered horizontally on `cx` with its top at `top` (both viewport px), absolutely positioned inside `host`. */
export function placeCentered(el, host, cx, top) {
  if (el.parentNode !== host) host.append(el);
  el.classList.remove('is-flow');
  el.classList.add('is-centered');
  Object.assign(el.style, { position: 'absolute', right: 'auto', bottom: 'auto', fontSize: '', lineHeight: '', transform: 'translateX(-50%)' });
  const box = containingBox(el);
  el.style.left = `${Math.round(cx - box.left)}px`;
  el.style.top = `${Math.round(top - box.top)}px`;
}

export const footerTop = () => {
  const f = document.querySelector('.footer_component');
  if (!f) return window.innerHeight;
  // The footer box can be taller than its text; use the clock's top when there is one.
  const c = clockEl();
  return (c || f).getBoundingClientRect().top;
};
