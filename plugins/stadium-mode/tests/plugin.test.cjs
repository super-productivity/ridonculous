// Runs plugin.js the way Super Productivity does (new Function with PluginAPI in scope)
// against fake audio and speech, then fires hooks and checks what the stadium does.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const code = fs.readFileSync(path.join(__dirname, '../plugin.js'), 'utf8');

// Any audio node: every property is another node, every call returns one. Started nodes are counted and kept;
// stop() fires onended like a browser does.
const audioNode = (log) => {
  const own = {};
  return new Proxy(function () {}, {
    get: (_, key, node) => {
      if (key in own) return own[key];
      if (key === 'start') return () => { log.started++; log.sources.push(node); };
      if (key === 'stop') return () => own.onended?.();
      if (key === 'getChannelData') return () => new Float32Array(8);
      if (key === 'then') return undefined; // not a promise, so awaiting a buffer resolves
      return typeof key === 'symbol' ? undefined : audioNode(log);
    },
    set: (_, key, value) => { own[key] = value; return true; },
    apply: () => audioNode(log),
  });
};

// Just enough DOM for the big screen: elements with children, text and remove().
const fakeElement = (tag) => ({
  tag, className: '', textContent: '', style: {}, children: [], parent: null,
  append(...nodes) { for (const n of nodes) { n.parent = this; this.children.push(n); } },
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; },
});

const load = (storage = new Map(), voices = [{ name: 'Commentator' }], dialogAnswer = undefined) => {
  // spoken: main lines; echoes: the quieter repeats of an announcer's last word.
  const log = { spoken: [], echoes: [], utterances: [], started: 0, sources: [], cancels: 0, closed: false, snacks: [], workers: [], dialogs: [] };
  const hooks = {};
  const buttons = [];
  let unload;
  class FakeAudioContext {
    constructor() { this.sampleRate = 8000; this.currentTime = 0; this.state = 'suspended'; this.destination = audioNode(log); }
    resume() { this.state = 'running'; }
    close() { log.closed = true; }
  }
  const audioFactories = ['createGain', 'createBiquadFilter', 'createBuffer', 'createBufferSource', 'createOscillator',
    'createWaveShaper', 'createDynamicsCompressor', 'createDelay', 'createConvolver'];
  for (const name of audioFactories) {
    FakeAudioContext.prototype[name] = () => audioNode(log);
  }
  globalThis.window = {
    AudioContext: FakeAudioContext,
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    speechSynthesis: {
      speak: (u) => {
        log.utterances.push(u);
        (u.volume === undefined ? log.spoken : log.echoes).push(u.text);
      },
      cancel: () => { log.cancels++; },
      getVoices: () => voices,
    },
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    // The neural voice worker: tests read what it was asked to say and answer for it.
    Worker: class {
      constructor(url, options) { Object.assign(this, { url, options, sent: [], terminated: false }); log.workers.push(this); }
      postMessage(message) { this.sent.push(message); }
      terminate() { this.terminated = true; }
    },
    Blob: class { constructor(parts) { this.code = parts.join(''); } },
    URL: { createObjectURL: (blob) => blob },
    document: { createElement: fakeElement, body: fakeElement('body') },
  };
  const api = {
    registerHook: (name, fn) => { hooks[name] = fn; },
    registerHeaderButton: (cfg) => buttons.push(cfg),
    showSnack: (snack) => log.snacks.push(snack.msg),
    onUnload: (fn) => { unload = fn; },
    openDialog: async (cfg) => { log.dialogs.push(cfg); return dialogAnswer; },
  };
  new Function('plugin', 'PluginAPI', code)(api, api);
  const lastUtterance = () => log.utterances.filter((u) => u.volume === undefined).at(-1);
  // Simulates the speech engine finishing the latest main line.
  const finishSpeaking = () => lastUtterance().onend?.();
  const body = window.document.body;
  // The scene on the big screen, as its type and the text of its parts, or null.
  const screen = () => {
    const scene = body.children[0]?.children.find((c) => c.className.startsWith('stm-scene'));
    return scene ? { type: scene.className.split('stm-').at(-1), text: scene.children.map((c) => c.textContent).filter(Boolean) } : null;
  };
  return { log, hooks, buttons, storage, body, screen, unload: () => unload(), last: () => log.spoken.at(-1), lastUtterance, finishSpeaking };
};

