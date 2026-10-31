# Ridonculous

A playground for slightly ridiculous [Super Productivity](https://super-productivity.com/) plugins.

What if a task manager did something unexpected? This is where we try it out. Some experiments might turn into useful tools. Others might make a fun YouTube video. Either outcome counts.

The goal is to play with ideas, share how they work, and give other people something to build on. Expect rough edges, unfinished experiments, and occasional questionable ideas taken a little too far.

## What to expect

- Experimental Super Productivity plugins, built around one interesting idea at a time.
- Small, understandable implementations you can explore and remix.
- Context for each experiment: what it does, how to try it, and what still needs work.
- Links to videos when an experiment gets its moment on screen.

These are playground projects, with no promise of ongoing maintenance or compatibility with every Super Productivity release. Any known limitations should be documented alongside the plugin. Try experiments with disposable tasks before trusting them with your daily workflow.

## Experiments

**[Daily Quest](plugins/daily-quest/)** — an adventure map from a buff to your final boss task to a recovery break, with the boss's subtasks as steps along the trail, an optional side-quest stash branching off it, and a searchable task picker, using Super Productivity’s standard UI kit. Includes a standalone demo and a local live-app test setup. Video coming when it exists.

**[Stadium Mode](plugins/stadium-mode/)**: a roaring crowd and a booming stadium announcer for your task list. Kick off when you start a task, "GOAL!" when you finish one, hat tricks for quick streaks, "ooooh" for rescheduling, red cards for deletions, and a final whistle with the day's score at Finish Day. All sound is synthesized in the app, and the plugin ships no audio files. An optional neural announcer voice (Kokoro, through a stadium PA) downloads about 110 MB after you confirm; otherwise it makes no network requests. Video coming when it exists.

## Test plugins in the real app

The launcher serves a local Super Productivity web build, opens a dedicated Chromium profile, installs the selected plugin ZIP, and opens its view (background-only plugins such as Stadium Mode have no view; they run once enabled). It does not modify the Super Productivity checkout. This is the real app and plugin bridge, not the standalone demo.

One-time setup in this repository (Node.js 22+, Python 3):

```sh
npm ci
npx playwright install chromium
```

Use an existing Super Productivity checkout with its frontend built. If needed, prepare that checkout separately using its required Node version (`.nvmrc`):

```sh
cd /path/to/super-productivity
npm ci
npm run buildFrontend:e2e
```

Then, from this repository:

```sh
npm run dev -- daily-quest /path/to/super-productivity
```

The app opens at `http://127.0.0.1:4173`. Add test tasks in Today, then return to Daily Quest using the plugin menu. Edit the plugin and **press Enter in the terminal** to repack, reinstall, and reopen it. This reloads the plugin view; it is not hot module replacement. Close the browser or press Ctrl+C to stop.

You can set `SP_DIR=/path/to/super-productivity` instead of passing the checkout each time. Without either, the launcher looks for `../super-productivity` relative to this repository. It prefers `.tmp/angular-dist/browser`, falling back to `dist/browser`; rebuild the app when you need newer host code. Only a built frontend is required at launch time.

Test data persists in the ignored `.local/browser-profile/`. Keep this profile disconnected from sync. It is separate from your everyday browser and desktop app. To start fresh, close the launcher and delete that directory. Whenever the Today list is empty at launch, the launcher fills it with the shared demo tasks from `tools/demo-tasks.json`, so every video starts from the same tasks. The titles use Super Productivity's short syntax: `1h` sets an estimate and `20m/1h` sets time spent and an estimate. Installation consent is automated only for the local plugin you selected in this test profile.

Run a quick headless check with a temporary profile:

```sh
npm run test:live -- daily-quest /path/to/super-productivity
```

This verifies real app startup, ZIP installation, the task API, and reinstallation, then closes the app and removes the temporary profile. A screenshot remains at `.local/live-smoke.png`. It does not replace each plugin's behavioral tests.

The launcher currently supports plugins with a self-contained `index.html` view. It packages `manifest.json`, `index.html`, and optional `plugin.js`, `icon.svg`, and `i18n/`. Build compiled plugins before reloading. Runtime code and assets must follow the host's self-contained iframe contract. Port 4173 must be free; a busy port fails rather than attaching to another app.

## Start an experiment

Give each plugin its own folder under `plugins/`, for example `plugins/task-confetti/`. Keep its source, assets, and any build configuration together so it can be understood on its own.

Include a short README covering:

- **The idea:** what you're trying and why it might be fun.
- **Try it:** reproducible build and installation steps, plus the Super Productivity version you tested.
- **Rough edges:** what works, what doesn't, and any effects on task data or external services.
- **Watch it:** a video link, if available.

Start with the smallest working version of the idea. Add tooling when the experiment actually needs it. A tiny plugin doesn't need to become a framework.

## Join in

Ideas, experiments, and fixes are welcome. For a new idea, describe the moment you'd want to show in a video or the interaction you'd want someone else to try. For an existing experiment, include enough detail to reproduce the problem or understand the change.

Polish is optional. Being clear about what your experiment does is not.
