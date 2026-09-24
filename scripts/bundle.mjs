// Builds zero-rd.html, the published page: every page as a tab of one artifact,
// in the frame from scripts/bundle-shell.html. Each page's style and markup go
// into a <template> that its tab clones into the tab's own shadow root the first
// time it opens, so the pages keep their own ids, styles and colour tokens side
// by side. Each page's script becomes a function the tab runs then, with its
// lookups scoped to that shadow root and its imports loaded on first open.
// Usage: npm run bundle
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const PAGES = [
  { id: 'model', file: 'index.html', tab: '3D model' },
  { id: 'thermal', file: 'thermal.html', tab: 'Thermal' },
  { id: 'solar', file: 'solar.html', tab: 'Solar' },
  { id: 'wiring', file: 'wiring.html', tab: 'Wiring' },
  { id: 'offgrid', file: 'offgrid.html', tab: 'Off-grid' },
  { id: 'finance', file: 'finance.html', tab: 'Finance' },
];

// Edits a page needs to live in a tab; each must match exactly once.
const PATCHES = {
  // A closed tab keeps its page loaded; the 3D view stops drawing until it's open again.
  model: [['renderer.setAnimationLoop(now => {\n', 'renderer.setAnimationLoop(now => {\n  if (tabRoot.host.hidden) return;\n']],
};

const ROOT = new URL('../', import.meta.url);
const OUT = 'zero-rd.html';
const read = f => readFileSync(new URL(f, ROOT), 'utf8');
const fail = msg => { throw new Error(msg); };
const count = (s, part) => s.split(part).length - 1;

// A page file is <title>, <meta> and <link> tags, one <style>, an optional
// import map, the page markup, and one module script at the end.
function split(p) {
  const src = read(p.file);
  const style = src.match(/<style>\n([\s\S]*?)<\/style>\n/) ?? fail(`${p.file}: no <style>`);
  const script = src.match(/<script type="module">\n([\s\S]*?)<\/script>\s*$/) ?? fail(`${p.file}: no module script at the end`);
  const head = src.slice(0, style.index);
  if (head.replace(/<title>[^<]*<\/title>|<meta [^>]*>|<link [^>]*>|\s/g, '')) fail(`${p.file}: more than title, meta and link tags before <style>`);
  const map = src.match(/<script type="importmap">\n[\s\S]*?<\/script>\n/);
  let markup = src.slice(style.index + style[0].length, script.index);
  if (map) markup = markup.replace(map[0], '');
  if (/<(script|style|link|meta|title)\b/.test(markup)) fail(`${p.file}: a head tag among the page markup`);
  return { ...p, links: head.match(/<link [^>]*>/g) ?? [], css: style[1], markup: markup.trim(), js: script[1], importmap: map?.[0].trim() };
}