const task = (overrides = {}) => ({ id: 't1', title: 'Write the quarterly report', isDone: false, timeEstimate: 0, timeSpent: 0, ...overrides });

const withClock = (t) => t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });

test('completing a task scores a goal with crowd noise and the task title', () => {
  const s = load();
  s.hooks.taskComplete({ taskId: 't1', task: task({ isDone: true }) });
  assert.match(s.last(), /Write the quarterly report/);
  assert.match(s.last(), /GOAL|net|finish/i);
  assert.ok(s.log.started > 0, 'crowd audio started');
});

test('quick completions build a combo that resets after the window', (t) => {
  withClock(t);
  const s = load();
  s.hooks.taskComplete({ task: task({ id: 'a' }) });
  s.hooks.taskComplete({ task: task({ id: 'b' }) });
  assert.match(s.last(), /double/i);
  s.hooks.taskComplete({ task: task({ id: 'c' }) });
  assert.match(s.last(), /HAT TRICK/);
  s.hooks.taskComplete({ task: task({ id: 'd' }) });
  assert.match(s.last(), /4 in a row/);
  t.mock.timers.tick(91_000);
  s.hooks.taskComplete({ task: task({ id: 'e' }) });
  assert.doesNotMatch(s.last(), /double|HAT TRICK|in a row/i);
});

test('the commentator notices pace against the estimate', () => {
  const s = load();
  s.hooks.taskComplete({ task: task({ timeEstimate: 3600000, timeSpent: 1200000 }) });
  assert.match(s.last(), /ahead of schedule/);
  s.hooks.taskComplete({ task: task({ timeEstimate: 600000, timeSpent: 1800000 }) });
  assert.match(s.last(), /extra time/);
});

test('starting, switching and pausing tasks get kickoff, substitution and half time', (t) => {
  withClock(t);
  const s = load();
  const a = task({ id: 'a', title: 'Alpha' });
  const b = task({ id: 'b', title: 'Bravo' });
  s.hooks.currentTaskChange({ current: a, previous: null });
  assert.equal(s.log.spoken.length, 0, 'waits for a possible completion first');
  t.mock.timers.tick(300);
  assert.match(s.last(), /Alpha/);
  s.hooks.currentTaskChange({ current: b, previous: a });
  t.mock.timers.tick(300);
  assert.match(s.last(), /Substitution.*Coming off\.\.\. Alpha!\.\.\. Coming on\.\.\. Bravo/);
  s.hooks.currentTaskChange({ current: null, previous: b });
  t.mock.timers.tick(300);
  assert.match(s.last(), /break|half time/);
});

test('finishing the running task is a goal, not half time or a substitution', (t) => {
  withClock(t);
  const s = load();
  const a = task({ id: 'a', title: 'Alpha' });
  // The host may report the stop before or after the completion, with a stale isDone.
  s.hooks.currentTaskChange({ current: null, previous: a });
  s.hooks.taskComplete({ task: { ...a, isDone: true } });
  t.mock.timers.tick(300);
  assert.equal(s.log.spoken.length, 1);
  assert.match(s.last(), /GOAL|net|finish/i);

  // With "auto start next task" on, the kickoff queues behind the goal instead of cutting it off.
  s.hooks.taskComplete({ task: task({ id: 'b', title: 'Bravo', isDone: true }) });
  const cancelsAfterGoal = s.log.cancels;
  s.hooks.currentTaskChange({ current: task({ id: 'c', title: 'Charlie' }), previous: task({ id: 'b', title: 'Bravo' }) });
  t.mock.timers.tick(300);
  assert.match(s.last(), /Charlie/);
  assert.doesNotMatch(s.last(), /Substitution/);
  assert.equal(s.log.cancels, cancelsAfterGoal, 'goal commentary not interrupted');
});

