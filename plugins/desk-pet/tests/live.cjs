// Installs Desk Pet into a built Super Productivity web app and feeds Mochi with a real task completion.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { packPlugin } = require('../../../tools/pack.cjs');

(async () => {
  if (!process.argv[2]) throw Error('Pass the path to a built Super Productivity checkout.');
  const appDir = path.resolve(process.argv[2]);
  let buildDir;
  for (const candidate of ['.tmp/angular-dist/browser', 'dist/browser']) {
    const dir = path.join(appDir, candidate);
    if (await fs.stat(path.join(dir, 'index.html')).catch(() => null)) { buildDir = await fs.realpath(dir); break; }
  }
  if (!buildDir) throw Error('No built frontend found in ' + appDir);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'desk-pet-live-'));
  const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.png': 'image/png' };
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = await fs.realpath(path.join(buildDir, pathname === '/' ? 'index.html' : pathname));
      if (!file.startsWith(buildDir + path.sep)) { res.writeHead(403).end(); return; }
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
      res.end(await fs.readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  let browser;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'en-US', serviceWorkers: 'block', colorScheme: 'light', reducedMotion: 'reduce' });
    context.setDefaultTimeout(30000);
    await context.addInitScript(() => {
      try {
        for (const key of ['SUP_ONBOARDING_PRESET_DONE', 'SUP_ONBOARDING_HINTS_DONE', 'SUP_IS_SHOW_TOUR', 'SUP_EXAMPLE_TASKS_CREATED']) localStorage.setItem(key, 'true');
      } catch { /* An iframe can temporarily have an opaque origin. */ }
    });
    const page = await context.newPage();
    const archive = path.join(temp, 'desk-pet.zip');
    packPlugin(path.resolve(__dirname, '..'), archive);
    await page.goto(`${base}/#/config`);
    await page.locator('mat-tab-header .mat-mdc-tab:has(mat-icon:has-text("extension"))').click();
    await page.locator('plugin-management input[type=file]').setInputFiles(archive);
    await page.locator('dialog-confirm [e2e="confirmBtn"]').click();
    const card = page.locator('plugin-management mat-card').filter({ has: page.locator('mat-card-title', { hasText: 'Desk Pet' }) });
    await card.waitFor();
    if (await card.getByRole('switch').getAttribute('aria-checked') !== 'true') await card.getByRole('switch').click();
    // Mochi lives in the host page itself, on every route.
    const mochi = page.locator('ridonculous-desk-pet');
    const mood = mochi.locator('#mood');
    await page.goto(`${base}/#/tag/TODAY/tasks`);
    await mood.filter({ hasText: 'Mochi is hungry' }).waitFor();
    assert.match(await mochi.locator('#stats').textContent(), /Never fed yet/);

    // Feed Mochi through the normal app UI; the plugin itself never writes.
    const input = page.locator('add-task-bar.global .main-input');
    for (const title of ['Water the plants', 'Reply to Sam']) {
      if (!await input.isVisible()) await page.locator('.tour-addBtn').click();
      await input.fill(title);
      await page.locator('.e2e-add-task-submit').click();
      await page.locator('task', { hasText: title }).waitFor();
    }
    await page.keyboard.press('Escape');
    const task = page.locator('task', { hasText: 'Water the plants' });
    await task.hover();
    await task.locator('done-toggle').click();
    await mood.filter({ hasText: 'Nom nom!' }).waitFor();
    assert.match(await mochi.locator('#pet').getAttribute('class'), /content munch/);
    assert.match(await mochi.locator('#stats').innerText(), /1 snack today · 0 overdue\nLast snack today/);
    await page.screenshot({ path: path.join(os.tmpdir(), 'desk-pet-live-fed.png') });

    // Still there after navigating elsewhere, in both themes.
    await page.goto(`${base}/#/config`);
    await mood.filter({ hasText: 'Mochi is content' }).waitFor();
    for (const mode of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: mode });
      await mochi.locator('#pet').click();
      await page.screenshot({ path: path.join(os.tmpdir(), `desk-pet-live-${mode}.png`) });
    }

    // Mochi can be dragged across the real app and stays put after a reload.
    const box = await mochi.locator('#pet').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(420, 320, { steps: 8 }); await page.mouse.up();
    const centreOf = b => [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)];
    assert.deepEqual(centreOf(await mochi.locator('#pet').boundingBox()), [420, 320]);
    await page.reload();
    await mood.filter({ hasText: 'Mochi is' }).waitFor();
    assert.deepEqual(centreOf(await mochi.locator('#pet').boundingBox()), [420, 320]);
    await page.screenshot({ path: path.join(os.tmpdir(), 'desk-pet-live-dragged.png') });

    // The header button (the host renders it without a label) hides Mochi; disabling the plugin removes them.
    await page.locator('plugin-header-btns button', { hasText: 'pets' }).first().click();
    assert.equal(await mochi.isVisible(), false);
    await page.locator('plugin-header-btns button', { hasText: 'pets' }).first().click();
    await mochi.waitFor();
    await page.locator('mat-tab-header .mat-mdc-tab:has(mat-icon:has-text("extension"))').click();
    await card.getByRole('switch').click();
    await mochi.waitFor({ state: 'detached' });
    console.log(`PASS: real app install, overlay on every page, hungry start, feeding from a real completion, light/dark, dragging remembered across reload, hide button, removal on disable. Screenshots in ${os.tmpdir()}`);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    server.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
