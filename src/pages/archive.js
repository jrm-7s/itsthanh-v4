// Archive: the camera-dial list. The chosen row always sits on the wrapper's center line and the list
// moves under it; rows blur and fade by distance; the page color follows the cover.
// Ported from archive-page-demo.html (outline labels + fade cover).

import { gsap } from 'gsap';
import { Observer } from 'gsap/Observer';
import { reduced, isMobile, bag, bezier, clamp, luminance, pad } from '../core/env.js';
import { navigate } from '../core/router.js';

const K = 320;            // spring stiffness
const C = 30;             // spring damping
const SUBSTEPS = 4;
const NOTCH = 60;         // wheel deltas this large are one mouse notch = one row
const TRACKPAD_GAIN = 0.55;
const SNAP_IDLE_MS = 110; // trackpad: snap once the wheel goes quiet
const PROJECT_S = 0.16;   // release: project this much of the fling velocity
const FLING_KEEP = 0.6;   // …and keep this much of it in the spring
// Webflow outputs the V4 collection variable as --_v4---archive-bg; --archive-bg is the contract's name.
const BG_VARS = ['--_v4---archive-bg', '--archive-bg'];
const colorEase = bezier(0.4, 0, 0.2, 1);
const coverEase = bezier(0.2, 0.7, 0.2, 1);