test('task updates: undo is disallowed, date changes are postponed, project moves are transfers', () => {
  const s = load();
  s.hooks.taskUpdate({ task: task(), changes: { isDone: false } });
  assert.match(s.last(), /disallowed/);
  s.hooks.taskUpdate({ task: task(), changes: { dueDay: '2026-11-02' } });
  assert.match(s.last(), /rescheduled|another day/i);
  s.hooks.taskUpdate({ task: task(), changes: { dueWithTime: 1, dueDay: undefined } });
  assert.match(s.last(), /rescheduled|another day/i);
  s.hooks.taskUpdate({ task: task(), changes: { projectId: 'p2' } });
  assert.match(s.last(), /transfer/);
  const spoken = s.log.spoken.length;
  s.hooks.taskUpdate({ task: task(), changes: { isDone: true } });
  s.hooks.taskUpdate({ task: task(), changes: { title: 'Renamed' } });
  assert.equal(s.log.spoken.length, spoken, 'completion and plain edits stay quiet here');
});

test('deleting tasks shows red cards', () => {
  const s = load();
  s.hooks.taskDelete({ taskId: 't1' });
  assert.match(s.last(), /red/i);
  s.hooks.taskDelete({ taskIds: ['a', 'b', 'c'] });
  assert.match(s.last(), /3 tasks sent off/);
});

test('finish day announces the score and starts the next match at zero', () => {
  const s = load();
  s.hooks.taskComplete({ task: task({ id: 'a' }) });
  s.hooks.taskComplete({ task: task({ id: 'b' }) });
  s.hooks.taskUpdate({ task: task({ id: 'b' }), changes: { isDone: false } });
  s.hooks.finishDay({ date: '2026-10-30' });
  assert.match(s.last(), /full time! 1 goal today/i);
  s.hooks.finishDay({ date: '2026-10-31' });
  assert.match(s.last(), /goalless draw/);
});

test('the header button mutes everything, keeps score, and remembers the choice', async () => {
  const s = load(new Map([['ridonculous-stadium-mode-neural-voice', 'false']]), undefined, 'Mute');
  assert.equal(s.log.dialogs.length, 0, 'no welcome dialog for a returning user');
  assert.equal(s.buttons.length, 1);
  await s.buttons[0].onClick();
  assert.equal(s.storage.get('ridonculous-stadium-mode-muted'), 'true');
  assert.deepEqual(s.log.snacks, ['Stadium Mode muted']);
  const started = s.log.started;
  s.hooks.taskComplete({ task: task() });
  s.hooks.taskDelete({ taskId: 'x' });
  assert.equal(s.log.spoken.length, 0);
  assert.equal(s.log.started, started);

  const reloaded = load(s.storage, undefined, 'System voice');
  reloaded.hooks.taskComplete({ task: task() });
  assert.equal(reloaded.log.spoken.length, 0, 'still muted after reload');
  await reloaded.buttons[0].onClick();
  assert.match(reloaded.log.dialogs[0].htmlContent, /Currently: <strong>Mute/);
  assert.match(reloaded.last(), /Stadium Mode/);
  reloaded.hooks.finishDay({});
  assert.match(reloaded.last(), /1 goal today/, 'muted goals still count');
});

test('a second copy in the same page stays silent until the first one unloads', () => {
  const first = load();
  const buttons = [];
  const hooks = [];
  const api = { registerHook: (name) => hooks.push(name), registerHeaderButton: (cfg) => buttons.push(cfg), showSnack() {}, onUnload() {}, openDialog: async () => {} };
  const run = () => new Function('plugin', 'PluginAPI', code)(api, api);
  run();
  assert.deepEqual([buttons.length, hooks.length], [0, 0], 'no duplicate buttons or hooks');
  first.unload();
  run();
  assert.equal(buttons.length, 1, 'loads again after a real unload, e.g. disable and enable');
});

