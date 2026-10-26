// Browser tests for v4.js / v4.css on the fixtures (Playwright + Chromium, node:test).
// Run: npm run build && npm test     Screenshots land in tests/screenshots/ (gitignored).
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { start } = require('../scripts/serve.cjs');

const PORT = 4190;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = path.join(__dirname, 'screenshots');
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

let server;
let browser;

before(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  server = await start(PORT);
  browser = await chromium.launch();
});
after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
});

/** Opens a page in a fresh context and records console errors and uncaught exceptions. */
async function open(urlPath, opts = {}) {
  const context = await browser.newContext({
    viewport: opts.viewport || DESKTOP,
    reducedMotion: opts.reducedMotion || 'no-preference',
    hasTouch: !!opts.touch,
    isMobile: !!opts.touch,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  if (opts.clock) await page.clock.install({ time: opts.clock });
  await page.goto(BASE + urlPath);
  await page.waitForFunction(() => window.V4 && window.V4.ready);
  const close = async () => {
    await context.close();
    assert.deepEqual(errors, [], 'no console errors');
  };
  return { page, context, errors, close };
}

const settled = (page) => page.waitForFunction(() => !document.documentElement.classList.contains('is-preloading'), null, { timeout: 20000 });

async function flipDone(page, pathname) {
  // Barba pushes the new URL before it fetches the page, so also wait for the container swap and the flip end.
  const ns = { '/': 'home', '/project': 'project', '/archive': 'archive' }[pathname];
  await page.waitForFunction(([p, n]) => {
    const cs = document.querySelectorAll('[data-barba="container"]');
    return location.pathname === p && cs.length === 1 && cs[0].getAttribute('data-barba-namespace') === n
      && !document.querySelector('[data-barba="wrapper"]').hasAttribute('data-flip')
      && !document.documentElement.classList.contains('v4-flipping') && !window.V4.isBusy();
  }, [pathname, ns], { timeout: 10000 });
}

/**
 * Records, on every frame of a transition: the direction and variant attributes on the wrapper, and for each
 * container its xPercent, rotateY, opacity, blur and scale, plus the veil's clip-path and whether a
 * cross-document view transition is active (it must never be for a Barba swap).
 */
function recordFlips(page) {
  return page.evaluate(() => {
    window.__flips = [];
    window.__variants = [];
    window.__frames = [];
    const w = document.querySelector('[data-barba="wrapper"]');
    new MutationObserver(() => {
      const d = w.getAttribute('data-flip');
      if (d) window.__flips.push(d);
      const v = w.getAttribute('data-flip-variant');
      if (v) window.__variants.push(v);
    }).observe(w, { attributes: true, attributeFilter: ['data-flip', 'data-flip-variant'] });
    const num = (re, str) => { const m = re.exec(str || ''); return m ? Number(m[1]) : null; };
    const vtSupported = CSS.supports('selector(:active-view-transition)');
    const tick = () => {
      const veil = document.querySelector('.v4-veil');
      const vt = vtSupported && document.documentElement.matches(':active-view-transition');
      document.querySelectorAll('[data-barba="container"]').forEach((c) => {
        const t = c.style.transform;
        window.__frames.push({
          ns: c.getAttribute('data-barba-namespace'),
          x: num(/translate\((-?[\d.]+)%/, t),
          rot: num(/rotateY\((-?[\d.]+)deg\)/, t),
          scale: num(/scale\(([\d.]+)/, t),
          opacity: c.style.opacity === '' ? null : Number(c.style.opacity),
          blur: num(/blur\(([\d.]+)px\)/, c.style.filter),
          veil: veil && getComputedStyle(veil).display !== 'none' ? veil.style.clipPath : null,
          vt,
        });
      });
      requestAnimationFrame(tick);
    };
    tick();
  });
}
const frames = (page) => page.evaluate(() => ({ flips: window.__flips, variants: window.__variants, frames: window.__frames }));
const resetFrames = (page) => page.evaluate(() => { window.__flips = []; window.__variants = []; window.__frames = []; });

const navState = (page) => page.evaluate(() => ({
  title: document.title,
  description: document.querySelector('meta[name="description"]').content,
  current: [...document.querySelectorAll('.nav_component a.w--current')].map((a) => a.getAttribute('href')),
  ariaCurrent: [...document.querySelectorAll('.nav_component a[aria-current="page"]')].map((a) => a.getAttribute('href')),
  ink: document.querySelector('.page-wrapper').getAttribute('data-ink'),
  namespace: document.querySelector('.page-wrapper').getAttribute('data-namespace'),
  wfPage: document.documentElement.getAttribute('data-wf-page'),
  scrollY: window.scrollY,
}));

/** The project pages fetched (by fetch(), for opening in place), in order. */
function trackCaseFetches(page) {
  const list = [];
  page.on('request', (r) => { if (r.resourceType() === 'fetch') list.push(new URL(r.url()).pathname); });
  return list;
}

/** The Project page's in-place case: URL, title, history entry, stage, list panel, pill and scroll. */
const caseState = (page) => page.evaluate(() => {
  const st = document.querySelector('[data-project-stage]');
  const panel = document.querySelector('.project-list_panel');
  const pill = document.querySelector('.v4-case_back');
  const m = new DOMMatrix(getComputedStyle(panel).transform);
  const v4case = history.state && history.state.v4case;
  return {
    path: location.pathname,
    title: document.title,
    state: v4case ? v4case.key : null,
    open: st.getAttribute('data-case'),
    pos: st.style.position,
    rect: st.getBoundingClientRect().toJSON(),
    top: Math.round(st.scrollTop),
    panel: Number(getComputedStyle(panel).opacity),
    panelX: Math.round(m.m41 * 100) / 100,
    panelY: Math.round(m.m42 * 100) / 100,
    pill: pill ? Number(getComputedStyle(pill).opacity) : null,
    pillVis: pill ? getComputedStyle(pill).visibility : null,
    nav: Number(getComputedStyle(document.querySelector('.nav_component')).opacity),
    winY: window.scrollY,
    flip: document.querySelector('[data-barba="wrapper"]').getAttribute('data-flip'),
    active: [...document.querySelectorAll('.project-preview_item.is-active')].map((p) => p.dataset.project),
    windowLenisStopped: document.documentElement.classList.contains('lenis-stopped'),
    stageLenis: st.classList.contains('lenis'),
  };
});

// ---------------------------------------------------------------------------------------------------
describe('pages load cleanly', () => {
  for (const [name, url, vp] of [['home', '/', DESKTOP], ['project', '/project', DESKTOP], ['archive', '/archive', DESKTOP],
    ['home (phone)', '/', PHONE], ['project (phone)', '/project', PHONE], ['archive (phone)', '/archive', PHONE]]) {
    test(`no console errors: ${name}`, async () => {
      const { page, close } = await open(url, { viewport: vp });
      if (url === '/') await settled(page);
      await page.waitForTimeout(url === '/' ? 4600 : 800); // Home: let a full wave run
      const lenis = await page.evaluate(() => document.documentElement.classList.contains('lenis'));
      assert.equal(lenis, true, 'Lenis is on');
      await page.screenshot({ path: path.join(SHOTS, `load-${name.replace(/\W+/g, '-')}.png`) });
      await close();
    });
  }
});

// ---------------------------------------------------------------------------------------------------
describe('footer clock', () => {
  test('ticks on the minute and switches PDT → PST at 2 AM on Nov 1, 2026', async () => {
    const { page, close } = await open('/project', { clock: new Date('2026-11-01T08:59:50Z') });
    const read = () => page.evaluate(() => [document.querySelector('[data-clock="time"]').textContent, document.querySelector('[data-clock="zone"]').textContent]);
    assert.deepEqual(await read(), ['15-01:59', 'PDT']);
    await page.clock.runFor(11000);
    assert.deepEqual(await read(), ['16-01:00', 'PST']);
    await page.clock.runFor(60000);
    assert.deepEqual(await read(), ['16-01:01', 'PST']);
    const title = await page.getAttribute('.footer_clock', 'title');
    assert.equal(title, 'Hanoi 16:01 · Los Angeles 01:01 PST');
    await close();
  });
});

// ---------------------------------------------------------------------------------------------------
describe('home', () => {
  test('preloader: wordmark rises from the center into the nav, then the page enters', async () => {
    const { page, close } = await open('/');
    const first = await page.evaluate(() => ({
      preloading: document.documentElement.classList.contains('is-preloading'),
      display: getComputedStyle(document.querySelector('.preloader_component')).display,
      logoTop: document.querySelector('.nav_logo').getBoundingClientRect().top,
      linkOpacity: getComputedStyle(document.querySelector('.nav_link')).opacity,
      overflow: getComputedStyle(document.documentElement).overflow,
    }));
    assert.equal(first.preloading, true);
    assert.equal(first.display, 'block');
    assert.ok(first.logoTop > 300, `wordmark starts near the vertical center (top ${first.logoTop})`);
    assert.equal(first.linkOpacity, '0', 'nav links wait for the entrance');
    assert.ok(['hidden', 'clip'].includes(first.overflow), `scroll locked (${first.overflow})`);
    await page.screenshot({ path: path.join(SHOTS, 'preloader-rising.png') });
    await settled(page);
    const done = await page.evaluate(() => ({
      display: getComputedStyle(document.querySelector('.preloader_component')).display,
      logoTop: document.querySelector('.nav_logo').getBoundingClientRect().top,
      logoStyle: document.querySelector('.nav_logo').getAttribute('style'),
      links: [...document.querySelectorAll('.nav_link')].map((a) => getComputedStyle(a).opacity),
      introOpacity: getComputedStyle(document.querySelector('.home-intro_text')).opacity,
      cellsVisible: [...document.querySelectorAll('.home-grid_item')].every((c) => getComputedStyle(c).opacity === '1'),
      rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
      t: performance.now(),
    }));
    assert.equal(done.display, 'none');
    assert.ok(Math.abs(done.logoTop - 3.625 * done.rem) < 1.5, `wordmark lands in its nav spot (top ${done.logoTop})`);
    assert.ok(!done.logoStyle, 'no inline transform left on the wordmark');
    assert.deepEqual(done.links, ['0.5', '0.5'], 'nav links back to their Webflow styles');
    assert.equal(done.introOpacity, '1');
    assert.equal(done.cellsVisible, true);
    assert.ok(done.t > 1200 + 2400, 'minimum 1.2 s rise plus the 2.5 s exit timeline');
    await page.screenshot({ path: path.join(SHOTS, 'home-after-preloader.png') });
    await close();
  });

  test('preloader never runs when Home is reached by the page flip', async () => {
    const { page, close } = await open('/project');
    await page.evaluate(() => {
      window.__sawPreloader = false;
      const check = () => {
        const pl = document.querySelector('.preloader_component');
        if (document.documentElement.classList.contains('is-preloading') || (pl && getComputedStyle(pl).display !== 'none')) window.__sawPreloader = true;
        requestAnimationFrame(check);
      };
      check();
    });
    await page.click('.nav_logo');
    await flipDone(page, '/');
    const s = await page.evaluate(() => ({
      saw: window.__sawPreloader,
      cells: document.querySelectorAll('.home-grid_item').length,
      visible: [...document.querySelectorAll('.home-grid_item')].every((c) => getComputedStyle(c).opacity === '1'),
    }));
    assert.equal(s.saw, false, 'no preloader after a flip');
    assert.equal(s.cells, 55);
    assert.equal(s.visible, true, 'grid shown at once');
    // The wave starts by itself after a flip arrival.
    await page.waitForFunction(() => [...document.querySelectorAll('.home-grid_item')].some((c) => c.getAnimations().length > 0), null, { timeout: 6000 });
    await close();
  });

  test('grid: 11 × 5 on desktop, 4 × 7 on phones (rebuilt live), quiet cells under the intro, neighbors differ', async () => {
    const { page, close } = await open('/');
    await settled(page);
    const check = () => page.evaluate(() => {
      const items = [...document.querySelectorAll('.home-grid_item')];
      const grid = document.querySelector('[data-home-grid]');
      const cols = Number(grid.style.getPropertyValue('--home-grid-cols'));
      const intro = document.querySelector('.home-intro_text');
      const range = document.createRange();
      range.selectNodeContents(intro);
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const lines = [...range.getClientRects()].filter((r) => r.width && r.height)
        .map((r) => ({ l: r.left - rem, r: r.right + rem, t: r.top - 0.75 * rem, b: r.bottom + 0.75 * rem }));
      let mismatches = 0, checked = 0, same = 0;
      items.forEach((el, i) => {
        if (el.getAnimations().length) return; // mid-flip: its box is transformed
        checked++;
        const b = el.getBoundingClientRect();
        const under = lines.some((L) => b.left < L.r && b.right > L.l && b.top < L.b && b.bottom > L.t);
        if (under !== el.classList.contains('is-quiet')) mismatches++;
      });
      const src = (el) => el.querySelector('.home-grid_face:not(.is-back) img').getAttribute('src');
      items.forEach((el, i) => {
        const x = i % cols, y = Math.floor(i / cols);
        items.forEach((o, j) => {
          const ox = j % cols, oy = Math.floor(j / cols);
          if (j > i && Math.abs(ox - x) <= 1 && Math.abs(oy - y) <= 1 && src(el) === src(o)) same++;
        });
      });
      return { count: items.length, layout: grid.getAttribute('data-layout'), quiet: items.filter((el) => el.classList.contains('is-quiet')).length, mismatches, checked, same };
    });
    const desk = await check();
    assert.equal(desk.count, 55);
    assert.equal(desk.layout, '11x5');
    assert.ok(desk.quiet >= 6 && desk.quiet <= 22, `desktop quiet cells: ${desk.quiet}`);
    assert.equal(desk.mismatches, 0, 'quiet = intersects a line of the intro');
    assert.equal(desk.same, 0, 'no two neighbors share an artwork');

    // After a full wave the neighbor rule still holds.
    await page.waitForFunction(() => [...document.querySelectorAll('.home-grid_item')].some((c) => c.getAnimations().length > 0), null, { timeout: 7000 });
    await page.waitForFunction(() => [...document.querySelectorAll('.home-grid_item')].every((c) => c.getAnimations().length === 0), null, { timeout: 5000 });
    const afterWave = await check();
    assert.equal(afterWave.same, 0, 'no two neighbors share an artwork after a wave');

    await page.setViewportSize(PHONE);
    await page.waitForFunction(() => document.querySelectorAll('.home-grid_item').length === 28);
    await page.waitForTimeout(400);
    const phone = await check();
    assert.equal(phone.layout, '4x7');
    assert.ok(phone.quiet >= 4 && phone.quiet <= 16, `phone quiet cells: ${phone.quiet}`);
    assert.equal(phone.mismatches, 0);
    assert.equal(phone.same, 0);
    await page.screenshot({ path: path.join(SHOTS, 'home-phone-resized.png') });
    await close();
  });

  test('quiet squares never flip; the wave pauses while the tab is hidden', async () => {
    const { page, close } = await open('/');
    await settled(page);
    await page.evaluate(() => {
      window.__quietMoved = false;
      const tick = () => {
        document.querySelectorAll('.home-grid_item.is-quiet').forEach((c) => { if (c.getAnimations().length) window.__quietMoved = true; });
        requestAnimationFrame(tick);
      };
      tick();
    });
    await page.waitForTimeout(6500);
    assert.equal(await page.evaluate(() => window.__quietMoved), false);
    // Hidden tab: no new waves are scheduled.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(1800); // let a running wave finish
    const moving = await page.evaluate(async () => {
      let seen = 0;
      const t0 = performance.now();
      await new Promise((resolve) => {
        const tick = () => {
          seen += [...document.querySelectorAll('.home-grid_item')].filter((c) => c.getAnimations().length).length;
          if (performance.now() - t0 > 4500) resolve(); else requestAnimationFrame(tick);
        };
        tick();
      });
      return seen;
    });
    assert.equal(moving, 0, 'no waves while hidden');
    await close();
  });
});

// ---------------------------------------------------------------------------------------------------
describe('page transitions', () => {
  test('default glide: Home → Project → Archive → Back → Back with direction, title, meta and w--current', async () => {
    const { page, close } = await open('/');
    await settled(page);
    assert.equal(await page.evaluate(() => window.V4.transition()), 'glide', 'glide is the default');
    await recordFlips(page);

    await page.hover('.nav_link[href="/project"]'); // Barba prefetches on hover
    await page.click('.nav_link[href="/project"]');
    await page.waitForFunction(() => window.__frames.some((f) => f.ns === 'home' && f.opacity !== null && f.opacity < 0.7));
    await page.screenshot({ path: path.join(SHOTS, 'transition-glide-mid.png') });
    await flipDone(page, '/project');
    let r = await frames(page);
    assert.deepEqual(r.flips, ['forward']);
    assert.deepEqual(r.variants, ['glide']);
    const homeX = r.frames.filter((f) => f.ns === 'home' && f.x !== null).map((f) => f.x);
    const projX = r.frames.filter((f) => f.ns === 'project' && f.x !== null).map((f) => f.x);
    assert.ok(Math.min(...homeX) <= -2 && Math.max(...homeX) <= 0, 'forward: the old page drifts left (toward the exit)');
    assert.ok(Math.max(...projX) >= 1.5 && Math.min(...projX) >= 0, 'forward: the new page settles in from the right');
    assert.equal(r.frames.filter((f) => f.rot !== null).length, 0, 'no 3D');
    assert.equal(r.frames.some((f) => f.vt), false, 'Barba swaps never start a cross-document view transition');
    let s = await navState(page);
    assert.equal(s.title, 'Projects | Thanh Quach');
    assert.match(s.description, /^Selected projects/);
    assert.deepEqual(s.current, ['/project']);
    assert.deepEqual(s.ariaCurrent, ['/project']);
    assert.equal(s.namespace, 'project');
    assert.equal(s.wfPage, 'fixture-project');
    assert.equal(s.scrollY, 0);

    await resetFrames(page);
    await page.click('.nav_link[href="/archive"]');
    await flipDone(page, '/archive');
    r = await frames(page);
    assert.deepEqual(r.flips, ['forward']);
    s = await navState(page);
    assert.equal(s.title, 'Archive | Thanh Quach');
    assert.deepEqual(s.current, ['/archive']);
    assert.equal(s.namespace, 'archive');

    // Browser Back: Archive → Project is a back transition, mirrored.
    await resetFrames(page);
    await page.goBack();
    await flipDone(page, '/project');
    r = await frames(page);
    assert.deepEqual(r.flips, ['back']);
    const archX = r.frames.filter((f) => f.ns === 'archive' && f.x !== null).map((f) => f.x);
    projX.length = 0;
    projX.push(...r.frames.filter((f) => f.ns === 'project' && f.x !== null).map((f) => f.x));
    assert.ok(Math.max(...archX) >= 2, 'back: the old page drifts right');
    assert.ok(Math.min(...projX) <= -1.5, 'back: the new page settles in from the left');
    s = await navState(page);
    assert.equal(s.title, 'Projects | Thanh Quach');
    assert.deepEqual(s.current, ['/project']);
    assert.equal(s.ink, 'light');

    await resetFrames(page);
    await page.goBack();
    await flipDone(page, '/');
    s = await navState(page);
    assert.deepEqual((await frames(page)).flips, ['back']);
    assert.match(s.title, /^Thanh Quach/);
    assert.deepEqual(s.current, ['/']);
    assert.equal(s.ink, 'dark');
    const containerStyle = await page.evaluate(() => document.querySelector('[data-barba="container"]').getAttribute('style'));
    assert.ok(!containerStyle, 'no inline styles left on the container');
    await close();
  });

  // inset() → [top, bottom] in %, from the 1-4 value shorthand the browser serializes to.
  const insetTB = (c) => {
    const m = /inset\(([^)]*)\)/.exec(c);
    if (!m) return null;
    const v = m[1].trim().split(/\s+/).map(parseFloat);
    return [v[0], v.length < 3 ? v[0] : v[2]];
  };
  // Each variant: ?t= selects it, forward then back, ends on the right page, no console errors.
  const EVIDENCE = {
    glide: (fr, from, to, dir) => {
      const fx = fr.filter((f) => f.ns === from && f.x !== null).map((f) => f.x);
      const tx = fr.filter((f) => f.ns === to && f.x !== null).map((f) => f.x);
      assert.ok(fx.some((x) => x * dir <= -2), `${from} drifts toward the exit`);
      assert.ok(tx.some((x) => x * dir >= 1.5), `${to} enters from the other side`);
    },
    veil: (fr, from, to, dir) => {
      const clips = fr.map((f) => f.veil).filter(Boolean).map(insetTB).filter(Boolean);
      assert.ok(clips.length > 5, 'the veil is drawn');
      const [top, bottom] = dir > 0 ? [0, 1] : [1, 0];
      assert.ok(clips.some((c) => c[top] > 5 && c[top] < 95 && c[bottom] === 0), dir > 0 ? 'it rises from the bottom' : 'it comes down from the top');
      assert.ok(clips.some((c) => c[bottom] > 5 && c[bottom] < 95), dir > 0 ? 'then carries on up and off' : 'then carries on down and off');
      assert.equal(fr.filter((f) => f.rot !== null).length, 0);
    },
    turn: (fr, from, to, dir) => {
      const turning = dir > 0 ? from : to;
      const rot = fr.filter((f) => f.ns === turning && f.rot !== null).map((f) => f.rot);
      assert.ok(rot.length > 5, `${turning} turns`);
      assert.ok(Math.min(...rot) >= -16.01 && Math.min(...rot) <= -10, `restrained: max ${Math.min(...rot)}°`);
      assert.equal(fr.filter((f) => f.ns !== turning && f.rot !== null).length, 0, 'only one page turns');
    },
    dissolve: (fr) => {
      const blur = fr.map((f) => f.blur).filter((b) => b !== null);
      const scale = fr.map((f) => f.scale).filter((b) => b !== null);
      assert.ok(Math.max(...blur) > 2 && Math.max(...blur) <= 4.01, `blur up to 4px (${Math.max(...blur)})`);
      assert.ok(Math.min(...scale) >= 0.9849 && Math.min(...scale) < 0.995, `scale down to .985 (${Math.min(...scale)})`);
      assert.equal(fr.filter((f) => f.rot !== null).length, 0);
    },
  };
  for (const variant of Object.keys(EVIDENCE)) {
    test(`${variant}: forward and back, right page, right direction, no console errors`, async () => {
      const { page, close } = await open(`/project?t=${variant}`);
      assert.equal(await page.getAttribute('.page-wrapper', 'data-v4-transition'), variant, '?t= sets the variant');
      await recordFlips(page);
      await page.click('.nav_link[href="/archive"]');
      if (variant === 'veil') {
        // Fully covered lasts at most a frame (the uncover starts right away), so accept nearly covered.
        await page.waitForFunction(() => window.__frames.some((f) => {
          const m = f.veil && /inset\(([^)]*)\)/.exec(f.veil);
          if (!m) return false;
          const v = m[1].trim().split(/\s+/).map(parseFloat);
          return v[0] < 3 && (v.length < 3 ? v[0] : v[2]) < 3;
        }));
        await page.screenshot({ path: path.join(SHOTS, 'transition-veil-covered.png') });
      } else if (variant !== 'glide') {
        await page.waitForTimeout(220);
        await page.screenshot({ path: path.join(SHOTS, `transition-${variant}-mid.png`) });
      }
      await flipDone(page, '/archive');
      let r = await frames(page);
      assert.deepEqual(r.flips, ['forward']);
      assert.deepEqual(r.variants, [variant]);
      EVIDENCE[variant](r.frames, 'project', 'archive', 1);
      assert.equal(r.frames.some((f) => f.vt), false);
      assert.equal(await page.getAttribute('.page-wrapper', 'data-v4-transition'), variant, 'the variant persists across Barba swaps');

      await resetFrames(page);
      await page.click('.nav_link[href="/project"]');
      await flipDone(page, '/project');
      r = await frames(page);
      assert.deepEqual(r.flips, ['back']);
      EVIDENCE[variant](r.frames, 'archive', 'project', -1);
      const after = await page.evaluate(() => ({
        style: document.querySelector('[data-barba="container"]').getAttribute('style'),
        veil: document.querySelector('.v4-veil') ? getComputedStyle(document.querySelector('.v4-veil')).display : 'none',
        title: document.title,
      }));
      assert.ok(!after.style, 'container clean');
      assert.equal(after.veil, 'none', 'veil gone');
      assert.equal(after.title, 'Projects | Thanh Quach');
      await close();
    });
  }

  test('data-v4-transition on the wrapper picks the variant; unknown names fall back to glide', async () => {
    const { page, close } = await open('/project');
    await page.evaluate(() => document.querySelector('.page-wrapper').setAttribute('data-v4-transition', 'dissolve'));
    assert.equal(await page.evaluate(() => window.V4.transition()), 'dissolve');
    await recordFlips(page);
    await page.click('.nav_link[href="/archive"]');
    await flipDone(page, '/archive');
    assert.deepEqual((await frames(page)).variants, ['dissolve']);
    await page.evaluate(() => document.querySelector('.page-wrapper').setAttribute('data-v4-transition', 'book'));
    assert.equal(await page.evaluate(() => window.V4.transition()), 'glide');
    await close();
  });

  test('links outside the three pages leave with the transition, then load normally', async () => {
    const { page, close } = await open('/project?t=veil');
    await recordFlips(page);
    await page.evaluate(() => window.V4.navigate('/archives/clock-for-alien'));
    await page.waitForURL(`${BASE}/archives/clock-for-alien`, { timeout: 5000 });
    assert.equal(await page.textContent('#case-title'), 'Clock for Alien');
    await close();
  });

  test('Back from the cache (pageshow persisted) brings the page back in after a transition out', async () => {
    const { page, close } = await open('/project');
    await page.evaluate(() => { window.__assigned = []; window.V4.assign = (href) => window.__assigned.push(href); });
    await page.evaluate(() => window.V4.navigate('/nuform'));
    await page.waitForFunction(() => window.__assigned.length === 1);
    const out = await page.evaluate(() => ({
      flip: document.querySelector('[data-barba="wrapper"]').getAttribute('data-flip'),
      opacity: getComputedStyle(document.querySelector('[data-barba="container"]')).opacity,
      href: new URL(window.__assigned[0]).pathname,
    }));
    assert.equal(out.flip, 'out');
    assert.equal(out.opacity, '0', 'the page left (glide out)');
    assert.equal(out.href, '/nuform');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    assert.equal(await page.getAttribute('[data-barba="wrapper"]', 'data-flip'), null);
    await page.waitForFunction(() => !document.querySelector('[data-barba="container"]').getAttribute('style'), null, { timeout: 3000 });
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[data-barba="container"]')).opacity), '1');
    assert.equal(await page.evaluate(() => window.V4.isBusy()), false);
    await close();
  });
});

// ---------------------------------------------------------------------------------------------------
describe('project', () => {
  const state = (page) => page.evaluate(() => ({
    lineupHidden: document.querySelector('[data-project-lineup]').classList.contains('is-hidden'),
    lineupOpacity: Number(getComputedStyle(document.querySelector('[data-project-lineup]')).opacity),
    active: [...document.querySelectorAll('.project-preview_item')].filter((p) => p.classList.contains('is-active')).map((p) => p.dataset.project),
    visible: [...document.querySelectorAll('.project-preview_item')].filter((p) => getComputedStyle(p).visibility === 'visible').map((p) => p.dataset.project),
    ariaShown: [...document.querySelectorAll('.project-preview_item[aria-hidden="false"]')].map((p) => p.dataset.project),
    rows: [...document.querySelectorAll('.project-list_row.is-active')].map((r) => r.dataset.project),
    rules: document.querySelectorAll('.project-list_rule.is-active').length,
    slatShown: [...document.querySelectorAll('.project-preview_slat')].map((s) => { const im = s.querySelector('img.is-shown'); return im ? im.getAttribute('src').replace(/.*strip-|\.jpg/g, '') : null; }),
    slatsMoving: [...document.querySelectorAll('.project-preview_slat')].filter((s) => s.getAnimations().length).length,
    slatsOpacity: Number(getComputedStyle(document.querySelector('[data-project-slats]')).opacity),
  }));
  const center = async (page, i) => {
    const b = await page.locator('.project-list_row').nth(i).boundingBox();
    return [b.x + b.width / 2, b.y + b.height / 2];
  };

  test('lineup → hover preview (80 ms intent, fade only) → slat flip and text roll → grace → lineup', async () => {
    const { page, close } = await open('/project');
    const fetched = trackCaseFetches(page);
    let s = await state(page);
    assert.equal(s.lineupHidden, false);
    assert.deepEqual(s.active, []);
    assert.deepEqual(s.visible, []);

    await page.mouse.move(...(await center(page, 0)));
    await page.waitForTimeout(40);
    assert.deepEqual((await state(page)).active, [], 'not before the 80 ms hover intent');
    await page.waitForTimeout(700);
    s = await state(page);
    assert.equal(s.lineupHidden, true);
    assert.ok(s.lineupOpacity < 0.01, 'lineup faded out');
    assert.deepEqual(s.active, ['recto-verso']);
    assert.deepEqual(s.visible, ['recto-verso']);
    assert.deepEqual(s.ariaShown, ['recto-verso']);
    assert.deepEqual(s.rows, ['recto-verso']);
    assert.equal(s.rules, 1);
    assert.deepEqual(s.slatShown, Array(6).fill('recto-verso'));
    assert.equal(s.slatsMoving, 0, 'the first hover is a fade, no slat flip');
    assert.deepEqual(fetched, ['/project-t---recto-verso'], 'the hover intent fetched the project page');
    // The slat layer sits exactly on the active strip.
    const align = await page.evaluate(() => {
      const a = document.querySelector('[data-project-slats]').getBoundingClientRect();
      const b = document.querySelector('.project-preview_item.is-active .project-preview_strip').getBoundingClientRect();
      return Math.max(Math.abs(a.left - b.left), Math.abs(a.top - b.top), Math.abs(a.width - b.width), Math.abs(a.height - b.height));
    });
    assert.ok(align < 0.5, `slats aligned to the strip (off by ${align}px)`);

    // Moving down to row 3: slats flip left to right and the text rolls in.
    await page.mouse.move(...(await center(page, 2)), { steps: 4 });
    await page.waitForTimeout(60);
    s = await state(page);
    assert.deepEqual(s.active, ['rio-grande']);
    assert.ok(s.slatsMoving >= 1, 'slats are turning');
    const rolling = await page.evaluate(() => [...document.querySelectorAll('.project-preview_item.is-active [data-roll]')].filter((el) => el.getAnimations().length).length);
    assert.equal(rolling, 5, 'title, summary and three meta values roll');
    const delays = await page.evaluate(() => [...document.querySelectorAll('.project-preview_slat')].map((s) => s.getAnimations()[0]?.effect.getTiming().delay));
    assert.deepEqual(delays, [0, 45, 90, 135, 180, 225], 'moving down: left to right, 45 ms apart');
    await page.screenshot({ path: path.join(SHOTS, 'project-slats-mid.png') });
    await page.waitForTimeout(900);
    s = await state(page);
    assert.deepEqual(s.slatShown, Array(6).fill('rio-grande'));
    assert.equal(s.slatsMoving, 0);

    // Moving up: right to left.
    await page.mouse.move(...(await center(page, 1)), { steps: 3 });
    await page.waitForTimeout(30);
    const upDelays = await page.evaluate(() => [...document.querySelectorAll('.project-preview_slat')].map((s) => s.getAnimations()[0]?.effect.getTiming().delay));
    assert.deepEqual(upDelays, [225, 180, 135, 90, 45, 0]);
    await page.waitForTimeout(800);

    // A fast sweep retargets the running flip instead of queuing: it settles on the last row.
    for (const i of [0, 1, 2, 3, 2, 3]) { await page.mouse.move(...(await center(page, i))); await page.waitForTimeout(25); }
    await page.waitForTimeout(1300);
    s = await state(page);
    assert.deepEqual(s.active, ['aloud']);
    assert.deepEqual(s.slatShown, Array(6).fill('aloud'));
    assert.equal(s.slatsMoving, 0);
    await page.screenshot({ path: path.join(SHOTS, 'project-preview.png') });

    // Leaving and coming back within the 0.2 s grace keeps the preview.
    const [x, y] = await center(page, 3);
    await page.mouse.move(x, y + 400);
    await page.waitForTimeout(80);
    await page.mouse.move(x, y);
    await page.waitForTimeout(400);
    assert.deepEqual((await state(page)).active, ['aloud'], 'grace kept the preview');

    // Leaving for good: back to the lineup after the 0.2 s grace.
    await page.mouse.move(1300, 450);
    await page.waitForTimeout(90);
    assert.deepEqual((await state(page)).active, ['aloud'], 'still within the grace');
    await page.waitForTimeout(700);
    s = await state(page);
    assert.equal(s.lineupHidden, false);
    assert.ok(s.lineupOpacity > 0.99);
    assert.deepEqual(s.active, []);
    assert.deepEqual(s.visible, []);
    assert.deepEqual(s.rows, []);
    assert.ok(s.slatsOpacity < 0.01);
    await close();
  });

  test('keyboard focus previews like hover', async () => {
    const { page, close } = await open('/project');
    await page.focus('.project-list_row[data-index="1"]');
    await page.waitForTimeout(500);
    let s = await state(page);
    assert.deepEqual(s.active, ['nuform']);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);
    s = await state(page);
    assert.deepEqual(s.active, ['rio-grande']);
    await close();
  });

  // ---------- Opening a project in place ----------
  const LFLA_BODY = ['aloud-overview', 'div-block-442', 'div-block-451', 'div-block-455', 'div-block-455'];
  const caseOpen = (page, key) => page.waitForFunction((k) => {
    const c = document.querySelector('.v4-case');
    return !!c && c.getAttribute('data-case-for') === k && !c.getAnimations().length && Number(getComputedStyle(c).opacity) === 1;
  }, key, { timeout: 5000 });
  const caseClosed = (page) => page.waitForFunction(() => !document.querySelector('.v4-case')
    && !document.querySelector('[data-project-stage]').style.position, null, { timeout: 5000 });
  const clickRow = async (page, i) => {
    await page.mouse.move(...(await center(page, i)));
    await page.mouse.down();
    await page.mouse.up();
  };
  // The page itself never changes: a marker on the document and on the Barba container survives.
  const mark = (page) => page.evaluate(() => { window.__doc = 'same'; document.querySelector('[data-barba="container"]').__same = true; });
  const sameDocument = (page) => page.evaluate(() => window.__doc === 'same'
    && document.querySelectorAll('[data-barba="container"]').length === 1 && document.querySelector('[data-barba="container"]').__same === true);

  test('click opens the project in place: no navigation, URL and title from the page, its body under the preview', async () => {
    const { page, close } = await open('/project');
    const fetched = trackCaseFetches(page);
    const navigations = [];
    page.on('request', (r) => { if (r.isNavigationRequest()) navigations.push(r.url()); });
    await page.evaluate(() => { window.__assigned = []; window.V4.assign = (href) => window.__assigned.push(href); });
    await mark(page);
    const stageBefore = await page.evaluate(() => document.querySelector('[data-project-stage]').getBoundingClientRect().toJSON());
    const lengthBefore = await page.evaluate(() => history.length);
    const rootFont = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);

    await page.mouse.move(...(await center(page, 3)));
    await page.waitForTimeout(600);
    assert.deepEqual(fetched, ['/library-foundation-of-los-angeles'], 'fetched on the hover intent');
    await page.mouse.down();
    await page.mouse.up();
    await caseOpen(page, 'aloud');
    const s = await caseState(page);
    assert.equal(s.path, '/library-foundation-of-los-angeles', 'the URL is the real case page');
    assert.equal(s.title, 'A New Narrative | Thanh Quach', "the fetched page's title");
    assert.equal(s.state, 'aloud', 'our own history entry');
    assert.equal(await page.evaluate(() => history.length), lengthBefore + 1, 'pushed, not replaced');
    assert.equal(await sameDocument(page), true, 'no navigation, no Barba swap');
    assert.deepEqual(navigations, [], 'no document request');
    assert.deepEqual(await page.evaluate(() => window.__assigned), []);
    assert.equal(s.flip, null);
    assert.deepEqual(s.active, ['aloud'], 'the preview stays');
    assert.equal(s.open, 'open');
    assert.equal(s.pos, '', 'not collapsed at the top');
    assert.ok(Math.abs(s.rect.left - stageBefore.left) < 1 && Math.abs(s.rect.width - stageBefore.width) < 1, 'the stage stays beside the list');
    assert.equal(s.panel, 1);
    assert.equal(s.pillVis, 'hidden');
    assert.equal(s.windowLenisStopped, true, "the window's Lenis is paused");
    assert.equal(s.stageLenis, true, 'the stage scrolls with its own Lenis');

    const body = await page.evaluate(() => {
      const st = document.querySelector('[data-project-stage]');
      const c = document.querySelector('.v4-case');
      const b = c.querySelector('.v4-case_body');
      return {
        kids: [...b.children].map((k) => k.className),
        caseTop: c.offsetTop,
        stageHeight: st.clientHeight,
        scrollable: st.scrollHeight > st.clientHeight * 2,
        heroes: c.querySelectorAll('.split-layout').length,
        wrappers: c.querySelectorAll('.page-wrapper, .main-bq, [data-barba]').length,
        navs: c.querySelectorAll('nav, .link-block-3').length,
        scripts: c.querySelectorAll('script').length,
        ranScripts: [window.__caseScriptRan, window.__embedScriptRan],
        styles: [...c.querySelectorAll('style')].map((x) => x.textContent.trim()),
        rootFont: getComputedStyle(document.documentElement).fontSize,
        noteColor: getComputedStyle(c.querySelector('.case-note')).color,
        staggers: c.querySelectorAll('.stagger-word').length,
        ix2: c.querySelectorAll('[data-w-id]').length,
        counters: ['counter1', 'counter2', 'counter3'].map((id) => !!c.querySelector(`#${id}`)),
        embeds: c.querySelectorAll('iframe, video').length,
        images: [...c.querySelectorAll('img')].every((im) => im.getAttribute('loading') === 'lazy'),
        srcset: !!c.querySelector('img[srcset]'),
        next: c.querySelector('.v4-case_next').textContent,
        nextHref: new URL(c.querySelector('.v4-case_next').href).pathname,
      };
    });
    assert.deepEqual(body.kids, LFLA_BODY, "the page-wrapper's last five children");
    assert.equal(body.caseTop, body.stageHeight, 'the body starts right under the preview');
    assert.ok(body.scrollable);
    assert.equal(body.heroes, 0, 'no hero (split-layout)');
    assert.equal(body.wrappers, 0, 'no .page-wrapper, .main-bq or Barba attributes injected');
    assert.equal(body.navs, 0, 'no close-X nav');
    assert.equal(body.scripts, 0, 'scripts stripped');
    assert.deepEqual(body.ranScripts, [undefined, undefined], 'and never ran');
    assert.deepEqual(body.styles, ['.div-block-451 .case-note { color: rgb(125, 123, 182); }'], 'only the non-root style embed is kept');
    assert.equal(body.noteColor, 'rgb(125, 123, 182)');
    assert.equal(body.rootFont, rootFont, "the case page's html font-size reset is not injected");
    assert.equal(body.staggers, 35);
    assert.equal(body.ix2, 5);
    assert.deepEqual(body.counters, [true, true, true]);
    assert.equal(body.embeds, 9, 'iframes and videos kept');
    assert.equal(body.images, true);
    assert.equal(body.srcset, true);
    assert.match(body.next, /Next project\s*Recto Verso →/);
    assert.equal(body.nextHref, '/project-t---recto-verso', 'wraps around to the first project');
    await page.screenshot({ path: path.join(SHOTS, 'case-open.png') });

    // Fetched once per project, however many times it opens.
    await page.keyboard.press('Escape');
    await caseClosed(page);
    await clickRow(page, 3);
    await caseOpen(page, 'aloud');
    assert.deepEqual(fetched, ['/library-foundation-of-los-angeles'], 'still one fetch');
    await close();
  });

  test('scrolling the stage past 24 px slides the list away and widens the stage; at the top it comes back', async () => {
    const { page, close } = await open('/project');
    const stageBefore = await page.evaluate(() => document.querySelector('[data-project-stage]').getBoundingClientRect().toJSON());
    await clickRow(page, 2);
    await caseOpen(page, 'rio-grande');
    const scrollStage = (y) => page.evaluate((v) => {
      const st = document.querySelector('[data-project-stage]');
      st.scrollTop = v;
      st.dispatchEvent(new Event('scroll'));
    }, y);

    await scrollStage(20);
    await page.waitForTimeout(250);
    let s = await caseState(page);
    assert.equal(s.pos, '', '20 px: still beside the list');
    assert.equal(s.panel, 1);

    await scrollStage(30);
    await page.waitForTimeout(300);
    s = await caseState(page);
    assert.equal(s.pos, 'fixed', 'pinned while it grows');
    assert.ok(s.panelX < -5 && s.panelX > -90, `the list is sliding (${s.panelX})`);
    assert.ok(s.rect.left > 0 && s.rect.left < stageBefore.left, 'the stage is widening');
    await page.screenshot({ path: path.join(SHOTS, 'case-collapsing.png') });
    await page.waitForTimeout(600);
    s = await caseState(page);
    assert.deepEqual([s.rect.left, s.rect.top, Math.round(s.rect.width), Math.round(s.rect.height)], [0, 0, 1440, 900], 'the stage fills the window');
    assert.equal(s.panel, 0);
    assert.equal(s.panelX, -90, 'the list slid 90 px left');
    assert.equal(s.nav, 0, 'the V4 nav steps aside for the pill');
    assert.equal(s.pill, 1);
    assert.equal(s.pillVis, 'visible');
    assert.equal(s.top, 30, 'the scroll position survives the pinning');
    await page.screenshot({ path: path.join(SHOTS, 'case-collapsed.png') });

    // The wheel scrolls the stage (its own Lenis), never the window.
    await page.mouse.move(900, 500);
    for (let k = 0; k < 5; k++) { await page.mouse.wheel(0, 150); await page.waitForTimeout(40); }
    await page.waitForTimeout(900);
    s = await caseState(page);
    assert.ok(s.top > 400, `the stage scrolled (${s.top})`);
    assert.equal(s.winY, 0, 'the window did not');

    // Back to the top with the wheel.
    await page.waitForTimeout(800); // let the stage's Lenis settle
    for (let k = 0; k < 5; k++) { await page.mouse.wheel(0, -400); await page.waitForTimeout(40); }
    await page.waitForFunction(() => document.querySelector('[data-project-stage]').scrollTop === 0, null, { timeout: 4000 });
    await page.waitForTimeout(800);
    s = await caseState(page);
    assert.equal(s.pos, '', 'back in the layout');
    assert.ok(Math.abs(s.rect.left - stageBefore.left) < 1 && Math.abs(s.rect.width - stageBefore.width) < 1, 'the stage is back beside the list');
    assert.equal(s.panel, 1);
    assert.equal(s.panelX, 0);
    assert.equal(s.nav, 1);
    assert.equal(s.pillVis, 'hidden');
    assert.equal(s.open, 'open', 'still open');
    assert.equal(s.path, '/rio-grande-rv-resort');
    await close();
  });

  test('Back, Esc and the pill close the case without a page transition; Forward reopens it', async () => {
    const { page, close } = await open('/project');
    await recordFlips(page);
    await mark(page);
    await clickRow(page, 0);
    await caseOpen(page, 'recto-verso');
    const rv = await page.evaluate(() => {
      const b = document.querySelector('.v4-case_body');
      return { kids: b.children.length, videos: [...b.querySelectorAll('.w-background-video video')].map((v) => v.muted && v.autoplay), title: document.title };
    });
    assert.equal(rv.kids, 15, 'Recto Verso: all 15 children of the single wrapper');
    assert.deepEqual(rv.videos, [true, true, true], 'background videos kept, muted, autoplay');
    assert.equal(rv.title, 'Recto Verso | Thanh Quach');

    // Back
    await page.goBack();
    await caseClosed(page);
    let s = await caseState(page);
    assert.equal(s.path, '/project');
    assert.equal(s.title, 'Projects | Thanh Quach');
    assert.deepEqual(s.active, ['recto-verso'], "that project's preview stays");
    assert.equal(s.windowLenisStopped, false, "the window's Lenis runs again");
    assert.equal(s.open, null);

    // Forward
    await page.goForward();
    await caseOpen(page, 'recto-verso');
    s = await caseState(page);
    assert.equal(s.path, '/project-t---recto-verso');
    assert.equal(s.title, 'Recto Verso | Thanh Quach');

    // Esc (steps back in history, so Forward stays in step)
    await page.keyboard.press('Escape');
    await caseClosed(page);
    s = await caseState(page);
    assert.equal(s.path, '/project');
    assert.equal(s.state, null);

    // The pill, once the list has slid away
    await clickRow(page, 0);
    await caseOpen(page, 'recto-verso');
    await page.evaluate(() => { const st = document.querySelector('[data-project-stage]'); st.scrollTop = 600; st.dispatchEvent(new Event('scroll')); });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.v4-case_back')).opacity === '1', null, { timeout: 3000 });
    assert.equal(await page.textContent('.v4-case_back'), '← All projects');
    const pill = await page.locator('.v4-case_back').boundingBox();
    assert.ok(pill.x < 40 && pill.y < 40, 'top-left');
    await page.click('.v4-case_back');
    await caseClosed(page);
    s = await caseState(page);
    assert.equal(s.path, '/project');
    assert.equal(s.panel, 1);
    assert.equal(s.nav, 1);
    assert.deepEqual(s.active, ['recto-verso']);

    const r = await frames(page);
    assert.deepEqual(r.flips, [], 'Barba never ran a transition');
    assert.equal(await sameDocument(page), true, 'same document, same container');
    await close();
  });

  test('"Next project →" and another row swap cases in place; hovering rows does not switch previews', async () => {
    const { page, close } = await open('/project');
    await mark(page);
    const len0 = await page.evaluate(() => history.length);
    await clickRow(page, 2);
    await caseOpen(page, 'rio-grande');
    // Hovering other rows leaves the open preview alone.
    await page.mouse.move(...(await center(page, 0)));
    await page.waitForTimeout(500);
    await page.mouse.move(...(await center(page, 1)));
    await page.waitForTimeout(500);
    let s = await caseState(page);
    assert.deepEqual(s.active, ['rio-grande'], 'hover does not switch previews while open');

    await page.click('.v4-case_next'); // scrolls the stage to it first, so the list has slid away
    await caseOpen(page, 'aloud');
    await page.waitForFunction(() => !document.querySelector('[data-project-stage]').style.position, null, { timeout: 2000 });
    s = await caseState(page);
    assert.equal(s.path, '/library-foundation-of-los-angeles');
    assert.equal(s.title, 'A New Narrative | Thanh Quach');
    assert.deepEqual(s.active, ['aloud'], 'the preview follows');
    assert.equal(s.top, 0, 'starts at the top of the next project');
    assert.equal(s.pos, '', 'with the list back');
    assert.equal(await page.evaluate(() => history.length), len0 + 1, 'swaps replace the entry');

    await clickRow(page, 1);
    await caseOpen(page, 'nuform');
    s = await caseState(page);
    assert.equal(s.path, '/nuform-v4');
    assert.deepEqual(s.active, ['nuform']);
    assert.deepEqual(await page.evaluate(() => [...document.querySelector('.v4-case_body').children].map((k) => k.className)), LFLA_BODY);
    assert.equal(await page.evaluate(() => history.length), len0 + 1);

    // One Back returns to /project.
    await page.goBack();
    await caseClosed(page);
    s = await caseState(page);
    assert.equal(s.path, '/project');
    assert.deepEqual(s.active, ['nuform']);
    assert.equal(await sameDocument(page), true);
    await close();
  });

  test('a slow page shows a 3 px bar across the top of the stage, then opens; Esc while loading cancels', async () => {
    const { page, close } = await open('/project');
    const slow = (re, ms) => page.route(re, async (route) => { await new Promise((r) => setTimeout(r, ms)); await route.continue(); });
    await slow(/\/rio-grande-rv-resort$/, 800);
    await clickRow(page, 2); // straight away: the hover intent never got to fetch it
    await page.waitForTimeout(250);
    const bar = await page.evaluate(() => {
      const p = document.querySelector('[data-project-stage] .v4-case_progress');
      const st = document.querySelector('[data-project-stage]').getBoundingClientRect();
      if (!p) return null;
      const r = p.getBoundingClientRect();
      return { h: r.height, top: r.top - st.top, left: r.left - st.left, scale: new DOMMatrix(getComputedStyle(p).transform).a, path: location.pathname, open: !!document.querySelector('.v4-case') };
    });
    assert.ok(bar, 'the bar is there');
    assert.equal(bar.h, 3);
    assert.equal(bar.top, 0);
    assert.equal(bar.left, 0);
    assert.ok(bar.scale > 0.3 && bar.scale < 1, `filling (${bar.scale})`);
    assert.equal(bar.path, '/project', 'nothing changes until the page arrives');
    assert.equal(bar.open, false);
    assert.deepEqual((await state(page)).active, ['rio-grande'], 'the preview shows at once');
    await page.screenshot({ path: path.join(SHOTS, 'case-loading.png') });
    await caseOpen(page, 'rio-grande');
    assert.equal(new URL(page.url()).pathname, '/rio-grande-rv-resort');
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.v4-case_progress').count(), 0, 'the bar is gone');

    await page.keyboard.press('Escape');
    await caseClosed(page);
    await slow(/\/nuform-v4$/, 800);
    await clickRow(page, 1);
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
    const s = await caseState(page);
    assert.equal(s.path, '/project', 'cancelled');
    assert.equal(s.open, null);
    assert.equal(await page.locator('.v4-case_progress').count(), 0);
    await close();
  });

  test('phone: the first tap previews, the second opens it full-screen; the pill and Back close it', async () => {
    const { page, close } = await open('/project', { viewport: PHONE, touch: true });
    // page.tap() waits for the row to stop moving; tap by coordinates like a finger would.
    const tapRow = async (i) => {
      const b = await page.locator('.project-list_row').nth(i).boundingBox();
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    };
    const stageBefore = await page.evaluate(() => document.querySelector('[data-project-stage]').getBoundingClientRect().toJSON());
    await tapRow(2);
    await page.waitForTimeout(600);
    assert.deepEqual((await state(page)).active, ['rio-grande']);
    assert.equal(new URL(page.url()).pathname, '/project');
    await page.screenshot({ path: path.join(SHOTS, 'project-phone-preview.png') });
    await tapRow(0);
    await page.waitForTimeout(700);
    assert.deepEqual((await state(page)).active, ['recto-verso'], 'tapping another row previews it');
    assert.equal(new URL(page.url()).pathname, '/project');

    await tapRow(0);
    await caseOpen(page, 'recto-verso');
    await page.waitForTimeout(800);
    let s = await caseState(page);
    assert.equal(s.path, '/project-t---recto-verso');
    assert.deepEqual([s.rect.left, s.rect.top, Math.round(s.rect.width), Math.round(s.rect.height)], [0, 0, PHONE.width, PHONE.height], 'full screen');
    assert.equal(s.panel, 0);
    assert.equal(s.panelY, 60, 'the list slid down and out');
    assert.equal(s.pill, 1);
    await page.screenshot({ path: path.join(SHOTS, 'case-phone.png') });
    await page.evaluate(() => { const st = document.querySelector('[data-project-stage]'); st.scrollTop = 900; st.dispatchEvent(new Event('scroll')); });
    await page.waitForTimeout(300);
    s = await caseState(page);
    assert.equal(s.top, 900, 'the stage scrolls');
    assert.equal(s.winY, 0, 'the window does not');
    assert.equal(s.pos, 'fixed', 'still full screen');

    const pill = await page.locator('.v4-case_back').boundingBox();
    await page.touchscreen.tap(pill.x + pill.width / 2, pill.y + pill.height / 2);
    await caseClosed(page);
    await page.waitForTimeout(300);
    s = await caseState(page);
    assert.equal(s.path, '/project');
    assert.ok(Math.abs(s.rect.top - stageBefore.top) < 1 && Math.abs(s.rect.height - stageBefore.height) < 1, 'the stage is back in its place');
    assert.equal(s.panel, 1);
    assert.deepEqual(s.active, ['recto-verso']);

    // The preview is still up, so one tap opens it again; Back closes.
    await tapRow(0);
    await caseOpen(page, 'recto-verso');
    await page.goBack();
    await caseClosed(page);
    assert.equal(new URL(page.url()).pathname, '/project');
    await close();
  });

  test('a nav link while a case is open closes it and runs the normal glide; Back returns to /project', async () => {
    const { page, close } = await open('/project');
    await clickRow(page, 3);
    await caseOpen(page, 'aloud');
    // "Project" itself just closes the case.
    await recordFlips(page);
    await page.click('.nav_link[href="/project"]');
    await caseClosed(page);
    let s = await caseState(page);
    assert.equal(s.path, '/project');
    assert.deepEqual((await frames(page)).flips, [], 'no transition');

    await clickRow(page, 3);
    await caseOpen(page, 'aloud');
    await page.click('.nav_link[href="/archive"]');
    await flipDone(page, '/archive');
    const r = await frames(page);
    assert.deepEqual(r.flips, ['forward'], 'the normal page transition');
    assert.deepEqual([...new Set(r.variants)], ['glide']);
    const a = await page.evaluate(() => ({
      leftovers: document.querySelectorAll('.v4-case, .v4-case_back, .v4-case_progress, .v4-case_slot').length,
      lenisStopped: document.documentElement.classList.contains('lenis-stopped'),
      title: document.title,
      current: [...document.querySelectorAll('.nav_component a.w--current')].map((x) => x.getAttribute('href')),
      chrome: [...document.querySelectorAll('.nav_component, .footer_component')].map((el) => el.style.opacity + el.style.visibility),
    }));
    assert.equal(a.leftovers, 0);
    assert.equal(a.lenisStopped, false, "the window's Lenis runs on the Archive");
    assert.equal(a.title, 'Archive | Thanh Quach');
    assert.deepEqual(a.current, ['/archive']);
    assert.deepEqual(a.chrome, ['', ''], 'nav and footer untouched');

    await resetFrames(page);
    await page.goBack();
    await flipDone(page, '/project');
    s = await caseState(page);
    assert.equal(s.path, '/project', 'Back lands on /project, not the case URL');
    assert.equal(s.open, null);
    assert.deepEqual((await frames(page)).flips, ['back']);

    // V4.navigate does the same.
    await clickRow(page, 2);
    await caseOpen(page, 'rio-grande');
    await resetFrames(page);
    await page.evaluate(() => window.V4.navigate('/'));
    await flipDone(page, '/');
    assert.deepEqual((await frames(page)).flips, ['back']);
    await page.goBack();
    await flipDone(page, '/project');
    assert.equal(new URL(page.url()).pathname, '/project');
    await close();
  });

  test('a link inside the case to another page leaves normally; a cache restore keeps the case open', async () => {
    const { page, close } = await open('/project');
    await page.evaluate(() => { window.__assigned = []; window.V4.assign = (href) => window.__assigned.push(href); });
    await clickRow(page, 3);
    await caseOpen(page, 'aloud');
    await page.click('.v4-case .case-link');
    await page.waitForFunction(() => window.__assigned.length === 1, null, { timeout: 3000 });
    assert.equal(new URL(await page.evaluate(() => window.__assigned[0])).pathname, '/archives/cactus-light');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await page.waitForFunction(() => !window.V4.isBusy() && !document.querySelector('[data-barba="wrapper"]').hasAttribute('data-flip'), null, { timeout: 3000 });
    await page.waitForTimeout(900);
    const s = await caseState(page);
    assert.equal(s.path, '/library-foundation-of-los-angeles');
    assert.equal(s.open, 'open', 'still open');
    assert.equal(s.windowLenisStopped, true, "the window's Lenis is paused again");
    await page.keyboard.press('Escape');
    await caseClosed(page);
    assert.equal(new URL(page.url()).pathname, '/project');
    await close();
  });
});