// The page's style, moved from the document onto its tab: :root and body
// become the tab itself, and panels that stick sit below the tab bar.
function pageCss(p) {
  const css = p.css
    .replace(/:root:not\(\[data-theme="light"\]\)/g, ':host(:not([data-theme="light"]))')
    .replace(/:root\[data-theme="dark"\]/g, ':host([data-theme="dark"])')
    .replace(/:root(?=\s*\{)/g, ':host')
    .replace(/^(\s*)(?:html, body|body)(?=\s*\{)/gm, '$1:host')
    .replace(/top: env\(safe-area-inset-top, 0px\)/g, 'top: calc(env(safe-area-inset-top, 0px) + var(--zr-bar-h))')
    .replace(/max-height: 100(d?)vh/g, 'max-height: calc(100$1vh - var(--zr-bar-h))');
  const left = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/(^|[\s,}])(:root|html|body)(?=[\s,.:{[])/);
  if (left) fail(`${p.file}: selector ${left[2]} would reach outside the tab`);
  // The document's reset doesn't reach into a shadow root; the tab carries its own.
  return ':host { display: block; }\n  [hidden]:not([hidden=until-found i]) { display: none !important; }\n  img { max-width: 100%; }\n' + css;
}

// The page's script as a function of its tab's shadow root (tabRoot).
function pageJs(p) {
  if (/\btabRoot\b/.test(p.js)) fail(`${p.file}: already uses the name tabRoot`);
  const imports = [];
  let js = p.js
    .replace(/^import \* as (\w+) from '([^']+)';\n/gm, (_, name, spec) => { imports.push(`const ${name} = await import('${spec}');`); return ''; })
    .replace(/^import \{([^}]*)\} from '([^']+)';\n/gm, (_, names, spec) => { imports.push(`const {${names.replace(/\s+as\s+/g, ': ')}} = await import('${spec}');`); return ''; });
  if (/^\s*(import|export)\b(?!\()/m.test(js)) fail(`${p.file}: an import or export the bundler doesn't rewrite`);
  js = js
    .replace(/\bdocument\.(querySelector|querySelectorAll|getElementById)\(/g, 'tabRoot.$1(')
    .replace(/\bdocument\.activeElement\b/g, 'tabRoot.activeElement')
    .replace(/getComputedStyle\(document\.documentElement\)/g, 'getComputedStyle(tabRoot.host)');
  for (const [from, to] of PATCHES[p.id] ?? []) {
    const n = count(js, from);
    if (n !== 1) fail(`${p.file}: patch matched ${n} times: ${from.trim()}`);
    js = js.replace(from, () => to);
  }
  const ok = ['createElement', 'createElementNS', 'createTextNode', 'createDocumentFragment', 'documentElement'];
  const left = [...js.matchAll(/\bdocument\.(\w+)/g)].find(m => !ok.includes(m[1]));
  if (left) fail(`${p.file}: document.${left[1]} would reach outside the tab`);
  return `<script type="module">\nzeroRd.page('${p.id}', async tabRoot => {\n${imports.join('\n')}\n${js.trim()}\n});\n</script>`;
}

// Every model and data file the pages reach, following imports, workers and fetches.
function supportFiles(pages) {
  const found = new Set();
  const scan = (code, base) => {
    for (const [, rel] of code.matchAll(/'(\.\.?\/[\w./-]+\.(?:js|json))'/g)) {
      const path = new URL(rel, new URL(base, ROOT)).href.slice(ROOT.href.length);
      if (found.has(path)) continue;
      if (!existsSync(new URL(path, ROOT))) fail(`${base}: ${rel} not found`);
      found.add(path);
      if (path.endsWith('.js')) scan(read(path), path);
    }
  };
  for (const p of pages) scan(p.js, p.file);
  return [...found].sort();
}

const pages = PAGES.map(split);
const links = [...new Set(pages.flatMap(p => p.links))];
const maps = [...new Set(pages.map(p => p.importmap).filter(Boolean))];
if (maps.length > 1) fail('pages disagree on the import map');

const fill = (html, marker, text) => {
  if (count(html, `<!-- ${marker} -->`) !== 1) fail(`bundle-shell.html: needs one <!-- ${marker} -->`);
  return html.replace(`<!-- ${marker} -->`, () => text);
};
let html = read('scripts/bundle-shell.html');
html = fill(html, 'page links', links.join('\n'));
html = fill(html, 'importmap', maps[0] ?? '');
html = fill(html, 'tabs', pages.map(p => `    <button type="button" role="tab" id="zr-tab-${p.id}" aria-controls="zr-panel-${p.id}" aria-selected="false" tabindex="-1" data-page="${p.id}">${p.tab}</button>`).join('\n'));
html = fill(html, 'panels', pages.map(p => `<div class="zr-panel" id="zr-panel-${p.id}" role="tabpanel" aria-labelledby="zr-tab-${p.id}" data-page="${p.id}" hidden></div>`).join('\n'));
html = fill(html, 'templates', pages.map(p => `<template id="zr-tpl-${p.id}">\n<style>\n  ${pageCss(p)}</style>\n${p.markup}\n</template>`).join('\n\n'));
html = fill(html, 'pages', pages.map(pageJs).join('\n\n'));

writeFileSync(new URL(OUT, ROOT), html);
const files = supportFiles(pages);
console.log(`wrote ${OUT} (${Math.round(html.length / 1024)} kB), ${pages.length} tabs; publish it with:`);
for (const f of files) console.log(`  ${f}`);
