# Desk Pet

**Mochi floats in the corner of every Super Productivity page. Feed them by finishing things.**

Mochi is a little rice cake who starts in the bottom-right corner of the app, on every page (drag them wherever you like), and reacts to your real task data:

| Mochi is… | When |
| --- | --- |
| **hungry** | nothing finished yet today |
| **content** | 1–2 tasks finished today |
| **overjoyed** | 3+ tasks finished today (bouncing) |
| **grumpy** | 3+ open (not archived) tasks are past their due day or time |
| **sulking** | nothing finished for 3+ days: Mochi melts into a puddle under a rain cloud |

Sulking wins over grumpy, and grumpy wins over the snack count. Mochi pops in when the app starts and squishes gently; their shape shows the mood, tall and sparkly when overjoyed, squat and steaming when grumpy, melted flat when sulking. Finishing a task makes them munch, say "Nom nom!" and show a little "+1". A sulking Mochi mutters "hmph". Mochi's dusted base takes on the theme's main colour, and the speech bubble follows the app's light, dark or custom theme. Tasks marked "Won't do" don't count. Hover Mochi to see their mood and today's stats in a speech bubble; it also pops up by itself when Mochi eats or their mood changes. Click Mochi, or focus them and press Enter or Space, to pet them; a sulking Mochi only gives you a broken heart. Drag Mochi anywhere on the page; the spot is remembered, Mochi is pulled back on screen if the window gets smaller, and the speech bubble opens towards whichever side has room. The paw button in the app header hides or shows Mochi, and the choice is remembered. Mochi never dies: the mood is worked out fresh from your tasks every time, so you can neglect them for a week and come back to make the video.

The plugin **only reads** tasks (active and archived) and the current day. It never changes your tasks and makes no network requests; the only things it stores are the hide/show choice and where you dragged Mochi, in this browser's local storage.

**Playground hack:** Super Productivity has no official way for a plugin to put something on every page, so Desk Pet adds its own element to the app page (in an isolated shadow root, so styles don't leak either way) and removes it when the plugin is disabled. A future app update could break or hide it. Mochi sits above the page but below dialogs; only Mochi itself catches clicks, so the bubble never blocks the app, but Mochi can cover whatever is underneath them (drag them elsewhere or hide them with the paw button). Days follow Super Productivity's "start of next day" setting, and tasks archived by Finish Day still count as today's snacks.

## Try it

Open [demo.html](demo.html) directly in a browser for the **standalone demo**: it runs the real plugin code with pretend tasks. Pick a scenario (hungry, content, overjoyed, grumpy, ignored for a week) and press "Finish a demo task" to feed Mochi.

To create an installable ZIP, run from this plugin directory:

```sh
python3 -m zipfile -c desk-pet.zip manifest.json plugin.js icon.svg
```

In Super Productivity, open **Settings → Plugins → Choose Plugin File**, select the ZIP, confirm, and enable the plugin. Mochi appears in the bottom-right corner right away. No build step: the whole plugin is `plugin.js`.

For local development, use the repository's [real-app launcher](../../README.md#test-plugins-in-the-real-app):

```sh
npm run dev -- desk-pet /path/to/super-productivity
```

Tests (from the repository root after `npm ci`):

```sh
node plugins/desk-pet/tests/browser.cjs                            # fake API: every mood, day offset, archive, errors, hide/unload, demo
node plugins/desk-pet/tests/live.cjs /path/to/super-productivity   # real app: install, Mochi on every page, real completion, light/dark, hide, disable
```

**Tested with the local Super Productivity 20.0.0 web build**, which the manifest requires. Checked against the [official plugin guide](https://github.com/super-productivity/super-productivity/blob/master/docs/plugin-development.md) and [API types](https://github.com/super-productivity/super-productivity/blob/master/packages/plugin-api/src/types.ts).

## What was verified

- Every mood, the sulk/grumpy thresholds, overdue by day and by time, the start-of-next-day offset, Finish Day archiving (also when a task is finished in the same moment), restored tasks counted once, petting, error display and recovery, no pile-up of retries during an outage, the hide button and its remembered choice, cleanup on unload, a second load replacing the first copy, clicks passing through the empty area around Mochi, and dragging (a drag is not a pet, the spot is remembered, kept on screen when the window shrinks, a broken saved spot falls back to the corner, the bubble flips near the top-left edge and hides while held, a cancelled drag doesn't block the next keyboard pet, a window shrunk while Mochi is hidden): browser test with a fake API.
- Real app 20.0.0: installs from the ZIP, Mochi appears on the Today page and stays on Settings, starts hungry, a real task completion (ticked in the normal task list) feeds Mochi (munch, "Nom nom!", "1 snack today · 0 overdue"), light and dark theme screenshots of the rice-cake design checked by eye (not asserted), dragging Mochi moves them and the spot survives a reload, the header button hides and shows Mochi, disabling the plugin removes them.
- Standalone demo: all five mood shapes checked by eye in light and dark (not asserted); the browser test asserts exactly one body shape is drawn per mood.
- Not verified: dragging by touch or pen, sulking and grumpy with real multi-day data in the app, native desktop and mobile apps (Mochi may cover mobile controls), Safari, screen readers, custom themes.

## Known limitations

- English only. Mochi's name is fixed.
- Thresholds are fixed: 3 snacks for overjoyed, 3 overdue for grumpy, 3 days for sulking.
- Every finished subtask counts as a snack, so splitting tasks feeds Mochi faster. Consider it a feature.
- When Desk Pet is installed right after the app starts, Super Productivity 20.0.0 can load it a second time without unloading the first copy (seen in the live test; after reloading the app it loads once). Desk Pet replaces the old copy, so there's still one Mochi, but the header can show **two paw buttons** until the next reload. Both work.
- Mochi can only be dragged with a pointer; there's no keyboard way to move them yet. Dragging was tested with a mouse only, not touch or pen.
- The old iframe version sometimes got no answer to its first calls from the app. Running inside the app page avoids that message channel and it wasn't seen in the new live runs. Reads here have no timeout, though: if one ever hung, Mochi would stop updating until the app is reloaded.
- Tasks finished on another device and archived there before syncing only feed Mochi after the app is reloaded.
- Mochi re-reads tasks once a minute so a due time passing shows up; between those checks, a newly overdue task can take up to a minute to make them grumpy.

Video: not recorded yet. Suggested opening: "I ignored my to-do list for a week. My pet noticed."