// ---------------------------------------------------------------------------------------------------
describe('archive', () => {
  const state = (page) => page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-archive="row"]')];
    const i = rows.findIndex((r) => r.classList.contains('is-active'));
    const wrap = document.querySelector('[data-archive="list"]').getBoundingClientRect();
    const row = rows[i].getBoundingClientRect();
    const cover = [...document.querySelectorAll('.archive_cover')].find((c) => c.classList.contains('is-active'));
    return {
      i,
      counter: document.querySelector('.archive_counter-current .v4-sr-only').textContent,
      total: document.querySelector('.archive_counter-total').textContent,
      bg: getComputedStyle(document.querySelector('[data-archive="bg"]')).backgroundColor,
      ink: document.querySelector('.page-wrapper').getAttribute('data-ink'),
      offCenter: Math.abs(row.top + row.height / 2 - (wrap.top + wrap.height / 2)),
      cover: cover && cover.dataset.slug,
      coverOpacity: cover && getComputedStyle(cover).opacity,
      blur: rows.map((r) => r.style.filter),
      opacity: rows.map((r) => Number(r.style.opacity)),
      versionColor: getComputedStyle(document.querySelector('.footer_version')).color,
      clockColor: getComputedStyle(document.querySelector('.footer_clock-time')).color,
      navColor: getComputedStyle(document.querySelector('.nav_link')).color,
      lastWheelPrevented: window.__lastWheelPrevented,
    };
  });
  const overList = async (page) => {
    const b = await page.locator('[data-archive="list"]').boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  };

  test('wheel: one notch = one row; color, ink, cover, counter and blur follow', async () => {
    const { page, close } = await open('/archive');
    await page.evaluate(() => window.addEventListener('wheel', (e) => { window.__lastWheelPrevented = e.defaultPrevented; }, { passive: true }));
    await page.waitForTimeout(600); // let Webflow's .4 s color transitions on the nav and footer finish
    let s = await state(page);
    assert.equal(s.i, 0);
    assert.equal(s.counter, '01');
    assert.equal(s.total, ' / 05');
    assert.equal(s.bg, 'rgb(75, 71, 102)');
    assert.equal(s.ink, 'light');
    assert.ok(s.offCenter < 1, 'the chosen row sits on the center line');
    assert.equal(s.cover, 'talos');
    assert.equal(s.versionColor, 'rgb(255, 255, 255)', 'VER flips to light ink on desktop Archive');
    assert.equal(s.clockColor, 'rgb(123, 116, 116)', 'the clock keeps the quiet color on the white panel');
    assert.equal(s.navColor, 'rgb(255, 255, 255)');

    await overList(page);
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(900);
    s = await state(page);
    assert.equal(s.lastWheelPrevented, true, 'the dial takes the wheel');
    assert.equal(s.i, 1);
    assert.equal(s.counter, '02');
    assert.equal(s.bg, 'rgb(197, 199, 198)');
    assert.equal(s.ink, 'dark', 'light cover → dark ink');
    assert.ok(s.offCenter < 1);
    assert.equal(s.cover, 'cactus-lamp');
    assert.equal(s.coverOpacity, '1');
    assert.equal(s.blur[1], '', 'the chosen row is sharp');
    const px = (f) => Number((/blur\(([\d.]+)px\)/.exec(f) || [0, 0])[1]);
    assert.ok(Math.abs(px(s.blur[0]) - 1.265) < 0.011, `one row away: (1 − .45) × 2.3 (${s.blur[0]})`);
    assert.ok(Math.abs(px(s.blur[4]) - 5.865) < 0.011, `three rows away: (3 − .45) × 2.3 (${s.blur[4]})`);
    assert.deepEqual(s.opacity, [0.8, 1, 0.8, 0.6, 0.4], 'opacity max(.14, 1 − d × .2)');
    await page.screenshot({ path: path.join(SHOTS, 'archive-row2.png') });

    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(900);
    s = await state(page);
    assert.equal(s.i, 2);
    assert.equal(s.bg, 'rgb(13, 51, 83)');
    assert.equal(s.ink, 'light');
    assert.equal(s.cover, 'weather-watchos');

    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(900);
    assert.equal((await state(page)).i, 1, 'one notch up = one row up');

    // Fast notches pass through rows without waiting for each change.
    await page.mouse.wheel(0, 100);
    await page.mouse.wheel(0, 100);
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(1000);
    s = await state(page);
    assert.equal(s.i, 4);
    assert.equal(s.counter, '05');
    assert.ok(s.offCenter < 1);

    // Trackpad-style small deltas move freely, then snap to a row.
    await page.mouse.wheel(0, -30);
    await page.mouse.wheel(0, -30);
    await page.mouse.wheel(0, -30);
    await page.waitForTimeout(900);
    s = await state(page);
    assert.ok(s.i === 3 || s.i === 2, `trackpad snapped to row ${s.i}`);
    assert.ok(s.offCenter < 1, 'and it lands exactly on the center line');

    // Keyboard: arrows move exactly one row.
    await page.focus('[data-archive="list"]');
    const before = s.i;
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(700);
    assert.equal((await state(page)).i, before - 1);
    await page.keyboard.press('Home');
    await page.waitForTimeout(800);
    assert.equal((await state(page)).i, 0);
    await page.keyboard.press('Enter'); // Talos has no page: nothing opens
    await page.waitForTimeout(300);
    assert.equal(new URL(page.url()).pathname, '/archive');
    await close();
  });

  test('wheel passes through to the page at either end on short screens', async () => {
    const { page, close } = await open('/archive', { viewport: { width: 1440, height: 480 } });
    // The desktop root size keeps the layout within the window, so make the page taller than it.
    await page.addStyleTag({ content: '.section_archive { min-height: 130vh; }' });
    await page.evaluate(() => window.addEventListener('wheel', (e) => { window.__lastWheelPrevented = e.defaultPrevented; }, { passive: true }));
    await overList(page);
    await page.mouse.wheel(0, -100); // already on the first row
    await page.waitForTimeout(300);
    assert.equal((await state(page)).lastWheelPrevented, false, 'first row + wheel up: not taken by the dial');
    await page.keyboard.press('Tab');
    await page.focus('[data-archive="list"]');
    await page.keyboard.press('End');
    await page.waitForTimeout(900);
    await overList(page);
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(600);
    const s = await state(page);
    assert.equal(s.i, 4);
    assert.equal(s.lastWheelPrevented, false, 'last row + wheel down: passes through');
    const scrolled = await page.evaluate(() => window.scrollY);
    assert.ok(scrolled > 0, `the page scrolled (${scrolled}px)`);
    await close();
  });

  test('click centers a row; a second click on the centered row opens it; drag snaps', async () => {
    const { page, close } = await open('/archive');
    await page.click('.archive_item:nth-child(4) .archive_name');
    await page.waitForTimeout(800);
    let s = await state(page);
    assert.equal(s.i, 3);
    assert.ok(s.offCenter < 1);
    assert.equal(new URL(page.url()).pathname, '/archive', 'the first click only centers');

    // Drag up by about two rows, release: momentum, then a row-by-row snap.
    const b = await page.locator('[data-archive="list"]').boundingBox();
    const x = b.x + b.width / 2;
    await page.mouse.move(x, b.y + b.height * 0.6);
    await page.mouse.down();
    for (let k = 1; k <= 8; k++) await page.mouse.move(x, b.y + b.height * 0.6 + k * 16, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(1000);
    s = await state(page);
    assert.ok(s.i < 3, `dragged down to row ${s.i}`);
    assert.ok(s.offCenter < 1, 'snapped onto the center line');
    assert.equal(new URL(page.url()).pathname, '/archive', 'a drag never opens a row');

    const n = s.i + 1;
    await page.click(`.archive_item:nth-child(${n}) .archive_name`);
    if (n === 1) { // Talos has no page
      await page.waitForTimeout(400);
      assert.equal(new URL(page.url()).pathname, '/archive');
    } else {
      await page.waitForURL(/\/archives\//, { timeout: 5000 });
    }
    await close();
  });

  test('opening the centered row grows the cover to fill the window; Back collapses it', async () => {
    const { page, close } = await open('/archive');
    await page.evaluate(() => { window.__assigned = []; window.V4.assign = (href) => window.__assigned.push([href, performance.now()]); });
    await page.click('.archive_item:nth-child(3) .archive_name');
    await page.waitForTimeout(900);
    const before = await page.evaluate(() => document.querySelector('[data-archive="covers"]').getBoundingClientRect().toJSON());
    const t0 = await page.evaluate(() => performance.now());
    await page.click('.archive_item:nth-child(3) .archive_name');
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(SHOTS, 'expand-archive-mid.png') });
    await page.waitForFunction(() => window.__assigned.length === 1, null, { timeout: 3000 });
    const done = await page.evaluate(() => ({
      href: new URL(window.__assigned[0][0]).pathname,
      at: window.__assigned[0][1],
      rect: document.querySelector('[data-archive="covers"]').getBoundingClientRect().toJSON(),
      panel: Number(getComputedStyle(document.querySelector('.archive_panel')).opacity),
      ground: getComputedStyle(document.querySelector('.v4-ground')).backgroundColor,
      flip: document.querySelector('[data-barba="wrapper"]').getAttribute('data-flip'),
    }));
    assert.equal(done.href, '/archives/designing-mcrointeractions');
    assert.ok(done.at - t0 > 780 && done.at - t0 < 1000, `about 0.85 s (${Math.round(done.at - t0)} ms)`);
    assert.deepEqual([done.rect.left, done.rect.top, Math.round(done.rect.width), Math.round(done.rect.height)], [0, 0, 1440, 900], 'the cover fills the window');
    assert.ok(done.panel < 0.01);
    assert.equal(done.ground, 'rgb(13, 51, 83)', "the row's cover colour (no data-ground set)");
    assert.equal(done.flip, 'expand');

    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await page.waitForFunction(() => !document.querySelector('[data-archive="covers"]').getAttribute('style'), null, { timeout: 3000 });
    const after = await page.evaluate(() => document.querySelector('[data-archive="covers"]').getBoundingClientRect().toJSON());
    assert.ok(Math.abs(after.left - before.left) < 1 && Math.abs(after.top - before.top) < 1 && Math.abs(after.width - before.width) < 1, 'the cover is back in its place');
    // The dial works again.
    const b = await page.locator('[data-archive="list"]').boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(900);
    assert.equal((await state(page)).i, 3);
    await close();
  });

  test('phones: two blur steps only (0 and 4 px), whole footer flips light over a dark cover', async () => {
    const { page, close } = await open('/archive', { viewport: PHONE, touch: true });
    await page.waitForTimeout(600);
    const s = await state(page);
    assert.deepEqual(s.blur, ['', 'blur(4px)', 'blur(4px)', 'blur(4px)', 'blur(4px)']);
    assert.equal(s.clockColor, 'rgb(255, 255, 255)');
    assert.equal(s.versionColor, 'rgb(255, 255, 255)');
    const rowH = await page.evaluate(() => document.querySelector('.archive_item').getBoundingClientRect().height);
    assert.ok(rowH >= 48, 'rows at least 48 px tall for thumbs');
    // A vertical swipe on the list turns the dial.
    const b = await page.locator('[data-archive="list"]').boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const x = b.x + b.width / 2, y0 = b.y + b.height * 0.7;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
    for (let k = 1; k <= 6; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 - k * 18 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(1000);
    const after = await state(page);
    assert.ok(after.i >= 1, `swipe up moved the dial to row ${after.i}`);
    assert.ok(after.offCenter < 1);
    assert.equal(await page.evaluate(() => window.scrollY), 0, 'the page did not scroll');
    await page.screenshot({ path: path.join(SHOTS, 'archive-phone.png') });
    await close();
  });
});

