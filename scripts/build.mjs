// Bundles src/ into dist/: v4.min.js (IIFE, minified, sourcemap), v4.min.css, and a copy of the Home head snippet.
import * as esbuild from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const watch = process.argv.includes('--watch');
const banner = `/*! itsthanh.me V4 ${pkg.version} | GSAP ${pkg.dependencies.gsap}, Barba ${pkg.dependencies['@barba/core']}, Lenis ${pkg.dependencies.lenis} */`;

const js = {
  entryPoints: ['src/index.js'],
  bundle: true,
  format: 'iife',
  minify: true,
  sourcemap: true,
  target: ['chrome92', 'safari15', 'firefox90', 'edge92'],
  outfile: 'dist/v4.min.js',
  banner: { js: banner },
  define: { __V4_VERSION__: JSON.stringify(pkg.version) },
  legalComments: 'none',
  logLevel: 'info',
};
const css = {
  entryPoints: ['src/v4.css'],
  bundle: true,
  minify: true,
  target: ['chrome92', 'safari15', 'firefox90', 'edge92'],
  outfile: 'dist/v4.min.css',
  banner: { css: banner },
  logLevel: 'info',
};

async function copySnippet() {
  const src = await readFile('src/preloader-head.html', 'utf8');
  // Strip the leading comment and blank lines; the snippet itself is already hand-minified.
  const out = src.replace(/<!--[\s\S]*?-->\s*/g, '').trim() + '\n';
  await writeFile('dist/preloader-head.html', out);
  return out.length;
}

async function report(snippetLen) {
  const rows = [];
  for (const f of ['dist/v4.min.js', 'dist/v4.min.css']) {
    const buf = await readFile(f);
    const sri = 'sha384-' + createHash('sha384').update(buf).digest('base64');
    rows.push(`${f.padEnd(18)} ${(buf.length / 1024).toFixed(1).padStart(6)} KB min  ${(gzipSync(buf, { level: 9 }).length / 1024).toFixed(1).padStart(5)} KB gzip  ${sri}`);
  }
  rows.push(`dist/preloader-head.html ${snippetLen} chars`);
  console.log(rows.join('\n'));
}

await mkdir('dist', { recursive: true });
if (watch) {
  const a = await esbuild.context(js), b = await esbuild.context(css);
  await Promise.all([a.watch(), b.watch()]);
  await copySnippet();
  console.log('watching src/ …');
} else {
  await Promise.all([esbuild.build(js), esbuild.build(css)]);
  await report(await copySnippet());
  require('./make-fixtures.cjs');
}
