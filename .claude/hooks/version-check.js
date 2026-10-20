#!/usr/bin/env node
/**
 * version-check.js — Commander Automation, Layer 1 (deterministic)
 * Claude Code SessionStart hook
 *
 * Compares the project's .commander-version against the live Commander
 * CONSTITUTION.md header on GitHub. If they differ, injects a notice
 * into the session context so the ACA informs the Director.
 *
 * Fails silently on network errors — version drift detection is
 * best-effort and must never block work.
 *
 * No dependencies. Node built-ins only.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const CONSTITUTION_URL =
  'https://raw.githubusercontent.com/IDSS123a/commander/main/CONSTITUTION.md';

function readProjectVersion(projectDir) {
  const vFile = path.join(projectDir, '.commander-version');
  if (!fs.existsSync(vFile)) return null;
  const raw = fs.readFileSync(vFile, 'utf8').trim();
  // Sanitize: accept only digits and dots; anything else is treated
  // as a corrupt version file and reported as "unknown"
  return /^[\d.]+$/.test(raw) ? raw : 'unknown (corrupt .commander-version)';
}

function fetchLiveVersion(cb) {
  const req = https.get(CONSTITUTION_URL, { timeout: 5000 }, (res) => {
    let data = '';
    res.on('data', (d) => {
      data += d;
      // Header is in the first few lines — stop early
      if (data.length > 500) {
        req.destroy();
        cb(extractVersion(data));
      }
    });
    res.on('end', () => cb(extractVersion(data)));
  });
  req.on('error', () => cb(null));
  req.on('timeout', () => {
    req.destroy();
    cb(null);
  });
}

function extractVersion(text) {
  // Matches: "# Version 1.2 — July 2026"
  const m = text.match(/^# Version\s+([\d.]+)/m);
  return m ? m[1] : null;
}

let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input || '{}');
    const projectDir = data.cwd || process.cwd();
    const projectVersion = readProjectVersion(projectDir);

    // No .commander-version file → not a Commander project or pre-v1.3
    // bootstrap. Do nothing.
    if (!projectVersion) process.exit(0);

    fetchLiveVersion((liveVersion) => {
      if (!liveVersion || liveVersion === projectVersion) process.exit(0);

      // Version mismatch — inject notice into session context
      const output = {
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext:
            `⚠️ COMMANDER VERSION MISMATCH: this project was bootstrapped ` +
            `under Commander v${projectVersion}, but Commander is now ` +
            `v${liveVersion}. Inform the Director in Bosnian and ask whether ` +
            `to upgrade (read COMMANDER_CHANGELOG.md for the diff between ` +
            `versions before proposing changes). Do not upgrade without ` +
            `explicit approval.`,
        },
      };
      process.stdout.write(JSON.stringify(output));
      process.exit(0);
    });
  } catch (e) {
    process.exit(0); // never block work
  }
});
