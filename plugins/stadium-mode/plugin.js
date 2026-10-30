// Stadium Mode: a crowd and a commentator for your task list.
// All sound is synthesized locally (Web Audio + Web Speech). The optional neural voices
// downloads its code and model once, after the user confirms; task titles never leave the machine.

// Right after install, the app can run this file twice in the same page (an activation race in the host),
// which would double every button and every sound. A second copy steps aside until the first unloads.
// shortcut: page-wide flag; remove once the host activates a plugin only once.
const INSTANCE_FLAG = '__ridonculousStadiumMode';
if (window[INSTANCE_FLAG]) return;
window[INSTANCE_FLAG] = true;

const MUTE_KEY = 'ridonculous-stadium-mode-muted';
const COMBO_WINDOW_MS = 90 * 1000;
// Completing or deleting the running task also fires currentTaskChange; wait for both before commenting.
const SETTLE_MS = 300;
// How long a completed or deleted task counts as "just left the pitch" for that check.
const EXIT_WINDOW_MS = 1000;

const LINES = {
  // Titles stand alone as "{title}!" sentences, so the neural commentator can prepare them at kick off.
  goal: [
    'GOAL! {title}! The crowd goes wild!',
    'It is in the back of the net! {title}! Done!',
    'What a finish! {title}! History!',
    'GOAL! Absolutely clinical! {title}!',
  ],
  // Announcer lines: each "..." is a dramatic pause in most speech engines.
  kickoff: [
    'Ladies and gentlemen... now taking the field... {title}!',
    'Please welcome... to the pitch... {title}!',
    'And now... the moment you have all been waiting for... {title}!',
  ],
  halftime: ['Ladies and gentlemen... it is half time.', 'The referee blows... for a break.'],
  // Titles stand alone as "{title}!", the same clip the kick off made, so the neural voice has it cached.
  substitution: ['Substitution... Coming off... {from}!... Coming on... {to}!'],
  postponed: [
    'Ooooh! {title}! Rescheduled! The fans are not happy.',
    'The fixture is moved! {title}! Another day, then.',
  ],
  transfer: ['Shock transfer! {title}! Off to a new club!'],
  disallowed: ['Hold on. VAR check. The goal is disallowed! {title}! Back on!'],
  redCard: ['Red card! A task is sent off!', 'Straight red! That task is off the pitch!'],
};

/** Shortens a task title so the commentator does not read an essay aloud. */
const shortTitle = (task) => {
  const title = String((task && task.title) || 'that task').trim();
  return title.length > 60 ? `${title.slice(0, 57)}...` : title;
};

const pick = (list, vars) =>
  list[Math.floor(Math.random() * list.length)].replace(/\{(\w+)\}/g, (_, key) => vars[key]);

const comboLine = (combo) => {
  if (combo === 2) return 'That is a double!';
  if (combo === 3) return 'HAT TRICK!';
  return combo > 3 ? `${combo} in a row! Somebody stop this player!` : '';
};

const paceLine = (task) => {
  if (!task.timeEstimate || !task.timeSpent) return '';
  if (task.timeSpent < task.timeEstimate * 0.8) return 'And well ahead of schedule!';
  return task.timeSpent > task.timeEstimate * 1.5 ? 'Deep into extra time, but it counts!' : '';
};

// Two people on air: a slow, deep stadium announcer and an excitable TV commentator.
const VOICES = {
  announcer: { rate: 0.85, pitch: 0.75 },
  commentator: { rate: 1.15, pitch: 1.15 },
};

/**
 * Decides how the stadium reacts to one event. Pure apart from Math.random line choice.
 * `cues` play at once; `outro` cues play when the spoken line ends.
 * @returns {{ cues: string[], outro: string[], line: string, voice: string, state: object }}
 */
