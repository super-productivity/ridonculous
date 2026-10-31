#!/usr/bin/env node
// Publishes plugins whose manifest version has no GitHub release yet and prints the
// pinned entry for Super Productivity's in-app listing (src/assets/community-plugins.json).
//
//   node tools/release.cjs   # needs gh + GH_TOKEN; in CI the entries go to the run summary
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { packPlugin } = require('./pack.cjs');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, '.local', 'release');
const repo = process.env.GITHUB_REPOSITORY || 'super-productivity/ridonculous';

const hasRelease = tag => {
  try {
    execFileSync('gh', ['release', 'view', tag, '--repo', repo], { stdio: 'ignore' });
    return true;
  } catch {
    return false; // gh exits non-zero when the release does not exist
  }
};

// Printed right after each release, so a later failure never hides an earlier hash.
function report(manifest, release) {
  const text = `### ${manifest.name} ${manifest.version}\n\nUpdate (or add) the "${manifest.id}" entry in community-plugins.json:\n\n\`\`\`json\n"release": ${JSON.stringify(release, null, 2)}\n\`\`\`\n\n`;
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
}

function releasePlugin(folder) {
  const dir = path.join(root, 'plugins', folder);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const tag = `${folder}-v${manifest.version}`;
  if (hasRelease(tag)) return false;
  const asset = `${manifest.id}-${manifest.version}.zip`;
  const archive = path.join(outDir, asset);
  packPlugin(dir, archive);
  const notes = 'Install in Super Productivity: Settings → Plugins → Community Plugins, or upload this ZIP with Choose Plugin File.';
  const target = process.env.GITHUB_SHA || 'main';
  execFileSync('gh', ['release', 'create', tag, archive, '--repo', repo, '--target', target, '--title', `${manifest.name} ${manifest.version}`, '--notes', notes], { stdio: 'inherit' });
  report(manifest, {
    version: manifest.version,
    downloadUrl: `https://github.com/${repo}/releases/download/${tag}/${asset}`,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),
  });
  return true;
}

const released = fs.readdirSync(path.join(root, 'plugins')).sort().filter(releasePlugin);
console.log(released.length ? `Released: ${released.join(', ')}` : 'Nothing new to release.');
