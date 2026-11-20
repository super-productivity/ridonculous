// Desk Pet: Mochi floats in the corner of every Super Productivity page and reacts to your tasks.
// Playground hack: the plugin API has no "overlay" slot, so this adds its own element to the host page.
// It lives in a shadow root (no style leaks either way) and is removed again on unload.

const DAY_MS = 86400000;
const SULK_DAYS = 3;
const GRUMPY_OVERDUE = 3;
const RETRY_MS = 5000;
const OVERDUE_CHECK_MS = 60000;
const BUBBLE_MS = 4000;
const HIDDEN_KEY = 'ridonculous-desk-pet-hidden';
const POSITION_KEY = 'ridonculous-desk-pet-position';
const DRAG_START_PX = 4; // smaller wiggles are still a click (a pet)
const DRAG_CLICK_MS = 300;
const MOODS = {
  sulking: { title: 'Mochi is sulking', line: s => `Nothing finished in ${s.daysSinceFed} days. Mochi has melted into a sad puddle.` },
  grumpy: { title: 'Mochi is grumpy', line: s => `${s.overdue} overdue tasks are glaring at Mochi from the list.` },
  hungry: { title: 'Mochi is hungry', line: () => 'Finish a task to feed Mochi their first snack of the day.' },
  content: { title: 'Mochi is content', line: () => 'A snack or two. Mochi is squishing happily.' },
  overjoyed: { title: 'Mochi is overjoyed', line: s => `${s.fedToday} snacks today! Mochi can't stop bouncing.` },
};