const react = (event, state, now) => {
  const vars = { title: shortTitle(event.task) };
  switch (event.type) {
    case 'goal': {
      const combo = now - state.lastGoalAt <= COMBO_WINDOW_MS ? state.combo + 1 : 1;
      const line = [pick(LINES.goal, vars), comboLine(combo), paceLine(event.task)].filter(Boolean).join(' ');
      const next = { ...state, combo, lastGoalAt: now, goals: state.goals + 1, lastExit: { ids: [event.task.id], at: now } };
      return { cues: ['cheer'], outro: combo > 1 ? ['airhorn'] : [], line, voice: 'commentator', state: next };
    }
    case 'kickoff':
      return { cues: ['whistle', 'murmur'], outro: ['organ'], line: pick(LINES.kickoff, vars), voice: 'announcer', state };
    case 'halftime':
      return { cues: ['whistle', 'murmur'], outro: [], line: pick(LINES.halftime, vars), voice: 'announcer', state };
    case 'substitution': {
      const line = pick(LINES.substitution, { from: shortTitle(event.from), to: shortTitle(event.task) });
      return { cues: ['whistle', 'murmur'], outro: [], line, voice: 'announcer', state };
    }
    case 'postponed':
      return { cues: ['ooh'], outro: [], line: pick(LINES.postponed, vars), voice: 'commentator', state };
    case 'transfer':
      return { cues: ['ooh'], outro: [], line: pick(LINES.transfer, vars), voice: 'commentator', state };
    case 'disallowed': {
      const next = { ...state, combo: 0, goals: Math.max(0, state.goals - 1) };
      return { cues: ['boo'], outro: [], line: pick(LINES.disallowed, vars), voice: 'commentator', state: next };
    }
    case 'redCard': {
      const count = event.ids.length;
      const line = count > 1 ? `Mass red cards! ${count} tasks sent off!` : pick(LINES.redCard, vars);
      return { cues: ['boo'], outro: [], line, voice: 'commentator', state: { ...state, lastExit: { ids: event.ids, at: now } } };
    }
    case 'fullTime': {
      const line = state.goals
        ? `Ladies and gentlemen... that is full time! ${state.goals} ${state.goals === 1 ? 'goal' : 'goals'} today!`
        : 'Ladies and gentlemen... full time. A goalless draw. The fans want their money back.';
      return { cues: ['finalWhistle', 'murmur'], outro: ['cheer'], line, voice: 'announcer', state: { ...state, goals: 0, combo: 0 } };
    }
    default:
      return { cues: [], outro: [], line: '', voice: 'commentator', state };
  }
};

// ---------- Sound: every cue is generated, no audio files ----------

let ctx = null;
let master = null;

const audio = () => {
  if (!ctx) {
    ctx = new window.AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  // Contexts start suspended until the page has had a user gesture; task events follow one.
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
};

/** Gain node with an attack/hold/release envelope, wired to the master bus. */
const envelope = (ac, { at, peak, attack, hold, release }) => {
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + attack);
  gain.gain.setValueAtTime(peak, at + attack + hold);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + hold + release);
  gain.connect(master);
  return { gain, end: at + attack + hold + release };
};

const filter = (ac, type, frequency, target) => {
  const node = ac.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.connect(target);
  return node;
};

const noise = (ac, target, at, end) => {
  const buffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * (end - at)), ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const source = ac.createBufferSource();
  source.buffer = buffer;
  source.connect(target);
  source.start(at);
};

const tone = (ac, { type, frequency, target, at, end }) => {
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, at);
  osc.connect(target);
  osc.start(at);
  osc.stop(end);
  return osc;
};

/** A crowd is noise for the roar plus a few detuned "voices" sliding by `slide`. */
const crowd = ({ peak, roar, low, high, slide, hold }) => {
  const ac = audio();
  const env = envelope(ac, { at: ac.currentTime, peak, attack: 0.3, hold, release: 1.2 });
  noise(ac, filter(ac, 'bandpass', roar, env.gain), ac.currentTime, env.end);
  const voices = filter(ac, 'lowpass', 1400, env.gain);
  for (let i = 0; i < 7; i++) {
    const frequency = low + Math.random() * (high - low);
    const osc = tone(ac, { type: 'sawtooth', frequency, target: voices, at: ac.currentTime, end: env.end });
    osc.frequency.linearRampToValueAtTime(frequency * slide, env.end);
  }
};

const whistle = (blasts) => {
  const ac = audio();
  let at = ac.currentTime;
  for (const length of blasts) {
    const env = envelope(ac, { at, peak: 0.25, attack: 0.02, hold: length, release: 0.05 });
    const osc = tone(ac, { type: 'sine', frequency: 2900, target: env.gain, at, end: env.end });
    // The pea in a referee's whistle makes this fast warble: a 32 Hz wobble of ±180 Hz.
    const depth = ac.createGain();
    depth.gain.value = 180;
    depth.connect(osc.frequency);
    tone(ac, { type: 'square', frequency: 32, target: depth, at, end: env.end });
    at = env.end + 0.12;
  }
};

const notes = ({ type, sequence, peak, step }) => {
  const ac = audio();
  sequence.forEach(([frequency, beats], i) => {
    const at = ac.currentTime + sequence.slice(0, i).reduce((sum, [, b]) => sum + b * step, 0);
    const env = envelope(ac, { at, peak, attack: 0.01, hold: beats * step * 0.8, release: 0.08 });
    const target = filter(ac, 'lowpass', 2400, env.gain);
    tone(ac, { type, frequency, target, at, end: env.end });
    tone(ac, { type, frequency: frequency * 1.006, target, at, end: env.end });
  });
};

