// PLAIN-13.1 to 13.3: renders checks' "after" snapshots from Playwright traces with the trace viewer of
// the Playwright that ran them, and finds the element each check marked. Run with the Checkout's Node,
// so the Playwright it loads runs as the tests did: `node plain-shots-render.mjs <input.json>`, whose
// answer is written beside it as `<input.json>.out.json`.
//
// Input: { root, deadline?, shots: [{ zip, callId, selector, absent, viewport: { width, height }, out }] }, the
// deadline a time (ms since the epoch) by which it answers with what it has.
// Answer: { results: [{ out, box: { x, y, w, h } | null, absent, error }] }, a box in fractions of the screen.
/* global document, window, Element, MutationObserver -- the functions page.evaluate and addInitScript run in the snapshot's page */
import { createReadStream, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};
const SNAPSHOT_TIMEOUT_MS = 10_000;
/** Without a deadline in the input: under Lookout's own 90 s cut-off. */
const DEADLINE_MS = 75_000;
/** No shot is started with less than this left before the deadline: one takes about a second. */
const LAST_START_MS = 3_000;
/** After the deadline, how long closing the browser may take before the answer is written regardless. */
const GRACE_MS = 2_000;
const FONTS_MS = 2_000;
const SCALE = 2;
const OUT_OF_TIME = 'Out of time before its turn.';

const CHAIN = ['@playwright/test', 'playwright', 'playwright-core'];

/** The package a file is part of: the nearest `package.json` above it that has a name. */
function ownerOf(file) {
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      if (typeof pkg.name === 'string') return { name: pkg.name, json: join(dir, 'package.json') };
    } catch {
      // not a package's root
    }
    if (dirname(dir) === dir) return null;
  }
}

/**
 * The runner's own playwright-core, as the tests loaded it: from the package that owns the CLI
 * `.bin/playwright` runs (npm links to it; pnpm's shell shim names it), through `playwright`; without
 * one, from the Checkout's `@playwright/test`. fantastic-productive has a newer playwright-core at the top
 * of `node_modules` that the runner doesn't use, and a Checkout can have `playwright` and
 * `@playwright/test` at two versions: only the CLI's own chain is the one that ran.
 */
export function runnerCore(root) {
  const home = realpathSync(root) + sep;
  // Node also looks in global folders (`~/.node_modules`): only the Checkout's own counts.
  const inside = (pkg) => realpathSync(pkg).startsWith(home);
  const follow = (from, names) => names.reduce((pkg, name) => createRequire(pkg).resolve(`${name}/package.json`), from);
  const found = (pkg) => ({ dir: dirname(pkg), load: () => createRequire(pkg)(dirname(pkg)) });
  const bin = join(root, 'node_modules', '.bin', 'playwright');
  let cli = null;
  try {
    const real = realpathSync(bin);
    if (/\.[cm]?js$/.test(real)) cli = real;
    else {
      const named = /"\$basedir\/([^"]+\.[cm]?js)"/.exec(readFileSync(real, 'utf8'));
      if (named) cli = realpathSync(join(dirname(bin), named[1]));
    }
  } catch {
    // no CLI to follow
  }
  const owner = cli ? ownerOf(cli) : null;
  const at = owner ? CHAIN.indexOf(owner.name) : -1;
  if (at >= 0) {
    try {
      const pkg = follow(owner.json, CHAIN.slice(at + 1));
      if (inside(pkg)) return found(pkg);
    } catch {
      // the Checkout's own, below
    }
  }
  for (const chain of [CHAIN, CHAIN.slice(1), CHAIN.slice(2)]) {
    try {
      const pkg = follow(join(root, 'package.json'), chain);
      if (inside(pkg)) return found(pkg);
    } catch {
      // the next way
    }
  }
  throw new Error("The Checkout's Playwright isn't there.");
}

/** A selector's container: the part before its last ` >> ` (the target's own `nth=` with it); null for the whole page. */
export function containerOf(selector) {
  const parts = String(selector || '').split(' >> ');
  while (parts.length && /^nth=/.test(parts[parts.length - 1])) parts.pop();
  parts.pop();
  return parts.length && !parts.some((p) => p.startsWith('internal:control=enter-frame')) ? parts.join(' >> ') : null;
}

