// Static server for the fixtures, with the site's routes:
//   /          → fixtures/home.html        /project → fixtures/project.html     /archive → fixtures/archive.html
//   project and archive entry pages → fixtures/case.html (pages outside the page flip)
//   /dist/*, /fixtures/* → files
// Usage: node scripts/serve.cjs [port]   (default 4173). Set IMG_DELAY=ms to slow the artwork pool down.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.map': 'application/json', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
};
const PAGES = { '/': 'home.html', '/project': 'project.html', '/archive': 'archive.html' };
const CASES = [/^\/project-t---recto-verso$/, /^\/nuform$/, /^\/rio-grande-rv-resort$/, /^\/library-foundation-of-los-angeles$/, /^\/archives\/[\w-]+$/];

function start(port = 4173, opts = {}) {
  const imgDelay = Number(opts.imgDelay ?? process.env.IMG_DELAY ?? 0);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let p = decodeURIComponent(url.pathname).replace(/\/+$/, '') || '/';
    let file = null;
    if (PAGES[p]) file = path.join(ROOT, 'fixtures', PAGES[p]);
    else if (CASES.some((re) => re.test(p))) file = path.join(ROOT, 'fixtures', 'case.html');
    else if (p === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    else if (/^\/(dist|fixtures)\//.test(p)) file = path.join(ROOT, p);
    if (!file || !file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    const send = () => {
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
    };
    if (imgDelay && /\/fixtures\/img\/art-/.test(p)) setTimeout(send, imgDelay * (0.4 + Math.random() * 0.6));
    else send();
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

module.exports = { start };

if (require.main === module) {
  const port = Number(process.argv[2]) || 4173;
  start(port).then(() => console.log(`fixtures on http://127.0.0.1:${port}/`));
}
