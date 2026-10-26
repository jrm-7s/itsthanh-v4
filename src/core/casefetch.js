// Fetch a project's real page and pull out the case-study body, so the Project page can open it in place.
//
// What gets injected (and what doesn't):
// - LFLA layout (A New Narrative, Rio Grande, nuform v4): body > div.main-bq > div.page-wrapper > 6 children.
//   We take the children of .page-wrapper (never the element itself: its class collides with V4's Barba
//   wrapper), minus div.split-layout, the hero that duplicates the preview. The .main-bq nav (close X) and the
//   html font-size reset embed are left out.
// - Older layout (Recto Verso): body > one div > many children; we take all of them.
// - Anything else: the body's children minus scripts, style-only embeds and navs.
// Every <script> is removed, and so is any <style> that targets html, body or :root (it would break V4's
// fluid root size). Images (srcset, lazy), iframes and videos stay.
//
// Results are cached per URL for the whole visit (they survive Barba swaps), as a parsed fragment that each
// open clones.

const cache = new Map(); // absolute URL → { promise, value, done }

const ROOT_RULE = /(^|[\s,}])(html|body|:root)\s*[{,]/i;
const CHROME_TAGS = new Set(['SCRIPT', 'NOSCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NAV']);

function isChrome(el) {
  if (CHROME_TAGS.has(el.tagName)) return true;
  if (el.matches('.w-nav, [role="navigation"]')) return true;
  // A style- or script-only embed (e.g. the per-breakpoint html font-size reset).
  const kids = [...el.children];
  return kids.length > 0 && kids.every((k) => k.tagName === 'STYLE' || k.tagName === 'SCRIPT');
}

/** The nodes of the case body, in order, from a parsed page. */
export function extractCase(doc) {
  const body = doc.body;
  if (!body) return [];
  const wrapper = body.querySelector('.main-bq > .page-wrapper') || body.querySelector('.main-bq .page-wrapper');
  if (wrapper) return [...wrapper.children].filter((el) => !el.classList.contains('split-layout'));
  const top = [...body.children].filter((el) => !isChrome(el));
  if (top.length === 1 && top[0].tagName === 'DIV' && top[0].children.length > 1) return [...top[0].children].filter((el) => !isChrome(el));
  return top;
}

function sanitize(root) {
  root.querySelectorAll('script').forEach((s) => s.remove());
  root.querySelectorAll('style').forEach((s) => { if (ROOT_RULE.test(s.textContent || '')) s.remove(); });
  root.querySelectorAll('link[rel="stylesheet"], meta, title, base').forEach((n) => n.remove());
  root.querySelectorAll('[data-barba], [data-barba-namespace]').forEach((n) => { n.removeAttribute('data-barba'); n.removeAttribute('data-barba-namespace'); });
}

/** Parse a page into { title, fragment, count } (fragment nodes belong to the current document). */
export function parseCase(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const nodes = extractCase(doc);
  const fragment = document.createDocumentFragment();
  nodes.forEach((n) => fragment.append(document.importNode(n, true)));
  sanitize(fragment);
  return { title: doc.title || '', fragment, count: fragment.children.length };
}

const abs = (href) => new URL(href, window.location.href).href.split('#')[0];

/** Fetch and parse once per URL. Resolves to the parsed case, or null if the page can't be used. */
export function loadCase(href) {
  const url = abs(href);
  let entry = cache.get(url);
  if (!entry) {
    entry = { done: false, value: undefined, promise: null };
    entry.promise = fetch(url, { credentials: 'same-origin', headers: { Accept: 'text/html' } })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((html) => {
        const parsed = parseCase(html);
        return parsed.count ? parsed : null;
      })
      .catch(() => null)
      .then((value) => {
        entry.done = true;
        entry.value = value;
        if (!value) cache.delete(url); // let a later hover try again
        return value;
      });
    cache.set(url, entry);
  }
  return entry.promise;
}

/** The parsed case if it has already arrived, else undefined. */
export function cachedCase(href) {
  const entry = cache.get(abs(href));
  return entry && entry.done ? entry.value : undefined;
}
