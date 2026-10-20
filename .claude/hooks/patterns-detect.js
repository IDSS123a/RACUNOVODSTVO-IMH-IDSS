#!/usr/bin/env node
/**
 * patterns-detect.js — Commander Automation, Layer 1 (deterministic)
 * Claude Code Stop hook (runs after lessons-guard.js)
 *
 * Scans all corrections/*_LESSONS.md files (SPRINT_* + PROTOTYPE) and counts how many
 * times each Commander rule ID (M-XX / E-XX / A-XX / C-XX) appears.
 * Any rule mentioned 3+ times across sprints is written to
 * corrections/PATTERNS.md as a severity-upgrade candidate.
 *
 * This pre-computes M-22 KRAJ Protocol Step 2a (repeated violations)
 * so the end-of-project analysis starts from detected patterns, not
 * from a cold read of every lessons file.
 *
 * Runs outside the LLM context — zero token cost.
 * No dependencies. Node built-ins only.
 */
const fs = require('fs');
const path = require('path');

const THRESHOLD = 3;

let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input || '{}');
    const projectDir = data.cwd || process.cwd();
    const corrDir = path.join(projectDir, 'corrections');
    if (!fs.existsSync(corrDir)) process.exit(0);

    const lessonFiles = fs
      .readdirSync(corrDir)
      .filter((f) => /_LESSONS\.md$/i /*FULL SPRINT_* + QUICK PROTOTYPE*/.test(f));
    if (lessonFiles.length === 0) process.exit(0);

    // Count rule ID mentions per file (a rule mentioned 5x in one
    // sprint counts once for that sprint — we track recurrence
    // ACROSS sprints, not verbosity within one)
    const ruleSprints = {}; // { 'M-4': Set(['SPRINT_02', 'SPRINT_05']) }
    for (const file of lessonFiles) {
      const text = fs.readFileSync(path.join(corrDir, file), 'utf8');
      const sprintName = file.replace(/_LESSONS\.md$/i, '');
      const ids = new Set(text.match(/\b[MEAC]-\d{1,2}\b/g) || []);
      for (const id of ids) {
        if (!ruleSprints[id]) ruleSprints[id] = new Set();
        ruleSprints[id].add(sprintName);
      }
    }

    const candidates = Object.entries(ruleSprints)
      .filter(([, sprints]) => sprints.size >= THRESHOLD)
      .sort((a, b) => b[1].size - a[1].size);

    if (candidates.length === 0) process.exit(0);

    const lines = [
      '# PATTERNS.md — Auto-Detected Recurrence (patterns-detect.js)',
      `# Generated: ${new Date().toISOString().slice(0, 10)}`,
      '# Rules appearing in 3+ sprint lessons files. Input for M-22 Step 2a.',
      '',
    ];
    for (const [id, sprints] of candidates) {
      lines.push(
        `- ⚠️ **${id}** appears in ${sprints.size} sprints ` +
          `(${[...sprints].sort().join(', ')}) — severity upgrade candidate ` +
          `or rule-clarity problem. Review at KRAJ.`
      );
    }
    lines.push('');

    fs.writeFileSync(path.join(corrDir, 'PATTERNS.md'), lines.join('\n'));
    process.exit(0);
  } catch (e) {
    process.exit(0); // never block work
  }
});