export default function archive(container) {
  const section = container.querySelector('[data-archive="bg"]');
  const wrap = container.querySelector('[data-archive="list"]');
  const list = wrap ? wrap.querySelector('.archive_list') || wrap.firstElementChild : null;
  const rows = wrap ? [...wrap.querySelectorAll('[data-archive="row"]')] : [];
  const N = rows.length;
  if (!wrap || !list || !N) return {};
  const covers = [...container.querySelectorAll('[data-archive="covers"] [data-slug]')];
  const counter = container.querySelector('[data-archive="counter"]');
  const pageWrap = document.querySelector('[data-barba="wrapper"]') || document.querySelector('.page-wrapper');
  const offs = bag();

  let centers = [];
  let pitch = 1;
  let mid = 0;
  let pos = 0;       // continuous position, in rows
  let vel = 0;       // rows per second
  let target = 0;
  let sel = -1;
  let springOn = false;
  let snapTimer = 0;
  let wheelAcc = 0;
  let dragStart = 0;
  let pressTarget = -1;
  let suppressClickUntil = 0;
  const MIN_P = -0.55;
  const MAX_P = N - 1 + 0.55;

  // ---------- Geometry (rows keep their Webflow layout; only the list is translated) ----------
  function measure() {
    const lr = list.getBoundingClientRect();
    centers = rows.map((r) => {
      const b = r.getBoundingClientRect();
      return b.top - lr.top + b.height / 2;
    });
    pitch = N > 1 ? (centers[N - 1] - centers[0]) / (N - 1) : rows[0].offsetHeight;
    if (!(pitch > 0)) pitch = rows[0].offsetHeight || 1;
    mid = wrap.clientHeight / 2;
  }

  function pxAt(p) {
    if (N === 1 || p <= 0) return centers[0] + p * pitch;
    if (p >= N - 1) return centers[N - 1] + (p - (N - 1)) * pitch;
    const i = Math.floor(p);
    return centers[i] + (centers[i + 1] - centers[i]) * (p - i);
  }

  // ---------- Counter: rolling digits ----------
  const reels = [];
  let counterText = null;
  (function buildCounter() {
    if (!counter) return;
    const width = Math.max(2, String(N).length);
    const total = counter.querySelector('.archive_counter-total');
    if (total) total.textContent = ` / ${pad(N, width)}`;
    const cur = counter.querySelector('.archive_counter-current');
    if (!cur) return;
    cur.textContent = '';
    counterText = document.createElement('span');
    counterText.className = 'v4-sr-only';
    cur.append(counterText);
    for (let k = 0; k < width; k++) {
      const mask = document.createElement('span');
      mask.className = 'archive_counter-digit';
      mask.setAttribute('aria-hidden', 'true');
      const reel = document.createElement('span');
      reel.className = 'archive_counter-reel';
      for (let n = 0; n < 10; n++) {
        const d = document.createElement('span');
        d.textContent = String(n);
        reel.append(d);
      }
      mask.append(reel);
      cur.append(mask);
      reels.push(reel);
    }
  })();

  function setCounter(n) {
    const s = pad(n, reels.length || 2);
    reels.forEach((reel, k) => reel.style.setProperty('--n', s[k]));
    if (counterText) counterText.textContent = s;
  }

  // ---------- Color, ink and cover ----------
  function setColor(color, instant) {
    if (!color) return;
    if (pageWrap) pageWrap.setAttribute('data-ink', luminance(color) > 0.42 ? 'dark' : 'light');
    if (!section) return;
    const vars = {};
    BG_VARS.forEach((v) => { vars[v] = color; });
    if (instant) gsap.set(section, vars);
    else gsap.to(section, { ...vars, duration: 0.7, ease: colorEase, overwrite: true });
  }

  let coverShown = null;
  let coverZ = 1;
  function setCover(i, instant) {
    const slug = rows[i].getAttribute('data-slug');
    const c = covers.find((el) => el.getAttribute('data-slug') === slug);
    if (!c || c === coverShown) return;
    covers.forEach((el) => el.classList.toggle('is-active', el === c));
    if (instant || reduced()) {
      covers.forEach((el) => {
        gsap.killTweensOf(el);
        gsap.set(el, { opacity: el === c ? 1 : 0, scale: 1, zIndex: el === c ? 1 : 0 });
      });
      coverZ = 1;
      coverShown = c;
      return;
    }
    if (coverZ > 900) {
      covers.forEach((el) => gsap.set(el, { zIndex: el === coverShown ? 1 : 0 }));
      coverZ = 1;
    }
    coverZ += 1;
    gsap.killTweensOf(c);
    gsap.set(c, { zIndex: coverZ });
    gsap.fromTo(c, { opacity: 0, scale: 1.03 }, {
      opacity: 1,
      scale: 1,
      duration: 0.32,
      ease: coverEase,
      onComplete: () => {
        if (coverShown !== c) return;
        covers.forEach((el) => { if (el !== c) gsap.set(el, { opacity: 0 }); });
      },
    });
    coverShown = c;
  }

  function select(i, first) {
    sel = i;
    rows.forEach((r, k) => {
      r.classList.toggle('is-active', k === i);
      const link = r.querySelector('.archive_link');
      if (link) {
        if (k === i) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      }
    });
    setCounter(i + 1);
    setColor(rows[i].getAttribute('data-color'), first);
    setCover(i, first);
  }

  // ---------- Render: translate the list, blur and fade rows by distance ----------
  function render() {
    list.style.transform = `translate3d(0, ${(mid - pxAt(pos)).toFixed(2)}px, 0)`;
    const mobile = isMobile();
    const rm = reduced();
    // Reduced motion: blur follows the selection only, so it never animates.
    const ref = rm ? clamp(Math.round(pos), 0, N - 1) : pos;
    rows.forEach((el, i) => {
      const d = Math.abs(i - ref);
      if (d > 5) { el.style.visibility = 'hidden'; return; }
      el.style.visibility = '';
      let blur = d < 0.45 ? 0 : Math.min(7, (d - 0.45) * 2.3);
      if (mobile && blur > 0) blur = 4; // phones: two steps only
      el.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : '';
      el.style.opacity = Math.max(0.14, 1 - d * 0.2).toFixed(3);
    });
    const now = clamp(Math.round(pos), 0, N - 1);
    if (now !== sel) select(now, sel < 0);
  }

  // ---------- Spring (K 320, C 30) on gsap.ticker ----------
  function step(time, deltaMs) {
    const dt = Math.min(0.032, (deltaMs || 16) / 1000);
    const h = dt / SUBSTEPS;
    for (let k = 0; k < SUBSTEPS; k++) {
      const a = -K * (pos - target) - C * vel;
      vel += a * h;
      pos += vel * h;
    }
    render();
    if (Math.abs(pos - target) < 0.2 / pitch && Math.abs(vel) < 2 / pitch) {
      pos = target;
      vel = 0;
      render();
      stopSpring();
    }
  }
  function startSpring() {
    if (springOn) return;
    springOn = true;
    gsap.ticker.add(step);
  }
  function stopSpring() {
    if (!springOn) return;
    springOn = false;
    gsap.ticker.remove(step);
  }
  function goTo(i) {
    target = clamp(Math.round(i), 0, N - 1);
    if (reduced()) {
      stopSpring();
      pos = target;
      vel = 0;
      render();
      return;
    }
    startSpring();
  }

  function open(i) {
    const a = rows[i] && rows[i].querySelector('a[href]');
    if (a) navigate(a.href); // rows without a page never open
  }

  // ---------- Input: GSAP Observer for wheel, trackpad, touch and drag ----------
  function onWheel(self) {
    const e = self.event;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * window.innerHeight : e.deltaY;
    if (!dy) return;
    const notch = e.deltaMode !== 0 || Math.abs(dy) >= NOTCH;
    if (reduced()) {
      wheelAcc = notch ? 0 : wheelAcc + dy;
      if (notch || Math.abs(wheelAcc) >= NOTCH) {
        goTo(Math.round(target) + Math.sign(notch ? dy : wheelAcc));
        wheelAcc = 0;
      }
      clearTimeout(snapTimer);
      snapTimer = setTimeout(() => { wheelAcc = 0; }, 160);
      return;
    }
    if (notch) { goTo(Math.round(target) + Math.sign(dy)); return; }
    // Trackpad: move freely, then snap to the nearest row.
    stopSpring();
    vel = 0;
    pos = clamp(pos + (dy * TRACKPAD_GAIN) / pitch, MIN_P, MAX_P);
    target = pos;
    render();
    clearTimeout(snapTimer);
    snapTimer = setTimeout(() => goTo(pos), SNAP_IDLE_MS);
  }

  const observer = Observer.create({
    target: wrap,
    type: 'wheel,touch,pointer',
    preventDefault: true,
    debounce: false,   // onWheel runs inside the event, so each notch is seen on its own
    dragMinimum: 3,
    // At either end, the wheel passes through to page scroll (short screens).
    ignoreCheck: (e) => {
      if (e.type !== 'wheel') return false;
      const at = Math.round(target);
      return (e.deltaY < 0 && at <= 0 && pos <= 0.01) || (e.deltaY > 0 && at >= N - 1 && pos >= N - 1.01);
    },
    onWheel,
    onPress: () => {
      stopSpring();
      vel = 0;
      dragStart = pos;
      pressTarget = Math.round(target);
    },
    onDrag: (self) => {
      pos = clamp(dragStart - (self.y - self.startY) / pitch, MIN_P, MAX_P);
      target = pos;
      render();
    },
    onRelease: (self, dragged) => {
      if (!dragged) {
        if (!reduced()) startSpring(); // resume toward the current row; the click decides the rest
        return;
      }
      suppressClickUntil = performance.now() + 350;
      const v = -self.velocityY / pitch;
      if (!reduced()) vel = v * FLING_KEEP;
      goTo(pos + v * PROJECT_S);
    },
  });

  // A tap or click centers its row; a second one on the centered row opens it. (Observer's own onClick
  // listener is passive and can't stop the link, so clicks are handled here.) Modified clicks open tabs.
  offs.on(wrap, 'click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0) return;
    const row = e.target && e.target.closest ? e.target.closest('[data-archive="row"]') : null;
    if (!row) return;
    e.preventDefault();
    if (performance.now() < suppressClickUntil) return; // the click that ends a drag
    const i = rows.indexOf(row);
    const was = e.detail === 0 ? Math.round(target) : pressTarget; // keyboard: the row that is centered now
    if (i === was) open(i);
    else goTo(i);
  });

  // Keyboard: arrows move exactly one row; Enter on the list opens the centered row.
  offs.on(wrap, 'keydown', (e) => {
    const cur = Math.round(target);
    const map = { ArrowDown: cur + 1, ArrowUp: cur - 1, PageDown: cur + 3, PageUp: cur - 3, Home: 0, End: N - 1 };
    if (e.key in map) {
      e.preventDefault();
      goTo(map[e.key]);
      const active = document.activeElement;
      if (active && active !== wrap && wrap.contains(active)) {
        const link = rows[target].querySelector('a[href]');
        (link || wrap).focus({ preventScroll: true });
      }
      return;
    }
    if (e.key === 'Enter' && e.target === wrap) {
      e.preventDefault();
      open(cur);
    }
  });
  // Tabbing onto a row's link centers it.
  offs.on(wrap, 'focusin', (e) => {
    const row = e.target && e.target.closest ? e.target.closest('[data-archive="row"]') : null;
    const i = rows.indexOf(row);
    if (i >= 0 && i !== Math.round(target)) goTo(i);
  });
  // Focus can scroll an overflow:hidden box; the dial moves by transform only.
  offs.on(wrap, 'scroll', () => { if (wrap.scrollTop) wrap.scrollTop = 0; });
  offs.on(wrap, 'dragstart', (e) => e.preventDefault());

  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => { measure(); render(); });
    ro.observe(wrap);
    ro.observe(list);
  }

  measure();
  render();

  return {
    destroy() {
      observer.kill();
      stopSpring();
      clearTimeout(snapTimer);
      offs.flush();
      if (ro) ro.disconnect();
    },
    restore() {
      measure();
      render();
      const color = rows[sel] && rows[sel].getAttribute('data-color');
      if (color && pageWrap) pageWrap.setAttribute('data-ink', luminance(color) > 0.42 ? 'dark' : 'light');
    },
  };
}
