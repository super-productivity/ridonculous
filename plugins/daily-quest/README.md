# Daily Quest

A little courage for today. An adventure map with a three-stop path (something that helps you begin, the task you've been avoiding, and a proper break) plus an optional side path for things that can wait. The boss's subtasks become steps along the trail. Inspired by the desktop and mobile mockups supplied for this experiment.

## Try it

This plugin is a self-contained `index.html`, `manifest.json` and `icon.svg`. No build or runtime dependencies, remote assets, or external services are needed.

From this directory, create an installable ZIP with the three files at the root:

```sh
python3 -m zipfile -c daily-quest.zip manifest.json index.html icon.svg
```

In Super Productivity, open **Settings → Plugins → Choose Plugin File**, select `daily-quest.zip`, and enable the plugin. Open **Daily Quest** from the app's plugin menu. The surrounding navigation belongs to Super Productivity; the plugin supplies the map and its stops, and uses the built-in Super Productivity UI kit for controls and theme colors.

Targets **Super Productivity 19.2.0+**. API calls and the task-start action were checked against the local 19.2.0 source and the [official plugin guide](https://github.com/super-productivity/super-productivity/blob/master/docs/plugin-development.md). Verified against the local 19.2.0 web build: ZIP installation, plugin bridge, reinstallation, and map rendering with the real UI kit (light theme, no tasks). Real task selection, timer start and saved attempts were verified live for v0.1. The v0.2 map and search UI and the v0.3 boss steps, side-quest list and **Defeat the boss** were checked once with real tasks against the local 19.2.0 web build (parent task as boss, subtasks as waypoints, **Take the next step** starting the first subtask's timer, the map following the host's current-task event, **Defeat the boss** marking the real task done, starting a side quest). That script was a one-off and is not in this repository. What can be reproduced from here is the mocked browser tests below plus the live smoke test, which covers installation and the plugin bridge only.

For a standalone functional preview, open `index.html` in a browser. The standard UI kit is injected by Super Productivity, so use the live app to preview the actual styling. **Demo mode** uses sample tasks and session storage, never your real tasks. Demo state survives reloads in the same tab, but is not a permanent save.

## How it works

- **The map:** a numbered path, 1 Buff → 2 Final boss → 3 Recovery, and a dotted branch to the unnumbered **Side quests** stop. Everything starts empty: what goes on the map is yours to decide, so nothing is pre-chosen. Each stop shows its state: dashed (nothing chosen), outlined (chosen), filled with a pulse (task running), green with a check (done today). Click a stop to open its card over the map, beside, below or above the stop, wherever it hides the fewest other stops and steps; never on the stop itself. Close it with ×, Escape, or a click on the map. Progress is shown under the title.
- **Final boss:** choose an unfinished task, then **Face the boss** to start its Super Productivity timer. Each successful start records an attempt for that task, across days. Repeated clicks are disabled while this view knows the task is running.
- **Steps to the boss:** if the boss has subtasks, they appear as small waypoints on the trail to it (up to six, around the next open step), and the trail fills in as steps are done. The boss card lists every step. **Take the next step** starts the first open one, or start any step directly. Steps count as attempts on the boss. Once every step is done, **Defeat the boss** marks the boss task itself done in Super Productivity (it does not do this automatically by default), with a short victory burst on the map.
- **Side quests:** an optional stash for tasks that can wait. Choosing a boss moves its subtasks out of the stash, since they become its steps. They branch off the path, are never required, and the badge shows how many are still open. Add as many as you like, start one from its card (this switches the active timer but counts no boss attempt), or remove it with ×. Removing only takes it off the map; the task stays in Super Productivity.
- **Task search:** the task picker is a searchable list. Type to filter (every word must match, case-insensitive, matches highlighted), use ↑/↓/Home/End to move, Enter to choose, or click. No task is highlighted until you type or use the arrow keys. Today's and overdue tasks (by due day, as in the app's Today list) and the current choice are listed first, with hints such as *Today*, *Overdue*, *Subtask of …*, estimate, and *Running now*. The boss may be a task with subtasks; side quests must be actionable tasks, so parents, the boss and its steps are excluded.
- **Buff / Recovery:** choose from four suggested activities for each, or write your own (up to 100 characters). Reminders are checked off once per local calendar day. Changing an activity clears its check-in so the new one can be completed. These are not Super Productivity tasks and do not pause or change the active timer. Stop tracking in the app before taking a break if you want that time excluded.
- **A new day:** a boss or side quest finished on an earlier day leaves the map, so the stop is free again; unfinished ones carry over. Buff and Recovery check-ins reset each day.
- Completing a task in Super Productivity shows it as done on the map. Deleted or archived tasks return the stop to empty. The map reloads tasks whenever Super Productivity reports a task change; archiving (for example at Finish Day) reports none, so an archived quest stays until the next task change or until you reopen the view.

Choices, reminders, check-ins, and attempt counts are saved using the plugin's synced-data API. The plugin reads tasks, listens for current-task changes and dispatches the allowed `[Task] SetCurrentTask` action. Its only change to task data is **Defeat the boss**, which calls `updateTask` to mark the chosen boss done. The manifest lists `updateTask` to declare this, though Super Productivity 19.2.0 does not enforce that permission. It never creates or deletes tasks.

## Validation

Node.js and Playwright are needed only for tests:

```sh
npm install
npx playwright install chromium
npm test
```

The browser checks cover the empty start, the v0.2 → v0.3 side-quest migration, boss subtasks as waypoints and steps (trail progress, step starts, **Defeat the boss**), the side-quest list (add, start without an attempt, failed and successful removal), next-day clearing of finished quests, the victory moment, map stops and on-demand cards, task search (filtering, highlighting, keyboard choice, empty results), task filtering, task starts, duplicate prevention, attempt counts, custom ritual editing, safe rendering of user text, completion/deletion, API failures, demo persistence, and responsive layouts at 15 sizes (240–1440px) with long task titles: no horizontal overflow, stops stay inside the map and apart, and every picker opens and fits. Desktop and mobile screenshots are written to the system temp directory (`daily-quest-desktop.png`, `daily-quest-mobile.png`).

For a real host session, use the [root live-testing setup](../../README.md#test-plugins-in-the-real-app):

```sh
# From the repository root
npm run dev -- daily-quest /path/to/super-productivity
npm run test:live -- daily-quest /path/to/super-productivity
```

Cross-device sync and native desktop/mobile runtimes still need manual verification.

## Rough edges

- English only. The map and stops tint themselves from the host theme colors, so light and dark themes both work. Wide plugin areas (560px and up) use a landscape map; narrower ones switch to a portrait route. On narrow screens the card may hang below the map and cover other stops while open. Stop labels on the map show one line; the card shows up to three lines and the picker shows full titles.
- v0.2 kept a single side quest; it is moved into the v0.3 side-quest list on load.
- Earlier v0.1 saves stored the default buff and recovery ("Coffee + music", "Walk outside") as if chosen. Saves from before v0.2 have those two exact values cleared on load, even if you picked them yourself back then; choose them again if so.
- No automatic daily task picking, XP, streaks, or punishment. The only completion button is **Defeat the boss**, shown once every step is done. Showing up is enough.
- Attempt counts measure launch requests through this plugin, not time spent or starts elsewhere in the app. The API provides current-task change events but no initial active-task snapshot. After reopening the view, starting an already-running task can count another attempt; subsequent task-change events keep the view up to date.
- Whole-state synced saves can overwrite each other if two devices edit the plugin simultaneously. Reopen the plugin to load remotely changed plugin settings.
- If the saved plugin data is ever corrupted, the map shows a load error and stays empty. Your tasks are not affected; removing and reinstalling the plugin deletes its saved data and starts fresh.
- If a timer starts but saving its attempt fails, the timer keeps running and a message explains the partial result.
- This is an experiment for videos and inspiration, with no compatibility claim for earlier app versions.

Video: not recorded yet.
