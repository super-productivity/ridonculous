# Working on Ridonculous

This repository is a playground for experimental Super Productivity plugins. Its purpose is to explore ideas, make fun YouTube content, and inspire others. Production polish is not the default goal.

- Build the smallest complete version that demonstrates the requested idea. Avoid speculative features, shared frameworks, and unrelated cleanup.
- Keep each plugin self-contained under `plugins/<plugin-name>/`. Reuse existing patterns when they exist; introduce shared tooling only when there is a concrete need.
- Before implementing a plugin, check the current official Super Productivity plugin documentation and examples. Do not invent API methods, manifest fields, or installation steps.
- Prefer Super Productivity's standard UI kit and theme variables for controls, typography, surfaces, and states. Make custom illustrations and layouts fit the host's light, dark, and custom themes instead of imposing a separate app theme.
- Give each plugin a README explaining its idea, build and installation steps, tested Super Productivity version, known limitations, and video link when available.
- Rough edges in presentation are fine. Handle errors sensibly, protect task data, and make external network calls or data changes clear to the person trying the plugin. Never commit credentials.
- Validate the behavior that makes the experiment work, using focused tests or a reproducible manual check as appropriate. Record what was actually verified and what remains untested.
- When adding a plugin, link it from the root README. Don't describe a planned experiment as already working.
- Never merge branches or push to a remote unless the user explicitly requests that exact action in the current turn.