const CUES = {
  whistle: () => whistle([0.5]),
  finalWhistle: () => whistle([0.35, 0.35, 1.1]),
  cheer: () => crowd({ peak: 0.35, roar: 1200, low: 300, high: 650, slide: 1.25, hold: 1.4 }),
  boo: () => crowd({ peak: 0.3, roar: 450, low: 100, high: 170, slide: 0.8, hold: 1.1 }),
  ooh: () => crowd({ peak: 0.25, roar: 700, low: 220, high: 330, slide: 0.7, hold: 0.6 }),
  // A quiet crowd bed under the announcer, so the voice sounds like it is in a stadium.
  murmur: () => crowd({ peak: 0.06, roar: 600, low: 180, high: 320, slide: 1, hold: 3.5 }),
  // The traditional "Charge!" bugle call, played on a stadium organ.
  organ: () => notes({ type: 'square', peak: 0.12, step: 0.16, sequence: [[392, 1], [523, 1], [659, 1], [784, 2], [659, 1], [784, 3]] }),
  airhorn: () => notes({ type: 'sawtooth', peak: 0.15, step: 0.2, sequence: [[466, 1], [466, 1], [466, 3]] }),
};

let warnedNoVoice = false;
let unloaded = false;
// Bumped on every cancel(): Chrome fires onend for cut-off lines too, and their outro must not play.
let generation = 0;
let muted = window.localStorage.getItem(MUTE_KEY) === 'true';

const playCues = (names) => {
  if (muted || unloaded) return;
  for (const name of names) {
    try {
      CUES[name]();
    } catch (error) {
      console.error(`[stadium-mode] ${name} failed`, error);
    }
  }
};

/** Cuts off whatever is being said: system speech, the PA, and pending outro cues. */
const interrupt = () => {
  generation++;
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  for (const source of playing) source.stop();
  playing.clear();
};

// ---------- Neural voices (opt-in): Kokoro TTS in a worker; announcer through a stadium PA, commentator dry ----------

const NEURAL_KEY = 'ridonculous-stadium-mode-neural-voice';
// Pinned, so the code running inside the app can't change under us.
const KOKORO_URL = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js';
// Michael booms over the stadium PA; George calls the game from the TV booth.
const NEURAL = {
  announcer: { voice: 'am_michael', speed: 1.25, pauseS: 0.2 },
  commentator: { voice: 'bm_george', speed: 1.2, pauseS: 0.05 },
};
const CLIP_CACHE = 'ridonculous-stadium-mode-clips';
// Inference blocks for seconds per phrase, so it runs in a worker to keep the app responsive.
// Jobs are chained because the ONNX session can't run two at once.
const WORKER_CODE = `
import { KokoroTTS } from '${KOKORO_URL}';
const tts = KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'wasm' });
tts.then(() => postMessage({ ready: true }), (error) => postMessage({ failed: String(error) }));
let queue = Promise.resolve();
onmessage = ({ data: { id, text, voice, speed } }) => {
  queue = queue.then(async () => {
    try {
      const { audio, sampling_rate } = await (await tts).generate(text, { voice, speed });
      postMessage({ id, audio, rate: sampling_rate }, [audio.buffer]);
    } catch (error) {
      postMessage({ id, error: String(error) });
    }
  });
};
`;

// A phrase per "..." pause or sentence, so cached parts play while a task title is still generated.
// Parts without a letter or digit (the "!" after a title truncated to "...") have nothing to say.
const phrasesOf = (line) => line.split(/\.\.\.|(?<=[!?.])\s+/).map((part) => part.trim()).filter((part) => /[\p{L}\p{N}]/u.test(part));
const fixedPhrases = (lines) => new Set(lines.flatMap(phrasesOf).filter((part) => !part.includes('{')));
// Phrases without a task title, per voice; substitution first, it's the line most likely to stall.
const FIXED_PHRASES = {
  announcer: fixedPhrases([...LINES.substitution, ...LINES.kickoff, ...LINES.halftime]),
  commentator: fixedPhrases([...LINES.goal, ...LINES.disallowed, ...LINES.redCard, ...LINES.postponed, ...LINES.transfer,
    comboLine(2), comboLine(3), comboLine(4), paceLine({ timeEstimate: 10, timeSpent: 1 }), paceLine({ timeEstimate: 1, timeSpent: 10 })]),
};

let worker = null;
let neuralReady = false;
let nextJob = 0;
// Jobs wait here and go to the worker one at a time, most urgent first. In arrival order, a new title
// waited behind warm-up phrases, prepared titles and the jobs of a line that was just cut off.
const queued = [];
const jobs = new Map();
// Lower than any line's priority (see announce).
const BACKGROUND = -1;
// shortcut: unbounded phrase cache; intros and titles repeat all day. An LRU if memory ever matters.
const clips = new Map();
const playing = new Set();
let pa = null;
let booth = null;
// The neural line currently playing; a queued line waits for it.
let onAir = Promise.resolve();

const stopNeural = () => {
  if (worker) worker.terminate();
  worker = null;
  neuralReady = false;
  for (const job of [...queued, ...jobs.values()]) job.reject(new Error('Neural voice stopped'));
  queued.length = 0;
  jobs.clear();
  clips.clear();
};