test('unloading stops pending commentary, speech and audio', (t) => {
  withClock(t);
  const s = load();
  s.hooks.taskComplete({ task: task() });
  s.hooks.currentTaskChange({ current: task({ id: 'b' }), previous: null });
  s.unload();
  t.mock.timers.tick(300);
  assert.equal(s.log.spoken.length, 1, 'no kickoff after unload');
  assert.ok(s.log.cancels > 1);
  assert.ok(s.log.closed);
});

test('a task that scored earlier, was undone and replayed still gets half time', (t) => {
  withClock(t);
  const s = load();
  const a = task({ id: 'a', title: 'Alpha' });
  s.hooks.taskComplete({ task: { ...a, isDone: true } });
  s.hooks.taskUpdate({ task: a, changes: { isDone: false } });
  t.mock.timers.tick(5000);
  s.hooks.currentTaskChange({ current: a, previous: null });
  t.mock.timers.tick(300);
  s.hooks.currentTaskChange({ current: null, previous: a });
  t.mock.timers.tick(300);
  assert.match(s.last(), /break|half time/);
});

test('deleting the running task is a red card, not half time', (t) => {
  withClock(t);
  const s = load();
  const a = task({ id: 'a', title: 'Alpha' });
  s.hooks.taskDelete({ taskId: 'a' });
  s.hooks.currentTaskChange({ current: null, previous: a });
  t.mock.timers.tick(300);
  assert.equal(s.log.spoken.length, 1);
  assert.match(s.last(), /red/i);
});

test('unscheduling is not a reschedule', () => {
  const s = load();
  s.hooks.taskUpdate({ task: task(), changes: { dueWithTime: undefined, reminderId: undefined } });
  assert.equal(s.log.spoken.length, 0);
});

test('planning a task for today is not a reschedule', () => {
  const s = load();
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  s.hooks.taskUpdate({ task: task(), changes: { dueDay: today, dueWithTime: undefined } });
  assert.equal(s.log.spoken.length, 0);
});

test('without any speech voice, a one-time snack explains the silent commentator', () => {
  const s = load(new Map(), []);
  s.hooks.taskComplete({ task: task() });
  s.hooks.taskComplete({ task: task() });
  assert.equal(s.log.snacks.length, 1);
  assert.match(s.log.snacks[0], /no speech voice/);
  assert.ok(s.log.started > 0, 'crowd still plays');
});

test('the announcer speaks slow and deep with a stadium echo; the commentator fast and high', (t) => {
  withClock(t);
  const s = load();
  s.hooks.currentTaskChange({ current: task({ title: 'Alpha' }), previous: null });
  t.mock.timers.tick(300);
  const announcer = s.lastUtterance();
  assert.ok(announcer.pitch < 1 && announcer.rate < 1);
  assert.deepEqual(s.log.echoes, ['Alpha', 'Alpha']);
  assert.ok(s.log.utterances.at(-1).volume < s.log.utterances.at(-2).volume, 'echo fades');

  s.hooks.taskComplete({ task: task({ isDone: true }) });
  const commentator = s.lastUtterance();
  assert.ok(commentator.pitch > 1 && commentator.rate > 1);
  assert.equal(s.log.echoes.length, 2, 'no echo for the commentator');
});

test('the crowd answers when the announcer finishes, but not for a cut-off line', (t) => {
  withClock(t);
  const s = load();
  s.hooks.finishDay({});
  const beforeEnd = s.log.started;
  s.finishSpeaking();
  assert.ok(s.log.started > beforeEnd, 'cheer after full time is called');

  s.hooks.currentTaskChange({ current: task({ title: 'Alpha' }), previous: null });
  t.mock.timers.tick(300);
  const kickoff = s.lastUtterance();
  s.hooks.taskDelete({ taskId: 'x' });
  const afterCut = s.log.started;
  kickoff.onend();
  assert.equal(s.log.started, afterCut, 'no organ for an interrupted kickoff');
});

test('without voices the outro plays right away; after unload it never plays', (t) => {
  withClock(t);
  const silent = load(new Map(), []);
  silent.hooks.finishDay({});
  assert.equal(silent.log.utterances.length, 0);
  assert.ok(silent.log.started > 0);

  const s = load();
  s.hooks.finishDay({});
  s.unload();
  const started = s.log.started;
  s.finishSpeaking();
  assert.equal(s.log.started, started);
});

