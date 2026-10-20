#!/usr/bin/env node
/**
 * log-change.js — Commander Automation, Layer 1 (deterministic logging)
 * Claude Code PostToolUse hook (matcher: Edit|Write|MultiEdit)
 *
 * Fires automatically after EVERY file edit/write Claude Code makes.
 * Appends one line to corrections/ACTIVITY_LOG.md.
 * This is raw material that can never be lost to context compaction.
 *
 * No dependencies. Node built-ins only.
 */
const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input || '{}');
    const filePath =
      (data.tool_input && (data.tool_input.file_path || data.tool_input.path)) || '';

    // Never log changes to the corrections folder itself (loop protection)
    if (!filePath || /corrections[\\/]/i.test(filePath)) process.exit(0);

    const projectDir = data.cwd || process.cwd();
    const corrDir = path.join(projectDir, 'corrections');
    if (!fs.existsSync(corrDir)) fs.mkdirSync(corrDir, { recursive: true });

    const logFile = path.join(corrDir, 'ACTIVITY_LOG.md');
    const now = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const rel = path.relative(projectDir, filePath) || filePath;
    const tool = data.tool_name || 'Edit';

    if (!fs.existsSync(logFile)) {
      fs.writeFileSync(
        logFile,
        '# ACTIVITY_LOG — automatski generisan (Commander Automation)\n' +
          '# Svaka izmjena fajla koju Claude Code napravi. Sirovi materijal za lessons.\n\n'
      );
    }
    fs.appendFileSync(logFile, `- [${now}] ${tool}: ${rel}\n`);
    if (fs.statSync(logFile).size > 200*1024) {
      const L = fs.readFileSync(logFile,'utf8').split('\n');
      fs.writeFileSync(logFile, L.slice(0,3).concat(['# ... older trimmed ...',''], L.slice(-1500)).join('\n'));
    }
  } catch (e) {
    // Hooks must never break the session — fail silently
  }
  process.exit(0);
});
