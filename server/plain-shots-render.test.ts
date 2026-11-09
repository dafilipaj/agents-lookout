import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect as see } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readTrace } from './plain-examples.ts';
import { containerOf, keepStyles, markedBox, runnerCore } from './plain-shots-render.mjs';

const ROOT = join(import.meta.dirname, '..');
const SCRIPT = join(import.meta.dirname, 'plain-shots-render.mjs');
const PAGE = `<!doctype html><html><body style="margin:0;font:16px sans-serif">
  <h1 style="margin:16px">Deals</h1>
  <section role="dialog" aria-label="Deal value" style="position:absolute;left:200px;top:100px;width:400px;height:300px;border:1px solid #ccc">
    <div role="radiogroup" aria-label="Deal type"><button role="radio" aria-checked="true">One-off</button><button role="radio" aria-checked="false">Retainer</button></div>
    <label>Your word <input type="password"></label>
    <p style="visibility:hidden">Ghost</p>
    <button style="position:absolute;left:300px;top:250px;width:80px;height:30px">Save</button>
  </section>
  <deep-part></deep-part>
  <iframe src="http://fixture.test/inner" title="Inner" style="position:absolute;left:100px;top:440px;width:300px;height:100px;border:2px solid #999;transform:scale(0.5);transform-origin:0 0"></iframe>
  <script>customElements.define('deep-part', class extends HTMLElement { connectedCallback() { this.attachShadow({ mode: 'open' }).innerHTML = '<button style="position:absolute;left:40px;top:500px;width:100px;height:30px">Deep</button>'; } });</script>
  <img src="https://elsewhere.invalid/logo.png" alt="">
</body></html>`;

const INNER = '<!doctype html><body style="margin:0"><button style="position:absolute;left:40px;top:20px;width:100px;height:30px">Inner</button></body>';

type Box = { x: number; y: number; width: number; height: number };

/**
 * PLAIN-13.1 to 13.3, against a real trace: Lookout's own Playwright (pnpm's `.bin` shim, so the script finds
 * it through the package the shim runs) records a page, and the script renders its checks' snapshots with its trace viewer.
 */
