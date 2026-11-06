const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const url = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      // Observe real Web Audio nodes, including their cleanup, without replacing synthesis.
      window.audioProbe = { voices: 0, live: 0, gains: [], context: null };
      const NativeAudioContext = window.AudioContext;
      window.AudioContext = class extends NativeAudioContext {
        constructor(...args) { super(...args); audioProbe.context = this; }
        createGain() { const node = super.createGain(); audioProbe.gains.push(node); return node; }
        createOscillator() {
          const node = super.createOscillator(); audioProbe.voices++; audioProbe.live++;
          node.addEventListener('ended', () => audioProbe.live--); return node;
        }
      };
      window.fixture = {
        tasks: [
          { id: 'a', title: 'Finally sort out my tax return', timeEstimate: 7200000, subTaskIds: [], isDone: false },
          { id: 'b', title: 'Give my personal website some love', timeEstimate: 5400000, subTaskIds: ['done-step', 'next'], isDone: false },
          { id: 'done-step', title: 'Old step', parentId: 'b', isDone: true },
          { id: 'next', title: 'Sketch the home page', parentId: 'b', isDone: false },
          { id: 'c', title: 'Make that dentist appointment', timeEstimate: 600000, isDone: false },
          { id: 'done', title: 'Already finished', isDone: true },
        ],
        hooks: {}, reads: 0, saved: null, actions: [], adds: [], saves: [], failLoad: false, failTasks: false,
        failSave: false, failAdd: false, failStart: false, holdAdd: false,
      };
      window.PluginAPI = {
        registerHook: async (name, callback) => { fixture.hooks[name] = callback; },
        getTasks: async () => {
          fixture.reads++; if (fixture.failTasks) throw Error('Task read failed');
          const snapshot = structuredClone(fixture.tasks);
          if (fixture.holdRead) await new Promise(resolve => { fixture.releaseRead = resolve; });
          return snapshot;
        },
        loadSyncedData: async () => { if (fixture.failLoad) throw Error('Docket read failed'); return fixture.saved; },
        persistDataSynced: async value => {
          if (fixture.failSave) throw Error('Docket save failed');
          fixture.saved = value; fixture.saves.push(value);
        },
        dispatchAction: async action => { if (fixture.failStart) throw Error('Start failed'); fixture.actions.push(action); },
        addTask: async data => {
          if (fixture.failAdd) throw Error('Add failed');
          if (fixture.holdAdd) await new Promise(resolve => { fixture.releaseAdd = resolve; });
          const id = 'created-' + fixture.adds.length;
          fixture.adds.push(data);
          fixture.tasks.push({ ...data, id, isDone: false, subTaskIds: [] });
          const parent = fixture.tasks.find(task => task.id === data.parentId);
          (parent.subTaskIds ||= []).push(id);
          return id;
        },
      };
    });
    const ready = () => page.locator('#workspace:not([disabled])').waitFor();
    const reset = async () => { await page.goto(url); await ready(); };
    const openPicker = async () => {
      if (await page.locator('#picker').isVisible()) return;
      await page.locator(await page.locator('#outcome').isVisible() ? '#another' : await page.locator('#hearing').isVisible() ? '#change-case' : '#call-case').click();
    };
    const pick = async id => { await openPicker(); await page.locator(`[data-task-id="${id}"]`).click(); };
    const rule = async (defense = 'big') => {
      await page.locator(`[data-plea="${defense}"]`).click();
      await page.locator('#hear-verdict').click();
    };
    const refresh = async () => {
      const reads = await page.evaluate(() => { const reads = fixture.reads; fixture.hooks.dataChanged(); return reads; });
      await page.waitForFunction(reads => fixture.reads > reads && !syncing && !busy, reads);
      await ready();
    };

    await reset();
    assert.equal(await page.locator('#demo').isVisible(), false);
    assert.equal(await page.locator('.case-item').count(), 3, 'Only unfinished main tasks are tried');
    assert.equal(await page.locator('#sound').getAttribute('aria-pressed'), 'false');
    await page.locator('#pet-judge').click({ position: { x: 30, y: 40 } });
    assert.equal(await page.locator('#judge').getAttribute('data-voice'), 'meow');
    assert.equal(await page.locator('#pet-judge .pet-heart').count(), 1);
    assert.ok(await page.locator('#judge').evaluate(el => parseFloat(el.style.getPropertyValue('--lean-x')) < 0), 'Leans toward the touch');
    await page.waitForFunction(() => document.querySelector('#judge').dataset.voice === 'purr');
    assert.equal(await page.evaluate(() => audioProbe.voices), 0, 'Silent until sound is enabled');
    await page.locator('#sound').click();
    assert.equal(await page.evaluate(() => audioProbe.context.state), 'running');
    assert.equal(await page.evaluate(() => audioProbe.voices), 1, 'Enabling sound previews a meow');
    await page.locator('#pet-prosecutor').click();
    assert.equal(await page.evaluate(() => audioProbe.voices), 4, 'Petting plays a voice and a modulated purr');
    await page.locator('#pet-judge').click();
    await page.waitForFunction(() => audioProbe.live === 3);
    await page.locator('#sound').click();
    assert.equal(await page.evaluate(() => audioProbe.gains[0].gain.value), 0, 'Mute immediately silences the output');
    await page.waitForFunction(() => audioProbe.live === 0);
    await page.locator('#pet-prosecutor').click();
    assert.equal(await page.evaluate(() => audioProbe.voices), 7, 'Muted scritches create no more audio');
    assert.deepEqual(await page.evaluate(() => [fixture.adds, fixture.actions, fixture.saves]), [[], [], []]);
    await page.locator('#sound').click();
    await page.locator('#pet-judge').click();
    await page.waitForFunction(() => audioProbe.live === 0);
    await reset();
    await page.evaluate(() => { window.AudioContext = class { constructor() { throw Error('Audio unavailable'); } }; });
    await page.locator('#sound').click();
    assert.match(await page.locator('#notice').textContent(), /Sound is unavailable/);
    assert.equal(await page.locator('#sound').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('#sound').isEnabled(), true);
    await reset();
    // The cats argue in turn, while the written defense and all task controls stay usable.
    await page.locator('#sound').click(); await pick('a');
    const beforeDebate = await page.evaluate(() => audioProbe.voices);
    await page.locator('[data-plea="big"]').click();
    for (const id of ['prosecutor','judge','prosecutor','judge']) {
      await page.waitForFunction(id => document.querySelector('#' + id).dataset.chat === 'speaking', id);
      assert.equal(await page.locator('.speech.is-speaking').getAttribute('data-cat'), id);
      assert.equal(await page.locator('#' + id).getAttribute('data-voice'), 'meow');
    }
    assert.equal(await page.evaluate(() => audioProbe.voices), beforeDebate + 4, 'Four distinct, alternating meows');
    await page.waitForFunction(() => !document.querySelector('[data-chat]') && audioProbe.live === 0);
    assert.match(await page.locator('#observation').textContent(), /mountain/);
    assert.deepEqual(await page.evaluate(() => [fixture.adds, fixture.actions, fixture.saves]), [[], [], []]);
    await page.locator('#hear-verdict').click();
    assert.equal(await page.locator('#prosecutor').getAttribute('data-chat'), 'speaking');
    await page.locator('[data-verdict="shrink"]').click();
    assert.equal(await page.locator('#small-step').isVisible(), true, 'Controls never wait for the conversation');
    assert.equal(await page.locator('[data-chat]').count(), 0);
    await page.locator('#cancel-shrink').click(); await page.locator('#back').click();
    await page.locator('[data-plea="unclear"]').click(); await page.locator('#sound').click();
    const mutedVoices = await page.evaluate(() => audioProbe.voices);
    await page.waitForTimeout(3600);
    assert.equal(await page.evaluate(() => audioProbe.voices), mutedVoices, 'Muting cancels all queued replies');
    assert.equal(await page.locator('[data-chat]').count(), 0);
    await page.locator('[data-plea="boring"]').click();
    assert.equal(await page.locator('#prosecutor').getAttribute('data-chat'), 'speaking', 'Muted cats still have visual dialogue');
    await page.locator('#pet-judge').click();
    assert.equal(await page.locator('[data-chat]').count(), 0, 'Scritches interrupt the argument');
    await page.locator('[data-plea="big"]').click(); await openPicker();
    assert.equal(await page.locator('[data-chat]').count(), 0, 'Opening the picker stops the old case conversation');
    await page.keyboard.press('Escape');
    await page.locator('[data-plea="unclear"]').click();
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await page.locator('[data-chat]').count(), 0, 'Hidden views stop the conversation');
    await reset();
    const clips = await page.evaluate(async () => {
      const clips = [];
      for (const kind of ['judge', 'prosecutor', 'gavel', 'sneeze']) {
        const context = new OfflineAudioContext(1, 96000, 48000);
        audioContext = new Proxy(context, { get(target, key) {
          if (key === 'state') return 'running';
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        } });
        soundEnabled = true; soundOutput = context.createGain(); soundOutput.connect(context.destination);
        if (kind === 'gavel') gavel(); else if (kind === 'sneeze') sneeze(); else catSound(kind, true);
        const samples = Array.from((await context.startRendering()).getChannelData(0));
        clips.push({ kind, samples });
      }
      return clips;
    });
    for (const { kind, samples } of clips) {
      const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
      const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
      assert.ok(peak > .01 && peak < .25, `${kind}: audible, bounded waveform (${peak})`);
      assert.ok(rms > (kind === 'sneeze' ? .0002 : .001), `${kind}: non-silent output`);
      assert.ok(samples.slice(-4800).every(value => Math.abs(value) < .00001), `${kind}: clean silent ending`);
      console.log(`Audio ${kind}: peak ${peak.toFixed(3)}, RMS ${rms.toFixed(4)}`);
    }
    assert.notDeepEqual(clips[0].samples, clips[1].samples, 'Each cat has its own voice');
    const samples = clips.flatMap(clip => clip.samples), wav = Buffer.alloc(44 + samples.length * 2);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(samples.length * 2, 40);
    samples.forEach((value, index) => wav.writeInt16LE(Math.round(value * 32767), 44 + index * 2));
    await fs.writeFile(path.join(os.tmpdir(), 'procrastination-court-sounds.wav'), wav);
    await reset();
    await page.screenshot({ path: path.join(os.tmpdir(), 'procrastination-court-welcome.png') });
    assert.equal(await page.locator('#picker').isVisible(), false);
    await openPicker();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'search');
    await page.locator('#search').fill('PERSONAL love');
    assert.deepEqual(await page.locator('.case-item strong').allTextContents(), ['Give my personal website some love']);
    await page.locator('#search').fill('no match');
    assert.match(await page.locator('#empty').textContent(), /No matching/);
    await page.locator('#search').fill('');

    // Native buttons are keyboard operable; no task changes before an explicit verdict.
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.taskId), 'a');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#pleading').isVisible(), true);
    assert.equal(await page.locator('#picker').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'case-title');
    assert.equal(await page.locator('#hear-verdict').isDisabled(), true);
    await page.locator('[data-plea="big"]').focus();
    await page.keyboard.press('Space');
    assert.match(await page.locator('#observation').textContent(), /mountain/);
    assert.match(await page.locator('#prosecution').textContent(), /trench coat/);
    // Browsing and cancelling the picker leaves the hearing intact and restores focus.
    await openPicker();
    await page.locator('#search').fill('website');
    await page.keyboard.press('Escape');
    await page.locator('#picker').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => document.activeElement.id), 'change-case');
    assert.equal(await page.locator('[data-plea="big"]').getAttribute('aria-pressed'), 'true');
    await openPicker();
    await page.mouse.click(4, 4);
    await page.locator('#picker').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('[data-plea="big"]').getAttribute('aria-pressed'), 'true');
    // Both cats can be petted by keyboard without losing the defense or changing tasks.
    for (const id of ['prosecutor', 'judge']) {
      await page.locator('#pet-' + id).focus();
      await page.keyboard.press('Enter');
      assert.match(await page.locator('#cat-caption').textContent(), /Purrmission|Scritches accepted/);
      assert.equal(await page.locator('[data-plea="big"]').getAttribute('aria-pressed'), 'true');
      assert.deepEqual(await page.evaluate(() => [fixture.adds, fixture.actions, fixture.saves]), [[], [], []]);
    }
    await page.locator('#motion').click();
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
    await page.locator('#motion').click();
    await page.screenshot({ path: path.join(os.tmpdir(), 'procrastination-court-hearing.png') });
    await page.locator('#hear-verdict').click();
    assert.equal(await page.locator('.verdict.recommended').getAttribute('data-verdict'), 'shrink');
    assert.deepEqual(await page.evaluate(() => [fixture.adds, fixture.actions, fixture.saves]), [[], [], []]);
    await page.locator('#back').click();
    assert.equal(await page.locator('[data-plea="big"]').getAttribute('aria-pressed'), 'true');
    await rule('boring');
    await page.locator('[data-verdict="start"]').click();
    await page.locator('#outcome').waitFor();
    assert.deepEqual(await page.evaluate(() => fixture.actions), [{ type: '[Task] SetCurrentTask', id: 'a' }]);
    await page.locator('#hearing.cozy').waitFor();
    assert.equal(await page.locator('#judge').getAttribute('data-pose'), 'sleep');
    assert.equal(await page.locator('#prosecutor').getAttribute('data-pose'), 'sleep');
    assert.equal(await page.locator('#outcome-title').textContent(), 'Court is quietly rooting for you.');
    assert.equal(await page.locator('.stamp svg').count(), 1);
    await page.screenshot({ path: path.join(os.tmpdir(), 'procrastination-court-cozy.png') });
    await page.locator('#pet-prosecutor').click();
    await page.waitForFunction(() => document.querySelector('#prosecutor').dataset.pose === 'sleep');
    await openPicker(); await page.keyboard.press('Escape');
    assert.equal(await page.locator('#hearing').getAttribute('class'), 'cozy');


    // A parent starts its next unfinished child, never a completed child.
    await pick('b');
    assert.equal(await page.locator('#hearing.cozy').count(), 0);
    await rule('boring');
    assert.match(await page.locator('#start-description').textContent(), /Sketch the home page/);
    await page.locator('[data-verdict="start"]').click();
    assert.equal(await page.evaluate(() => fixture.actions.at(-1).id), 'next');
    await page.evaluate(() => { fixture.tasks.find(t => t.id === 'next').isDone = true; });
    await refresh(); await pick('b'); await rule();
    assert.equal(await page.locator('[data-verdict="start"]').isDisabled(), true);

    // Adding a step preserves its literal title, parent, existing children and notes.
    await reset();
    await page.evaluate(() => { fixture.tasks[0].notes = 'Keep this note'; fixture.holdAdd = true; });
    await pick('a'); await rule();
    await page.locator('[data-verdict="shrink"]').click();
    await page.locator('#small-step').fill('   ');
    await page.locator('#shrink-form button[type="submit"]').click();
    assert.equal(await page.evaluate(() => fixture.adds.length), 0);
    const literalTitle = '<img src=x onerror=alert(1)> #tax @tomorrow 2h';
    await page.locator('#small-step').fill(literalTitle);
    await openPicker();
    await page.locator('#close-picker').click();
    assert.equal(await page.locator('#small-step').inputValue(), literalTitle, 'Cancelling a case change preserves the draft');
    await page.locator('#shrink-form button[type="submit"]').click();
    await page.waitForFunction(() => fixture.releaseAdd);
    assert.equal(await page.locator('#workspace').evaluate(el => el.disabled), true);
    await page.evaluate(() => {
      document.querySelector('#shrink-form').dispatchEvent(new Event('submit', { cancelable: true }));
      fixture.releaseAdd();
    });
    await page.locator('#outcome').waitFor();
    assert.deepEqual(await page.evaluate(() => fixture.adds), [{ title: literalTitle, parentId: 'a', timeEstimate: 300000, isIgnoreShortSyntax: true }]);
    assert.equal(await page.evaluate(() => fixture.tasks[0].notes), 'Keep this note');
    assert.equal(await page.locator('#step-title').textContent(), literalTitle);
    assert.equal(await page.locator('img').count(), 0);
    await page.evaluate(() => { fixture.failStart = true; });
    await page.locator('#start-step').click();
    await page.locator('#notice').getByText('Your small step was saved', { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => fixture.adds.length), 1, 'A failed timer must not re-add the step');
    await page.evaluate(() => { fixture.failStart = false; });
    await page.locator('#start-step').click();
    assert.equal(await page.locator('#start-step').isDisabled(), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'outcome-title');
    assert.equal(await page.evaluate(() => fixture.actions.at(-1).id), 'created-0');
    await pick('c');
    await page.waitForTimeout(1900);
    assert.equal(await page.locator('#hearing.cozy').count(), 0, 'A previous verdict cannot turn a new hearing into a nap');
    assert.equal(await page.locator('#judge').getAttribute('data-pose'), 'welcome');


    // Dismissal is reversible plugin state, with no mutations to any host task.
    await reset(); await pick('a'); await rule('irrelevant');
    const originalTasks = await page.evaluate(() => fixture.tasks);
    await page.evaluate(() => { fixture.saved = JSON.stringify({ version: 1, dismissed: ['b'] }); });
    await page.locator('[data-verdict="dismiss"]').click();
    await page.locator('#outcome').waitFor();
    assert.deepEqual(await page.evaluate(() => JSON.parse(fixture.saved).dismissed), ['b', 'a'], 'Preserve already-synced dismissals');
    assert.deepEqual(await page.evaluate(() => fixture.tasks), originalTasks);
    await refresh();
    assert.equal(await page.locator('.case-item').count(), 1);
    // Opening the picker always starts on Open and never silently selects or reopens a task.
    await openPicker();
    await page.locator('#dismissed-filter').click();
    await page.keyboard.press('Escape');
    await openPicker();
    assert.equal(await page.locator('#open-filter').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#outcome').isVisible(), true, 'Refreshing keeps the current ruling');
    await pick('c');
    assert.equal(await page.locator('#case-title').textContent(), 'Make that dentist appointment');
    assert.deepEqual(await page.evaluate(() => JSON.parse(fixture.saved).dismissed), ['b', 'a']);
    await openPicker(); await page.locator('#dismissed-filter').click();
    assert.equal(await page.locator('.case-item').count(), 2);
    await page.evaluate(() => { fixture.failSave = true; });
    await pick('a');
    await page.locator('#picker-status').getByText('The court couldn’t save this docket change.', { exact: false }).waitFor();
    assert.equal(await page.locator('#picker').isVisible(), true, 'Reopen failures stay visible in the modal');
    assert.deepEqual(await page.evaluate(() => JSON.parse(fixture.saved).dismissed), ['b', 'a']);
    await page.evaluate(() => { fixture.failSave = false; });
    await pick('a');
    await page.locator('#hearing').waitFor();
    assert.deepEqual(await page.evaluate(() => JSON.parse(fixture.saved).dismissed), ['b']);
    assert.equal(await page.locator('#open-filter').getAttribute('aria-pressed'), 'true');

    // Failed writes do not pretend to succeed or discard the user's form input.
    await rule('irrelevant');
    await page.evaluate(() => { fixture.failSave = true; });
    await page.locator('[data-verdict="dismiss"]').click();
    await page.locator('#notice').getByText('The court couldn’t save this docket change.', { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.dataset.verdict), 'dismiss', 'Keyboard focus survives a failed action');
    assert.equal(await page.locator('#outcome').isVisible(), false);
    assert.deepEqual(await page.evaluate(() => JSON.parse(fixture.saved).dismissed), ['b']);
    await page.locator('[data-verdict="shrink"]').click();
    await page.locator('#small-step').fill('Find one document');
    await page.evaluate(() => { fixture.failAdd = true; });
    await page.locator('#shrink-form button[type="submit"]').click();
    await page.locator('#notice').getByText('The new step could not be confirmed', { exact: false }).waitFor();
    assert.equal(await page.locator('#small-step').inputValue(), 'Find one document');
    assert.deepEqual(await page.evaluate(() => fixture.adds), []);
    // Leave the dedicated step screen before amending the defense.
    await page.locator('#cancel-shrink').click(); await page.locator('#back').click(); await rule('boring');
    assert.equal(await page.locator('#shrink-form').isVisible(), false);

    // A task completed, deleted or reparented during a hearing cannot be acted on.
    for (const change of ['complete', 'delete', 'reparent']) {
      await reset(); await pick('a'); await rule();
      await page.evaluate(change => {
        if (change === 'complete') fixture.tasks[0].isDone = true;
        if (change === 'delete') fixture.tasks.shift();
        if (change === 'reparent') fixture.tasks[0].parentId = 'b';
      }, change);
      await page.locator('[data-verdict="start"]').click();
      await page.locator('#notice').getByText('This task was completed', { exact: false }).waitFor();
      assert.deepEqual(await page.evaluate(() => fixture.actions), []);
    }

    // Reads fail closed; corrupt synced state is never overwritten.
    await reset();
    for (const raw of ['not json', '{"version":99,"dismissed":[]}', '{"version":1,"dismissed":[42]}']) {
      await page.evaluate(raw => { fixture.saved = raw; }, raw);
      await page.evaluate(() => initialize());
      await page.locator('#notice').getByText('It has not been overwritten.', { exact: false }).waitFor();
      assert.equal(await page.locator('#workspace').evaluate(el => el.disabled), true);
      assert.deepEqual(await page.evaluate(() => fixture.saves), []);
    }
    // Corrupt data found during a dismissal gets the same friendly, non-destructive message.
    await page.evaluate(() => { fixture.saved = null; }); await refresh(); await pick('a'); await rule('irrelevant');
    await page.evaluate(() => { fixture.saved = 'not json'; });
    await page.locator('[data-verdict="dismiss"]').click();
    await page.locator('#notice').getByText('It has not been overwritten.', { exact: false }).waitFor();
    assert.deepEqual(await page.evaluate(() => fixture.saves), []);
    await page.evaluate(() => { fixture.saved = null; fixture.failTasks = true; });
    await page.evaluate(() => initialize());
    await page.locator('#notice').getByText('Task read failed').waitFor();
    assert.equal(await page.locator('#workspace').evaluate(el => el.disabled), true);
    await reset();
    await page.evaluate(() => { fixture.tasks = []; });
    await refresh();
    assert.match(await page.locator('#empty').textContent(), /No unfinished main tasks/);
    assert.equal(await page.locator('#welcome-title').textContent(), 'Nothing before the court.');
    assert.equal(await page.locator('#judge').getAttribute('data-pose'), 'sleep');
    await page.screenshot({ path: path.join(os.tmpdir(), 'procrastination-court-empty.png') });
    await reset();
    await page.evaluate(() => { fixture.saved = JSON.stringify({ version: 1, dismissed: ['a','b','c'] }); });
    await refresh();
    assert.equal(await page.locator('#prosecutor').getAttribute('data-pose'), 'sleep');
    await openPicker(); await page.locator('#dismissed-filter').click(); await page.locator('[data-task-id="a"]').click();
    assert.equal(await page.locator('#judge').getAttribute('data-pose'), 'welcome');

    // A case dismissed on another device before the docket refreshes receives no ruling.
    // Each change and click happens in one step so no background refresh can slip in between.
    const dismissElsewhereAndClick = selector => page.evaluate(selector => {
      fixture.saved = JSON.stringify({ version: 1, dismissed: ['c'] }); document.querySelector(selector).click();
    }, selector);
    // The refusal is followed by the docket's steady "no longer open" notice, which is what we wait for.
    const refusedAsDismissed = async () => {
      await page.locator('#notice').getByText('no longer open', { exact: false }).waitFor();
      assert.equal(await page.locator('#outcome').isVisible(), false);
      assert.deepEqual(await page.evaluate(() => [fixture.actions, fixture.adds]), [[], []], 'No task write for a case dismissed elsewhere');
    };
    await reset(); await pick('c'); await rule('big');
    await dismissElsewhereAndClick('[data-verdict="start"]');
    await refusedAsDismissed();
    await reset(); await pick('c'); await rule('big');
    await page.locator('[data-verdict="shrink"]').click();
    await page.locator('#small-step').fill('Look up the number');
    await dismissElsewhereAndClick('#shrink-form button[type="submit"]');
    await refusedAsDismissed();
    assert.equal(await page.locator('#small-step').inputValue(), 'Look up the number', 'The draft is kept');
    // A new small step cannot be started once its case was dismissed elsewhere.
    await reset(); await pick('c'); await rule('big');
    await page.locator('[data-verdict="shrink"]').click();
    await page.locator('#small-step').fill('Look up the number');
    await page.locator('#shrink-form button[type="submit"]').click();
    await page.locator('#start-step').waitFor();
    await dismissElsewhereAndClick('#start-step');
    await page.waitForFunction(() => !busy && document.querySelector('#notice').textContent.includes('dismissed in the meantime'));
    assert.deepEqual(await page.evaluate(() => fixture.actions), [], 'No timer start for a dismissed case');
    // Dismissing a case that was already dismissed elsewhere simply succeeds.
    await reset(); await pick('c'); await rule('irrelevant');
    await dismissElsewhereAndClick('[data-verdict="dismiss"]');
    await page.locator('#outcome').waitFor();
    assert.deepEqual(await page.evaluate(() => JSON.parse(fixture.saved).dismissed), ['c']);
    // Reopening a case whose task finished elsewhere explains why and leaves the docket unchanged.
    await reset();
    await page.evaluate(() => { fixture.saved = JSON.stringify({ version: 1, dismissed: ['c'] }); });
    await refresh(); await openPicker(); await page.locator('#dismissed-filter').click();
    await page.locator('[data-task-id="c"]').waitFor();
    await page.evaluate(() => { fixture.tasks.find(task => task.id === 'c').isDone = true; document.querySelector('[data-task-id="c"]').click(); });
    await page.locator('#picker-status').getByText('can’t be reopened', { exact: false }).waitFor();
    assert.deepEqual(await page.evaluate(() => JSON.parse(fixture.saved).dismissed), ['c'], 'A failed reopen keeps the docket');
    await page.keyboard.press('Escape');


    // Long and untrusted titles remain text. Check each stage across narrow and wide views.
    await reset();
    await page.evaluate(() => { fixture.tasks[0].title = '<svg onload=alert(1)> ' + 'UnbrokenTaskTitle'.repeat(15); });
    await refresh(); await pick('a');
    assert.match(await page.locator('#case-title').textContent(), /^<svg onload=/);
    assert.equal(await page.locator('#case-title svg').count(), 0);
    for (const width of [280, 320, 390, 650, 768, 950, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await openPicker();
      const pickerRect = await page.locator('#picker').boundingBox();
      assert.ok(pickerRect.x >= 0 && pickerRect.x + pickerRect.width <= width && pickerRect.y >= 0 && pickerRect.y + pickerRect.height <= 900, 'Picker fits the iframe');
      await pick('a');
      for (const stage of ['plea', 'ruling', 'shrink']) {
        if (stage === 'ruling') await rule();
        if (stage === 'shrink') await page.locator('[data-verdict="shrink"]').click();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert.equal(overflow, false, `No horizontal overflow at ${width}px, ${stage}`);
      }
    }
    await page.setViewportSize({ width: 844, height: 390 });
    await openPicker();
    const close = await page.locator('#close-picker').boundingBox();
    assert.ok(close.y >= 0 && close.y + close.height <= 390, 'Close control stays reachable in a short container');
    await page.screenshot({ path: path.join(os.tmpdir(), 'procrastination-court-picker.png') });
    await page.keyboard.press('Escape');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.blink').evaluate(el => getComputedStyle(el).animationName), 'none');

    // Standalone demo works without a bridge or any external requests and resets on reload.
    const demo = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const requests = [];
    demo.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    demo.on('pageerror', error => errors.push(error.message));
    await demo.goto(url);
    await demo.locator('#demo').waitFor();
    await demo.locator('#call-case').click();
    await demo.locator('.case-item').first().click();
    await demo.locator('[data-plea="big"]').click();
    await demo.locator('#hear-verdict').click();
    await demo.locator('[data-verdict="shrink"]').click();
    await demo.locator('#small-step').fill('Find the tax folder');
    await demo.locator('#shrink-form button[type="submit"]').click();
    await demo.locator('#outcome').waitFor();
    await demo.screenshot({ path: path.join(os.tmpdir(), 'procrastination-court-mobile.png'), fullPage: true, animations: 'disabled' });
    await demo.locator('#start-step').click();
    assert.match(await demo.locator('#outcome-copy').textContent(), /No real tasks/);
    await demo.locator('#hearing.cozy').waitFor();
    await demo.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await demo.evaluate(() => document.getAnimations().length), 0);
    await demo.screenshot({ path: path.join(os.tmpdir(), 'procrastination-court-mobile-cozy.png'), fullPage: true });
    await demo.reload();
    assert.equal(await demo.locator('.case-item').count(), 5);
    assert.deepEqual(requests, []);
    // Each scene exposes one decision; moving back keeps the chosen defense and draft.
    await page.setViewportSize({ width: 960, height: 900 });
    await reset(); await pick('a');
    assert.equal(await page.locator('#hearing').getAttribute('data-stage'), 'defense');
    await rule('big');
    assert.equal(await page.locator('#pleading').isVisible(), false);
    await page.locator('[data-verdict="shrink"]').click();
    assert.equal(await page.locator('#ruling').isVisible(), false, 'Ruling actions leave the drafting screen');
    assert.equal(await page.locator('#small-step').evaluate(el => el === document.activeElement), true);
    await page.locator('#small-step').fill('Find one receipt');
    await page.screenshot({ path: path.join(os.tmpdir(), 'procrastination-court-step-scene.png'), fullPage: true });
    await page.locator('#cancel-shrink').click();
    assert.equal(await page.locator('[data-verdict="shrink"]').evaluate(el => el === document.activeElement), true);
    await page.locator('#back').click();
    assert.equal(await page.locator('[data-plea="big"]').getAttribute('aria-pressed'), 'true');
    await page.locator('#hear-verdict').click();
    await page.screenshot({ path: path.join(os.tmpdir(), 'procrastination-court-ruling-scene.png'), fullPage: true });
    await page.locator('[data-verdict="shrink"]').click();
    assert.equal(await page.locator('#small-step').inputValue(), 'Find one receipt');
    assert.deepEqual(await page.evaluate(() => [fixture.adds, fixture.actions, fixture.saves]), [[], [], []]);
    await page.locator('#shrink-form button[type="submit"]').click();
    assert.equal(await page.locator('#shrink-form').isVisible(), false);
    assert.equal(await page.locator('#case-title').isVisible(), true);
    await page.locator('#start-step').click(); await page.locator('#hearing.cozy').waitFor();
    assert.equal(await page.locator('#case-title').isVisible(), true, 'The task remains visible when the court rests');
    // Live updates keep the hearing, draft, and keyboard position instead of resetting the court.
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await reset();
    assert.equal(await page.locator('#refresh').count(), 0);
    assert.equal(await page.getByRole('heading', { name: 'Procrastination Cat Court', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Cat sounds', exact: true }).count(), 1);
    assert.equal(await page.locator('#sound svg').isVisible(), true);
    assert.equal(await page.locator('#motion svg').isVisible(), true);
    await pick('a');
    assert.equal(await page.getByRole('heading', { name: 'Finally sort out my tax return', level: 1 }).count(), 1);
    assert.match(await page.locator('#hearing-phase').textContent(), /Make your case/);
    assert.equal(await page.locator('.steps, .case-guide, .signature, .court-whisper').count(), 0);
    await rule('big'); await page.locator('[data-verdict="shrink"]').click();
    await page.locator('#small-step').fill('Keep this unfinished draft');
    await page.evaluate(() => {
      fixture.tasks[0].title = 'A smaller, renamed tax task';
      fixture.tasks.push({ id: 'new', title: 'A newly added case', isDone: false });
      fixture.hooks.dataChanged();
    });
    await page.waitForFunction(() => document.querySelector('#case-title').textContent === 'A smaller, renamed tax task');
    assert.equal(await page.locator('#small-step').inputValue(), 'Keep this unfinished draft');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'small-step');
    assert.equal(await page.locator('[data-plea="big"]').getAttribute('aria-pressed'), 'true');
    await openPicker();
    await page.locator('[data-task-id="b"]').focus();
    await page.evaluate(() => { window.focusedRow = document.activeElement; fixture.tasks[0].timeSpent = 1000; fixture.hooks.dataChanged(); });
    await refresh();
    assert.equal(await page.evaluate(() => document.activeElement === focusedRow && focusedRow.isConnected), true, 'Timer ticks do not rebuild the list');
    await page.evaluate(() => { fixture.tasks.push({ id: 'newer', title: 'Another new case', isDone: false }); fixture.hooks.dataChanged(); });
    await page.locator('[data-task-id="newer"]').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.dataset.taskId), 'b');
    await page.keyboard.press('Escape');
    await page.locator('#small-step').focus();
    await page.evaluate(() => { fixture.tasks[0].isDone = true; fixture.hooks.dataChanged(); });
    await page.waitForFunction(() => document.querySelector('#case-controls').disabled);
    assert.equal(await page.locator('#small-step').inputValue(), 'Keep this unfinished draft');
    assert.equal(await page.locator('#change-case').isEnabled(), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'change-case', 'A disabled draft hands keyboard focus to case selection');
    assert.deepEqual(await page.evaluate(() => [fixture.adds, fixture.actions, fixture.saves]), [[], [], []]);
    await page.evaluate(() => { fixture.tasks[0].isDone = false; fixture.hooks.dataChanged(); });
    await page.waitForFunction(() => !document.querySelector('#case-controls').disabled);
    await page.evaluate(() => { fixture.saved = JSON.stringify({ version: 1, dismissed: ['a'] }); fixture.hooks.persistedDataChanged(); });
    await page.waitForFunction(() => document.querySelector('#case-controls').disabled);
    await page.evaluate(() => { fixture.saved = null; fixture.hooks.persistedDataChanged(); });
    await page.waitForFunction(() => !document.querySelector('#case-controls').disabled);
    await page.evaluate(() => { fixture.failTasks = true; fixture.hooks.dataChanged(); });
    await page.locator('#notice').getByText('The court will retry automatically.', { exact: false }).waitFor();
    assert.equal(await page.locator('#small-step').inputValue(), 'Keep this unfinished draft');
    assert.equal(await page.locator('#workspace').evaluate(el => el.disabled), false);
    await page.evaluate(() => { fixture.failTasks = false; });
    await page.waitForFunction(() => !document.querySelector('#notice').textContent, null, { timeout: 6000 });
    // A running timer makes the host fire dataChanged every second; those bursts must not re-read every time.
    const burstReads = await page.evaluate(async () => {
      const before = fixture.reads;
      for (let tick = 0; tick < 10; tick++) {
        fixture.tasks[0].timeSpent = 2000 + tick; fixture.hooks.dataChanged();
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      return fixture.reads - before;
    });
    assert.ok(burstReads >= 1 && burstReads <= 2, `A burst of 10 hooks over 1.5 s reads once or twice (read ${burstReads} times)`);
    await page.evaluate(() => { fixture.tasks[0].title = 'Renamed after a burst'; fixture.hooks.dataChanged(); });
    await page.waitForFunction(() => document.querySelector('#case-title').textContent === 'Renamed after a burst', null, { timeout: 5000 });
    // A read started before a write cannot replace that write's newer result.
    await page.evaluate(() => { fixture.holdRead = true; fixture.hooks.dataChanged(); });
    await page.waitForFunction(() => fixture.releaseRead);
    await page.evaluate(() => { fixture.holdRead = false; fixture.holdAdd = true; });
    await page.locator('#shrink-form button[type="submit"]').click();
    await page.waitForFunction(() => fixture.releaseAdd);
    assert.equal(await page.locator('#change-case').isDisabled(), true, 'Navigation is locked during a task write');
    assert.equal(await page.locator('#sound').isEnabled(), true, 'Mute remains available while a task action is pending');
    assert.equal(await page.locator('#motion').isEnabled(), true);
    await page.evaluate(() => { fixture.releaseAdd(); });
    await page.locator('#outcome').waitFor();
    await page.evaluate(() => { fixture.releaseRead(); });
    await page.waitForFunction(() => !syncing && tasks.some(task => task.id === 'created-0'));
    assert.equal(await page.locator('#step-title').textContent(), 'Keep this unfinished draft');
    assert.equal(await page.evaluate(() => fixture.adds.length), 1);
    // The curtain entrance and defense are one screen, with no extra navigation gate.
    await reset(); await pick('a');
    assert.equal(await page.locator('#court-intro, #begin-hearing, #skip-intro').count(), 0);
    assert.equal(await page.locator('#pleading').isVisible(), true);
    assert.equal(await page.locator('#case-title').textContent(), 'Finally sort out my tax return');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'case-title');
    assert.equal(await page.locator('[data-plea="big"]').isEnabled(), true);
    assert.equal(await page.locator('#hearing-stage').evaluate(el => getComputedStyle(el, '::before').animationName), 'curtain-left');
    assert.deepEqual(await page.evaluate(() => [fixture.adds, fixture.actions, fixture.saves]), [[], [], []]);
    await page.screenshot({ path: path.join(os.tmpdir(), 'procrastination-court-curtains.png') });
    await page.locator('[data-plea="big"]').click();
    assert.equal(await page.locator('#hear-verdict').isEnabled(), true, 'Defense choices work during the entrance');
    assert.equal(await page.locator('#hearing-stage.opening').count(), 0, 'Choosing a defense clears the opening curtains');
    await page.locator('#hear-verdict').click();
    assert.equal(await page.locator('#ruling').isVisible(), true);
    await openPicker(); await page.locator('[data-task-id="c"]').click();
    await page.evaluate(() => { fixture.tasks.find(task => task.id === 'c').title = 'Call the dentist'; fixture.hooks.dataChanged(); });
    await page.waitForFunction(() => document.querySelector('#case-title').textContent === 'Call the dentist');
    await page.evaluate(() => { fixture.tasks.find(task => task.id === 'c').isDone = true; fixture.hooks.dataChanged(); });
    await page.waitForFunction(() => document.querySelector('#case-controls').disabled);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await pick('b');
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
    assert.equal(await page.locator('#hearing-stage').evaluate(el => getComputedStyle(el, '::before').animationName), 'none');
    for (const width of [280,390,844]) {
      await page.setViewportSize({ width, height: width === 844 ? 390 : 844 });
      await pick('a');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Combined scene fits ${width}px`);
      const bar = await page.locator('.court-tools').boundingBox();
      assert.ok(bar.y >= 0 && bar.y + bar.height <= (width === 844 ? 390 : 844), 'Selecting a case keeps the top bar in view');
      for (const id of ['hearing-phase', 'change-case', 'sound', 'motion']) {
        const control = await page.locator('#' + id).boundingBox();
        assert.ok(control.x >= bar.x && control.x + control.width <= bar.x + bar.width + 1, `${id} stays in the single toolbar`);
        assert.ok(control.y >= bar.y && control.y + control.height <= bar.y + bar.height + 1);
      }
      for (const id of ['prosecutor', 'judge']) {
        const bubble = await page.locator(`.speech[data-cat="${id}"]`).boundingBox();
        const cat = await page.locator('#pet-' + id).boundingBox();
        assert.ok(bubble.y + bubble.height <= cat.y, 'Written dialogue sits above its cat');
        assert.ok(Math.abs(bubble.x + bubble.width / 2 - cat.x - cat.width / 2) < 2, 'Bubble tail points to the correct cat');
      }
      await page.screenshot({ path: path.join(os.tmpdir(), `procrastination-court-merged-${width}.png`), fullPage: true, animations: 'disabled' });
      await rule('big');
      assert.match(await page.locator('.court-tools').textContent(), /Choose your ruling/);
      assert.equal(await page.locator('.speech[data-cat="judge"]').isVisible(), true);
    }
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    // Small-screen character polish stays decorative and never holds up the next action.
    const polish = await browser.newPage({ viewport: { width: 390, height: 844 } });
    polish.on('pageerror', error => errors.push(error.message));
    await polish.goto(url); await polish.locator('#workspace:not([disabled])').waitFor();
    assert.equal(await polish.locator('#return-greeting').isVisible(), false);
    await polish.reload(); await polish.locator('#workspace:not([disabled])').waitFor();
    assert.equal(await polish.locator('#return-greeting').isVisible(), true);
    for (const id of ['motion','sound','call-case']) {
      assert.ok((await polish.locator('#' + id).boundingBox()).height >= 44, `${id}: comfortable touch target`);
    }
    assert.ok(await polish.locator('#call-case').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight), 'Welcome action fits on a small screen');
    await polish.screenshot({ path: path.join(os.tmpdir(), 'procrastination-court-compact-welcome.png'), fullPage: true });
    await polish.locator('#call-case').click(); await polish.locator('.case-item').first().click();
    assert.equal(await polish.locator('#prosecutor').getAttribute('data-pose'), 'arrival');
    assert.equal(await polish.locator('#folder-title').textContent(), await polish.locator('#case-title').textContent());
    assert.equal(await polish.locator('#folder-case-number').textContent(), 'CASE 001');
    await polish.screenshot({ path: path.join(os.tmpdir(), 'procrastination-court-compact-hearing.png'), fullPage: true });
    for (const defense of ['big','unclear','boring','irrelevant','big']) {
      await polish.locator(`[data-plea="${defense}"]`).click();
      assert.notEqual(await polish.locator('#prosecutor').getAttribute('data-pose'), 'sneeze');
    }
    await polish.locator('[data-plea="unclear"]').click();
    assert.equal(await polish.locator('#prosecutor').getAttribute('data-pose'), 'sneeze');
    assert.match(await polish.locator('#cat-caption').textContent(), /Achoo/);
    await polish.locator('#hear-verdict').click();
    assert.notEqual(await polish.locator('#prosecutor').getAttribute('data-pose'), 'sneeze', 'The next action cancels the surprise');
    for (const defense of ['unclear','big','boring','irrelevant']) {
      if (defense !== 'unclear') {
        await polish.locator('#back').click();
        await polish.locator(`[data-plea="${defense}"]`).click(); await polish.locator('#hear-verdict').click();
      }
      assert.equal(await polish.locator('[data-defense-art]:not([hidden])').count(), 1);
      assert.equal(await polish.locator('[data-defense-art]:not([hidden])').getAttribute('data-defense-art'), defense);
      assert.ok((await polish.locator('#ruling-kindness').textContent()).length > 10);
      await polish.screenshot({ path: path.join(os.tmpdir(), `procrastination-court-defense-${defense}.png`), fullPage: true });
    }
    await polish.locator('[data-verdict="start"]').click(); await polish.locator('#hearing.cozy').waitFor();
    const peek = await polish.locator('#judge .nap-open').evaluate(el => {
      const animation = el.getAnimations().find(animation => animation.animationName === 'peek');
      animation.pause(); animation.currentTime = 47000 * .95;
      return getComputedStyle(el).opacity;
    });
    assert.equal(peek, '1', 'A silent check-in opens one eye');
    await polish.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await polish.locator('#judge .nap-open').evaluate(el => getComputedStyle(el).opacity), '0');
    assert.equal(await polish.evaluate(() => document.getAnimations().length), 0);
    // Reopening is still usable if the browser denies session storage.
    const privatePage = await browser.newPage();
    privatePage.on('pageerror', error => errors.push(error.message));
    await privatePage.addInitScript(() => Object.defineProperty(window, 'sessionStorage', { get() { throw Error('Storage blocked'); } }));
    await privatePage.goto(url); await privatePage.locator('#workspace:not([disabled])').waitFor();
    assert.equal(await privatePage.locator('#return-greeting').isVisible(), false);
    await privatePage.locator('#call-case').click(); assert.equal(await privatePage.locator('.case-item').count(), 5);
    assert.deepEqual(errors, []);
    console.log('PASS: courtroom verdicts, task safety, persistence, errors, keyboard, responsive layouts, reduced motion, and standalone demo.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