// ---------------------------------------------------------------------------------------------------
describe('reduced motion', () => {
  const RM = { reducedMotion: 'reduce' };

  test('Home: wordmark in place, short fade, no wave, no Lenis', async () => {
    const { page, close } = await open('/', RM);
    const first = await page.evaluate(() => ({
      transform: getComputedStyle(document.querySelector('.nav_logo')).transform,
      lenis: document.documentElement.classList.contains('lenis'),
    }));
    assert.equal(first.transform, 'none', 'the wordmark starts in place');
    assert.equal(first.lenis, false, 'Lenis is off');
    await settled(page);
    const t = await page.evaluate(() => performance.now());
    assert.ok(t < 3500, `preloader done quickly (${Math.round(t)} ms)`);
    const moved = await page.evaluate(async () => {
      let seen = 0;
      const t0 = performance.now();
      await new Promise((resolve) => {
        const tick = () => {
          seen += [...document.querySelectorAll('.home-grid_item')].filter((c) => c.getAnimations().length).length;
          if (performance.now() - t0 > 5500) resolve(); else requestAnimationFrame(tick);
        };
        tick();
      });
      return seen;
    });
    assert.equal(moved, 0, 'no waves');
    await close();
  });

  test('every variant becomes a 0.2 s crossfade', async () => {
    const { page, close } = await open('/project?t=turn', RM);
    await recordFlips(page);
    const t0 = Date.now();
    await page.click('.nav_link[href="/archive"]');
    await flipDone(page, '/archive');
    const r = await frames(page);
    assert.equal(r.frames.filter((f) => f.rot !== null || f.x !== null || f.blur !== null).length, 0, 'no movement, no blur');
    assert.ok(r.frames.some((f) => f.ns === 'project' && f.opacity !== null && f.opacity < 1 && f.opacity > 0), 'the old page fades');
    assert.ok(Date.now() - t0 < 2000);
    await close();
  });

  test('the Archive expand becomes a short fade to the ground', async () => {
    const { page, close } = await open('/archive', RM);
    await page.evaluate(() => { window.__assigned = []; window.V4.assign = (href) => window.__assigned.push([href, performance.now()]); });
    await page.click('.archive_item:nth-child(3) .archive_name');
    await page.waitForTimeout(200);
    const t0 = await page.evaluate(() => performance.now());
    await page.click('.archive_item:nth-child(3) .archive_name');
    await page.waitForFunction(() => window.__assigned.length === 1, null, { timeout: 3000 });
    const r = await page.evaluate(() => ({ at: window.__assigned[0][1], position: getComputedStyle(document.querySelector('[data-archive="covers"]')).position, ground: getComputedStyle(document.querySelector('.v4-ground')).opacity }));
    assert.ok(r.at - t0 < 450, `quick (${Math.round(r.at - t0)} ms)`);
    assert.notEqual(r.position, 'fixed', 'nothing grows');
    assert.equal(r.ground, '1');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.v4-ground')).display === 'none', null, { timeout: 2000 });
    await close();
  });

  test('Project opens a case in place with no slide or fade, and closes the same way', async () => {
    const { page, close } = await open('/project', RM);
    const b = await page.locator('.project-list_row').nth(3).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(300); // fetched on the hover intent
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForSelector('.v4-case', { timeout: 3000 });
    const now = (fn) => page.evaluate(fn);
    const opened = await now(() => {
      const c = document.querySelector('.v4-case');
      const st = document.querySelector('[data-project-stage]');
      return { opacity: getComputedStyle(c).opacity, path: location.pathname, stageLenis: st.classList.contains('lenis'), focused: document.activeElement === st };
    });
    assert.equal(opened.opacity, '1', 'no fade in');
    assert.equal(opened.path, '/library-foundation-of-los-angeles');
    assert.equal(opened.stageLenis, false, 'native scroll in the stage');
    assert.equal(opened.focused, true, 'focus moves into the case');
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(100);
    assert.ok(await now(() => document.querySelector('[data-project-stage]').scrollTop) > 200, 'the keyboard scrolls the case');
    await now(() => { const st = document.querySelector('[data-project-stage]'); st.scrollTop = 0; });
    await page.waitForTimeout(50);
    // Past 24 px: the list is gone on the same frame.
    const collapsed = await now(() => new Promise((resolve) => {
      const st = document.querySelector('[data-project-stage]');
      st.scrollTop = 100;
      st.addEventListener('scroll', () => requestAnimationFrame(() => {
        const r = st.getBoundingClientRect();
        resolve({ rect: [r.left, r.top, Math.round(r.width), Math.round(r.height)], panel: getComputedStyle(document.querySelector('.project-list_panel')).opacity, pill: getComputedStyle(document.querySelector('.v4-case_back')).opacity });
      }), { once: true });
    }));
    assert.deepEqual(collapsed.rect, [0, 0, 1440, 900]);
    assert.equal(collapsed.panel, '0');
    assert.equal(collapsed.pill, '1');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.v4-case'), null, { timeout: 1000 });
    const closed = await now(() => ({ path: location.pathname, panel: getComputedStyle(document.querySelector('.project-list_panel')).opacity, pos: document.querySelector('[data-project-stage]').style.position, focus: document.activeElement.getAttribute('data-project') }));
    assert.deepEqual(closed, { path: '/project', panel: '1', pos: '', focus: 'aloud' }, 'focus returns to the row');
    await close();
  });

  test('Archive snaps instantly; Project swaps instantly', async () => {
    const { page, close } = await open('/archive', RM);
    const b = await page.locator('[data-archive="list"]').boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(60);
    const snap = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-archive="row"]')];
      const wrap = document.querySelector('[data-archive="list"]').getBoundingClientRect();
      const r = rows[1].getBoundingClientRect();
      return { active: rows.findIndex((x) => x.classList.contains('is-active')), off: Math.abs(r.top + r.height / 2 - (wrap.top + wrap.height / 2)), cover: getComputedStyle(document.querySelector('.archive_cover[data-slug="cactus-lamp"]')).opacity };
    });
    assert.equal(snap.active, 1);
    assert.ok(snap.off < 1, 'already on the center line');
    assert.equal(snap.cover, '1', 'cover swapped without the fade');
    await page.click('.nav_link[href="/project"]');
    await flipDone(page, '/project');
    const row = await page.locator('.project-list_row').nth(2).boundingBox();
    await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2);
    await page.waitForTimeout(140);
    const p = await page.evaluate(() => ({
      opacity: getComputedStyle(document.querySelector('.project-preview_item[data-project="rio-grande"]')).opacity,
      slatsMoving: [...document.querySelectorAll('.project-preview_slat')].filter((s) => s.getAnimations().length).length,
    }));
    assert.equal(p.opacity, '1');
    const row2 = await page.locator('.project-list_row').nth(3).boundingBox();
    await page.mouse.move(row2.x + row2.width / 2, row2.y + row2.height / 2);
    await page.waitForTimeout(30);
    const q = await page.evaluate(() => ({
      shown: [...document.querySelectorAll('.project-preview_slat img.is-shown')].map((i) => i.getAttribute('src').replace(/.*strip-|\.jpg/g, '')),
      moving: [...document.querySelectorAll('.project-preview_slat, [data-roll]')].filter((s) => s.getAnimations().length).length,
    }));
    assert.deepEqual(q.shown, Array(6).fill('aloud'), 'instant swap');
    assert.equal(q.moving, 0, 'no slat flip, no roll');
    await close();
  });
});

