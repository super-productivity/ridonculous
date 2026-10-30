#!/usr/bin/env node
// Real host, normal ZIP installation, and a browser profile reserved for experiments.
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { createInterface } = require('node:readline');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const smoke = args.includes('--smoke');
const positional = args.filter(arg => arg !== '--smoke');
if (positional.length > 2 || args.includes('--help')) {
  console.log('Usage: npm run dev -- [plugin-folder=daily-quest] [Super-Productivity-checkout]\nSet SP_DIR instead of the second argument if preferred.\nUse npm run test:live -- [plugin-folder] [checkout] for a headless smoke test.');
  process.exit(args.includes('--help') ? 0 : 1);
}
const pluginName = positional[0] || 'daily-quest';
if (!/^[a-z0-9][a-z0-9-]*$/.test(pluginName)) throw Error('Plugin folder must be a lowercase name under plugins/.');
const pluginDir = path.join(root, 'plugins', pluginName);
const appDir = path.resolve(positional[1] || process.env.SP_DIR || path.join(root, '../super-productivity'));
const localDir = path.join(root, '.local');
const port = 4173;
let server, context, terminal, temporaryProfile;

async function install(page, baseUrl, manifest) {
  const archive = path.join(localDir, `${pluginName}.zip`);
  // Only portable runtime files belong in an uploaded plugin, never node_modules or tests.
  const files = ['manifest.json'];
  for (const name of ['index.html', 'plugin.js', 'icon.svg', 'i18n']) {
    if (await fs.stat(path.join(pluginDir, name)).catch(() => null)) files.push(name);
  }
  execFileSync('python3', ['-m', 'zipfile', '-c', archive, ...files], { cwd: pluginDir });
  // A dialog the plugin left open (e.g. a welcome prompt) would block the settings clicks below.
  for (let i = 0; i < 5 && await page.locator('mat-dialog-container').count(); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  await page.goto(`${baseUrl}/#/config`);
  await page.locator('mat-tab-header .mat-mdc-tab:has(mat-icon:has-text("extension"))').click();
  const uploader = page.locator('plugin-management input[type=file]');
  await uploader.waitFor({ state: 'attached' });
  await uploader.setInputFiles(archive);
  // Consent is only automated for the explicitly selected local plugin in this isolated profile.
  await page.locator('dialog-confirm [e2e="confirmBtn"]').click();
  await page.waitForFunction(() => {
    const input = document.querySelector('plugin-management input[type=file]');
    return input && input.value === '';
  });
  const card = page.locator('plugin-management mat-card').filter({
    has: page.locator('mat-card-title', { hasText: manifest.name }),
  });
  await card.waitFor();
  const toggle = card.getByRole('switch');
  if (await toggle.getAttribute('aria-checked') !== 'true') await toggle.click();
  if (!manifest.iFrame) {
    // Background plugins have no view to open; their plugin.js runs once enabled.
    await page.waitForFunction(el => el.getAttribute('aria-checked') === 'true', await toggle.elementHandle());
    console.log(`Installed ${manifest.name}; background plugin enabled (no view).`);
    return page;
  }
  await page.goto(`${baseUrl}/#/plugins/${encodeURIComponent(manifest.id)}/index`);
  const iframe = page.locator('plugin-index iframe');
  await iframe.waitFor();
  const frame = await (await iframe.elementHandle()).contentFrame();
  await frame.waitForFunction(() => Boolean(window.PluginAPI));
  const tasks = await frame.evaluate(() => window.PluginAPI.getTasks());
  if (!Array.isArray(tasks)) throw Error('The live task API did not return tasks.');
  console.log(`Installed ${manifest.name}; real PluginAPI connected (${tasks.length} tasks).`);
  return frame;
}

// Same demo tasks for every video. Only an empty Today list is seeded, so manual test data is never touched.
async function seedDemoTasks(page, baseUrl) {
  await page.goto(`${baseUrl}/#/tag/TODAY/tasks`);
  // The header renders its page title only after the initial data load, so the count below sees real data.
  await page.locator('main-header page-title').waitFor();
  await page.locator('task-list').first().waitFor();
  if (await page.locator('task').count()) return;
  // Titles use short syntax: "1h" is an estimate, "20m/1h" is time spent / estimate.
  const titles = JSON.parse(await fs.readFile(path.join(__dirname, 'demo-tasks.json'), 'utf8'));
  const input = page.locator('add-task-bar.global .main-input');
  if (!await input.isVisible()) await page.locator('.tour-addBtn').click();
  for (const [i, title] of titles.entries()) {
    await input.fill(title);
    await page.locator('.e2e-add-task-submit').click();
    await page.locator('task').nth(i).waitFor();
  }
  await page.keyboard.press('Escape');
  console.log(`Seeded ${titles.length} demo tasks into the empty Today list.`);
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(path.join(pluginDir, 'manifest.json'), 'utf8'));
  await fs.access(path.join(pluginDir, manifest.iFrame ? 'index.html' : 'plugin.js'));
  let buildDir;
  for (const candidate of ['.tmp/angular-dist/browser', 'dist/browser']) {
    const dir = path.join(appDir, candidate);
    if (await fs.stat(path.join(dir, 'index.html')).catch(() => null)) { buildDir = await fs.realpath(dir); break; }
  }
  if (!buildDir) throw Error(`No web build found in ${appDir}. In that checkout, run npm ci and npm run buildFrontend:e2e first. See README.md.`);
  execFileSync('python3', ['--version']);
  await fs.mkdir(localDir, { recursive: true });
  const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
  server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = await fs.realpath(path.join(buildDir, pathname === '/' ? 'index.html' : pathname));
      if (!file.startsWith(buildDir + path.sep)) { res.writeHead(403).end(); return; }
      const data = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    } catch { res.writeHead(404).end('Not found'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const baseUrl = `http://127.0.0.1:${port}`;
  const profile = smoke ? temporaryProfile = await fs.mkdtemp(path.join(localDir, 'smoke-')) : path.join(localDir, 'browser-profile');
  context = await chromium.launchPersistentContext(profile, {
    headless: smoke, locale: 'en-US', serviceWorkers: 'block',
    // A fixed viewport pins the page size, so resizing the headed window would only crop it.
    // Linux Chromium only offers speech voices (speech-dispatcher) behind this flag.
    args: ['--enable-speech-dispatcher', ...(smoke ? [] : ['--window-size=1440,1000'])],
    ...(smoke ? { viewport: { width: 1440, height: 1000 } } : { viewport: null }),
  });
  context.setDefaultTimeout(30000);
  await context.addInitScript(() => {
    try {
      for (const key of ['SUP_ONBOARDING_PRESET_DONE', 'SUP_ONBOARDING_HINTS_DONE', 'SUP_IS_SHOW_TOUR', 'SUP_EXAMPLE_TASKS_CREATED']) localStorage.setItem(key, 'true');
    } catch { /* Plugin teardown can briefly create an opaque frame. */ }
  });
  const page = context.pages()[0] || await context.newPage();
  console.log(`Serving ${buildDir}\nProfile: ${profile}\nApp: ${baseUrl}`);
  await seedDemoTasks(page, baseUrl);
  await install(page, baseUrl, manifest);
  if (smoke) {
    await install(page, baseUrl, manifest);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(localDir, 'live-smoke.png') });
    console.log(`PASS: real app startup, ZIP installation, ${manifest.iFrame ? 'plugin bridge, ' : ''}and reinstallation.`);
    return;
  }
  console.log('Edit the plugin, then press Enter here to repack and reinstall. Ctrl+C or close the browser to stop.\nThis profile is for test data. Leave sync disconnected.');
  terminal = createInterface({ input: process.stdin, output: process.stdout });
  let installing = false;
  terminal.on('line', async () => {
    if (installing) return;
    installing = true;
    try { await install(page, baseUrl, JSON.parse(await fs.readFile(path.join(pluginDir, 'manifest.json'), 'utf8'))); }
    catch (error) { console.error(`Reload failed: ${error.message}`); }
    finally { installing = false; }
  });
  await new Promise(resolve => context.once('close', resolve));
}
async function cleanup() {
  terminal?.close();
  await context?.close().catch(() => {});
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (temporaryProfile) await fs.rm(temporaryProfile, { recursive: true, force: true });
}
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  if (stopping) return;
  stopping = true; await cleanup(); process.exit(0);
});
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(cleanup);