describe('the proof shots render (PLAIN-13.1 to 13.3)', () => {
  let dir: string;
  let checks: ReturnType<typeof readTrace>;
  let zip: string;
  const at: Record<'save' | 'dialog' | 'deep' | 'inner' | 'saveTall', Box> = {} as never;

  beforeAll(async () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'lookout-shots-')));
    zip = join(dir, 'trace.zip');
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
    await ctx.tracing.start({ screenshots: true, snapshots: true });
    const page = await ctx.newPage();
    await page.route('http://fixture.test/**', (r) => r.fulfill({ contentType: 'text/html', body: r.request().url().endsWith('/inner') ? INNER : PAGE }));
    await page.route('https://elsewhere.invalid/**', (r) => r.abort());
    await page.goto('http://fixture.test/');
    await page.getByLabel('Your word').fill('hunter2');
    await page.getByRole('radio', { name: 'Retainer' }).click();
    const dialog = page.getByRole('dialog', { name: 'Deal value' });
    await see(page.getByRole('button', { name: 'Save' })).toBeVisible();
    await see(dialog.getByLabel('Period')).toHaveCount(0);
    await see(dialog.getByText('Ghost')).toBeHidden();
    await see(page.getByRole('button', { name: 'Deep' })).toBeVisible();
    await see(page.frameLocator('iframe').getByRole('button', { name: 'Inner' })).toBeVisible();
    at.inner = (await page.frameLocator('iframe').getByRole('button', { name: 'Inner' }).boundingBox())!;
    at.save = (await page.getByRole('button', { name: 'Save' }).boundingBox())!;
    at.dialog = (await dialog.boundingBox())!;
    at.deep = (await page.getByRole('button', { name: 'Deep' }).boundingBox())!;
    await page.setViewportSize({ width: 600, height: 800 });
    await see(page.getByRole('button', { name: 'Save' })).toBeVisible();
    at.saveTall = (await page.getByRole('button', { name: 'Save' }).boundingBox())!;
    await ctx.tracing.stop({ path: zip });
    await browser.close();
    const entries = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n').filter((e) => /^[\w.-]+\.trace$/.test(e));
    checks = readTrace(entries.map((e) => execFileSync('unzip', ['-p', zip, e], { encoding: 'utf8' })));
  }, 60_000);

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('PLAIN-13.1, 13.2, 13.4: a check is drawn at its moment and page size, twice the pixels, its element boxed (in a shadow root and a scaled frame too); an absence is boxed to the container it searched; a call with no snapshot fails alone', () => {
    expect(checks.checks.map((c) => [c.steps, c.absent, c.viewport])).toEqual([
      // The password field's own markup keeps what was typed in it out of the steps.
      [['Open the page', 'Type in Your word', 'Pick Retainer'], false, { width: 800, height: 600 }],
      [[], true, { width: 800, height: 600 }],
      [[], true, { width: 800, height: 600 }],
      [[], false, { width: 800, height: 600 }],
      [[], false, { width: 800, height: 600 }],
      [[], false, { width: 600, height: 800 }],
    ]);
    // The iframe is drawn at half its size: its button is 50 × 15 on the page.
    expect([at.inner.width, at.inner.height]).toEqual([50, 15]);
    const input = join(dir, 'shots.json');
    const shots = checks.checks.map((c, i) => ({ zip, callId: c.callId, selector: c.selector, absent: c.absent, viewport: c.viewport, out: join(dir, `${i}.jpg`) }));
    shots.push({ ...shots[0]!, callId: 'call@99999', out: join(dir, 'x.jpg') });
    writeFileSync(input, JSON.stringify({ root: ROOT, deadline: Date.now() + 60_000, shots }));
    execFileSync(process.execPath, [SCRIPT, input], { cwd: dir, timeout: 60_000 });
    const { results } = JSON.parse(readFileSync(`${input}.out.json`, 'utf8')) as { results: { box: { x: number; y: number; w: number; h: number } | null; absent: boolean; error: string | null }[] };
    const near = (box: { x: number; y: number; w: number; h: number } | null, r: Box, [W, H] = [800, 600]) => {
      expect(box).not.toBeNull();
      expect(box!.x).toBeCloseTo(r.x / W, 2);
      expect(box!.y).toBeCloseTo(r.y / H, 2);
      expect(box!.w).toBeCloseTo(r.width / W, 2);
      expect(box!.h).toBeCloseTo(r.height / H, 2);
    };
    expect(results.map((r) => [r.absent, r.error])).toEqual([[false, null], [true, null], [true, null], [false, null], [false, null], [false, null], [false, expect.stringContaining("isn't in the trace")]]);
    near(results[0]!.box, at.save);
    near(results[1]!.box, at.dialog);
    // `visibility: hidden` is still laid out: the absence is boxed to where it searched, not to the hidden element.
    near(results[2]!.box, at.dialog);
    near(results[3]!.box, at.deep);
    // In a frame scaled to half: where it's drawn on the page.
    near(results[4]!.box, at.inner);
    near(results[5]!.box, at.saveTall, [600, 800]);
    expect(results[6]!.box).toBeNull();
    // A JPEG at twice the test's pixels, at the size the page had at its check.
    const width = (f: string) => execFileSync('sips', ['-g', 'pixelWidth', join(dir, f)], { encoding: 'utf8' });
    expect(readFileSync(join(dir, '0.jpg')).subarray(0, 2).toString('hex')).toBe('ffd8');
    expect(width('0.jpg')).toContain('pixelWidth: 1600');
    expect(width('5.jpg')).toContain('pixelWidth: 1200');
  }, 60_000);

  it("PLAIN-13.3: without the Checkout's Playwright every shot fails, and says so; past its deadline, none is started", () => {
    const input = join(dir, 'none.json');
    const shot = { zip, callId: 'x', selector: 'x', absent: false, viewport: { width: 800, height: 600 }, out: join(dir, 'n.jpg') };
    writeFileSync(input, JSON.stringify({ root: dir, shots: [shot] }));
    execFileSync(process.execPath, [SCRIPT, input], { cwd: dir, timeout: 30_000 });
    expect(JSON.parse(readFileSync(`${input}.out.json`, 'utf8'))).toEqual({ results: [{ out: join(dir, 'n.jpg'), box: null, absent: false, error: "The Checkout's Playwright isn't there." }] });
    writeFileSync(input, JSON.stringify({ root: ROOT, deadline: Date.now() - 1, shots: [{ ...shot, callId: checks.checks[0]!.callId }] }));
    execFileSync(process.execPath, [SCRIPT, input], { cwd: dir, timeout: 30_000 });
    expect(JSON.parse(readFileSync(`${input}.out.json`, 'utf8'))).toEqual({ results: [{ out: join(dir, 'n.jpg'), box: null, absent: false, error: 'Out of time before its turn.' }] });
  }, 60_000);

  it("PLAIN-13.1: the checked element keeps its own inline style; the viewer's outline and fill are gone", async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.addInitScript(keepStyles);
      await page.route('http://fixture.test/**', (r) => r.fulfill({ contentType: 'text/html', body: '<button __playwright_target__="" style="background-color: rgb(255, 0, 0)">Paid</button><span __playwright_target__="">Due</span>' }));
      await page.goto('http://fixture.test/');
      // As the trace viewer marks them.
      await page.evaluate(`(() => {
        for (const el of document.querySelectorAll('[__playwright_target__]')) {
          el.style.outline = '2px solid #006ab1';
          el.style.backgroundColor = '#6fa8dc7f';
        }
      })()`);
      expect(await page.evaluate(markedBox)).not.toBeNull();
      expect(await page.locator('button').getAttribute('style')).toBe('background-color: rgb(255, 0, 0)');
      expect(await page.locator('span').getAttribute('style')).toBeNull();
    } finally {
      await browser.close();
    }
  }, 30_000);
});

