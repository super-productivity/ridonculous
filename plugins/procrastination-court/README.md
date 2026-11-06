# Procrastination Cat Court

**The task is on trial. Your worth is not.**

Bring an avoided task before Hon. Justice Later, a round ginger kitten in a powdered wig, and Prosecutor Pounce, a fluffy gray kitten with an oversized evidence folder. Explain what is holding you back, hear their little exchange, and choose a ruling: make a beginning, reduce the sentence, or dismiss the case. The prosecutor argues against the intimidating task, never against you.

The cats are animated and pettable: click, tap, or press Enter/Space on either one for a head scratch, a heart, and (with sound on) a meow and a purr. Choosing a defense starts a short four-turn miau debate above the written dialogue. The courtroom uses Super Productivity's standard UI kit and theme colors, follows live light/dark theme changes, works on narrow screens, and can be used with the keyboard. The dialogue is hand-written; there is no AI service or download.

## Try it

Open [index.html](index.html) directly in a browser for the **standalone demo**. It uses five fictional tasks. Changes stay in memory, and the timer buttons only simulate a start.

To create an installable ZIP, run from this plugin directory:

```sh
python3 -m zipfile -c procrastination-court.zip manifest.json index.html icon.svg
```

In Super Productivity, open **Settings → Plugins → Choose Plugin File**, select the ZIP, confirm, and enable the plugin. Open **Cat Court** from the plugin menu. No build step is needed: the whole plugin is `index.html`.

For local development, use the repository's [real-app launcher](../../README.md#test-plugins-in-the-real-app):

```sh
# From the repository root, with dependencies installed via npm ci:
npm run dev -- procrastination-court /path/to/super-productivity
```

**Tested with the local Super Productivity 19.3.1 web build.** The manifest requires 19.3.1+. Checked against the [official plugin guide](https://github.com/super-productivity/super-productivity/blob/master/docs/plugin-development.md), [API types](https://github.com/super-productivity/super-productivity/blob/master/packages/plugin-api/src/types.ts), and the official [Procrastination Buster example](https://github.com/super-productivity/super-productivity/tree/master/packages/plugin-dev/procrastination-buster). Earlier versions are untested.

## A day in court

1. **Choose a case.** Open the searchable picker and select an unfinished main task. Nothing is selected automatically, and selecting changes no task data. Subtasks belong to their parent's case.
2. **Make your defense.** “It's too big,” “It's a bit of a fog,” “I just don't feel like it,” or “It may not matter now.” Pounce presents the evidence, Justice Later responds kindly, and the court recommends a ruling. You have the final say.
3. **Rule kindly.**

| Ruling | What actually happens |
| --- | --- |
| **Make a beginning** | Starts the task's Super Productivity timer. For a parent with subtasks, starts the first unfinished child. Disabled if every child is done. |
| **Reduce the sentence** | You name one concrete step. The court adds it as a subtask with a 5-minute estimate (short syntax is treated literally). A separate button can start its timer. |
| **Dismiss the case** | Saves the task's ID in the plugin's dismissed docket. The task itself is not deleted, completed, or rescheduled. Open **Dismissed** to reopen it. |

Starting a timer switches away from any running task, and **there is no automatic stop**; five minutes is an invitation. Afterwards both cats curl up beneath “Court is quietly rooting for you.”

Sound starts off; the speaker icon enables locally synthesized meows, purrs, and a gavel (Web Audio, no recordings). The pause icon stops all animation, and the system reduced-motion preference keeps the court still. Both preferences last only while the view is open. Animation and sound never delay a task action.

## Data and error handling

- Reads tasks via `getTasks`. Only explicit rulings write: `addTask` for a small step, and the allowed `[Task] SetCurrentTask` action to start a timer.
- Syncs only a version number and dismissed task IDs via `persistDataSynced`. A tab-local session-storage flag (no task data) enables the “Welcome back” greeting. No plugin code makes network requests.
- The docket updates through the host's `dataChanged` and `persistedDataChanged` hooks (a steady stream, such as from a running timer, is read at most every 2 seconds), when the view regains focus or becomes visible again, and when the picker opens. If hook registration is unavailable, it polls every 5 seconds instead. Updates only read data and keep your current defense and draft.
- Before each ruling or reopening, the task and docket are read again: a task completed, removed, moved under another task, or dismissed elsewhere cannot receive a ruling, and a finished task's case cannot be reopened.
- Controls are disabled while an action runs. A failed write is reported without a successful ruling; no write is retried automatically. A saved small step is kept even if starting its timer fails.
- Invalid saved docket data blocks the court rather than being silently overwritten.

## Validation

From the repository root, install dependencies with `npm ci` and, if needed, `npx playwright install chromium`.

```sh
# Mocked browser behavior and standalone demo
npm test --prefix plugins/procrastination-court

# All three rulings in a real, built host, with disposable tasks
npm run test:live --prefix plugins/procrastination-court -- /path/to/super-productivity

# Repository-level installation / reinstallation smoke test
npm run test:live -- procrastination-court /path/to/super-productivity
```

Verified on 2026-11-06:

- **Browser tests:** search, keyboard picker, and focus restoration; all three rulings, including starting the next unfinished child and literal subtask titles; duplicate-submission prevention; dismissal and reopening, including cases dismissed elsewhere and finished tasks; failed reads and writes, stale tasks, and invalid saved data; HTML-like titles rendered as text; live updates that keep drafts and focus, with hook bursts throttled; reduced motion and the motion toggle; no horizontal overflow from 280 to 1280px; and a standalone demo with no HTTP requests.
- **Sound:** silent by default, voices replace rather than overlap, mute is immediate, and nothing writes task data. Offline renders check that each sound is audible, bounded, and unclipped (measured cat peaks about 0.083, gavel 0.074). The suite writes `procrastination-court-sounds.wav` to the system temp directory for listening.
- **Real 19.3.1 web build:** ZIP installation and reinstallation, UI kit injection, live light/dark changes, new tasks appearing through hooks, subtask creation with a 5-minute estimate, tracked time increasing from both start actions, and dismissal surviving a reload.
- **Screenshots inspected:** desktop and mobile hearing, verdict, focus, and empty screens, and the icon in the real app menu in light and dark themes. Tests write `procrastination-court-*.png` screenshots to the system temp directory.

## Known limitations

- English only. Native desktop, native mobile, Safari, and assistive technology testing are unverified, and nobody has listened to the synthesized audio yet.
- An unfinished defense or step draft is lost when the view closes.
- Only main tasks get their own case.
- Adding a subtask uses the host's normal behavior, so the parent's displayed estimate follows its subtask totals.
- Dismissals are one synced document. The court re-reads it before saving, but simultaneous edits on different devices can still overwrite each other. Dismissed IDs of later-deleted tasks are never pruned. Cross-device sync is untested.
- Case numbers are positions in the current list, not permanent identifiers.

Video: not recorded yet. Suggested opening: “I took my to-do list to court. The judge was a cat.”
