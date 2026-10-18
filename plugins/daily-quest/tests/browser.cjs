const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const url = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const shot = name => path.join(os.tmpdir(), `daily-quest-${name}.png`);
const roles = ['buff', 'boss', 'recovery', 'side'];

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1300, height: 950 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      // Super Productivity 19.2 marks Today by a local dueDay; TODAY is never in tagIds.
      const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      window.fixture = {
        tasks: [
          { id: 'a', title: 'Untangle the sync architecture', isDone: false, tagIds: [] },
          { id: 'b', title: 'Review one small PR', isDone: false, tagIds: [], dueDay: today, timeEstimate: 900000 },
          { id: 'parent', title: 'Parent task', subTaskIds: ['a'], isDone: false },
          { id: 'done', title: 'Finished task', isDone: true },
        ],
        saved: null, current: null, actions: [], hooks: {}, failSave: false, failDispatch: false,
      };
      window.PluginAPI = {
        getTasks: async () => fixture.tasks,
        loadSyncedData: async () => fixture.saved,
        persistDataSynced: async value => { if (fixture.failSave) throw Error('Save failed'); fixture.saved = value; },
        dispatchAction: async action => {
          if (fixture.failDispatch) throw Error('Dispatch failed');
          fixture.actions.push(action); fixture.current = action.id;
          fixture.hooks.currentTaskChange?.({ current: fixture.tasks.find(task => task.id === action.id), previous: null });
        },
        registerHook: async (name, fn) => { fixture.hooks[name] = fn; },
      };
    });
    await page.goto(url);
    // The card overlays the map and may cover other stops, so close it before switching.
    const open = async role => {
      if (await page.locator('#node-' + role).getAttribute('aria-expanded') === 'true') return;
      if (await page.locator('#panel').isVisible()) await page.locator('#close-detail').click();
      await page.locator('#node-' + role).click();
      await page.locator('#detail').waitFor();
    };
    const pick = async role => { await open(role); await page.locator('#choice').click(); await page.locator('#picker').waitFor(); };

    // Nothing is pre-selected; the map shows stops and the detail card only appears on demand.
    await page.locator('#progress').getByText('Pick a stop').waitFor();
    for (const role of roles) assert.equal(await page.locator('#node-' + role).getAttribute('data-status'), 'empty', role);
    assert.equal(await page.locator('#detail').isVisible(), false);
    assert.equal(await page.locator('.trails path').count(), 3);
    // Only the main path is numbered; side quests are an optional branch.
    assert.deepEqual(await page.locator('.stops li:not([data-role=side]) .step').allTextContents(), ['1', '2', '3']);
    assert.equal(await page.locator('#node-side .step').isVisible(), false);
    await open('boss');
    assert.equal(await page.locator('#choice').textContent(), 'Choose your challengeChoose ›');
    assert.equal(await page.locator('#act').isVisible(), false);

    // Searchable task selector: filtering, highlighting, keyboard choice.
    await page.locator('#choice').click();
    await page.locator('#picker').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'task-search');
    // Nothing looks pre-chosen: no option is highlighted until the person types or uses the arrows.
    assert.equal(await page.locator('#task-search').getAttribute('aria-activedescendant'), null);
    assert.equal(await page.locator('#task-choice [aria-selected=true]').count(), 0);
    assert.deepEqual(await page.locator('#task-choice [role=option] .option-text > span:first-child').allTextContents(), ['Review one small PR', 'Untangle the sync architecture', 'Parent task']);
    assert.match(await page.locator('#task-choice [role=option]').nth(2).textContent(), /1 step/);
    assert.match(await page.locator('#task-choice [role=option]').first().textContent(), /Today · ~15m/);
    assert.equal(await page.locator('#save').isVisible(), false);
    await page.locator('#task-search').fill('zzz');
    await page.locator('#task-empty').getByText('No tasks match “zzz”.').waitFor();
    await page.locator('#task-search').fill('SYNC arch');
    assert.equal(await page.locator('#task-choice [role=option]').count(), 1);
    assert.deepEqual(await page.locator('#task-choice mark').allTextContents(), ['sync', 'arch']);
    await page.locator('#task-search').fill('');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('#task-search').getAttribute('aria-activedescendant'), 'task-option-1');
    await page.keyboard.press('Enter');
    await page.locator('#picker').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => JSON.parse(fixture.saved).boss), 'a');
    assert.deepEqual(await page.evaluate(() => fixture.actions), []);
    assert.equal(await page.locator('#node-boss').getAttribute('data-status'), 'chosen');

    // Starting the boss runs the timer once and counts an attempt.
    await page.locator('#act').click();
    await page.getByRole('button', { name: '▶ Adventuring now' }).waitFor();
    assert.deepEqual(await page.evaluate(() => fixture.actions), [{ type: '[Task] SetCurrentTask', id: 'a' }]);
    assert.equal(await page.evaluate(() => JSON.parse(fixture.saved).attempts.a), 1);
    assert.equal(await page.locator('#attempts').textContent(), '1 attempt · Still standing');
    assert.equal(await page.locator('#node-boss').getAttribute('data-status'), 'active');
    assert.equal(await page.locator('#act').isDisabled(), true);
    await page.getByRole('button', { name: 'Dismiss message' }).click();
    await page.evaluate(() => refresh());
    assert.equal(await page.locator('#act').isDisabled(), true);

    // Side quests: a list that excludes the boss and parents; starting one counts no boss attempt.
    await pick('side');
    assert.equal(await page.locator('#task-choice [role=option]').count(), 1);
    await page.locator('#task-choice [role=option]').click();
    await page.locator('#picker').waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => JSON.parse(fixture.saved).side), ['b']);
    assert.equal(await page.locator('#node-side .stop-value').textContent(), '1 waiting');
    assert.equal(await page.locator('#act').isVisible(), false, 'side quests are never a required action');
    await page.getByRole('button', { name: 'Start: Review one small PR' }).click();
    await page.getByRole('button', { name: 'Running: Review one small PR' }).waitFor();
    assert.deepEqual(await page.evaluate(() => fixture.actions.at(-1)), { type: '[Task] SetCurrentTask', id: 'b' });
    assert.equal(await page.evaluate(() => JSON.parse(fixture.saved).attempts.b), undefined);
    assert.equal(await page.locator('#node-side').getAttribute('data-status'), 'active');
    await page.locator('#choice').click();
    await page.locator('#task-empty').getByText('No available tasks', { exact: false }).waitFor();
    await page.locator('#cancel').click();

    // Rituals: suggestions, check-in, custom text resets the check-in.
    await pick('buff');
    await page.getByRole('button', { name: 'Put on a focus playlist', exact: true }).click();
    await page.locator('#picker').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => JSON.parse(fixture.saved).buff), 'Put on a focus playlist');
    await page.locator('#act').click();
    await page.getByRole('button', { name: 'Done for today ✓' }).waitFor();
    assert.equal(await page.locator('#node-buff').getAttribute('data-status'), 'complete');
    assert.equal(await page.locator('.trails path.done').count(), 1);
    await page.locator('#choice').click();
    await page.locator('#ritual').fill('Light a candle and play jazz');
    await page.locator('#save').click();
    await page.locator('#picker').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => JSON.parse(fixture.saved).buff), 'Light a candle and play jazz');
    assert.equal(await page.locator('#act').isEnabled(), true);
    await pick('recovery');
    await page.locator('#ritual').fill('<img src=x onerror=alert(1)>');
    await page.locator('#save').click();
    await page.locator('#picker').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#node-recovery .stop-value').textContent(), '<img src=x onerror=alert(1)>');
    assert.equal(await page.locator('img').count(), 0);
    await page.locator('#choice').click();
    await page.getByRole('button', { name: 'Walk outside', exact: true }).click();
    await page.locator('#picker').waitFor({ state: 'hidden' });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#panel').isVisible(), false);
    await open('side');
    await page.locator('.map').click({ position: { x: 5, y: 5 } });
    assert.equal(await page.locator('#panel').isVisible(), false, 'clicking the map closes the card');
    await page.screenshot({ path: shot('desktop'), animations: 'disabled' });

    // Responsive layouts with long titles: stops stay on the map, apart, and reachable.
    await page.evaluate(() => { fixture.tasks[0].title = 'A very long final boss task with plenty of detail '.repeat(8); fixture.tasks[1].title = 'UnbrokenTaskTitle'.repeat(20); });
    await page.evaluate(() => refresh());
    for (const [width, height] of [[240, 500], [280, 600], [320, 480], [320, 568], [380, 650], [390, 844], [508, 668], [600, 800], [768, 1024], [844, 390], [1024, 600], [1024, 768], [1100, 800], [1200, 700], [1440, 1000]]) {
      await page.setViewportSize({ width, height });
      const issues = await page.evaluate(() => {
        const failures = [];
        const map = document.querySelector('.map').getBoundingClientRect();
        if (document.documentElement.scrollWidth > innerWidth) failures.push('horizontal overflow');
        const stops = [...document.querySelectorAll('.stops li')].map(li => ({ role: li.dataset.role, rect: li.getBoundingClientRect() }));
        for (const { role, rect } of stops) {
          if (rect.left < map.left - 1 || rect.right > map.right + 1 || rect.top < map.top - 1 || rect.bottom > map.bottom + 1) failures.push(role + ' outside map');
        }
        for (let i = 0; i < stops.length; i++) for (let j = i + 1; j < stops.length; j++) {
          const a = stops[i].rect, b = stops[j].rect;
          if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) failures.push(`${stops[i].role} overlaps ${stops[j].role}`);
        }
        for (const element of document.querySelectorAll('.stop-label, .slot, #act, header')) {
          if (element.scrollWidth > element.clientWidth + 1) failures.push('content overflow: ' + (element.id || element.className || element.tagName));
        }
        return failures;
      });
      assert.deepEqual(issues, [], `${width}×${height}`);
      for (const role of roles) {
        await open(role);
        const card = await page.evaluate(role => {
          const map = document.querySelector('.map').getBoundingClientRect(), panel = document.querySelector('#panel').getBoundingClientRect();
          const orb = document.querySelector(`#node-${role} .orb`).getBoundingClientRect();
          return { insideX: panel.left >= map.left - 1 && panel.right <= map.right + 1, coversStop: panel.left < orb.right && panel.right > orb.left && panel.top < orb.bottom && panel.bottom > orb.top, overflow: document.documentElement.scrollWidth > innerWidth };
        }, role);
        assert.deepEqual(card, { insideX: true, coversStop: false, overflow: false }, `${role} card ${width}×${height}`);
        await page.locator('#choice').click();
        await page.locator('#picker').waitFor();
        assert.equal(await page.locator('#picker').evaluate(element => element.scrollWidth <= element.clientWidth), true, `${role} picker ${width}`);
        const box = await page.locator('#picker').boundingBox();
        assert.ok(box.y >= 0 && box.y + box.height <= height + 1, `${role} picker fits ${width}×${height}`);
        await page.locator('#cancel').click();
        await page.locator('#close-detail').click();
      }
    }
    // The iframe can be wide while its content panel is constrained by the host.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => { document.body.style.width = '500px'; });
    const portrait = await page.locator('.map').evaluate(map => map.clientHeight > map.clientWidth);
    assert.equal(portrait, true, 'narrow content panel in a wide viewport uses the portrait map');
    await page.evaluate(() => { document.body.style.removeProperty('width'); });
    await page.evaluate(() => { fixture.tasks[0].title = 'Untangle the sync architecture'; fixture.tasks[1].title = 'Review one small PR'; });
    await page.evaluate(() => refresh());
    await page.setViewportSize({ width: 390, height: 844 });
    await open('boss');
    await page.screenshot({ path: shot('mobile'), fullPage: true, animations: 'disabled' });

    await page.setViewportSize({ width: 320, height: 568 });
    await pick('buff');
    await page.locator('#ritual').fill('   ');
    await page.locator('#save').click();
    await page.locator('#picker-error').getByText('Add a little something for yourself first.').waitFor();
    await page.locator('#cancel').click();

    // Host events: completion, deletion, failures.
    await open('boss');
    await page.evaluate(() => { fixture.tasks[0].isDone = true; fixture.hooks.taskComplete(); });
    await page.locator('#act').getByText('Boss defeated ✓').waitFor();
    await page.locator('#attempts').getByText('Victory. You showed up.').waitFor();
    await page.evaluate(() => { fixture.tasks = fixture.tasks.filter(task => task.id !== 'a'); fixture.hooks.taskDelete(); });
    await page.locator('#choice').getByText('Choose your challenge').waitFor();
    assert.equal(await page.locator('#act').isVisible(), false);
    await page.locator('#choice').click();
    // Stashed side quests stay out of the boss list; parents are allowed.
    assert.deepEqual(await page.locator('#task-choice [role=option] .option-text > span:first-child').allTextContents(), ['Parent task']);
    await page.locator('#cancel').click();
    await page.evaluate(() => { fixture.current = null; fixture.hooks.currentTaskChange({ current: null }); fixture.failDispatch = true; });
    await open('side');
    await page.getByRole('button', { name: 'Start: Review one small PR' }).click();
    await page.getByText('That did not work. Please try again.').waitFor();
    await page.evaluate(() => { fixture.failDispatch = false; fixture.failSave = true; });
    await page.getByRole('button', { name: 'Remove Review one small PR from side quests' }).click();
    await page.getByText('That did not work. Please try again.').waitFor();
    assert.equal(await page.locator('#camp li').count(), 1, 'a failed removal keeps the side quest');
    await page.evaluate(() => { fixture.failSave = false; });
    await page.getByRole('button', { name: 'Remove Review one small PR from side quests' }).click();
    await page.locator('#camp').waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => JSON.parse(fixture.saved).side), []);
    await page.evaluate(() => { fixture.failSave = true; });
    await pick('recovery');
    await page.getByRole('button', { name: 'Stretch for a minute', exact: true }).click();
    await page.locator('#picker-error').getByText('Could not save your choice. Please try again.').waitFor();
    assert.equal(await page.locator('#picker').isVisible(), true);
    assert.equal(await page.evaluate(() => JSON.parse(fixture.saved).recovery), 'Walk outside');
    await page.locator('#cancel').click();
    assert.deepEqual(errors, []);

    // v0.1 saved its default rituals as if chosen; those are cleared, real choices are kept.
    const legacy = await browser.newPage();
    await legacy.addInitScript(() => {
      window.PluginAPI = { getTasks: async () => [], loadSyncedData: async () => JSON.stringify({ boss: null, side: null, buff: 'Coffee + music', recovery: 'Walk outside', attempts: {}, rituals: {} }), persistDataSynced: async () => {}, dispatchAction: async () => {} };
    });
    await legacy.goto(url);
    await legacy.locator('#progress').getByText('Nothing chosen yet').waitFor();
    for (const role of roles) assert.equal(await legacy.locator('#node-' + role).getAttribute('data-status'), 'empty', 'legacy ' + role);
    await legacy.evaluate(() => { window.PluginAPI = undefined; });
    const chosen = await browser.newPage();
    await chosen.addInitScript(() => {
      window.PluginAPI = { getTasks: async () => [], loadSyncedData: async () => JSON.stringify({ version: 2, buff: 'Coffee + music', attempts: {}, rituals: {} }), persistDataSynced: async () => {}, dispatchAction: async () => {} };
    });
    await chosen.goto(url);
    await chosen.locator('#node-buff[data-status=chosen]').waitFor();
    // v0.2 kept a single side quest; it moves into the v0.3 list.
    const migrated = await browser.newPage();
    await migrated.addInitScript(() => {
      window.PluginAPI = { getTasks: async () => [{ id: 'b', title: 'Review one small PR', isDone: false }], loadSyncedData: async () => JSON.stringify({ version: 2, side: 'b', attempts: {}, rituals: {} }), persistDataSynced: async () => {}, dispatchAction: async () => {} };
    });
    await migrated.goto(url);
    await migrated.locator('#node-side .stop-value').getByText('1 waiting').waitFor();

    // A boss with subtasks: steps become waypoints, the trail fills in, and clearing them all offers victory.
    const steps = await browser.newPage();
    await steps.addInitScript(() => {
      window.fx = {
        tasks: [
          { id: 'P', title: 'Release 19.2', isDone: false, subTaskIds: ['s1', 's2', 'gone'] },
          { id: 's1', title: 'Write release notes', isDone: false, parentId: 'P' },
          { id: 's2', title: 'Tag and publish', isDone: false, parentId: 'P' },
        ],
        actions: [], updates: [], hooks: {}, saved: JSON.stringify({ version: 3, boss: 'P', side: [], attempts: {}, rituals: {} }), failSave: false,
      };
      window.PluginAPI = {
        getTasks: async () => fx.tasks, loadSyncedData: async () => fx.saved,
        persistDataSynced: async value => { if (fx.failSave) throw Error('Save failed'); fx.saved = value; },
        dispatchAction: async action => { fx.actions.push(action.id); fx.hooks.currentTaskChange?.({ current: fx.tasks.find(task => task.id === action.id) }); },
        updateTask: async (id, updates) => { fx.updates.push([id, updates]); Object.assign(fx.tasks.find(task => task.id === id), updates); },
        registerHook: async (name, fn) => { fx.hooks[name] = fn; },
      };
    });
    await steps.goto(url);
    await steps.locator('#node-boss[data-status=chosen]').waitFor();
    assert.deepEqual(await steps.locator('.waypoint').evaluateAll(dots => dots.map(dot => [dot.title, dot.dataset.status])), [['Write release notes', 'next'], ['Tag and publish', 'open']], 'missing subtasks are skipped');
    assert.equal(await steps.locator('.trails path').count(), 5);
    await steps.locator('.waypoint').first().click();
    await steps.locator('#steps-summary').getByText('0 of 2 steps cleared', { exact: false }).waitFor();
    await steps.getByRole('button', { name: 'Take the next step' }).click();
    await steps.getByRole('button', { name: 'Running: Write release notes' }).waitFor();
    assert.equal(await steps.locator('.waypoint[data-status=active]').getAttribute('title'), 'Write release notes');
    await steps.getByRole('button', { name: 'Start step: Tag and publish' }).click();
    await steps.getByRole('button', { name: 'Running: Tag and publish' }).waitFor();
    assert.deepEqual(await steps.evaluate(() => fx.actions), ['s1', 's2']);
    assert.equal(await steps.evaluate(() => JSON.parse(fx.saved).attempts.P), 2, 'steps count as boss attempts');
    await steps.evaluate(() => { fx.tasks[1].isDone = true; fx.hooks.taskComplete(); });
    await steps.locator('#steps-summary').getByText('1 of 2 steps cleared', { exact: false }).waitFor();
    assert.equal(await steps.locator('.trails path.done').count(), 1, 'the trail fills in up to the cleared step');
    await steps.evaluate(() => { fx.tasks[2].isDone = true; fx.hooks.currentTaskChange({ current: null }); });
    await steps.getByRole('button', { name: 'Defeat the boss' }).click();
    await steps.getByRole('button', { name: 'Boss defeated ✓' }).waitFor();
    assert.equal(await steps.locator('#node-boss').evaluate(node => node.classList.contains('victory')), true, 'defeating the boss celebrates');
    assert.deepEqual(await steps.evaluate(() => fx.updates), [['P', { isDone: true }]]);
    assert.equal(await steps.locator('.trails path.done').count(), 3);
    // The attempt save can fail after the timer started; the person is told so.
    const solo = await browser.newPage();
    await solo.addInitScript(() => {
      window.PluginAPI = { getTasks: async () => [{ id: 'Q', title: 'Solo boss', isDone: false }], loadSyncedData: async () => JSON.stringify({ version: 3, boss: 'Q' }), persistDataSynced: async () => { throw Error('Save failed'); }, dispatchAction: async () => {} };
    });
    await solo.goto(url);
    await solo.locator('#node-boss').click();
    await solo.getByRole('button', { name: 'Face the boss' }).click();
    await solo.getByText('Task started, but the attempt could not be saved.').waitFor();

    // Choosing a boss turns its subtasks into steps, so they leave the side-quest stash.
    const promoted = await browser.newPage();
    await promoted.addInitScript(() => {
      window.fx = { saved: JSON.stringify({ version: 3, boss: null, side: ['s1', 'X'] }) };
      window.PluginAPI = {
        getTasks: async () => [
          { id: 'P', title: 'Parent boss', isDone: false, subTaskIds: ['s1'] },
          { id: 's1', title: 'Stashed step', isDone: false, parentId: 'P' },
          { id: 'X', title: 'Other side quest', isDone: false },
        ],
        loadSyncedData: async () => fx.saved, persistDataSynced: async value => { fx.saved = value; }, dispatchAction: async () => {},
      };
    });
    await promoted.goto(url);
    await promoted.locator('#node-side .stop-value').getByText('2 waiting').waitFor();
    await promoted.locator('#node-boss').click();
    await promoted.locator('#choice').click();
    await promoted.getByRole('option', { name: /Parent boss/ }).click();
    await promoted.locator('#node-side .stop-value').getByText('1 waiting').waitFor();
    assert.deepEqual(await promoted.evaluate(() => JSON.parse(fx.saved).side), ['X']);

    // A task change reported while the map is busy is not lost: the map loads again afterwards.
    const late = await browser.newPage();
    await late.addInitScript(() => {
      window.fx = { tasks: [{ id: 'L', title: 'Late boss', isDone: false }], hooks: {}, gate: null };
      window.PluginAPI = {
        // Snapshot at call time, like a real round trip that started before the change.
        getTasks: async () => { const snapshot = JSON.parse(JSON.stringify(fx.tasks)); await fx.gate; return snapshot; },
        loadSyncedData: async () => JSON.stringify({ version: 3, boss: 'L' }), persistDataSynced: async () => {}, dispatchAction: async () => {},
        registerHook: async (name, fn) => { fx.hooks[name] = fn; },
      };
    });
    await late.goto(url);
    await late.locator('#node-boss[data-status=chosen]').waitFor();
    await late.evaluate(() => {
      let release; fx.gate = new Promise(resolve => { release = resolve; }); fx.release = release;
      fx.hooks.taskUpdate();
      fx.tasks[0].isDone = true; fx.hooks.taskComplete();
      fx.gate = null; fx.release();
    });
    await late.locator('#node-boss[data-status=complete]').waitFor();

    // Quests finished on an earlier day clear from the map; today's wins stay, and a boss already done does not celebrate again.
    const nextDay = await browser.newPage();
    await nextDay.addInitScript(() => {
      const yesterday = Date.now() - 86400000;
      window.fx = {
        tasks: [
          { id: 'old-boss', title: 'Old boss', isDone: true, doneOn: yesterday },
          { id: 'old-side', title: 'Old side quest', isDone: true, doneOn: yesterday },
          { id: 'new-side', title: 'Won today', isDone: true, doneOn: Date.now() },
          { id: 'open', title: 'Still open', isDone: false },
        ],
        saved: JSON.stringify({ version: 3, boss: 'old-boss', side: ['old-side', 'new-side', 'open'], attempts: {}, rituals: {} }),
      };
      window.PluginAPI = { getTasks: async () => fx.tasks, loadSyncedData: async () => fx.saved, persistDataSynced: async value => { fx.saved = value; }, dispatchAction: async () => {} };
    });
    await nextDay.goto(url);
    await nextDay.locator('#node-boss[data-status=empty]').waitFor();
    await nextDay.locator('#node-side').click();
    assert.deepEqual(await nextDay.locator('#camp .row-title').allTextContents(), ['Won today', 'Still open']);
    await nextDay.getByRole('button', { name: 'Remove Still open from side quests' }).click();
    await nextDay.locator('#camp li').first().waitFor();
    assert.deepEqual(await nextDay.evaluate(() => JSON.parse(fx.saved).side), ['new-side'], 'saving drops quests finished on earlier days');
    const doneToday = await browser.newPage();
    await doneToday.addInitScript(() => {
      window.PluginAPI = { getTasks: async () => [{ id: 'B', title: 'Beaten', isDone: true, doneOn: Date.now() }], loadSyncedData: async () => JSON.stringify({ version: 3, boss: 'B' }), persistDataSynced: async () => {}, dispatchAction: async () => {} };
    });
    await doneToday.goto(url);
    await doneToday.locator('#node-boss[data-status=complete]').waitFor();
    assert.equal(await doneToday.locator('#node-boss').evaluate(node => node.classList.contains('victory')), false);

    // Demo mode starts empty too and persists within the tab.
    const demo = await browser.newPage();
    await demo.goto(url);
    await demo.locator('#demo').waitFor();
    for (const role of roles) assert.equal(await demo.locator('#node-' + role).getAttribute('data-status'), 'empty', 'demo ' + role);
    await demo.locator('#node-boss').click();
    await demo.locator('#choice').click();
    await demo.locator('#task-search').fill('sync');
    await demo.keyboard.press('Enter');
    await demo.getByRole('button', { name: 'Take the next step' }).click();
    await demo.reload();
    await demo.locator('#node-boss').click();
    await demo.getByText('1 attempt · Still standing').waitFor();
    console.log(`PASS: empty start (incl. clearing v0.1 saved defaults and migrating v0.2 side quests), boss subtasks as waypoints and steps, optional side-quest list, next-day clearing of finished quests, victory moment, map stops with on-map detail cards, searchable task combobox (filter, highlight, keyboard), timer dispatch, attempts, rituals, safe text, host events, error handling, 15 responsive sizes, and demo persistence. Screenshots: ${shot('desktop')}, ${shot('mobile')}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