function serve(viewer, zips) {
  const server = createServer((req, res) => {
    let file = null;
    let path = '';
    try {
      path = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    } catch {
      // a malformed path is no file
    }
    const z = /^\/z\/(\d+)\.zip$/.exec(path);
    if (z) file = zips[Number(z[1])] ?? null;
    else if (path.startsWith('/trace/')) {
      const f = resolve(viewer, `.${path.slice('/trace'.length)}`);
      if (f.startsWith(viewer + sep)) file = f;
    }
    try {
      if (!file) throw new Error('not served');
      const st = statSync(file);
      if (!st.isFile()) throw new Error('not a file');
      res.writeHead(200, { 'Content-Type': z ? 'application/zip' : (TYPES[extname(file)] ?? 'application/octet-stream'), 'Content-Length': st.size });
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

/**
 * Before the viewer's script runs: each element's own `style` attribute, as the snapshot has it, kept when it
 * first changes. The viewer marks the checked element by overwriting its inline outline and background.
 */
export function keepStyles() {
  const kept = new Map();
  const seen = new MutationObserver((records) => {
    for (const r of records) if (!kept.has(r.target)) kept.set(r.target, r.oldValue);
  });
  const opts = { subtree: true, attributes: true, attributeFilter: ['style'], attributeOldValue: true };
  seen.observe(document, opts);
  const attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (...args) {
    const root = attach.apply(this, args);
    seen.observe(root, opts);
    return root;
  };
  window.__lookoutStyles = { kept, seen };
}

/** In one frame of the snapshot: the marked elements, in its shadow roots too, their styles as the app had them; their box. */
export function markedBox() {
  const { kept, seen } = window.__lookoutStyles ?? {};
  for (const r of seen?.takeRecords() ?? []) if (!kept.has(r.target)) kept.set(r.target, r.oldValue);
  const marked = [];
  const visit = (root) => {
    marked.push(...root.querySelectorAll('[__playwright_target__]'));
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) visit(el.shadowRoot);
  };
  visit(document);
  let box = null;
  for (const el of marked) {
    if (kept?.has(el)) {
      const old = kept.get(el);
      if (old === null) el.removeAttribute('style');
      else el.setAttribute('style', old);
    } else {
      el.style.outline = '';
      el.style.backgroundColor = '';
    }
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    box = box ? { x1: Math.min(box.x1, r.left), y1: Math.min(box.y1, r.top), x2: Math.max(box.x2, r.right), y2: Math.max(box.y2, r.bottom) } : { x1: r.left, y1: r.top, x2: r.right, y2: r.bottom };
  }
  return box;
}

/** One shot: the snapshot rendered, the box of what its check found (or searched, for an absence), a JPEG of the screen. */
async function shoot(page, base, zipUrl, shot, left) {
  const url = `${base}/trace/snapshot/${encodeURIComponent(shot.callId)}?trace=${encodeURIComponent(zipUrl)}&phase=after`;
  const { width, height } = shot.viewport;
  await page.setViewportSize({ width, height });
  const r = await page.goto(url, { waitUntil: 'load', timeout: Math.min(SNAPSHOT_TIMEOUT_MS, left()) });
  if (!r || r.status() !== 200) throw new Error(`Its snapshot isn't in the trace (${r ? r.status() : 'no answer'}).`);
  await page.evaluate((ms) => Promise.race([document.fonts?.ready, new Promise((ok) => setTimeout(ok, ms))]), FONTS_MS).catch(() => {});
  // Every frame's marks, its own and its shadow roots', in the page's coordinates.
  let rect = null;
  for (const frame of page.frames()) {
    let b = await frame.evaluate(markedBox).catch(() => null);
    if (!b) continue;
    if (frame !== page.mainFrame()) {
      // The frame's box on the page, scaled as CSS draws it: its content starts inside its border.
      const el = await frame.frameElement().catch(() => null);
      const at = el && (await el.boundingBox().catch(() => null));
      const own = el && (await el.evaluate((e) => ({ w: e.offsetWidth, h: e.offsetHeight, left: e.clientLeft, top: e.clientTop })).catch(() => null));
      if (!at || !own?.w || !own.h) continue;
      const [sx, sy] = [at.width / own.w, at.height / own.h];
      const [dx, dy] = [at.x + own.left * sx, at.y + own.top * sy];
      b = { x1: dx + b.x1 * sx, y1: dy + b.y1 * sy, x2: dx + b.x2 * sx, y2: dy + b.y2 * sy };
    }
    rect = rect ? { x1: Math.min(rect.x1, b.x1), y1: Math.min(rect.y1, b.y1), x2: Math.max(rect.x2, b.x2), y2: Math.max(rect.y2, b.y2) } : b;
  }
  // PLAIN-13.2: an absence is boxed to where it searched, even when what it found hidden is still laid out (`visibility: hidden`).
  if (shot.absent) {
    rect = null;
    const container = containerOf(shot.selector);
    if (container) {
      const b = await page.locator(container).first().boundingBox({ timeout: 1500 }).catch(() => null);
      if (b) rect = { x1: b.x, y1: b.y, x2: b.x + b.width, y2: b.y + b.height };
    }
  }
  await page.screenshot({ path: shot.out, type: 'jpeg', quality: 80, animations: 'disabled', caret: 'hide', timeout: Math.min(SNAPSHOT_TIMEOUT_MS, left()) });
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const box = rect
    ? { x: clamp(rect.x1 / width), y: clamp(rect.y1 / height), w: clamp((Math.min(rect.x2, width) - Math.max(rect.x1, 0)) / width), h: clamp((Math.min(rect.y2, height) - Math.max(rect.y1, 0)) / height) }
    : null;
  return { out: shot.out, box: box && box.w > 0 && box.h > 0 ? box : null, absent: !!shot.absent, error: null };
}

/** A shot's work, cut off when the deadline comes: its page closed, which stops whatever it was waiting on. */
async function shootBy(ctx, base, zipUrl, shot, left) {
  const page = await ctx.newPage();
  let timer;
  try {
    const late = new Promise((_, no) => (timer = setTimeout(() => no(new Error('Out of time while it was drawn.')), left())));
    return await Promise.race([shoot(page, base, zipUrl, shot, left), late]);
  } finally {
    clearTimeout(timer);
    await page.close().catch(() => {});
  }
}

const failed = (s, error) => ({ out: s.out, box: null, absent: false, error });

/** The answer: each shot's result, `missing` for one that has none. */
export function answerOf(shots, done, missing) {
  return { results: shots.map((s) => done.get(s) ?? failed(s, missing)) };
}

/** The shots rendered, each into `done` as it's finished, so an answer written early has them. */
export async function render(input, done = new Map()) {
  const shots = input.shots ?? [];
  const failAll = (error) => {
    for (const s of shots) if (!done.has(s)) done.set(s, failed(s, error));
    return answerOf(shots, done, error);
  };
  let core;
  try {
    core = runnerCore(input.root);
  } catch {
    return failAll("The Checkout's Playwright isn't there.");
  }
  const viewer = join(core.dir, 'lib', 'vite', 'traceViewer');
  try {
    statSync(join(viewer, 'index.html'));
  } catch {
    return failAll('Its Playwright has no trace viewer.');
  }
  const deadline = deadlineOf(input);
  const left = () => deadline - Date.now();
  if (left() < LAST_START_MS) return failAll(OUT_OF_TIME);
  const zips = [...new Set(shots.map((s) => s.zip))];
  const server = await serve(viewer, zips);
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser = null;
  try {
    const pw = core.load();
    browser = await pw.chromium.launch({ timeout: Math.max(1, Math.min(30_000, left())) });
    const byViewport = new Map();
    for (const s of shots) {
      const k = `${s.viewport.width}x${s.viewport.height}`;
      byViewport.set(k, [...(byViewport.get(k) ?? []), s]);
    }
    for (const group of byViewport.values()) {
      let ctx = null;
      try {
        if (left() < LAST_START_MS) throw new Error(OUT_OF_TIME);
        ctx = await browser.newContext({ viewport: group[0].viewport, deviceScaleFactor: SCALE, serviceWorkers: 'allow' });
        await ctx.addInitScript(keepStyles);
        // PLAIN-13.3: nothing but Lookout's own server for the run.
        await ctx.route((url) => !url.href.startsWith(`${base}/`), (route) => route.abort());
        const home = await ctx.newPage();
        await home.goto(`${base}/trace/index.html`, { timeout: Math.min(SNAPSHOT_TIMEOUT_MS, left()) });
        await home.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: Math.min(SNAPSHOT_TIMEOUT_MS, left()) });
        for (const s of group) {
          if (left() < LAST_START_MS) {
            done.set(s, failed(s, OUT_OF_TIME));
            continue;
          }
          try {
            done.set(s, await shootBy(ctx, base, `${base}/z/${zips.indexOf(s.zip)}.zip`, s, left));
          } catch (err) {
            done.set(s, failed(s, String(err?.message ?? err).split('\n')[0].slice(0, 200)));
          }
        }
      } catch (err) {
        // A group that can't start fails alone: the shots before it are kept.
        const error = err?.message === OUT_OF_TIME ? OUT_OF_TIME : `Its Playwright couldn't render the pictures: ${String(err?.message ?? err).split('\n')[0].slice(0, 160)}`;
        for (const s of group) if (!done.has(s)) done.set(s, failed(s, error));
      } finally {
        await ctx?.close().catch(() => {});
      }
    }
    return answerOf(shots, done, OUT_OF_TIME);
  } catch (err) {
    return failAll(`Its Playwright couldn't render the pictures: ${String(err?.message ?? err).split('\n')[0].slice(0, 160)}`);
  } finally {
    await browser?.close().catch(() => {});
    server.close();
  }
}

/** When it answers by: the input's deadline, or 75 s from its start. */
function deadlineOf(input) {
  const own = Date.now() + DEADLINE_MS;
  return typeof input.deadline === 'number' && Number.isFinite(input.deadline) ? Math.min(input.deadline, own) : own;
}

/** The answer beside the input, whole or not at all: Lookout may read it while the script is being stopped. */
function write(file, answer) {
  writeFileSync(`${file}.out.json.part`, JSON.stringify(answer), { mode: 0o600 });
  renameSync(`${file}.out.json.part`, `${file}.out.json`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const file = process.argv[2];
  const input = JSON.parse(readFileSync(file, 'utf8'));
  const done = new Map();
  // Whatever is still running at the deadline (a browser that won't start or close), the shots done are answered.
  const watchdog = setTimeout(() => {
    write(file, answerOf(input.shots ?? [], done, OUT_OF_TIME));
    process.exit(0);
  }, Math.max(0, deadlineOf(input) - Date.now()) + GRACE_MS);
  write(file, await render(input, done));
  clearTimeout(watchdog);
}
