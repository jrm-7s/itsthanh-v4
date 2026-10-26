// Generates the stand-in images for fixtures/ by drawing on a canvas in headless Chromium
// (the same generative styles as the approved demos). Run: node scripts/make-fixture-images.cjs
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'fixtures', 'img');

const JOBS = [
  ...Array.from({ length: 16 }, (_, i) => ({ file: `art-${String(i + 1).padStart(2, '0')}.jpg`, kind: 'art', w: 256, h: 256, seed: 1013 * i + 7, i })),
  { file: 'strip-recto-verso.jpg', kind: 'strip', style: 'eeg', w: 400, h: 1200, seed: 11, pal: ['#e9e4fb', '#b3a6f0', '#5b4fc4', '#1e1745'] },
  { file: 'strip-nuform.jpg', kind: 'strip', style: 'blob', w: 400, h: 1200, seed: 12, pal: ['#fbeee6', '#f2b9a0', '#c76d8e', '#4a2550'] },
  { file: 'strip-rio-grande.jpg', kind: 'strip', style: 'horizon', w: 400, h: 1200, seed: 13, pal: ['#f3ead8', '#d9b98a', '#9a6a3a', '#3b2a1c'] },
  { file: 'strip-aloud.jpg', kind: 'strip', style: 'ribs', w: 400, h: 1200, seed: 14, pal: ['#e8f1f5', '#9cc6d6', '#4b7fa8', '#1c2b4a'] },
  { file: 'cover-talos.jpg', kind: 'cover', style: 'rings', w: 520, h: 520, seed: 31, pal: ['#d8d6ea', '#8f8ab8', '#4b4766', '#ffffff'] },
  { file: 'cover-cactus-lamp.jpg', kind: 'cover', style: 'icon', w: 520, h: 520, seed: 38, pal: ['#e4e6e5', '#c5c7c6', '#6f7a70', '#ffffff'] },
  { file: 'cover-weather-watchos.jpg', kind: 'cover', style: 'dots', w: 520, h: 520, seed: 45, pal: ['#1d4f7a', '#3d7fb3', '#0d3353', '#ffffff'] },
  { file: 'cover-apple-mail.jpg', kind: 'cover', style: 'icon', w: 520, h: 520, seed: 52, pal: ['#8fc4fb', '#5aa2f5', '#2481f0', '#ffffff'] },
  { file: 'cover-clock-for-alien.jpg', kind: 'cover', style: 'waves', w: 520, h: 520, seed: 59, pal: ['#8fa3a5', '#5d7173', '#3b4d4f', '#ffffff'] },
];