const flush = () => new Promise((resolve) => setImmediate(resolve));
const NEURAL_KEY = 'ridonculous-stadium-mode-neural-voice';

test('the first run asks for a voice and only downloads Michael after that answer', async () => {
  const closed = load(new Map(), undefined, undefined);
  await flush();
  assert.equal(closed.log.dialogs.length, 1, 'welcome dialog opens by itself');
  assert.match(closed.log.dialogs[0].htmlContent, /110 MB.*cdn\.jsdelivr\.net.*huggingface\.co/s);
  assert.equal(closed.log.workers.length, 0, 'nothing downloaded without consent');
  assert.equal(load(closed.storage).log.dialogs.length, 0, 'closing it counts as an answer');

  const muted = load(new Map(), undefined, 'Mute');
  await flush();
  assert.equal(load(muted.storage).log.dialogs.length, 0, 'muting counts as an answer');

  const accepted = load(new Map(), undefined, 'Michael (neural)');
  await flush();
  assert.equal(accepted.storage.get(NEURAL_KEY), 'true');
  const [worker] = accepted.log.workers;
  assert.match(worker.url.code, /kokoro-js@1\.2\.1/);
  assert.equal(worker.options.type, 'module');

  const back = load(accepted.storage, undefined, 'System voice');
  await back.buttons[0].onClick();
  assert.equal(back.storage.get(NEURAL_KEY), 'false');
  assert.ok(back.log.workers[0].terminated, 'switching back stops the worker');
});

test('once ready, the announcer is generated phrase by phrase, played, and cached', async (t) => {
  withClock(t);
  t.mock.method(Math, 'random', () => 0); // same kickoff line both times
  const s = load(new Map([[NEURAL_KEY, 'true']]));
  const [worker] = s.log.workers;
  assert.ok(worker, 'loads from cache on startup');
  s.hooks.currentTaskChange({ current: task({ title: 'Early' }), previous: null });
  t.mock.timers.tick(300);
  assert.match(s.last(), /Early/, 'system voice while the model is still loading');
  assert.equal(worker.sent.length, 0);
  worker.onmessage({ data: { ready: true } });
  s.log.spoken.length = 0;

  s.hooks.currentTaskChange({ current: task({ title: 'Alpha' }), previous: null });
  t.mock.timers.tick(300);
  assert.equal(s.log.spoken.length, 0, 'no system voice for the announcer');
  const started = s.log.started;
  await answerAll(worker);
  const order = worker.sent.map((m) => `${m.voice}: ${m.text}`);
  const title = order.indexOf('am_michael: Alpha!');
  assert.ok(title > 1 && title < order.indexOf('bm_george: Alpha!'), `Michael announces first: ${order}`);
  assert.ok(s.log.started > started, 'phrases play over the PA');

  // A repeated intro is served from the cache instead of being generated again.
  const sentBefore = worker.sent.length;
  s.hooks.currentTaskChange({ current: task({ id: 'b', title: 'Alpha' }), previous: null });
  t.mock.timers.tick(300);
  assert.equal(worker.sent.length, sentBefore);

  const prepared = () => worker.sent.filter((m) => m.voice === 'bm_george' && m.text === 'Alpha!').length;
  assert.equal(prepared(), 1, 'George prepares the title for the goal call at kick off');

  s.hooks.taskComplete({ task: task({ title: 'Alpha', isDone: true }) });
  assert.equal(s.log.spoken.length, 0, 'George calls the goal, not the system voice');
  const goal = worker.sent.filter((m) => m.voice === 'bm_george').map((m) => m.text);
  assert.ok(goal.includes('GOAL!') && goal.includes('The crowd goes wild!'), `goal call: ${goal}`);
  assert.equal(prepared(), 1, 'the prepared title is reused');
});

