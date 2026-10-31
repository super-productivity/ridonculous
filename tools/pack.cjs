// Packs a plugin folder into the ZIP that Super Productivity installs.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Only portable runtime files belong in an uploaded plugin, never node_modules or tests.
const RUNTIME_FILES = ['index.html', 'plugin.js', 'icon.svg', 'i18n'];

/** Writes `archive` from `pluginDir` and returns the packed file names. */
function packPlugin(pluginDir, archive) {
  const files = ['manifest.json', ...RUNTIME_FILES.filter(name => fs.existsSync(path.join(pluginDir, name)))];
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  fs.rmSync(archive, { force: true });
  execFileSync('python3', ['-m', 'zipfile', '-c', archive, ...files], { cwd: pluginDir });
  return files;
}

module.exports = { packPlugin };
