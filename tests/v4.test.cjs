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

/** Records flip direction and the rotateY of each container on every frame. */
function recordFlips(page) {
  return page.evaluate(() => {
    window.__flips = [];
    window.__rot = [];
    const w = document.querySelector('[data-barba="wrapper"]');
    new MutationObserver(() => { const d = w.getAttribute('data-flip'); if (d) window.__flips.push(d); })
      .observe(w, { attributes: true, attributeFilter: ['data-flip'] });
    const tick = () => {
      document.querySelectorAll('[data-barba="container"]').forEach((c) => {
        const m = /rotateY\((-?[\d.]+)deg\)/.exec(c.style.transform);
        window.__rot.push([c.getAttribute('data-barba-namespace'), m ? Number(m[1]) : null, c.style.opacity]);
      });
      requestAnimationFrame(tick);
    };
    tick();
  });
}

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
      t: performance.now(),
    }));
    assert.equal(done.display, 'none');
    assert.ok(Math.abs(done.logoTop - 3.625 * (1440 / 97.5)) < 1.5, `wordmark lands in its nav spot (top ${done.logoTop})`);
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
describe('page flip', () => {
  test('Home → Project → Archive → Back → Back: direction, title, meta, w--current, top of page', async () => {
    const { page, close } = await open('/');
    await settled(page);
    await recordFlips(page);

    await page.hover('.nav_link[href="/project"]'); // Barba prefetches on hover
    await page.click('.nav_link[href="/project"]');
    await page.waitForFunction(() => window.__rot.some(([ns, deg]) => ns === 'home' && deg < -30 && deg > -70));
    await page.screenshot({ path: path.join(SHOTS, 'flip-forward-mid.png') });
    await flipDone(page, '/project');
    let r = await page.evaluate(() => ({ flips: window.__flips, rot: window.__rot }));
    assert.deepEqual(r.flips, ['forward']);
    let homeRot = r.rot.filter(([ns, d]) => ns === 'home' && d !== null).map(([, d]) => d);
    assert.ok(homeRot.length > 10, 'the old page turned');
    assert.ok(Math.min(...homeRot) <= -90 && Math.max(...homeRot) <= 0, 'forward: the old page turns right to left (0 → −100°)');
    assert.equal(r.rot.filter(([ns, d]) => ns === 'project' && d !== null).length, 0, 'forward: the new page waits underneath');
    let s = await navState(page);
    assert.equal(s.title, 'Projects | Thanh Quach');
    assert.match(s.description, /^Selected projects/);
    assert.deepEqual(s.current, ['/project']);
    assert.deepEqual(s.ariaCurrent, ['/project']);
    assert.equal(s.ink, 'light', "the Project page's own data-ink");
    assert.equal(s.namespace, 'project');
    assert.equal(s.wfPage, 'fixture-project');
    assert.equal(s.scrollY, 0);

    await page.evaluate(() => { window.__flips = []; window.__rot = []; });
    await page.click('.nav_link[href="/archive"]');
    await flipDone(page, '/archive');
    r = await page.evaluate(() => ({ flips: window.__flips, rot: window.__rot }));
    assert.deepEqual(r.flips, ['forward']);
    assert.ok(r.rot.some(([ns, d]) => ns === 'project' && d !== null && d < -45));
    s = await navState(page);
    assert.equal(s.title, 'Archive | Thanh Quach');
    assert.deepEqual(s.current, ['/archive']);
    assert.equal(s.namespace, 'archive');

    // Browser Back: Archive → Project turns left to right; the incoming page swings in on top.
    await page.evaluate(() => { window.__flips = []; window.__rot = []; });
    await page.goBack();
    await page.waitForFunction(() => window.__rot.some(([ns, deg]) => ns === 'project' && deg !== null && deg < -30 && deg > -70));
    await page.screenshot({ path: path.join(SHOTS, 'flip-back-mid.png') });
    await flipDone(page, '/project');
    r = await page.evaluate(() => ({ flips: window.__flips, rot: window.__rot }));
    assert.deepEqual(r.flips, ['back']);
    const projRot = r.rot.filter(([ns, d]) => ns === 'project' && d !== null).map(([, d]) => d);
    assert.ok(projRot[0] <= -90 && projRot[projRot.length - 1] > -15, 'back: the new page turns in from −100° to 0°');
    assert.equal(r.rot.filter(([ns, d]) => ns === 'archive' && d !== null).length, 0, 'back: the old page stays underneath');
    s = await navState(page);
    assert.equal(s.title, 'Projects | Thanh Quach');
    assert.deepEqual(s.current, ['/project']);
    assert.equal(s.ink, 'light');

    await page.evaluate(() => { window.__flips = []; });
    await page.goBack();
    await flipDone(page, '/');
    s = await navState(page);
    assert.deepEqual(await page.evaluate(() => window.__flips), ['back']);
    assert.match(s.title, /^Thanh Quach/);
    assert.deepEqual(s.current, ['/']);
    assert.equal(s.ink, 'dark');
    const containerStyle = await page.evaluate(() => document.querySelector('[data-barba="container"]').getAttribute('style'));
    assert.ok(!containerStyle, 'no inline styles left on the container');
    await close();
  });

  test('a link outside the three pages flips the page away, then loads normally', async () => {
    const { page, close } = await open('/archive');
    // Center "Cactus Lamp" (row 2), then click it again to open its entry page.
    await page.click('.archive_item:nth-child(2) .archive_name');
    await page.waitForFunction(() => document.querySelector('.archive_item:nth-child(2)').classList.contains('is-active'));
    await page.waitForTimeout(500);
    await page.click('.archive_item:nth-child(2) .archive_name');
    await page.waitForFunction(() => document.querySelector('[data-barba="wrapper"]').getAttribute('data-flip') === 'out');
    await page.waitForURL(`${BASE}/archives/cactus-light`, { timeout: 5000 });
    assert.equal(await page.textContent('#case-title'), 'cactus light');
    await close();
  });

  test('Back from the cache (pageshow persisted) resets the page and turns it back in', async () => {
    const { page, close } = await open('/project');
    const row = await page.locator('.project-list_row').nth(1).boundingBox();
    await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2);
    await page.waitForFunction(() => document.querySelector('.project-preview_item[data-project="nuform"]').classList.contains('is-active'));
    // Simulate the state a flip-out leaves behind, then the back/forward cache restoring it.
    await page.mouse.move(5, 5);
    await page.evaluate(() => {
      const c = document.querySelector('[data-barba="container"]');
      c.style.transform = 'perspective(4000px) rotateY(-100deg)';
      document.querySelector('[data-barba="wrapper"]').setAttribute('data-flip', 'out');
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    const mid = await page.evaluate(() => ({
      flip: document.querySelector('[data-barba="wrapper"]').getAttribute('data-flip'),
      lineup: document.querySelector('[data-project-lineup]').classList.contains('is-hidden'),
      active: document.querySelectorAll('.project-preview_item.is-active').length,
    }));
    assert.equal(mid.flip, null);
    assert.equal(mid.lineup, false, 'back on the lineup');
    assert.equal(mid.active, 0);
    await page.waitForFunction(() => !document.querySelector('[data-barba="container"]').getAttribute('style'), null, { timeout: 3000 });
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
    const prefetched = await page.evaluate(() => [...document.head.querySelectorAll('link[rel="prefetch"]')].map((l) => new URL(l.href).pathname));
    assert.deepEqual(prefetched, ['/project-t---recto-verso']);
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

  test('click flips out to the project page', async () => {
    const { page, close } = await open('/project');
    await page.mouse.move(...(await center(page, 3)));
    await page.waitForTimeout(300);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('[data-barba="wrapper"]').getAttribute('data-flip') === 'out');
    await page.waitForURL(`${BASE}/library-foundation-of-los-angeles`, { timeout: 5000 });
    await close();
  });

  test('touch: the first tap previews, a second tap on the same row opens', async () => {
    const { page, close } = await open('/project', { viewport: PHONE, touch: true });
    // page.tap() waits for the row to stop moving; tap by coordinates like a finger would.
    const tapRow = async (i) => {
      const b = await page.locator('.project-list_row').nth(i).boundingBox();
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    };
    await tapRow(2);
    await page.waitForTimeout(600);
    const s = await state(page);
    assert.deepEqual(s.active, ['rio-grande']);
    assert.equal(new URL(page.url()).pathname, '/project');
    await page.screenshot({ path: path.join(SHOTS, 'project-phone-preview.png') });
    await tapRow(0);
    await page.waitForTimeout(700);
    assert.deepEqual((await state(page)).active, ['recto-verso'], 'tapping another row previews it');
    assert.equal(new URL(page.url()).pathname, '/project');
    await tapRow(0);
    await page.waitForURL(`${BASE}/project-t---recto-verso`, { timeout: 5000 });
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

  test('page flip is a 0.2 s crossfade', async () => {
    const { page, close } = await open('/project', RM);
    await recordFlips(page);
    const t0 = Date.now();
    await page.click('.nav_link[href="/archive"]');
    await flipDone(page, '/archive');
    const r = await page.evaluate(() => window.__rot);
    assert.equal(r.filter(([, d]) => d !== null).length, 0, 'no rotation');
    assert.ok(r.some(([ns, , o]) => ns === 'project' && o !== '' && Number(o) < 1 && Number(o) > 0), 'the old page fades');
    assert.ok(Date.now() - t0 < 2000);
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

