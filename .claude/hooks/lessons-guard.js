#!/usr/bin/env node
/**
 * lessons-guard.js — Commander Automation, Layer 2 (deterministic enforcement)
 * v1.1 — fixes from brutal stress test 2026-07-13:
 *   FIX-1: session freshness window — stale ACTIVITY_LOG from a previous
 *          session (older than 12h) no longer blocks conversation-only turns
 *   FIX-2: QUICK mode support — accepts ANY *_LESSONS.md file
 *          (SPRINT_XX_LESSONS.md or PROTOTYPE_LESSONS.md)
 */
const fs = require('fs');
const path = require('path');

const SESSION_WINDOW_MS = 12 * 60 * 60 * 1000; // 12h — real sessions run 8h+ (see /compact evidence)
const GRACE_MS = 10 * 60 * 1000;              // 10 min tolerancije

let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input || '{}');
    if (data.stop_hook_active) process.exit(0); // loop protection

    const projectDir = data.cwd || process.cwd();
    const corrDir = path.join(projectDir, 'corrections');
    const logFile = path.join(corrDir, 'ACTIVITY_LOG.md');

    if (!fs.existsSync(logFile)) process.exit(0);

    const logMtime = fs.statSync(logFile).mtimeMs;

    // FIX-1: ako je log stariji od 12h, izmjene su iz prosle sesije —
    // ne blokiraj cisto konverzacijski turn danas
    if (Date.now() - logMtime > SESSION_WINDOW_MS) process.exit(0);

    // FIX-2: prihvati bilo koji *_LESSONS.md (FULL i QUICK mode)
    let newestLessonsMtime = 0;
    for (const f of fs.readdirSync(corrDir)) {
      if (/_LESSONS\.md$/i.test(f)) {
        const m = fs.statSync(path.join(corrDir, f)).mtimeMs;
        if (m > newestLessonsMtime) newestLessonsMtime = m;
      }
    }

    if (newestLessonsMtime + GRACE_MS >= logMtime) process.exit(0);

    process.stderr.write(
      'STANDING ORDER (Commander M-18, automated guard): files were ' +
        'modified this session but no lessons file in corrections/ was ' +
        'updated. Before finishing: (1) review corrections/ACTIVITY_LOG.md, ' +
        '(2) append lessons to corrections/SPRINT_XX_LESSONS.md (FULL mode) ' +
        'or corrections/PROTOTYPE_LESSONS.md (QUICK mode) using the standard ' +
        'entry format, (3) if nothing lesson-worthy happened, append: ' +
        '"### [date] — No lessons this session (routine changes only)". ' +
        'Then finish.'
    );
    process.exit(2);
  } catch (e) {
    process.exit(0);
  }
});