const loadNeural = (notify) => {
  if (worker) return;
  worker = new window.Worker(window.URL.createObjectURL(new window.Blob([WORKER_CODE], { type: 'text/javascript' })), { type: 'module' });
  const fail = (reason) => {
    console.error('[stadium-mode] neural voices failed to load', reason);
    stopNeural();
    // Stay on the system voice, as the snack says, instead of failing again on every start.
    window.localStorage.setItem(NEURAL_KEY, 'false');
    PluginAPI.showSnack({ msg: 'Stadium Mode: the neural voices could not be loaded, using the system voice.', type: 'ERROR' });
  };
  worker.onerror = (event) => fail(event.message);
  worker.onmessage = ({ data }) => {
    if (data.ready) {
      neuralReady = true;
      warmUp();
      if (notify) PluginAPI.showSnack({ msg: 'Michael and George are ready!', type: 'SUCCESS', ico: 'record_voice_over' });
    } else if (data.failed) fail(data.failed);
    else {
      const job = jobs.get(data.id);
      jobs.delete(data.id);
      if (job) data.error ? job.reject(new Error(data.error)) : job.resolve(data);
      sendNextJob();
    }
  };
};

// Highest priority first; the first one queued wins a tie, so a line's phrases go in order.
const sendNextJob = () => {
  if (!worker || jobs.size || !queued.length) return;
  const job = queued.reduce((best, next) => (next.want.priority > best.want.priority ? next : best));
  queued.splice(queued.indexOf(job), 1);
  jobs.set(job.id, job);
  worker.postMessage({ id: job.id, text: job.text, voice: NEURAL[job.voice].voice, speed: NEURAL[job.voice].speed });
};

// `want` is shared with the phrase's clip, so a line that needs a queued phrase can raise its priority.
const generate = (text, voice, want) => new Promise((resolve, reject) => {
  queued.push({ id: nextJob++, text, voice, want, resolve, reject });
  sendNextJob();
});

// Fixed phrases survive reloads in Cache Storage, so the warm-up runs once. Task titles stay in memory only,
// so none end up on disk. The key includes the voice settings, so changing them regenerates everything.
const stored = async (phrase, voice, want) => {
  const url = `https://stadium-mode.invalid/${NEURAL[voice].voice}/${NEURAL[voice].speed}/${encodeURIComponent(phrase)}`;
  const cache = FIXED_PHRASES[voice].has(phrase) && window.caches
    ? await window.caches.open(CLIP_CACHE).catch((error) => console.warn('[stadium-mode] no clip cache', error))
    : null;
  const hit = cache && await cache.match(url);
  if (hit) return { audio: new Float32Array(await hit.arrayBuffer()), rate: Number(hit.headers.get('x-sample-rate')) };
  const result = await generate(phrase, voice, want);
  if (cache) {
    const response = new window.Response(result.audio, { headers: { 'x-sample-rate': String(result.rate) } });
    await cache.put(url, response).catch((error) => console.warn('[stadium-mode] could not store clip', error));
  }
  return result;
};

/** A phrase's audio, generated once. `priority` decides its place in the queue while it waits for the worker. */
const clip = (ac, phrase, voice, priority = BACKGROUND) => {
  const key = `${voice}:${phrase}`;
  if (!clips.has(key)) {
    const want = { priority };
    const buffer = stored(phrase, voice, want).then(({ audio, rate }) => {
      const result = ac.createBuffer(1, audio.length, rate);
      result.copyToChannel(audio, 0);
      return result;
    });
    buffer.catch(() => clips.delete(key));
    clips.set(key, { buffer, want });
  }
  const entry = clips.get(key);
  entry.want.priority = Math.max(entry.want.priority, priority);
  return entry.buffer;
};

/** The stadium PA: horn-speaker EQ, soft clipping, compression, echoes off the stands, arena reverb. */
const paInput = (ac) => {
  if (pa) return pa;
  const out = ac.createGain();
  out.gain.value = 1.2;
  out.connect(master);
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -24;
  comp.ratio.value = 6;
  comp.connect(out);
  // Later echoes come from further away: quieter and duller.
  for (const [time, level, cutoff] of [[0.17, 0.42, 2800], [0.34, 0.28, 2000], [0.55, 0.16, 1400], [0.8, 0.08, 1000]]) {
    const delay = ac.createDelay(1);
    delay.delayTime.value = time;
    const gain = ac.createGain();
    gain.gain.value = level;
    gain.connect(out);
    delay.connect(filter(ac, 'lowpass', cutoff, gain));
    comp.connect(delay);
  }
  const impulse = ac.createBuffer(1, Math.floor(ac.sampleRate * 2.6), ac.sampleRate);
  const decay = impulse.getChannelData(0);
  for (let i = 0; i < decay.length; i++) decay[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / decay.length, 3.5);
  const reverb = ac.createConvolver();
  reverb.buffer = impulse;
  const wet = ac.createGain();
  wet.gain.value = 0.22;
  wet.connect(out);
  reverb.connect(filter(ac, 'lowpass', 3000, wet));
  comp.connect(reverb);
  const shaper = ac.createWaveShaper();
  shaper.curve = Float32Array.from({ length: 1024 }, (_, i) => Math.tanh(2.2 * (i / 511.5 - 1)) / Math.tanh(2.2));
  shaper.connect(comp);
  const drive = ac.createGain();
  drive.gain.value = 1.6;
  drive.connect(shaper);
  const honk = filter(ac, 'peaking', 1800, filter(ac, 'lowpass', 5200, drive));
  honk.gain.value = 7;
  pa = filter(ac, 'highpass', 280, honk);
  return pa;
};