describe('which Playwright, and where an absence searched (PLAIN-13.1, 13.2)', () => {
  it("PLAIN-13.1: the playwright-core of the package the CLI belongs to, though the Checkout's @playwright/test is another; through pnpm's shim too", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'lookout-core-')));
    try {
      const pkg = (at: string, name: string) => {
        mkdirSync(join(root, at), { recursive: true });
        writeFileSync(join(root, at, 'package.json'), JSON.stringify({ name, main: 'index.js' }));
        writeFileSync(join(root, at, 'index.js'), '');
      };
      writeFileSync(join(root, 'package.json'), '{}');
      pkg('node_modules/playwright', 'playwright');
      writeFileSync(join(root, 'node_modules/playwright/cli.js'), '');
      pkg('node_modules/playwright/node_modules/playwright-core', 'playwright-core');
      pkg('node_modules/@playwright/test', '@playwright/test');
      pkg('node_modules/@playwright/test/node_modules/playwright', 'playwright');
      pkg('node_modules/@playwright/test/node_modules/playwright-core', 'playwright-core');
      mkdirSync(join(root, 'node_modules/.bin'));
      const bin = join(root, 'node_modules/.bin/playwright');
      symlinkSync('../playwright/cli.js', bin);
      const ran = join(root, 'node_modules/playwright/node_modules/playwright-core');
      expect(runnerCore(root).dir).toBe(ran);
      rmSync(bin);
      writeFileSync(bin, '#!/bin/sh\nbasedir=$(dirname "$0")\nexec node  "$basedir/../playwright/cli.js" "$@"\n');
      expect(runnerCore(root).dir).toBe(ran);
      // No CLI: the Checkout's own @playwright/test.
      rmSync(bin);
      expect(runnerCore(root).dir).toBe(join(root, 'node_modules/@playwright/test/node_modules/playwright-core'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("PLAIN-13.2: an absence's container is its selector less its last part, with the container's own position", () => {
    expect(containerOf('internal:role=dialog[name="Deal value"s] >> internal:label="Period"s')).toBe('internal:role=dialog[name="Deal value"s]');
    expect(containerOf('internal:role=dialog >> internal:label="Period"s >> nth=0')).toBe('internal:role=dialog');
    expect(containerOf('css=.row >> nth=2 >> internal:text="Missing"i')).toBe('css=.row >> nth=2');
    expect(containerOf('#gone')).toBeNull();
    expect(containerOf('internal:control=enter-frame >> #x')).toBeNull();
  });
});