function draw(job) {
  /* eslint-disable no-undef */
  const { w: W, h: H, seed } = job;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  let s = seed >>> 0;
  const r = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  const PALS = [
    ['#efeafc', '#b7a8f0', '#6a5ccf', '#2b2160'], ['#fbeee6', '#f2b9a0', '#c76d8e', '#4a2550'],
    ['#e8f1f5', '#9cc6d6', '#4b7fa8', '#1c2b4a'], ['#f3f1ea', '#cfc8b4', '#7d7766', '#2a2823'],
    ['#eef7ee', '#a9d4b5', '#4f8f7a', '#1d3a35'], ['#f6ecf7', '#dba7e0', '#9a4fb3', '#331a45'],
  ];
  const ST = {
    blob(p) { const lg = g.createLinearGradient(0, 0, W * r(), H); lg.addColorStop(0, p[0]); lg.addColorStop(1, p[1]); g.fillStyle = lg; g.fillRect(0, 0, W, H);
      for (let k = 0; k < 4; k++) { const x = W * (.1 + .8 * r()), y = H * (.15 + .8 * r()), rad = Math.max(W, H) * (.3 + .3 * r()), col = p[2 + (k % 2)];
        const rg = g.createRadialGradient(x, y, 0, x, y, rad); rg.addColorStop(0, hexA(col, .82)); rg.addColorStop(1, hexA(col, 0)); g.fillStyle = rg; g.fillRect(0, 0, W, H); } },
    rings(p) { g.fillStyle = p[0]; g.fillRect(0, 0, W, H); const cx = W * r(), cy = H * r(), st = Math.max(W, H) / 40; g.lineWidth = st * .45;
      for (let k = 0; k < 70; k++) { g.strokeStyle = k % 2 ? p[2] : p[1]; g.beginPath(); g.arc(cx, cy, k * st, 0, Math.PI * 2); g.stroke(); } },
    eeg(p) { const lg = g.createLinearGradient(0, 0, 0, H); lg.addColorStop(0, p[3]); lg.addColorStop(1, p[2]); g.fillStyle = lg; g.fillRect(0, 0, W, H);
      const n = Math.max(6, Math.round(H / 46)); g.lineWidth = 1.6;
      for (let k = 0; k < n; k++) { const y0 = H * (k + .5) / n, ph = r() * 6, f1 = (.02 + r() * .03) * 400 / W, a1 = H / n * (.2 + r() * .3); g.strokeStyle = hexA(k % 2 ? p[0] : p[1], .85); g.beginPath();
        for (let x = 0; x <= W; x += 2) { const y = y0 + Math.sin(x * f1 + ph) * a1 + (r() - .5) * 2.4; if (x) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); } },
    halftone(p) { g.fillStyle = p[0]; g.fillRect(0, 0, W, H); const st = Math.max(W, H) / 14, fx = r(), fy = r(); g.fillStyle = p[2];
      for (let y = st / 2; y < H; y += st) for (let x = st / 2; x < W; x += st) { const d = Math.hypot(x / W - fx, y / H - fy); g.beginPath(); g.arc(x, y, Math.max(.8, st * .47 * (1 - d * 1.05)), 0, Math.PI * 2); g.fill(); } },
    stripes(p) { g.fillStyle = p[1]; g.fillRect(0, 0, W, H); g.save(); g.translate(W / 2, H / 2); g.rotate((r() - .5) * 1.4); const L = Math.hypot(W, H); let x = -L;
      while (x < L) { const w = 6 + r() * 20; g.fillStyle = r() < .5 ? p[2] : p[3]; g.globalAlpha = .55 + r() * .4; g.fillRect(x, -L, w, L * 2); x += w + 8 + r() * 18; } g.restore(); g.globalAlpha = 1; },
    mosaic(p) { const n = 7, sz = Math.max(W, H) / n; for (let y = 0; y < H; y += sz) for (let x = 0; x < W; x += sz) { const v = r(); g.fillStyle = v < .4 ? p[0] : v < .72 ? p[1] : v < .92 ? p[2] : p[3]; g.fillRect(x, y, Math.ceil(sz), Math.ceil(sz)); } },
    horizon(p) { const lg = g.createLinearGradient(0, 0, 0, H); lg.addColorStop(0, p[1]); lg.addColorStop(.6, p[0]); lg.addColorStop(1, p[1]); g.fillStyle = lg; g.fillRect(0, 0, W, H);
      const m = Math.min(W, H), cx = W * (.3 + .4 * r()), cy = H * (.5 + .12 * r()), rad = m * (.22 + .1 * r()); const rg = g.createRadialGradient(cx, cy, 0, cx, cy, rad); rg.addColorStop(0, p[2]); rg.addColorStop(1, p[3]);
      g.fillStyle = rg; g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.fill(); g.fillStyle = hexA(p[3], .88); g.fillRect(0, cy + rad * .35, W, H); },
    ribs(p) { g.fillStyle = p[3]; g.fillRect(0, 0, W, H); let x = -r() * W * .08;
      while (x < W) { const w = Math.max(60, W * (.18 + .16 * r())), gap = Math.max(14, W * (.05 + .06 * r())); const lg = g.createLinearGradient(x, 0, x + w, 0);
        lg.addColorStop(0, p[3]); lg.addColorStop(.3, p[1]); lg.addColorStop(.62, p[2]); lg.addColorStop(1, p[3]); g.fillStyle = lg; g.fillRect(x, 0, w, H); x += w + gap; } },
    icon(p) { const rg = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * .72); rg.addColorStop(0, p[1]); rg.addColorStop(1, p[0]); g.fillStyle = rg; g.fillRect(0, 0, W, H);
      const w = W * .46, x = (W - w) / 2; g.fillStyle = p[2]; g.beginPath(); g.roundRect(x, x, w, w, w * .23); g.fill();
      g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(x + w * .24, x + w * .32, w * .52, w * .36, 12); g.fill(); },
    dots(p) { g.fillStyle = p[0]; g.fillRect(0, 0, W, H); const n = 13, st = W / n, fx = r(), fy = r(); g.fillStyle = p[1];
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const cx = (x + .5) * st, cy = (y + .5) * st, d = Math.hypot(cx / W - fx, cy / H - fy); g.beginPath(); g.arc(cx, cy, Math.max(1, st * .46 * (1 - d)), 0, Math.PI * 2); g.fill(); } },
    waves(p) { g.fillStyle = p[2]; g.fillRect(0, 0, W, H); g.lineWidth = 2; for (let k = 0; k < 18; k++) { const y0 = H * (k + .5) / 18, ph = r() * 6, a = 6 + r() * 16; g.strokeStyle = k % 3 ? p[1] : p[0]; g.beginPath();
      for (let x = 0; x <= W; x += 3) { const y = y0 + Math.sin(x * .025 + ph) * a * Math.sin(x / W * Math.PI); if (x) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); } },
  };
  if (job.kind === 'art') {
    const names = ['blob', 'rings', 'eeg', 'halftone', 'stripes', 'mosaic', 'horizon'];
    ST[names[job.i % names.length]](PALS[(job.i * 5 + (job.i >> 2)) % PALS.length]);
  } else {
    ST[job.style](job.pal);
  }
  const d = g.getImageData(0, 0, W, H), a = d.data;
  for (let k = 0; k < a.length; k += 4) { const n = (r() - .5) * 20; a[k] += n; a[k + 1] += n; a[k + 2] += n; }
  g.putImageData(d, 0, 0);
  return c.toDataURL('image/jpeg', 0.8);
}

const LOGOS = {
  'logo-recto-verso.svg': ['RECTO', 'VERSO', '#4a3fb0'],
  'logo-nuform.svg': ['NU', 'FORM', '#b45f80'],
  'logo-rio-grande.svg': ['RIO', 'GRANDE', '#9a6a3a'],
  'logo-aloud.svg': ['ALOUD', 'LFLA', '#3d5a8a'],
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const job of JOBS) {
    const url = await page.evaluate(draw, job);
    fs.writeFileSync(path.join(OUT, job.file), Buffer.from(url.split(',')[1], 'base64'));
  }
  await browser.close();
  for (const [file, [a, b, color]] of Object.entries(LOGOS)) {
    fs.writeFileSync(path.join(OUT, file), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 150" width="96" height="150"><polygon points="0,16 56,0 96,22 96,132 40,150 0,130" fill="${color}"/><text x="11" y="40" fill="#fff" font-family="monospace" font-size="11" font-weight="600"><tspan x="11">${a}</tspan><tspan x="11" dy="13">${b}</tspan></text></svg>\n`);
  }
  console.log(`wrote ${JOBS.length + Object.keys(LOGOS).length} files to fixtures/img`);
})();