/** The TV booth: no stadium echo, just less bass, like a commentary mic. */
const boothInput = (ac) => {
  if (!booth) booth = filter(ac, 'highpass', 150, master);
  return booth;
};

// Generating is ~3x slower than speaking, so prepare the fixed phrases of both voices in the background.
// Then only task titles are generated live, and a line doesn't stall mid-sentence on first use.
// The announcer's phrases come first; most of George's lines start with a cached phrase anyway.
// One phrase at a time, at background priority, so a live line waits behind at most the phrase in progress.
const warmUp = async () => {
  const ac = audio();
  for (const voice of Object.keys(FIXED_PHRASES)) {
    for (const part of FIXED_PHRASES[voice]) {
      if (!neuralReady) return;
      await clip(ac, part, voice).catch((error) => console.warn('[stadium-mode] warm-up failed', error));
    }
  }
};

const speechDone = () => new Promise((resolve) => {
  const check = () => (window.speechSynthesis && window.speechSynthesis.speaking ? setTimeout(check, 200) : resolve());
  check();
});

/**
 * Plays a line phrase by phrase, so cached phrases already play while a task title is generated.
 * Resolves when the line has finished or was cut off. `after` is a line to wait for (kick off after a goal).
 */
const announce = async ({ line, voice, outro }, after) => {
  const current = generation;
  const ac = audio();
  // The newest line first, in line order; a line that was cut off falls behind it.
  const parts = phrasesOf(line).map((part, index) => clip(ac, part, voice, current - index / 100));
  if (after) await Promise.all([after, speechDone()]);
  let at = 0;
  let last = null;
  try {
    for (const part of parts) {
      const buffer = await part;
      if (current !== generation || unloaded || muted) {
        console.info('[stadium-mode] announcer line cut off by a newer event:', line);
        return;
      }
      const source = ac.createBufferSource();
      source.buffer = buffer;
      source.connect(voice === 'announcer' ? paInput(ac) : boothInput(ac));
      at = Math.max(at, ac.currentTime);
      source.start(at);
      source.onended = () => playing.delete(source);
      playing.add(source);
      at += buffer.duration + NEURAL[voice].pauseS;
      last = source;
    }
  } catch (error) {
    console.error('[stadium-mode] announcer voice failed', error);
  }
  if (!last) {
    if (current === generation && !unloaded) playCues(outro);
    return;
  }
  // An interrupted line's source is stopped, which also fires onended.
  await new Promise((resolve) => {
    last.onended = () => {
      playing.delete(last);
      if (current === generation) playCues(outro);
      resolve();
    };
  });
};

const utter = (text, voice, volume) => {
  const utterance = new window.SpeechSynthesisUtterance(text);
  Object.assign(utterance, VOICES[voice]);
  if (volume !== undefined) utterance.volume = volume;
  return utterance;
};