test('once ready, the fixed announcer phrases are prepared one at a time', async () => {
  const s = load(new Map([[NEURAL_KEY, 'true']]));
  const [worker] = s.log.workers;
  worker.onmessage({ data: { ready: true } });
  assert.equal(worker.sent.length, 1, 'a live line never waits behind the whole warm-up');
  for (let i = 0; i < worker.sent.length && i < 200; i++) {
    worker.onmessage({ data: { id: worker.sent[i].id, audio: new Float32Array(10), rate: 24000 } });
    await flush();
  }
  const warmed = worker.sent.map((m) => m.text);
  assert.ok(warmed.includes('Coming off') && warmed.includes('Ladies and gentlemen'), `warm-up: ${warmed}`);
  assert.ok(!warmed.some((text) => text.includes('{')), 'titles are only generated live');
  assert.equal(new Set(warmed).size, warmed.length, 'each phrase once');
});

// Answers every worker job, including the ones each answer triggers, like the one-at-a-time warm-up.
const answerAll = async (worker) => {
  for (let i = 0; i < worker.sent.length && i < 200; i++) {
    worker.onmessage({ data: { id: worker.sent[i].id, audio: new Float32Array(10), rate: 24000 } });
    await flush();
  }
};

test('prepared announcer phrases survive a reload, task titles do not', async (t) => {
  t.mock.method(Math, 'random', () => 0);
  const store = new Map();
  const caches = { open: async () => ({ match: async (url) => store.get(url)?.clone(), put: async (url, res) => { store.set(url, res); } }) };
  const first = load(new Map([[NEURAL_KEY, 'true']]));
  Object.assign(window, { caches, Response });
  first.log.workers[0].onmessage({ data: { ready: true } });
  await answerAll(first.log.workers[0]);
  first.hooks.currentTaskChange({ current: task({ title: 'Secret plan' }), previous: null });
  await new Promise((resolve) => setTimeout(resolve, 350));
  await answerAll(first.log.workers[0]);
  assert.ok(store.size > 3, 'fixed phrases are stored');
  assert.ok(![...store.keys()].some((url) => decodeURIComponent(url).includes('Secret plan')), 'titles are never stored');

  const second = load(first.storage);
  Object.assign(window, { caches, Response });
  second.log.workers[0].onmessage({ data: { ready: true } });
  await answerAll(second.log.workers[0]);
  assert.deepEqual(second.log.workers[0].sent, [], 'no warm-up generation after a reload');
});

test('a kick off right after a goal waits for the goal call before the PA starts', async () => {
  const s = load(new Map([[NEURAL_KEY, 'true']]));
  const [worker] = s.log.workers;
  worker.onmessage({ data: { ready: true } });
  await answerAll(worker);
  const done = task({ isDone: true });
  s.hooks.taskComplete({ task: done });
  await answerAll(worker);
  const goalEnd = s.log.sources.at(-1);
  s.hooks.currentTaskChange({ current: task({ id: 'b', title: 'Next' }), previous: done });
  await new Promise((resolve) => setTimeout(resolve, 350));
  await answerAll(worker);
  const started = s.log.started;
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(s.log.started, started, 'nothing plays while George is on');
  goalEnd.onended();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(s.log.started > started, 'Michael follows once the goal call ends');
});

test('a new event cuts off a neural line, and a queued line still follows a cut-off one', async () => {
  const s = load(new Map([[NEURAL_KEY, 'true']]));
  const [worker] = s.log.workers;
  worker.onmessage({ data: { ready: true } });
  await answerAll(worker);
  s.hooks.taskComplete({ task: task({ isDone: true }) });
  await answerAll(worker);
  const started = s.log.started;
  s.hooks.taskDelete({ taskId: 'x' }); // cuts the goal call off: its sources are stopped
  await answerAll(worker);
  assert.ok(s.log.started > started, 'the red card call plays');
  const done = task({ id: 'x', isDone: true });
  s.hooks.taskComplete({ task: done });
  s.hooks.taskUpdate({ task: done, changes: { isDone: false } }); // VAR cuts the goal off before it plays
  await answerAll(worker);
  const afterVar = s.log.started;
  s.log.sources.at(-1).onended();
  s.hooks.currentTaskChange({ current: task({ id: 'n', title: 'Next' }), previous: done });
  await new Promise((resolve) => setTimeout(resolve, 400));
  await answerAll(worker);
  assert.ok(s.log.started > afterVar, 'nothing on air is left waiting forever');
});

