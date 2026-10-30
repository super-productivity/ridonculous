# Stadium Mode

What if your task list had a stadium crowd, a booming PA announcer and an overexcited commentator? Start a task and the referee blows, the announcer calls out "Ladies and gentlemen... now taking the field... *your task*!" (echoing off the stands), and the organ plays "Charge!". Finish one and the crowd erupts: "GOAL! Write the quarterly report! The crowd goes wild!". Reschedule something and the whole stadium goes "ooooh". Delete a task and it's a red card. A big screen over the app shows the matching animation.

## Try it

The plugin is a background `plugin.js` plus `manifest.json` and `icon.svg`. It has no view, no build step, no dependencies and no audio files. Every sound is synthesized with the Web Audio API, and the announcer and commentator use the browser's built-in speech synthesis (Web Speech API). Optional neural voices are downloaded on request (see below).

From this directory:

```sh
python3 -m zipfile -c stadium-mode.zip manifest.json plugin.js icon.svg
```

In Super Productivity, open **Settings → Plugins → Choose Plugin File**, select `stadium-mode.zip`, confirm, and enable it. Then just work: start, finish, reschedule or delete tasks. On first start, a welcome dialog asks you to pick **Mute**, **System voice** or **Michael (neural)**. Michael is preselected. To change it later, click the megaphone button in the header.

### Optional: neural voices

