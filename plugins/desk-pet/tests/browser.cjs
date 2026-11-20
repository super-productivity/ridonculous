// Opens demo.html (which loads plugin.js) with a fake PluginAPI and checks Mochi's mood for hand-written task histories.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const url = pathToFileURL(path.resolve(__dirname, '../demo.html')).href;

// "Now" for every case: 19 Nov 2026, 12:00 local time.
const NOW = new Date(2026, 10, 19, 12, 0).getTime();
const at = (day, hour = 10) => new Date(2026, 10, day, hour, 0).getTime();
const done = (id, ts) => ({ id, title: id, isDone: true, doneOn: ts });
const open = (id, extra = {}) => ({ id, title: id, isDone: false, ...extra });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.setFixedTime(NOW);

    const load = async ({ tasks = [], archived = [], offsetMs = 0, failTasks = false, hidden = false, position = '' }) => {
      await page.addInitScript(fixture => {
        window.fixture = { ...fixture, hooks: {}, hookList: {}, archiveReads: 0, taskReads: 0, buttons: [], unload: null };
        localStorage.setItem('ridonculous-desk-pet-hidden', fixture.hidden ? '1' : '');
        localStorage.setItem('ridonculous-desk-pet-position', fixture.position);
        window.q = id => document.querySelector('ridonculous-desk-pet')?.shadowRoot.getElementById(id);
        window.PluginAPI = {
          Hooks: { DATA_CHANGED: 'dataChanged', DAY_CHANGE: 'dayChange' },
          registerHook: (name, cb) => { (window.fixture.hookList[name] ||= []).push(cb); window.fixture.hooks[name] = () => window.fixture.hookList[name].forEach(fn => fn()); },
          registerHeaderButton: cfg => { window.fixture.buttons.push(cfg); },
          onUnload: fn => { window.fixture.unload = fn; },
          getTasks: async () => { window.fixture.taskReads++; if (window.fixture.failTasks) throw Error('Task read failed'); return structuredClone(window.fixture.tasks); },
          getArchivedTasks: async () => { window.fixture.archiveReads++; return structuredClone(window.fixture.archived); },
          getDayContext: async () => ({ todayStr: '2026-11-19', startOfNextDayDiffMs: window.fixture.offsetMs }),
        };
      }, { tasks, archived, offsetMs, failTasks, hidden, position });
      await page.goto(url);
      await page.waitForFunction(() => q('mood')?.textContent !== 'Mochi is waking up…');
    };
    const read = () => page.evaluate(() => ({
      mood: q('mood').textContent,
      cls: q('pet').getAttribute('class'),
      stats: [...q('stats').children].map(line => line.textContent).join(' | '),
      // Which body shape is actually drawn: exactly one mood group should be visible.
      shape: [...document.querySelector('ridonculous-desk-pet').shadowRoot.querySelectorAll('.mood')].filter(g => getComputedStyle(g).display !== 'none').map(g => g.classList[1]).join(),
    }));
    const fireChange = async mutate => {
      await page.evaluate(`(${mutate})(window.fixture); window.fixture.hooks.dataChanged();`);
      await page.waitForTimeout(100);
    };

    // A brand-new user is hungry, not neglected.
    await load({});
    assert.deepEqual(await read(), { mood: 'Mochi is hungry', cls: 'pet hungry', shape: 'm-hungry', stats: '0 snacks today · 0 overdue | Never fed yet' });

    // Only Mochi catches the pointer: the (invisible) bubble area above them lets clicks through to the app.
    const box = await page.locator('ridonculous-desk-pet #pet').boundingBox();
    assert.notEqual(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [box.x + box.width / 2, box.y - 40]), 'RIDONCULOUS-DESK-PET');
    assert.equal(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [box.x + box.width / 2, box.y + box.height / 2]), 'RIDONCULOUS-DESK-PET');

    await page.locator('ridonculous-desk-pet #pet').hover(); // hovering Mochi still opens the bubble
    await page.waitForFunction(() => getComputedStyle(document.querySelector('ridonculous-desk-pet').shadowRoot.querySelector('.bubble')).opacity === '1');
    await page.mouse.move(0, 0);

    // Two snacks today, one overdue: still content.
    await load({ tasks: [done('a', at(19, 9)), done('b', at(19, 11)), open('c', { dueDay: '2026-11-18' }), open('d', { dueDay: '2026-11-19' })] });
    assert.deepEqual(await read(), { mood: 'Mochi is content', cls: 'pet content', shape: 'm-content', stats: '2 snacks today · 1 overdue | Last snack today' });

    // Three snacks today.
    await load({ tasks: [done('a', at(19, 8)), done('b', at(19, 9)), done('c', at(19, 10))] });
    assert.equal((await read()).mood, 'Mochi is overjoyed');
    assert.equal((await read()).shape, 'm-overjoyed');

    // Three overdue (two by day, one by time earlier today) outweigh two snacks; a future time or a done task is not overdue.
    await load({ tasks: [done('a', at(19)), open('b', { dueDay: '2026-11-17' }), open('c', { dueDay: '2026-11-10' }),
      open('d', { dueWithTime: at(19, 11) }), open('e', { dueWithTime: at(19, 15) }), { ...done('f', at(19)), dueDay: '2026-11-01' }] });
    assert.deepEqual(await read(), { mood: 'Mochi is grumpy', cls: 'pet grumpy', shape: 'm-grumpy', stats: '2 snacks today · 3 overdue | Last snack today' });

    // Last snack four days ago: sulking. Two days ago: just hungry.
    await load({ archived: [done('a', at(15)), done('b', at(12))] });
    assert.deepEqual(await read(), { mood: 'Mochi is sulking', cls: 'pet sulking', shape: 'm-sulking', stats: '0 snacks today · 0 overdue | Last snack 4 days ago' });
    assert.match(await page.evaluate(() => q('line').textContent), /Nothing finished in 4 days/);
    // The sulking "hmph" sits outside Mochi's button and must not catch clicks either.
    assert.notEqual(await page.evaluate(() => {
      const r = document.querySelector('ridonculous-desk-pet').shadowRoot.querySelector('text.hmph').getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.tagName;
    }), 'RIDONCULOUS-DESK-PET');
    await load({ archived: [done('a', at(16))] }); // exactly three days: sulking starts
    assert.equal((await read()).mood, 'Mochi is sulking');
    // "Won't do" marks a task done, but dismissing work doesn't feed Mochi.
    await load({ tasks: [{ ...done('w', at(19)), wontDoOn: at(19) }], archived: [done('a', at(10))] });
    assert.equal((await read()).mood, 'Mochi is sulking');
    // An unfinished subtask archived with its finished parent is not overdue.
    await load({ tasks: [done('a', at(19))], archived: [open('s', { dueDay: '2026-11-01' }), open('t', { dueDay: '2026-11-02' }), open('u', { dueDay: '2026-11-03' })] });
    assert.equal((await read()).stats, '1 snack today · 0 overdue | Last snack today');
    await load({ archived: [done('a', at(17))] });
    assert.equal((await read()).mood, 'Mochi is hungry');

    // With the day starting at 04:00, a task finished at 02:00 belongs to yesterday.
    await load({ tasks: [done('a', at(19, 2))], offsetMs: 4 * 3600000 });
    assert.deepEqual(await read(), { mood: 'Mochi is hungry', cls: 'pet hungry', shape: 'm-hungry', stats: '0 snacks today · 0 overdue | Last snack 1 day ago' });

    // Finishing a task feeds Mochi with a munch; Finish Day archiving keeps today's snacks counted.
    await load({ tasks: [done('a', at(19, 9)), open('b')] });
    assert.equal((await read()).stats, '1 snack today · 0 overdue | Last snack today');
    await fireChange(f => { f.tasks[1] = { ...f.tasks[1], isDone: true, doneOn: Date.now() }; });
    assert.deepEqual(await read(), { mood: 'Nom nom!', cls: 'pet content munch', shape: 'm-content', stats: '2 snacks today · 0 overdue | Last snack today' });
    assert.equal(await page.locator('ridonculous-desk-pet .plus').textContent(), '+1');
    await page.waitForFunction(() => q('mood').textContent === 'Mochi is content' && !q('pet').classList.contains('munch')); // back to the mood after munching
    const readsBefore = await page.evaluate(() => fixture.archiveReads);
    await fireChange(() => {}); // a tracking tick must not re-read the archive
    assert.equal(await page.evaluate(() => fixture.archiveReads), readsBefore);
    await fireChange(f => { f.archived = f.tasks; f.tasks = []; });
    assert.equal(await page.evaluate(() => fixture.archiveReads), readsBefore + 1);
    assert.equal((await read()).stats, '2 snacks today · 0 overdue | Last snack today');

    // Finish Day and a new completion in the same refresh: the done count stays 1, but the archived snack still counts.
    await load({ tasks: [done('a', at(19, 9)), open('b')] });
    await fireChange(f => { f.archived = [f.tasks[0]]; f.tasks = [{ ...f.tasks[1], isDone: true, doneOn: Date.now() }]; });
    assert.equal((await read()).stats, '2 snacks today · 0 overdue | Last snack today');
    // A task restored from the archive is counted once, not twice.
    await fireChange(f => { f.tasks.push(f.archived[0]); });
    assert.equal((await read()).stats, '2 snacks today · 0 overdue | Last snack today');

    // Petting adds a heart.
    await page.locator('#pet').click();
    assert.equal(await page.locator('.heart').count(), 1);
    // After the squish, Mochi goes back to their idle animation instead of freezing.
    await page.waitForTimeout(700);
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('ridonculous-desk-pet').shadowRoot.querySelector('.wobble')).animationName), 'squish');

    // Dragging moves Mochi and doesn't count as petting; the spot is remembered.
    await load({});
    const centre = async () => { const b = await page.locator('#pet').boundingBox(); return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)]; };
    const drag = async (x, y) => {
      const [fromX, fromY] = await centre();
      await page.mouse.move(fromX, fromY); await page.mouse.down(); await page.mouse.move(x, y, { steps: 6 }); await page.mouse.up();
    };
    // While held, the bubble stays out of the way.
    { const [fx, fy] = await centre(); await page.mouse.move(fx, fy); await page.mouse.down(); await page.mouse.move(fx - 200, fy - 200, { steps: 4 });
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('ridonculous-desk-pet').shadowRoot.querySelector('.bubble')).opacity), '0', 'bubble hidden mid-drag');
      await page.mouse.up(); }
    await drag(300, 240);
    assert.deepEqual(await centre(), [300, 240]);
    assert.equal(await page.locator('.heart').count(), 0, 'a drag is not a pet');
    const saved = await page.evaluate(() => localStorage.getItem('ridonculous-desk-pet-position'));
    // A plain click right after a drag still pets.
    await page.locator('#pet').click();
    assert.equal(await page.locator('.heart').count(), 1);
    // Near the top-left corner the bubble opens below and to the right, so it stays on screen.
    await drag(60, 60);
    await page.mouse.move(60, 60);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('ridonculous-desk-pet').shadowRoot.querySelector('.bubble')).opacity === '1');
    const bubble = await page.locator('.bubble').boundingBox();
    assert.ok(bubble.x >= 0 && bubble.y >= 0, `bubble on screen: ${JSON.stringify(bubble)}`);
    // The remembered spot is used after a reload.
    await load({ position: saved });
    assert.deepEqual(await centre(), [300, 240]);
    // A spot that no longer fits (smaller window) is pulled back on screen.
    await page.setViewportSize({ width: 260, height: 200 });
    await page.waitForTimeout(100);
    const shrunk = await page.locator('#pet').boundingBox();
    assert.ok(shrunk.x + shrunk.width <= 260 && shrunk.y + shrunk.height <= 200, `Mochi on screen: ${JSON.stringify(shrunk)}`);
    await page.setViewportSize({ width: 1280, height: 720 });
    // Same when the window shrinks while Mochi is hidden: they come back on screen.
    await load({ position: saved });
    await page.evaluate(() => fixture.buttons[0].onClick());
    await page.setViewportSize({ width: 260, height: 200 });
    await page.waitForTimeout(100);
    await page.evaluate(() => fixture.buttons[0].onClick());
    const reshown = await page.locator('#pet').boundingBox();
    assert.ok(reshown.x >= 0 && reshown.x + reshown.width <= 260 && reshown.y + reshown.height <= 200, `Mochi back on screen: ${JSON.stringify(reshown)}`);
    await page.setViewportSize({ width: 1280, height: 720 });
    // A drag the browser cancels (e.g. a touch turned into a gesture) doesn't swallow the next keyboard pet.
    await page.evaluate(() => {
      const pet = q('pet'); const at = (type, x) => pet.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, buttons: 1, clientX: x, clientY: 300 }));
      at('pointerdown', 300); at('pointermove', 340); at('pointercancel', 340);
    });
    const heartsBefore = await page.locator('.heart').count();
    await page.locator('#pet').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('.heart').count(), heartsBefore + 1, 'keyboard pet after a cancelled drag');
    // A broken saved value falls back to the corner instead of breaking Mochi.
    await load({ position: 'not json' });
    assert.deepEqual(await centre(), [1280 - 24 - 44, 720 - 20 - 44]);

    // A failed read is shown, not swallowed.
    await load({ failTasks: true });
    assert.equal(await page.evaluate(() => q('mood').textContent), 'Mochi is confused');
    assert.match(await page.evaluate(() => q('line').textContent), /Task read failed/);
    // A one-off failure recovers without waiting for a task change.
    await page.evaluate(() => { fixture.failTasks = false; });
    await page.waitForFunction(() => q('mood').textContent === 'Mochi is hungry', null, { timeout: 8000 });
    // An outage doesn't pile up retries: ten failed change events leave one retry every 5 s, not ten.
    await fireChange(f => { f.failTasks = true; });
    for (let i = 0; i < 10; i++) await page.evaluate(() => fixture.hooks.dataChanged());
    const before = await page.evaluate(() => fixture.taskReads); // each event reads once; count only the retries after
    await page.waitForTimeout(11000);
    const outageReads = await page.evaluate(() => fixture.taskReads) - before;
    assert.ok(outageReads <= 4, `expected at most 4 retries in 11 s, got ${outageReads}`);
    await page.evaluate(() => { fixture.failTasks = false; });
    await page.waitForFunction(() => q('mood').textContent === 'Mochi is hungry', null, { timeout: 8000 });
    // Same after a later failure, even though the recovered data is unchanged.
    await fireChange(f => { f.failTasks = true; });
    assert.equal(await page.evaluate(() => q('mood').textContent), 'Mochi is confused');
    await page.evaluate(() => { fixture.failTasks = false; });
    await page.waitForFunction(() => q('mood').textContent === 'Mochi is hungry', null, { timeout: 8000 });

    // The host can run plugin.js again without unloading it first: still one Mochi, and the old copy stops reading.
    await load({});
    await page.evaluate(code => new Function(code)(), fs.readFileSync(path.resolve(__dirname, '../plugin.js'), 'utf8')); // own scope, like the host
    await page.waitForFunction(() => q('mood').textContent === 'Mochi is hungry');
    assert.equal(await page.locator('ridonculous-desk-pet').count(), 1);
    const readsBeforeTick = await page.evaluate(() => fixture.taskReads);
    await page.evaluate(() => fixture.hooks.dataChanged());
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => fixture.taskReads), readsBeforeTick + 1, 'only the new copy reads');
    await page.evaluate(() => fixture.buttons[0].onClick()); // the stale copy's header button still works
    assert.equal(await page.locator('ridonculous-desk-pet').isVisible(), false);

    // The header button hides Mochi and remembers it; unloading the plugin removes the overlay.
    await load({});
    const button = await page.evaluate(() => fixture.buttons.map(b => [b.label, b.icon]));
    assert.deepEqual(button, [['Show or hide Mochi', 'pets']]);
    await page.evaluate(() => fixture.buttons[0].onClick());
    assert.equal(await page.locator('ridonculous-desk-pet').isVisible(), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('ridonculous-desk-pet-hidden')), '1');
    await load({ hidden: true });
    assert.equal(await page.locator('ridonculous-desk-pet').isVisible(), false);
    await page.evaluate(() => fixture.buttons[0].onClick());
    assert.equal(await page.locator('ridonculous-desk-pet').isVisible(), true);
    await page.evaluate(() => fixture.unload());
    assert.equal(await page.locator('ridonculous-desk-pet').count(), 0);
    const readsAtUnload = await page.evaluate(() => fixture.taskReads);
    await page.evaluate(() => fixture.hooks.dataChanged());
    assert.equal(await page.evaluate(() => fixture.taskReads), readsAtUnload, 'no reads after unload');

    // Standalone demo: a neglected pet perks up when fed.
    const demo = await browser.newPage();
    demo.on('pageerror', error => errors.push(error.message));
    await demo.goto(url);
    await demo.selectOption('#scenario', 'sulking');
    await demo.locator('ridonculous-desk-pet #mood', { hasText: 'Mochi is sulking' }).waitFor();
    await demo.click('#feed');
    await demo.locator('ridonculous-desk-pet #mood', { hasText: 'Nom nom!' }).waitFor();
    assert.match(await demo.locator('ridonculous-desk-pet #pet').getAttribute('class'), /content/);

    assert.deepEqual(errors, []);
    console.log('PASS: desk pet overlay moods, day offset, feeding, archive, petting, error, hide/unload and demo');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