test('if the neural voice fails to load, the system voice takes over', async (t) => {
  withClock(t);
  const s = load(new Map([[NEURAL_KEY, 'true']]));
  s.log.workers[0].onerror({ message: 'network down' });
  assert.match(s.log.snacks.at(-1), /could not be loaded/);
  s.hooks.currentTaskChange({ current: task({ title: 'Alpha' }), previous: null });
  t.mock.timers.tick(300);
  assert.match(s.last(), /Alpha/);
  assert.equal(load(s.storage).log.workers.length, 0, 'the next start does not fail again');
});

test('a muted start does not load the neural voices', () => {
  const s = load(new Map([[NEURAL_KEY, 'true'], ['ridonculous-stadium-mode-muted', 'true']]));
  assert.equal(s.log.workers.length, 0);
});

test('the big screen shows each event, with the combo stamp and the final score', (t) => {
  withClock(t);
  const s = load(new Map([[NEURAL_KEY, 'false']]));
  s.hooks.currentTaskChange({ current: task(), previous: null });
  t.mock.timers.tick(300);
  assert.deepEqual(s.screen(), { type: 'kickoff', text: ['Now taking the field', 'Write the quarterly report'] });
  s.hooks.currentTaskChange({ current: task({ id: 't2', title: 'Bravo' }), previous: task() });
  t.mock.timers.tick(300);
  assert.deepEqual(s.screen(), { type: 'substitution', text: ['Substitution', '▼ Write the quarterly report', '▲ Bravo'] });
  s.hooks.taskComplete({ task: task() });
  assert.deepEqual(s.screen().text.slice(0, 1), ['Goal!']);
  s.hooks.taskComplete({ task: task({ id: 't2' }) });
  s.hooks.taskComplete({ task: task({ id: 't3' }) });
  assert.deepEqual(s.screen().text.slice(0, 2), ['Goal!', 'Hat trick!']);
  s.hooks.taskUpdate({ task: task(), changes: { isDone: false } });
  assert.deepEqual(s.screen(), { type: 'disallowed', text: ['VAR check', 'No goal'] });
  s.hooks.taskDelete({ taskIds: ['a', 'b', 'c'] });
  assert.deepEqual(s.screen(), { type: 'redCard', text: ['×3'] });
  s.hooks.finishDay();
  assert.deepEqual(s.screen(), { type: 'fullTime', text: ['Full time', '2 goals'] });
  assert.equal(s.body.children[0].children.length, 2, 'one style and only the newest scene');
});

test('the big screen clears itself, stays dark while muted, and is removed on unload', (t) => {
  withClock(t);
  const s = load(new Map([[NEURAL_KEY, 'false'], ['ridonculous-stadium-mode-muted', 'true']]));
  s.hooks.taskComplete({ task: task() });
  assert.equal(s.body.children.length, 0, 'muted: no overlay at all');
  const loud = load(new Map([[NEURAL_KEY, 'false']]));
  loud.hooks.taskComplete({ task: task({ title: '<img src=x onerror=alert(1)>' }) });
  loud.hooks.taskUpdate({ task: task({ title: '<b>x</b>' }), changes: { dueDay: '2026-11-01' } });
  assert.equal(loud.screen().type, 'goal', 'a reschedule has no scene and leaves the goal up');
  t.mock.timers.tick(2800);
  assert.equal(loud.screen(), null);
  loud.hooks.currentTaskChange({ current: task({ title: '<img src=x>' }), previous: null });
  t.mock.timers.tick(300);
  assert.deepEqual(loud.screen().text, ['Now taking the field', '<img src=x>'], 'titles are text, not HTML');
  loud.unload();
  assert.equal(loud.body.children.length, 0);
});