/** Logical day (YYYY-MM-DD) of a timestamp, honouring the user's start-of-next-day offset. */
function dayOf(ts, offsetMs) {
  const d = new Date(ts - offsetMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Derives Mochi's state from task data alone, so nothing is written and sync can't conflict. */
function petState({ tasks, archived = [], todayStr, now, offsetMs }) {
  // "Won't do" also sets isDone; SP's own taskComplete hook skips those, so they aren't snacks either.
  const doneTimes = [...tasks, ...archived].filter(t => t.isDone && t.doneOn && t.wontDoOn !== t.doneOn).map(t => t.doneOn);
  const fedToday = doneTimes.filter(ts => dayOf(ts, offsetMs) === todayStr).length;
  // Only active tasks: an unfinished subtask archived with its parent is not waiting on anyone.
  const overdue = tasks.filter(t => !t.isDone && (t.dueWithTime ? t.dueWithTime < now : t.dueDay && t.dueDay < todayStr)).length;
  const lastFed = doneTimes.length ? doneTimes.reduce((a, b) => Math.max(a, b)) : null; // spread overflows on huge archives
  const daysSinceFed = lastFed === null ? null
    : Math.max(0, Math.round((Date.parse(todayStr) - Date.parse(dayOf(lastFed, offsetMs))) / DAY_MS)); // clock skew between devices
  // A brand-new user with no history is hungry, not neglected.
  const mood = daysSinceFed >= SULK_DAYS ? 'sulking' : overdue >= GRUMPY_OVERDUE ? 'grumpy'
    : fedToday === 0 ? 'hungry' : fedToday < 3 ? 'content' : 'overjoyed';
  return { mood, fedToday, overdue, daysSinceFed };
}

// Mochi is a rice cake: a cream body with a dark outline reads on light and dark pages alike.
// The dusted band at the bottom takes the theme's main colour; the speech bubble and focus ring use the host theme variables.
const STYLE = `
  :host { all: initial; pointer-events: none; position: fixed; right: 24px; bottom: 20px; z-index: 999; font-family: var(--font-primary-stack, system-ui, sans-serif); color: var(--text-color, #263238); }
  :host([hidden]) { display: none; }
  .wrap { position: relative; } /* :host ignores the pointer; only Mochi catches clicks */
  .bubble { position: absolute; right: 0; bottom: calc(100% + 10px); width: max-content; max-width: 220px; padding: 10px 14px 11px; border-radius: 14px; background: var(--bg-lighter, #fff); box-shadow: var(--whiteframe-shadow-4dp, 0 4px 14px #0002); font-size: 13px; line-height: 1.4; opacity: 0; transform: translateY(8px) scale(.96); transform-origin: calc(100% - 44px) 100%; transition: opacity .18s, transform .18s; pointer-events: none; }
  .bubble::after { content: ''; position: absolute; right: 38px; bottom: -6px; width: 12px; height: 12px; background: inherit; transform: rotate(45deg); border-radius: 0 0 3px 0; }
  .left .bubble { right: auto; left: 0; transform-origin: 44px 100%; }
  .below .bubble { bottom: auto; top: calc(100% + 10px); transform: translateY(-8px) scale(.96); transform-origin: calc(100% - 44px) 0; }
  .below.left .bubble { transform-origin: 44px 0; }
  .left .bubble::after { right: auto; left: 38px; }
  .below .bubble::after { bottom: auto; top: -6px; }
  .wrap:has(button:hover) .bubble, .wrap:focus-within .bubble, .bubble.open { opacity: 1; transform: none; }
  .wrap.dragging .bubble { opacity: 0 !important; transition: none; } /* beats the hover/focus rules while held */
  .bubble strong { display: block; font-size: 14px; margin-bottom: 2px; }
  .bubble strong.error { color: var(--color-danger, #c62828); }
  .stats { margin-top: 8px; padding-top: 7px; border-top: 1px solid var(--separator-color, #0001); color: var(--text-color-muted, #607d8b); font-size: 12px; }
  .stats span { display: block; }
  .stats:empty { display: none; }
  button { all: unset; display: block; pointer-events: auto; position: relative; cursor: grab; touch-action: none; width: 88px; height: 88px; border-radius: 50%; -webkit-tap-highlight-color: transparent; }
  .dragging button { cursor: grabbing; }
  button:focus-visible { outline: 3px solid var(--focus-ring-color, var(--c-primary, #5c6bc0)); outline-offset: 2px; }
  svg { width: 100%; height: 100%; overflow: visible; pointer-events: none; } /* the button is the only click target, even where drawings spill out */
  .pop { transform-origin: 100px 180px; animation: pop .5s cubic-bezier(.3, 1.6, .5, 1); }
  button:hover .pop { transform: scale(1.05); transition: transform .2s; }
  .body { fill: #fffaf0; }
  .band { fill: color-mix(in srgb, var(--c-primary, #f06292) 35%, #fff); }
  .outline { fill: none; stroke: #37474f; stroke-width: 5; stroke-linejoin: round; }
  .ink { fill: none; stroke: #263238; stroke-width: 6; stroke-linecap: round; stroke-linejoin: round; }
  .eye { fill: #263238; }
  .shine { fill: #fff; }
  .cheek { fill: #f48fb1; opacity: .6; }
  .drool { fill: #81d4fa; }
  .sparkle { fill: #ffca28; }
  .steam { fill: none; stroke: #e57373; stroke-width: 5; stroke-linecap: round; }
  .cloud { fill: #b0bec5; }
  .rain { stroke: #64b5f6; stroke-width: 5; stroke-linecap: round; }
  .shadow { fill: #000; opacity: .16; }
  .hmph { display: none; fill: var(--text-color, #263238); font: italic 700 22px var(--font-primary-stack, system-ui, sans-serif); opacity: .7; }
  .wobble { transform-origin: 100px 180px; animation: bob 2.4s ease-in-out infinite; }
  .blink { transform-box: fill-box; transform-origin: center; animation: blink 4.5s infinite; }
  .mood { display: none; }
  .hungry .m-hungry, .content .m-content, .overjoyed .m-overjoyed, .grumpy .m-grumpy, .sulking .m-sulking, .sulking .hmph { display: inline; }
  .overjoyed .wobble { animation: bounce .7s ease-in-out infinite; }
  .grumpy .wobble { animation: huff 1.6s ease-in-out infinite; }
  .sulking .wobble { animation: slump 3s ease-in-out infinite; }
  .sulking .hmph { animation: hmph 3s ease-in-out infinite; }
  .munch .wobble { animation: munch .18s ease-in-out 6; }
  .squish .wobble { animation: squish .45s ease-out; }
  .float { position: absolute; left: 50%; top: -4px; pointer-events: none; font: 700 18px var(--font-primary-stack, system-ui, sans-serif); animation: float 1.2s ease-out forwards; }
  .heart { color: #e91e63; font-size: 22px; }
  .plus { color: #2e7d32; left: -6px; top: 24px; }
  @keyframes pop { from { transform: scale(0); } }
  @keyframes bob { 50% { transform: scale(1.04, .96); } }
  @keyframes bounce { 50% { transform: translateY(-18px) scale(.95, 1.06); } }
  @keyframes huff { 50% { transform: scale(1.06, .94); } }
  @keyframes slump { 50% { transform: scale(1.03, .97); } }
  @keyframes hmph { 0%, 100% { opacity: 0; transform: translateY(6px); } 15%, 80% { opacity: .75; transform: none; } }
  @keyframes munch { 50% { transform: scale(1.1, .88); } }
  @keyframes squish { 30% { transform: scale(1.2, .78); } 60% { transform: scale(.94, 1.06); } }
  @keyframes blink { 0%, 94%, 100% { transform: none; } 97% { transform: scaleY(.1); } }
  @keyframes float { from { transform: translate(-50%, 0); opacity: 1; } to { transform: translate(-50%, -56px); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .pop, .wobble, .blink, .hmph { animation: none !important; } .float { display: none; } button:hover .pop { transform: none; } .bubble { transition: none; } }
`;

/** A rice-cake body standing on y=180, `halfWidth` wide each side and `height` tall: tall when happy, melted when sulking. */
function cake(halfWidth, height) {
  const l = 100 - halfWidth, r = 100 + halfWidth, top = 180 - height, k = halfWidth * 0.55;
  const outline = `M${l} 168C${l} ${top + height * 0.15} ${100 - k} ${top} 100 ${top}S${r} ${top + height * 0.15} ${r} 168Q${r} 180 ${r - 12} 180H${l + 12}Q${l} 180 ${l} 168Z`;
  const band = `M${l} 162Q100 176 ${r} 162V168Q${r} 180 ${r - 12} 180H${l + 12}Q${l} 180 ${l} 168Z`;
  return `<path class="body" d="${outline}"/><path class="band" d="${band}"/><path class="outline" d="${outline}"/>`;
}
/** Two round eyes at height y, with a shine, that blink together. */
const eyes = (y, r) => `<g class="blink"><circle class="eye" cx="80" cy="${y}" r="${r}"/><circle class="eye" cx="120" cy="${y}" r="${r}"/>`
  + `<circle class="shine" cx="${82 - r / 3}" cy="${y - r / 3}" r="2.2"/><circle class="shine" cx="${122 - r / 3}" cy="${y - r / 3}" r="2.2"/></g>`;
const cheeks = y => `<ellipse class="cheek" cx="62" cy="${y}" rx="10" ry="6"/><ellipse class="cheek" cx="138" cy="${y}" rx="10" ry="6"/>`;
const sparkle = (x, y, s) => `<path class="sparkle" d="M${x} ${y - s}L${x + s / 3} ${y - s / 3} ${x + s} ${y} ${x + s / 3} ${y + s / 3} ${x} ${y + s} ${x - s / 3} ${y + s / 3} ${x - s} ${y} ${x - s / 3} ${y - s / 3}Z"/>`;
const MOCHI_SVG = `
  <svg viewBox="0 0 200 200" aria-hidden="true">
    <ellipse class="shadow" cx="100" cy="183" rx="86" ry="7"/>
    <g class="pop"><g class="wobble">
      <g class="mood m-hungry">${cake(68, 100)}${cheeks(138)}${eyes(122, 7)}<ellipse class="eye" cx="100" cy="144" rx="7" ry="9"/><path class="drool" d="M111 147q6 11 0 16q-6-5 0-16Z"/></g>
      <g class="mood m-content">${cake(70, 96)}${cheeks(138)}<path class="ink" d="M70 126q10-10 20 0M110 126q10-10 20 0M92 140q8 7 16 0"/></g>
      <g class="mood m-overjoyed">${cake(62, 122)}${cheeks(124)}<path class="ink" d="M68 112q12-14 24 0M108 112q12-14 24 0"/><path class="eye" d="M86 124h28q0 20-14 20t-14-20Z"/><path fill="#f06292" d="M92 138q8-6 16 0q-3 6-8 6t-8-6Z"/>${sparkle(38, 70, 12)}${sparkle(164, 86, 9)}</g>
      <g class="mood m-grumpy">${cake(76, 78)}<path class="ink" d="M70 128l18 7M130 128l-18 7"/>${eyes(144, 5)}<path class="ink" d="M92 160h16"/><path class="steam" d="M140 92q6-10 12 0t12 0"/></g>
      <g class="mood m-sulking">${cake(84, 52)}<path class="ink" d="M72 158h14M114 158h14M94 170q6-5 12 0"/><path class="cloud" d="M64 92q-14 0-14-12t14-12q4-16 22-14q10-12 28-4q18-4 22 12q14 2 14 16t-14 14Z"/><path class="rain" d="M78 106v10M100 108v12M122 106v10"/></g>
    </g></g>
    <text class="hmph" x="-52" y="150">hmph</text>
  </svg>`;

/** Builds the floating Mochi in its own shadow root and returns the parts render() updates. */
function createOverlay() {
  const host = document.createElement('ridonculous-desk-pet');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${STYLE}</style>
    <div class="wrap">
      <div class="bubble" role="status"><strong id="mood">Mochi is waking up…</strong><span id="line"></span><div class="stats" id="stats"></div></div>
      <button id="pet" class="pet hungry" aria-label="Pet Mochi">${MOCHI_SVG}</button>
    </div>`;
  document.body.append(host);
  const $ = id => root.getElementById(id);
  return { host, wrap: root.querySelector('.wrap'), pet: $('pet'), bubble: root.querySelector('.bubble'), mood: $('mood'), line: $('line'), stats: $('stats') };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** Two short lines for the bubble footer: today's counts, then when Mochi last ate. */
function statsLines(s) {
  const last = s.daysSinceFed === null ? 'Never fed yet'
    : s.daysSinceFed === 0 ? 'Last snack today' : `Last snack ${plural(s.daysSinceFed, 'day')} ago`;
  return [`${plural(s.fedToday, 'snack')} today · ${s.overdue} overdue`, last];
}

// The host can load plugin.js again (seen when installing right after startup) without calling onUnload,
// so a new copy shuts down the previous one instead of stacking a second Mochi on the page.
const INSTANCE_KEY = '__ridonculousDeskPet';
window[INSTANCE_KEY]?.dispose();
const ui = createOverlay();
let shown = null;
let munchTimer = null;
let bubbleTimer = null;

/** Opens the speech bubble briefly, so a reaction is visible without hovering. */
function say() {
  ui.bubble.classList.add('open');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => ui.bubble.classList.remove('open'), BUBBLE_MS);
}

function render(state) {
  if (JSON.stringify(state) === JSON.stringify(shown)) return; // dataChanged fires every second while tracking
  const ate = shown && state.fedToday > shown.fedToday;
  const moodChanged = shown && state.mood !== shown.mood;
  const fedBefore = shown?.fedToday ?? 0;
  shown = state;
  ui.pet.setAttribute('class', `pet ${state.mood}${ate ? ' munch' : ''}`);
  if (ate) {
    clearTimeout(munchTimer);
    munchTimer = setTimeout(() => { ui.pet.classList.remove('munch'); if (shown) ui.mood.textContent = MOODS[shown.mood].title; }, 1200);
  }
  ui.mood.textContent = ate ? 'Nom nom!' : MOODS[state.mood].title;
  ui.mood.classList.remove('error');
  ui.line.textContent = MOODS[state.mood].line(state);
  ui.stats.replaceChildren(...statsLines(state).map(text => Object.assign(document.createElement('span'), { textContent: text })));
  if (ate) floatUp('plus', `+${state.fedToday - fedBefore}`);
  if (ate || moodChanged) say();
}

/** A little floating "+1" or heart above Mochi that removes itself. */
function floatUp(kind, text) {
  const el = Object.assign(document.createElement('span'), { className: `float ${kind}`, textContent: text });
  el.setAttribute('aria-hidden', 'true');
  ui.pet.append(el);
  setTimeout(() => el.remove(), 1300);
}

function petMochi() {
  ui.pet.classList.remove('squish'); void ui.pet.offsetWidth; ui.pet.classList.add('squish');
  floatUp('heart', shown?.mood === 'sulking' ? '💔' : '♥');
  if (shown) ui.mood.textContent = MOODS[shown.mood].title;
  say();
}
let dragged = false; // set by a drag so the click that ends it doesn't also pet Mochi
ui.pet.addEventListener('click', () => { if (dragged) dragged = false; else petMochi(); });
// A finished squish would otherwise keep overriding the mood's idle animation.
ui.pet.addEventListener('animationend', event => { if (event.animationName === 'squish') ui.pet.classList.remove('squish'); });

// --- Dragging Mochi around the page ---
/** Puts Mochi's top-left corner at (left, top), kept fully on screen, and turns the bubble towards the open side. */
function placeAt(left, top) {
  const size = ui.pet.offsetWidth;
  const keep = (value, room) => Math.max(0, Math.min(value, room - size));
  Object.assign(ui.host.style, { left: `${keep(left, innerWidth)}px`, top: `${keep(top, innerHeight)}px`, right: 'auto', bottom: 'auto' });
  orientBubble();
}
/** Opens the bubble below or to the right of Mochi when there isn't room above or to the left. */
function orientBubble() {
  const box = ui.pet.getBoundingClientRect();
  ui.wrap.classList.toggle('below', box.top < 170);
  ui.wrap.classList.toggle('left', box.right < 240);
}
function savedPosition() {
  try {
    const saved = JSON.parse(localStorage.getItem(POSITION_KEY) || 'null');
    return Number.isFinite(saved?.left) && Number.isFinite(saved?.top) ? saved : null;
  } catch (error) { console.warn('Desk Pet: ignoring a broken saved position', error); return null; }
}
function savePosition() {
  const { left, top } = ui.pet.getBoundingClientRect();
  spot = { left, top };
  try { localStorage.setItem(POSITION_KEY, JSON.stringify({ left, top })); } catch (error) { console.warn('Desk Pet: could not remember the position', error); }
}
let spot = null; // last placed spot, kept in memory in case storage is unavailable
let dragTimer = null;
let grab = null; // pointer offset inside Mochi while the button is held
ui.pet.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  const box = ui.pet.getBoundingClientRect();
  grab = { id: event.pointerId, dx: event.clientX - box.left, dy: event.clientY - box.top, x: event.clientX, y: event.clientY, moving: false };
  dragged = false;
  ui.pet.setPointerCapture(event.pointerId);
});
ui.pet.addEventListener('pointermove', event => {
  if (!grab || event.pointerId !== grab.id) return;
  if (!event.buttons) { endDrag(); return; } // the press ended somewhere we didn't hear about
  if (!grab.moving && Math.hypot(event.clientX - grab.x, event.clientY - grab.y) < DRAG_START_PX) return;
  grab.moving = true;
  ui.wrap.classList.add('dragging');
  placeAt(event.clientX - grab.dx, event.clientY - grab.dy);
});
function endDrag(event) {
  if (grab?.moving) {
    savePosition();
    // Swallow the click a browser may fire right after this pointerup (a short touch drag can still count as a tap);
    // the flag expires quickly so a later keyboard pet isn't lost. Cancelled drags send no click at all.
    if (event?.type === 'pointerup') { dragged = true; clearTimeout(dragTimer); dragTimer = setTimeout(() => { dragged = false; }, DRAG_CLICK_MS); }
  }
  grab = null;
  ui.wrap.classList.remove('dragging');
}
ui.pet.addEventListener('pointerup', endDrag);
ui.pet.addEventListener('pointercancel', endDrag);
ui.pet.addEventListener('lostpointercapture', endDrag);
// A saved spot can fall off screen when the window shrinks; pull Mochi back in.
// A hidden Mochi has no size to measure, so they are re-placed when shown again instead.
const keepOnScreen = () => { if (ui.host.hidden || grab?.moving) return; const at = savedPosition() ?? spot; if (at) placeAt(at.left, at.top); else orientBubble(); };
window.addEventListener('resize', keepOnScreen);

function setHidden(hidden) {
  ui.host.hidden = hidden;
  keepOnScreen();
  try { localStorage.setItem(HIDDEN_KEY, hidden ? '1' : ''); } catch (error) { console.warn('Desk Pet: could not remember hide/show', error); }
}
function wasHidden() {
  try { return localStorage.getItem(HIDDEN_KEY) === '1'; } catch (error) { console.warn('Desk Pet: could not read hide/show', error); return false; }
}
setHidden(wasHidden());
// The stale copy's header button stays in the toolbar too, so every button toggles whichever Mochi is current.
PluginAPI.registerHeaderButton({ label: 'Show or hide Mochi', icon: 'pets', onClick: () => window[INSTANCE_KEY]?.toggle() });

// --- Reading tasks ---
let archived = [];
let activeDoneIds = null; // null until the archive has been read once
let running = false;
let pending = false;
let retryTimer = null;
let unloaded = false;

async function refresh() {
  const [tasks, day] = await Promise.all([PluginAPI.getTasks(), PluginAPI.getDayContext()]);
  const doneIds = new Set(tasks.filter(t => t.isDone).map(t => t.id));
  // Finish Day, deletion or sync removes done tasks from the active list; only then re-read the (large) archive.
  if (!activeDoneIds || [...activeDoneIds].some(id => !doneIds.has(id))) archived = await PluginAPI.getArchivedTasks();
  activeDoneIds = doneIds;
  const activeIds = new Set(tasks.map(t => t.id)); // a restored task is counted once
  render(petState({ tasks, archived: archived.filter(t => !activeIds.has(t.id)), todayStr: day.todayStr, now: Date.now(), offsetMs: day.startOfNextDayDiffMs }));
}

function showError(error) {
  ui.mood.textContent = 'Mochi is confused';
  ui.mood.classList.add('error');
  ui.line.textContent = `Couldn't read your tasks: ${error?.message || error}`;
  shown = null; // force a full redraw once reads work again
}

/** Runs one refresh at a time; events arriving meanwhile collapse into a single follow-up. */
async function queueRefresh() {
  if (unloaded) return;
  if (running) { pending = true; return; }
  running = true;
  clearTimeout(retryTimer);
  try {
    await refresh();
  } catch (error) {
    showError(error);
    retryTimer = setTimeout(queueRefresh, RETRY_MS);
  } finally {
    running = false;
    if (pending) { pending = false; queueRefresh(); }
  }
}

PluginAPI.registerHook(PluginAPI.Hooks.DATA_CHANGED, queueRefresh);
PluginAPI.registerHook(PluginAPI.Hooks.DAY_CHANGE, queueRefresh);
// A due time can pass while nothing else changes.
const overdueCheck = setInterval(queueRefresh, OVERDUE_CHECK_MS);
queueRefresh();

function dispose() {
  unloaded = true;
  clearInterval(overdueCheck);
  [retryTimer, munchTimer, bubbleTimer, dragTimer].forEach(clearTimeout);
  window.removeEventListener('resize', keepOnScreen);
  ui.host.remove();
  if (window[INSTANCE_KEY]?.dispose === dispose) delete window[INSTANCE_KEY];
}
window[INSTANCE_KEY] = { dispose, toggle: () => setHidden(!ui.host.hidden) };
PluginAPI.onUnload?.(dispose);