/** Speaks a reaction's line in its voice, then plays its outro cues when the line ends. */
const say = ({ line, voice, outro }, queue) => {
  // Newest call wins; a backlog of stale commentary is worse than a cut-off sentence.
  // shortcut: cancel() clears all speech in the renderer, also other plugins' (e.g. Voice Reminder)
  if (!queue) interrupt();
  if (neuralReady && line) {
    onAir = announce({ line, voice, outro }, queue && onAir);
    return;
  }
  const synth = window.speechSynthesis;
  const hasVoice = synth && synth.getVoices().length > 0;
  // Linux Chromium/Electron has no voices unless started with --enable-speech-dispatcher; say so once.
  if (synth && !hasVoice && !warnedNoVoice) {
    warnedNoVoice = true;
    PluginAPI.showSnack({ msg: 'Stadium Mode: no speech voice found, so the commentator is silent. See the plugin README.', type: 'WARNING' });
  }
  if (!hasVoice || !line) {
    playCues(outro);
    return;
  }
  const current = generation;
  const main = utter(line, voice);
  main.onend = () => current === generation && playCues(outro);
  synth.speak(main);
  // Speech can't be routed through Web Audio for real reverb, so fake the PA echo off the stands.
  const lastWord = voice === 'announcer' && (line.match(/([\p{L}\p{N}']+)[^\p{L}\p{N}]*$/u) || [])[1];
  if (lastWord) [0.45, 0.2].forEach((volume) => synth.speak(utter(lastWord, voice, volume)));
};

// ---------- Big screen: animations over the app, drawn in code ----------
// The plugin API has no overlay, so this adds one element to the app page directly. That is unofficial
// and may break with an app update. It never takes clicks and is removed on unload.
const SCREEN_MS = 2800;
const CONFETTI_COLORS = ['#ffd600', '#ff1744', '#00e676', '#2979ff', '#ffffff'];
const SCREEN_CSS = `
.stm-overlay { position: fixed; inset: 0; z-index: 100000; pointer-events: none; display: grid; place-items: center; overflow: hidden;
  font-family: Impact, 'Arial Black', sans-serif; line-height: 1.15; text-transform: uppercase; text-align: center; color: #fff; }
.stm-overlay .stm-scene { grid-area: 1 / 1; display: flex; flex-direction: column; align-items: center; animation: stm-fade ${SCREEN_MS}ms both; }
.stm-overlay .stm-kickoff { width: 100%; padding: 24px 0; background: linear-gradient(90deg, transparent, #003300ee 15%, #003300ee 85%, transparent); }
.stm-overlay .stm-small { font-size: 22px; letter-spacing: 6px; color: #ffd600; }
.stm-overlay .stm-big { font-size: 56px; max-width: 90vw; overflow-wrap: anywhere; }
.stm-overlay .stm-kickoff .stm-big { animation: stm-slide 0.5s 0.2s ease-out both; }
.stm-overlay .stm-substitution, .stm-overlay .stm-fullTime { padding: 16px 40px; background: #111; border: 6px solid #333; border-radius: 8px;
  box-shadow: 0 0 40px #000; font-family: 'Courier New', monospace; font-weight: bold; animation: stm-pop 0.5s both, stm-fade ${SCREEN_MS}ms both; }
.stm-overlay .stm-off, .stm-overlay .stm-on { font-size: 40px; max-width: 80vw; overflow-wrap: anywhere; }
.stm-overlay .stm-off { color: #ff3d00; text-shadow: 0 0 12px #ff3d00; }
.stm-overlay .stm-on { color: #00e676; text-shadow: 0 0 12px #00e676; animation: stm-blink 0.3s 0.6s steps(1) 4 both; }
.stm-overlay .stm-goal-text { font-size: min(200px, 28vw); line-height: 1; color: #ffd600; -webkit-text-stroke: 6px #000; text-shadow: 0 10px 0 #000;
  animation: stm-pop 0.6s cubic-bezier(0.2, 2, 0.4, 1) both; }
.stm-overlay .stm-stamp { font-size: 56px; color: #ff1744; border: 6px solid #ff1744; border-radius: 8px; padding: 0 20px; background: #000a;
  transform: rotate(-8deg); animation: stm-stamp 0.4s 0.5s both; }
.stm-overlay .stm-confetti { position: absolute; top: -20px; width: 10px; height: 16px; animation: stm-fall 2.6s linear both; }
.stm-overlay .stm-disallowed { position: relative; overflow: hidden; padding: 24px 64px; background: #000a28ee; border: 3px solid #2979ff; }
.stm-overlay .stm-scan { position: absolute; left: 0; right: 0; height: 4px; background: #2979ff; box-shadow: 0 0 16px #2979ff;
  animation: stm-scan 0.6s linear 2; }
.stm-overlay .stm-verdict { font-size: 72px; color: #ff1744; animation: stm-pop 0.3s 1.3s both; }
.stm-overlay .stm-redCard { align-self: end; }
.stm-overlay .stm-card { display: grid; place-items: center; width: 180px; height: 260px; margin-bottom: -30px; border-radius: 14px;
  background: #d50000; box-shadow: 0 0 40px #000; font-size: 64px; transform: rotate(8deg); animation: stm-rise 0.6s ease-out both; }
.stm-overlay .stm-fullTime .stm-big { color: #ffd600; text-shadow: 0 0 12px #ffd600; }
@keyframes stm-fade { from { opacity: 0; } 8%, 85% { opacity: 1; } to { opacity: 0; } }
@keyframes stm-slide { from { transform: translateX(-60vw); } }
@keyframes stm-pop { from { transform: scale(0); } }
@keyframes stm-blink { 50% { opacity: 0; } }
@keyframes stm-stamp { from { transform: scale(3) rotate(-8deg); opacity: 0; } }
@keyframes stm-fall { to { transform: translate(var(--drift), 110vh) rotate(720deg); } }
@keyframes stm-scan { from { top: 0; } to { top: 100%; } }
@keyframes stm-rise { from { transform: translateY(120%) rotate(8deg); } }
@media (prefers-reduced-motion: reduce) {
  .stm-overlay * { animation: none !important; }
  .stm-overlay .stm-confetti, .stm-overlay .stm-scan { display: none; }
}`;

let overlay = null;
let scene = null;
let sceneEndsAt = 0;
// A queued event's scene, waiting for the current one to finish.
let waiting = null;
const clearWaiting = () => {
  clearTimeout(waiting);
  timers.delete(waiting);
  waiting = null;
};

const el = (tag, className, text = '') => {
  const node = window.document.createElement(tag);
  node.className = className;
  node.textContent = text; // never innerHTML: task titles must not be parsed as HTML
  return node;
};

const confetti = () =>
  Array.from({ length: 40 }, () => {
    const piece = el('i', 'stm-confetti');
    const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
    piece.style.cssText = `left: ${Math.random() * 100}vw; background: ${color}; animation-delay: ${Math.random() * 0.6}s; --drift: ${Math.random() * 20 - 10}vw`;
    return piece;
  });

const comboStamp = (combo) => {
  if (combo === 2) return 'Double!';
  if (combo === 3) return 'Hat trick!';
  return combo > 3 ? `${combo} in a row!` : '';
};

/** What the big screen shows for an event: a list of elements, or nothing. `before` is the state before it. */
const screenParts = (event, before, after) => {
  switch (event.type) {
    case 'kickoff': return [el('div', 'stm-small', 'Now taking the field'), el('div', 'stm-big', shortTitle(event.task))];
    case 'substitution':
      return [el('div', 'stm-small', 'Substitution'), el('div', 'stm-off', `▼ ${shortTitle(event.from)}`), el('div', 'stm-on', `▲ ${shortTitle(event.task)}`)];
    case 'goal': {
      const stamp = comboStamp(after.combo);
      return [el('div', 'stm-goal-text', 'Goal!'), ...(stamp ? [el('div', 'stm-stamp', stamp)] : []), ...confetti()];
    }
    case 'disallowed': return [el('div', 'stm-scan'), el('div', 'stm-big', 'VAR check'), el('div', 'stm-verdict', 'No goal')];
    case 'redCard': return [el('div', 'stm-card', event.ids.length > 1 ? `×${event.ids.length}` : '')];
    case 'fullTime':
      return [el('div', 'stm-small', 'Full time'), el('div', 'stm-big', `${before.goals} ${before.goals === 1 ? 'goal' : 'goals'}`)];
    default: return [];
  }
};

/** Shows an event on the big screen for a few seconds; a newer event replaces it, like the commentary. */
const showOnScreen = (event, before, after) => {
  const parts = screenParts(event, before, after);
  if (!parts.length) return;
  clearWaiting();
  if (!overlay) {
    overlay = el('div', 'stm-overlay');
    overlay.append(el('style', '', SCREEN_CSS));
    window.document.body.append(overlay);
  }
  if (scene) scene.remove();
  const current = el('div', `stm-scene stm-${event.type}`);
  current.append(...parts);
  overlay.append(current);
  scene = current;
  sceneEndsAt = Date.now() + SCREEN_MS;
  const id = setTimeout(() => {
    timers.delete(id);
    current.remove();
    if (scene === current) scene = null;
  }, SCREEN_MS);
  timers.add(id);
};

/** Like a queued line, a queued event's scene waits until the current scene is over. */
const showAfterScene = (event, before, after) => {
  const wait = scene ? sceneEndsAt - Date.now() : 0;
  if (wait <= 0) return showOnScreen(event, before, after);
  clearWaiting();
  waiting = setTimeout(() => showOnScreen(event, before, after), wait);
  timers.add(waiting);
};

// ---------- Wiring ----------

let state = { goals: 0, combo: 0, lastGoalAt: -Infinity, lastExit: { ids: [], at: -Infinity } };
// Chrome loads voices asynchronously; asking early means they are ready by the first event.
if (window.speechSynthesis) window.speechSynthesis.getVoices();
const timers = new Set();

/** Plays an event's cues and commentary; `queue` waits for the current line instead of cutting it off. */
const perform = (event, queue = false) => {
  const before = state;
  const result = react(event, state, Date.now());
  state = result.state;
  if (muted) return;
  playCues(result.cues);
  (queue ? showAfterScene : showOnScreen)(event, before, state);
  say(result, queue);
  // The goal call comes later; George prepares the title while Michael is still announcing it.
  if (neuralReady && (event.type === 'kickoff' || event.type === 'substitution')) {
    for (const part of phrasesOf(`${shortTitle(event.task)}!`)) {
      clip(audio(), part, 'commentator').catch((error) => console.warn('[stadium-mode] could not prepare a title', error));
    }
  }
};

const later = (fn) => {
  const id = setTimeout(() => {
    timers.delete(id);
    fn();
  }, SETTLE_MS);
  timers.add(id);
};

PluginAPI.registerHook('taskComplete', (payload) => {
  if (payload && payload.task) perform({ type: 'goal', task: payload.task });
});

PluginAPI.registerHook('currentTaskChange', (payload) => {
  const { current, previous } = payload || {};
  later(() => {
    const { ids, at } = state.lastExit;
    const previousLeft = previous && (previous.isDone || (ids.includes(previous.id) && Date.now() - at < EXIT_WINDOW_MS));
    if (current && previous && !previousLeft) perform({ type: 'substitution', task: current, from: previous });
    else if (current) perform({ type: 'kickoff', task: current }, previousLeft); // let the goal call finish
    else if (previous && !previousLeft) perform({ type: 'halftime', task: previous });
  });
});

// Super Productivity stores dueDay as a local YYYY-MM-DD string.
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

PluginAPI.registerHook('taskUpdate', (payload) => {
  const { task, changes } = payload || {};
  if (!task || !changes) return;
  if (changes.isDone === false) perform({ type: 'disallowed', task });
  else if (changes.isDone === true) return; // taskComplete already celebrated this
  // Unscheduling sends both as undefined; only a new day or time is a reschedule.
  // Planning a task for today pulls it closer, so only other days and times count.
  else if ((changes.dueDay && changes.dueDay !== todayStr()) || changes.dueWithTime) perform({ type: 'postponed', task });
  else if ('projectId' in changes) perform({ type: 'transfer', task });
});

PluginAPI.registerHook('taskDelete', (payload) => {
  const ids = payload && Array.isArray(payload.taskIds) ? payload.taskIds : [payload && payload.taskId];
  perform({ type: 'redCard', ids });
});

PluginAPI.registerHook('finishDay', () => {
  perform({ type: 'fullTime' });
});

const MODES = { mute: 'Mute', system: 'System voice', neural: 'Michael (neural)' };

const currentMode = () => {
  if (muted) return 'mute';
  return window.localStorage.getItem(NEURAL_KEY) === 'true' ? 'neural' : 'system';
};

const setMode = (mode) => {
  muted = mode === 'mute';
  window.localStorage.setItem(MUTE_KEY, String(muted));
  if (mode !== 'mute') window.localStorage.setItem(NEURAL_KEY, String(mode === 'neural'));
  if (mode === 'mute') {
    interrupt();
    clearWaiting();
    if (scene) scene.remove();
    scene = null;
    PluginAPI.showSnack({ msg: 'Stadium Mode muted', type: 'INFO', ico: 'campaign' });
    return;
  }
  if (mode === 'system') stopNeural();
  if (mode === 'neural' && !worker) {
    PluginAPI.showSnack({ msg: 'Stadium Mode: loading Michael and George...', type: 'INFO', ico: 'campaign' });
    loadNeural(true);
    return;
  }
  PluginAPI.showSnack({ msg: 'Stadium Mode is live!', type: 'INFO', ico: 'campaign' });
  perform({ type: 'kickoff', task: { title: 'Stadium Mode' } });
};

// One dialog for everything; picking Michael doubles as the consent for the neural download (both voices).
const chooseMode = async (firstRun) => {
  const mode = firstRun ? 'neural' : currentMode();
  const choice = await PluginAPI.openDialog({
    title: firstRun ? 'Welcome to Stadium Mode!' : 'Stadium Mode',
    htmlContent:
      (firstRun ? '<p>Pick the voices for the stadium. You can change it later with the megaphone button in the header.</p>' : `<p>Currently: <strong>${MODES[mode]}</strong></p>`) +
      '<p><strong>Michael</strong> is a neural stadium announcer (Kokoro) played through a stadium PA, and <strong>George</strong> joins him as the TV commentator.</p>' +
      '<p>Choosing Michael downloads about <strong>110 MB</strong> once: code from <code>cdn.jsdelivr.net</code> and the voice model from <code>huggingface.co</code>. ' +
      'Speech is then generated on this device, so task titles are not sent anywhere. Expect the first lines to be a few seconds late.</p>',
    buttons: Object.entries(MODES).map(([key, label]) => ({ label, ...(key === mode ? { color: 'primary', raised: true } : {}) })),
  });
  const picked = Object.keys(MODES).find((key) => MODES[key] === choice);
  if (picked) setMode(picked);
};

PluginAPI.registerHeaderButton({ label: 'Stadium Mode', icon: 'campaign', onClick: () => chooseMode(false) });

// First run: ask right away instead of waiting for someone to find the header button.
// Marked as asked before the dialog opens, so any answer (even closing it) keeps it from coming back.
if (window.localStorage.getItem(NEURAL_KEY) === null) {
  window.localStorage.setItem(NEURAL_KEY, 'false');
  chooseMode(true);
}

// Already downloaded once, so this loads from the browser cache.
if (window.localStorage.getItem(NEURAL_KEY) === 'true' && !muted) loadNeural(false);

PluginAPI.onUnload(() => {
  unloaded = true;
  delete window[INSTANCE_FLAG];
  stopNeural();
  for (const id of timers) clearTimeout(id);
  timers.clear();
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (ctx) ctx.close();
  ctx = null;
  if (overlay) overlay.remove();
  overlay = null;
});