// Regression: during the warm-up, a substitution went silent after "Coming on" because the incoming title
// waited behind warm-up phrases, George's prepared titles and the jobs of the kick off it had cut off.
test('a new line is generated ahead of the warm-up, prepared titles and lines that were cut off', async (t) => {
  withClock(t);
  t.mock.method(Math, 'random', () => 0); // kick off: "Ladies and gentlemen... now taking the field... {title}!"
  const s = load(new Map([[NEURAL_KEY, 'true']]));
  const [worker] = s.log.workers;
  worker.onmessage({ data: { ready: true } });
  s.hooks.currentTaskChange({ current: task({ title: 'Alpha' }), previous: null });
  t.mock.timers.tick(300);
  await flush();
  s.hooks.currentTaskChange({ current: task({ id: 'b', title: 'Bravo' }), previous: task({ title: 'Alpha' }) });
  t.mock.timers.tick(300);
  await flush();
  const order = [];
  for (let i = 0; i < worker.sent.length && i < 200; i++) {
    const { id, text, voice } = worker.sent[i];
    order.push(`${voice === 'bm_george' ? 'George' : 'Michael'}: ${text}`);
    worker.onmessage({ data: { id, audio: new Float32Array(10), rate: 24000 } });
    await flush();
  }
  const at = (job) => order.indexOf(job);
  assert.ok(at('Michael: Bravo!') >= 0, `jobs: ${order}`);
  assert.ok(at('Michael: Bravo!') <= 4, `the new title is at most behind the job in flight and its own line: ${order.slice(0, 8)}`);
  assert.ok(at('Michael: Bravo!') < at('Michael: now taking the field'), 'ahead of the cut-off kick off');
  assert.ok(at('Michael: Bravo!') < at('George: Alpha!'), 'ahead of prepared titles');
  assert.ok(at('Michael: Alpha!') < at('George: Alpha!'), 'Michael before George prepares the same title');
});

test('a kick off right after a goal waits for the goal scene, and mute clears the screen', async (t) => {
  withClock(t);
  const s = load(new Map([[NEURAL_KEY, 'false']]), undefined, 'Mute');
  s.hooks.taskComplete({ task: task({ isDone: true }) });
  s.hooks.currentTaskChange({ current: task({ id: 't2', title: 'Bravo' }), previous: task({ isDone: true }) });
  t.mock.timers.tick(300);
  assert.equal(s.screen().type, 'goal', 'the goal stays up while its call is still on');
  t.mock.timers.tick(2500);
  assert.deepEqual(s.screen(), { type: 'kickoff', text: ['Now taking the field', 'Bravo'] });
  await s.buttons[0].onClick();
  assert.equal(s.screen(), null, 'muting clears the screen');
});

test('a title cut off with "..." is not followed by a lone "!" phrase', async (t) => {
  withClock(t);
  const s = load(new Map([[NEURAL_KEY, 'true']]));
  const [worker] = s.log.workers;
  worker.onmessage({ data: { ready: true } });
  s.hooks.currentTaskChange({ current: task({ title: 'x'.repeat(80) }), previous: null });
  t.mock.timers.tick(300);
  await answerAll(worker);
  assert.ok(!worker.sent.some((m) => !/\w/.test(m.text)), `phrases: ${worker.sent.map((m) => m.text)}`);
});

test('a goal call moves its prepared title ahead of the warm-up', async (t) => {
  withClock(t);
  t.mock.method(Math, 'random', () => 0);
  const s = load(new Map([[NEURAL_KEY, 'true']]));
  const [worker] = s.log.workers;
  worker.onmessage({ data: { ready: true } });
  s.hooks.currentTaskChange({ current: task({ title: 'Alpha' }), previous: null });
  t.mock.timers.tick(300);
  s.hooks.taskComplete({ task: task({ title: 'Alpha', isDone: true }) });
  await answerAll(worker);
  const order = worker.sent.map((m) => `${m.voice}: ${m.text}`);
  assert.ok(order.indexOf('bm_george: Alpha!') <= 3, `George's title right after GOAL!: ${order}`);
});