System voices sound like robots. Pick **Michael (neural)** in the megaphone dialog for neural voices instead: [Kokoro](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) with "Michael" as the stadium announcer and the British "George" as the TV commentator, run in WebAssembly by [kokoro-js](https://github.com/hexgrad/kokoro/tree/main/kokoro.js). Michael's lines (kick off, substitution, half time, full time) go through a synthesized stadium PA: horn-speaker EQ, soft clipping, compression, four echoes off the stands and an arena reverb. George's lines (goals, VAR, reschedules, transfers, red cards) stay dry, like a TV commentary mic. When a task kicks off, George already prepares its title for the goal call. The newest line is always generated first, ahead of the warm-up, prepared titles and lines that were cut off.

Nothing is downloaded until you pick Michael. The dialog says what will be downloaded, and closing it on first start keeps the system voice. Pick **System voice** to switch back.

Tested with **Super Productivity 19.3.1**. The manifest allows 19.2.0+, but older versions are untested. The hooks, `registerHeaderButton`, `showSnack` and `onUnload` usage were checked against the [official plugin guide](https://github.com/super-productivity/super-productivity/blob/master/docs/plugin-development.md), the plugin API types, and the hook dispatch code of a local 19.3.1 checkout. Sound starts after you've interacted with the app at least once. Task events always come from a click or key press, so in practice this doesn't get in the way.

## What happens when

| You do this | The stadium does this |
| --- | --- |
| Start a task | Whistle, announcer: "Ladies and gentlemen... now taking the field... *task*!", then "Charge!" on the organ |
| Switch from one task to another | Whistle, announcer: "Substitution... Coming off... *A*!... Coming on... *B*!" |
| Stop the timer | Whistle, announcer: "Ladies and gentlemen... it is half time." |
| Complete a task | Crowd cheer, "GOAL! *task*!" |
| Complete several within 90 seconds | Plus an air horn and "That is a double!", "HAT TRICK!", "5 in a row!" |
| Finish well under / far over the estimate | "And well ahead of schedule!" / "Deep into extra time, but it counts!" |
| Un-complete a task | Boos, "VAR check. The goal is disallowed!" |
| Move a task to another day or time | "Ooooh! *task*! Rescheduled! The fans are not happy." |
| Move a task to another project | "Shock transfer!" |
| Delete one or more tasks | Boos, "Red card!" / "Mass red cards! 3 tasks sent off!" |
| Finish Day | Final whistle, announcer: "...that is full time! 4 goals today!" (or a goalless draw), then the crowd cheers |

## Big screen

Six events also get a short animation over the app (about 3 seconds, drawn with HTML and CSS):

| Event | On screen |
| --- | --- |
| Start a task | Green banner: "Now taking the field", then the task title slides in |
| Switch tasks | LED substitution board: red ▼ old task, blinking green ▲ new task |
| Complete a task | "GOAL!" pops up with falling confetti; a combo adds a "Double!", "Hat trick!" or "5 in a row!" stamp |
| Un-complete a task | "VAR check" screen with a scan line, then "No goal" |
| Delete tasks | A red card rises from the bottom edge (with "×3" for bulk deletes) |
| Finish Day | Scoreboard: "Full time · 4 goals" |

The newest event replaces the current animation. Clicks go straight through to the app. Mute turns the animations off too. With the system setting "reduce motion", you get a still version without confetti.

Lines are picked at random from a small set per event. There are two voices:

- The **stadium announcer** (kick off, substitution, half time, full time) speaks slowly and deeply over a quiet crowd murmur. Their last word is repeated twice, quieter each time, as a fake echo off the stands. The organ or the cheer plays when they finish speaking. With the neural voices, the announcer is Michael through the stadium PA, with real echoes instead.
- The **TV commentator** (goals, VAR, reschedules, transfers, red cards) is fast and high-pitched. With the neural voices, the commentator is George, dry like a commentary mic.

## Data and privacy

The plugin only listens to task events. It never reads your task list and never changes task data. The big screen is one element the plugin adds to the app page and removes when the plugin is disabled. By default it makes no network requests.

**Network, neural voices only:** after you confirm the dialog, it downloads about 110 MB once and the browser caches it. The files are `kokoro-js@1.2.1` (2 MB) and the ONNX runtime (21 MB, `@huggingface/transformers@3.5.1`) from `cdn.jsdelivr.net`, plus the model (88 MB) and the two voices (`am_michael`, `bm_george`, about 0.5 MB each) from `huggingface.co`. Your task titles are not sent anywhere: speech is generated on your device in a Web Worker. The generated audio for the fixed phrases of both voices (no task titles, a few MB) is stored in this browser's Cache Storage under `ridonculous-stadium-mode-clips`. The code is loaded from a CDN at runtime and runs inside the app, pinned to these versions. Like the plugin itself, that downloaded code can access the app's data, so the dialog is your consent for it. Both voices read task titles aloud, truncated to 60 characters. With the system voice, whether the speech is generated on your device or by an online voice service depends on your browser or OS voice. Some Chrome voices are network-based, so mute the plugin around sensitive task titles if that matters to you. The mute setting is saved in this device's `localStorage` and isn't synced.

## Validation

```sh
npm test
```

No install is needed (Node.js 22+ built-in test runner). The tests load `plugin.js` the way Super Productivity does (`new Function` with `PluginAPI` in scope), with fake audio and speech. They fire every hook and check what is said and that audio starts. They cover combos and their reset, pace lines, kick off, substitution and half time, a completed running task counting as a goal rather than half time, undo, reschedule, transfer, single and bulk delete, the Finish Day score, mute (including that it persists and that goals still count while muted), cleanup on unload, the two voices and the echo, and that the crowd cue after an announcement plays when the line ends, but not when the line was cut off, after unload, or (immediately instead) without voices.

Verified once against a local Super Productivity 19.3.1 web build (headless Chromium, 2026-10-30) with a one-off Playwright script that isn't in this repository. It installed the ZIP, created tasks and used keyboard shortcuts and menus. The real hooks produced the expected commentary for: start, switch, pause, completing the running task (goal, no half time), a double combo, undo (VAR), reschedule to tomorrow via the context menu, delete, mute and unmute via the header button (since replaced by the mode dialog), and Finish Day ("2 goals today"). It was rerun the same day after adding the announcer voice, with a fake voice injected because headless Chromium has none: it confirmed the announcer lines, rate and pitch, and the echo for each event. Audio nodes started for each sound cue, and there were no page errors.

The live smoke test covers installation and reinstallation:

```sh
# From the repository root
npm run test:live -- stadium-mode /path/to/super-productivity
```

The neural voice was checked the same day in the 19.3.1 web build, with `cdn.jsdelivr.net` and `huggingface.co` served locally from the exact files at the pinned URLs. The dialog appeared, and the plugin requested only the files listed above. Announcer phrases played through the PA, and the app's main thread never stalled for more than 250 ms while the voice was generated. On that machine, the first kick off started speaking after about 3 s, and the task title came about 10 s after the event. A substitution 20 s after "ready" played without a pause: all fixed phrases and the outgoing title were cached, and the incoming title was ready before the line reached it. After speeding Michael up (Kokoro speed 1.25, 0.2 s pauses), phrases were about 15% shorter. The 12 fixed phrases were stored without any task title, and after a reload nothing was generated for the warm-up. A kick off right after a goal waits for the commentator (unit test only).

George was checked the same way after it was added: 34 fixed phrases (12 Michael, 22 George) were prepared one at a time in about 3.5 minutes after "ready" and all stored. At kick off, Michael announced the title and George prepared it in parallel. Completing the task then started George's goal call 0.3 s after the event, and undoing it started the VAR call at once, both with nothing left to generate and no system voice. The plugin downloaded only the two voice files listed above, with no page errors or main-thread stalls over 250 ms. The British voice was not listened to inside the app. The PA chain was only listened to in an offline render, not inside the app. Electron is untested for the neural voice: it needs Cache Storage and module workers from a `file://` page.

A substitution during the warm-up used to end in silence after "Coming on": the incoming title waited behind the warm-up, George's prepared title and the jobs of the cut-off kick off, and hadn't played 25 s later. Now the plugin keeps the job queue itself and hands the worker one phrase at a time, newest line first. In the same build, the incoming title was sent to the worker 5.3 s after the event (once the warm-up phrase in progress was done) and played at 9.7 s, a 2.7 s pause after "Coming on". After the warm-up, a substitution played all five phrases with no pause. Unit tests cover the order (new line, then cut-off lines, prepared titles and the warm-up) and that a goal call moves its prepared title up.

The big screen was checked in the same build (headless, 2026-10-30) with a one-off Playwright script: start, switch, goal, a 4-goal combo, undo, delete and Finish Day each showed the expected scene with the right text, from real key presses. Screenshots confirmed the layout, there was only one overlay, the point under it still hit the app (so clicks go through), and "reduce motion" gave the still version. There were no page errors. The unit tests cover each scene's text, that only the newest scene stays up, that a kick off right after a goal waits for the goal scene, that muting clears the screen, that it clears after 2.8 s, nothing while muted, titles shown as text rather than HTML, and removal on unload. The animations themselves were only seen as stills, not watched in motion.

The mode dialog was checked in the same build: the welcome dialog opens once after install (5 runs). Mute and System voice apply, and the dialog doesn't return after a reload.

**Not verified:** how it actually *sounds*, including whether the "..." pauses and the echo come across as a stadium PA with your system voice (espeak-ng may ignore the pauses). The headless runs prove the audio graph plays without errors, not that the crowd sounds like a crowd, so give it a listen. The desktop (Electron) and mobile apps are untested too. The Electron app uses the same renderer, but voice availability depends on the OS.

## Rough edges

- **Linux:** Chromium-based browsers and the Electron desktop app only offer speech voices when started with `--enable-speech-dispatcher` (plus an installed `speech-dispatcher`). Without it you get crowd and whistle but no commentator, and a one-time snack tells you so. The repository's live launcher passes the flag. For the desktop app, try `superproductivity --enable-speech-dispatcher` (not verified).
- English only. Both personas use your system's default speech voice with a different rate and pitch. On Linux the default espeak-ng voice sounds robotic. A nicer offline voice such as RHVoice (`sudo apt install rhvoice rhvoice-english speech-dispatcher-rhvoice`, then `DefaultModule rhvoice` in `~/.config/speech-dispatcher/speechd.conf`) should help (not verified).
- The echo is fake: browser speech can't be routed through Web Audio, so there's no real reverb or PA filter. Michael has the real thing.
- The neural voices are slow on the CPU, about 3× slower than real time on one thread. The page isn't cross-origin isolated, so the WebAssembly runtime can't use more. Once they are ready, they prepare the fixed phrases in the background (Michael's first, substitution first; all of them took about 3.5 minutes). These fixed phrases are kept in the browser's Cache Storage, so this happens once, not after every reload. Task titles are only cached in memory: each voice reuses a title from its kick off, so only a new title is generated live and arrives a few seconds late. An event in that time cuts the line off. A goal for a task that was never started (ticked off directly) has its title generated live too. In the first few minutes after the first download, a new line can also wait for the warm-up phrase in progress (up to ~15 s for a long one), but not for the rest of the warm-up. Kokoro has no emotion setting, so Michael and George sound keen rather than ecstatic.
- The Finish Day score counts goals since the app was last loaded, not all tasks done today. Reloading mid-day resets it.
- New commentary cuts off the line currently being spoken, so a burst of events doesn't build up minutes of stale commentary. The exception is a kick off right after a goal, which waits for the goal call to finish. Cutting off a line stops *all* speech in the app, including the Voice Reminder plugin's.
- Adding or planning a task for today doesn't count as a reschedule. Any other new day or time does, even for a task that had no date yet, because the hook doesn't say what the date was before.
- Right after a ZIP install, Super Productivity 19.3.1 sometimes runs `plugin.js` twice, which doubled the header button and every sound (2 of 3 fresh installs). The plugin now ignores a second copy in the same page. In 5 runs afterwards, install, reload and reinstall each gave one button and one line per goal. Disabling and re-enabling via the toggle is only covered by a unit test.
- The big screen is not part of the plugin API: `plugin.js` adds its own element to the app page. A future app version could hide it or break its layout. It sits above dialogs too, but only for about 3 seconds and without taking clicks. It uses Impact where installed, with a fallback font otherwise.
- The header button looks the same in every mode. The dialog shows the current one.
- An experiment for videos and inspiration, with no compatibility claim for earlier app versions.

Video: not recorded yet.
