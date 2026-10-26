// Builds the static review demo from the fixtures: relative links (home.html, project.html, archive.html, the
// four project pages as <slug>.html, case.html for archive entries), dist/, img/ and webflow.css side by side,
// plus a small transition picker on the three V4 pages (demo only, never in dist). Project rows open in place
// (fetching <slug>.html) when the demo is served over http(s); from file:// the fetch fails and they simply
// load the page. An existing index.html launcher in the target folder is left alone.
// Run after `npm run build`:  node scripts/make-demo.cjs <out-dir>
const fs = require('node:fs');
const path = require('node:path');
const { PROJECTS, ARCHIVE, CASE_PAGES } = require('./make-fixtures.cjs'); // also refreshes fixtures/

const ROOT = path.join(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'demo'));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function relink(html) {
  let s = html
    .replace(/\/fixtures\/webflow\.css/g, 'webflow.css')
    .replace(/\/fixtures\/img\//g, 'img/')
    .replace(/"\/dist\//g, '"dist/')
    .replace(/href="\/"/g, 'href="home.html"')
    .replace(/href="\/project"/g, 'href="project.html"')
    .replace(/href="\/archive"/g, 'href="archive.html"');
  // Projects link to their own (real-structure) pages; archive entries share one stand-in case page.
  PROJECTS.forEach((p) => { s = s.split(`href="${p.href}"`).join(`href="${p.href.slice(1)}.html"`); });
  ARCHIVE.filter((a) => a.href).forEach((a) => { s = s.split(`href="${a.href}"`).join(`href="case.html?a=${a.slug}"`); });
  return s;
}

const PICKER = `<!-- Review only (not part of dist): pick the page transition. It sets data-v4-transition on the
     page-wrapper, which Barba keeps, and remembers the choice for full page loads in this tab. -->
<style>
.demo-picker { position: fixed; z-index: 2000; left: 50%; top: 10px; transform: translateX(-50%); display: flex; align-items: center; gap: 2px;
  padding: 3px; border-radius: 999px; background: rgba(255, 255, 255, .78); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
  box-shadow: 0 0 0 1px rgba(43, 43, 43, .08), 0 8px 24px -12px rgba(30, 25, 60, .35); font: 500 12px/1 "IBM Plex Mono", ui-monospace, Menlo, monospace; }
.demo-picker span { padding: 0 8px 0 10px; color: #7b7474; letter-spacing: .04em; }
.demo-picker button { font: inherit; border: 0; background: transparent; color: #4b4766; padding: 7px 10px; border-radius: 999px; cursor: pointer; }
.demo-picker button[aria-pressed="true"] { background: #2b2b2b; color: #fff; }
.demo-picker button:focus-visible { outline: 2px solid #7d7bb6; outline-offset: 1px; }
@media (max-width: 767px) { .demo-picker { top: auto; bottom: 3.25rem; font-size: 11px; } .demo-picker span { display: none; } .demo-picker button { padding: 7px 8px; } }
</style>
<div class="demo-picker" role="group" aria-label="Page transition">
  <span>Transition</span>
  <button type="button" data-t="glide">Glide</button><button type="button" data-t="veil">Veil</button><button type="button" data-t="turn">Turn</button><button type="button" data-t="dissolve">Dissolve</button>
</div>
<script>
(function () {
  var KEY = 'v4-demo-transition';
  var wrap = document.querySelector('.page-wrapper');
  var buttons = [].slice.call(document.querySelectorAll('.demo-picker button'));
  var saved = null;
  try { saved = sessionStorage.getItem(KEY); } catch (e) {}
  if (saved && !/[?&]t=/.test(location.search)) wrap.setAttribute('data-v4-transition', saved);
  function sync() {
    var v = (window.V4 && window.V4.transition) ? window.V4.transition() : (wrap.getAttribute('data-v4-transition') || 'glide');
    buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-t') === v)); });
  }
  buttons.forEach(function (b) {
    b.addEventListener('click', function () {
      var v = b.getAttribute('data-t');
      wrap.setAttribute('data-v4-transition', v);
      try { sessionStorage.setItem(KEY, v); } catch (e) {}
      sync();
    });
  });
  document.addEventListener('v4:ready', sync);
  sync();
})();
</script>
`;

fs.mkdirSync(path.join(OUT, 'dist'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });
for (const name of ['home', 'project', 'archive']) {
  const html = relink(read(`fixtures/${name}.html`)).replace('<!-- Footer code (Home, Project, Archive) -->', `${PICKER}<!-- Footer code (Home, Project, Archive) -->`);
  fs.writeFileSync(path.join(OUT, `${name}.html`), html);
}
fs.writeFileSync(path.join(OUT, 'case.html'), relink(read('fixtures/case.html')));
for (const slug of CASE_PAGES) fs.writeFileSync(path.join(OUT, `${slug}.html`), relink(read(`fixtures/cases/${slug}.html`)));
fs.writeFileSync(path.join(OUT, 'webflow.css'), relink(read('fixtures/webflow.css')));
for (const f of ['v4.min.js', 'v4.min.css']) fs.copyFileSync(path.join(ROOT, 'dist', f), path.join(OUT, 'dist', f));
for (const f of fs.readdirSync(path.join(ROOT, 'fixtures', 'img'))) fs.copyFileSync(path.join(ROOT, 'fixtures', 'img', f), path.join(OUT, 'img', f));
console.log(`demo: ${OUT}${fs.existsSync(path.join(OUT, 'index.html')) ? ' (kept index.html)' : ''}`);
