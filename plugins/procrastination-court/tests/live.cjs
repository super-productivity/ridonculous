// Isolated real-app verdict checks. Usage: node tests/live.cjs /path/to/super-productivity
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
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'procrastination-court-live-'));
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
    const archive = path.join(temp, 'court.zip');
    packPlugin(path.resolve(__dirname, '..'), archive);
    await page.goto(`${base}/#/config`);
    await page.locator('mat-tab-header .mat-mdc-tab:has(mat-icon:has-text("extension"))').click();
    await page.locator('plugin-management input[type=file]').setInputFiles(archive);
    await page.locator('dialog-confirm [e2e="confirmBtn"]').click();
    const card = page.locator('plugin-management mat-card').filter({ has: page.locator('mat-card-title', { hasText: 'Cat Court' }) });
    await card.waitFor();
    if (await card.getByRole('switch').getAttribute('aria-checked') !== 'true') await card.getByRole('switch').click();
    const open = async () => {
      await page.goto(`${base}/#/plugins/ridonculous-procrastination-court/index`);
      const iframe = page.locator('plugin-index iframe');
      await iframe.waitFor();
      const frame = await (await iframe.elementHandle()).contentFrame();
      await frame.locator('#workspace:not([disabled])').waitFor();
      return frame;
    };
    let frame = await open();
    const ids = await frame.evaluate(async () => {
      const a = await PluginAPI.addTask({ title: 'Finally sort out my tax return', notes: 'Keep my original notes', timeEstimate: 7200000, isIgnoreShortSyntax: true });
      const b = await PluginAPI.addTask({ title: 'Make that dentist appointment', timeEstimate: 600000, isIgnoreShortSyntax: true });
      return { a, b };
    });
    await frame.locator(`[data-task-id="${ids.a}"]`).waitFor({ state: 'attached' });
    await frame.locator(`[data-task-id="${ids.b}"]`).waitFor({ state: 'attached' });
    const rule = async (id, plea) => {
      await frame.locator(await frame.locator('#outcome').isVisible() ? '#another' : await frame.locator('#hearing').isVisible() ? '#change-case' : '#call-case').click();
      await frame.locator(`[data-task-id="${id}"]`).click();
      await frame.locator(`[data-plea="${plea}"]`).click();
      await frame.locator('#hear-verdict').click();
    };
    await frame.locator('#sound').click();
    assert.equal(await frame.evaluate(() => audioContext.state), 'running');
    await rule(ids.a, 'big');
    await frame.waitForFunction(() => document.querySelector('#judge').dataset.chat === 'speaking');
    await frame.locator('#sound').click();
    assert.equal(await frame.locator('[data-chat]').count(), 0);
    await page.screenshot({ path: path.join(os.tmpdir(), 'procrastination-court-live-ruling.png') });
    await frame.locator('[data-verdict="shrink"]').click();
    const literal = 'Open the folder #tax @tomorrow 2h';
    await frame.locator('#small-step').fill(literal);
    // Exercise the host's live theme injection while a draft and modal are open.
    await frame.locator('#change-case').click();
    assert.equal(await frame.locator('#sp-ui-kit').count(), 1);
    for (const mode of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: mode });
      await frame.waitForFunction(mode => getComputedStyle(document.documentElement).getPropertyValue('--is-dark-theme').trim() === (mode === 'dark' ? '1' : '0'), mode);
      const colors = await frame.evaluate(() => {
        const resolve = name => {
          const probe = document.createElement('span'); probe.style.color = `var(${name})`;
          document.body.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color;
        };
        return {
          standalone: document.documentElement.classList.contains('standalone'),
          body: getComputedStyle(document.body).backgroundColor, expectedBody: resolve('--bg'),
          text: getComputedStyle(document.body).color, expectedText: resolve('--text-color'),
          picker: getComputedStyle(document.querySelector('#picker')).backgroundColor, expectedPicker: resolve('--card-bg'),
          primary: getComputedStyle(document.querySelector('#call-case')).backgroundColor, expectedPrimary: resolve('--c-primary'),
          field: getComputedStyle(document.querySelector('#search')).backgroundColor, expectedField: resolve('--input-bg-hover'),
        };
      });
      assert.equal(colors.standalone, false, 'The real host uses the UI kit, not preview styles');
      for (const key of ['body', 'text', 'picker', 'primary', 'field']) {
        assert.equal(colors[key], colors['expected' + key[0].toUpperCase() + key.slice(1)], `${mode}: ${key} follows the host token`);
      }
      await page.screenshot({ path: path.join(os.tmpdir(), `procrastination-court-live-${mode}-picker.png`) });
    }
    await frame.locator('#close-picker').click();
    assert.equal(await frame.locator('#small-step').inputValue(), literal, 'Live theme changes preserve the draft');
    await page.screenshot({ path: path.join(os.tmpdir(), 'procrastination-court-live-dark.png') });
    await frame.locator('#shrink-form button[type="submit"]').click();
    await frame.locator('#outcome').waitFor();
    const taskData = await frame.evaluate(() => PluginAPI.getTasks());
    const parent = taskData.find(task => task.id === ids.a);
    const child = taskData.find(task => task.parentId === ids.a);
    assert.equal(parent.title, 'Finally sort out my tax return');
    assert.equal(parent.notes, 'Keep my original notes');
    assert.equal(parent.isDone, false);
    assert.equal(child.title, literal);
    assert.equal(child.timeEstimate, 300000);
    assert.ok(parent.subTaskIds.includes(child.id));
    await frame.locator('#start-step').click();
    await frame.waitForFunction(async id => (await PluginAPI.getTasks()).find(task => task.id === id)?.timeSpent > 0, child.id);
    // Start another task, proving that the ordinary verdict also starts the actual host timer.
    await rule(ids.b, 'boring');
    await frame.locator('[data-verdict="start"]').click();
    await frame.locator('#outcome').waitFor();
    await frame.waitForFunction(async id => (await PluginAPI.getTasks()).find(task => task.id === id)?.timeSpent > 0, ids.b);
    await rule(ids.a, 'irrelevant');
    await frame.locator('[data-verdict="dismiss"]').click();
    await frame.locator('#outcome').waitFor();
    assert.ok(await frame.evaluate(async id => (await PluginAPI.getTasks()).some(task => task.id === id && !task.isDone), ids.a));
    // Reopen the host page, not just the view: the dismissal must survive persistence.
    await page.reload(); frame = await open();
    assert.equal(await frame.locator('#return-greeting').isVisible(), true, 'The host keeps the tab-local return greeting');
    assert.equal(await frame.locator(`[data-task-id="${ids.a}"]`).count(), 0);
    await frame.locator('#call-case').click();
    await frame.locator('#dismissed-filter').click();
    await frame.locator(`[data-task-id="${ids.a}"]`).click();
    await page.screenshot({ path: path.join(os.tmpdir(), 'procrastination-court-live-intro.png') });
    await frame.locator('#hearing').waitFor();
    const saved = await frame.evaluate(() => PluginAPI.loadSyncedData());
    assert.deepEqual(JSON.parse(saved).dismissed, []);
    await page.screenshot({ path: path.join(os.tmpdir(), 'procrastination-court-live-hearing.png') });
    console.log('PASS: real host UI kit and live light/dark themes, ZIP install, literal subtask creation, original data preserved, both timer actions, persisted dismissal, and reopening.');
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
