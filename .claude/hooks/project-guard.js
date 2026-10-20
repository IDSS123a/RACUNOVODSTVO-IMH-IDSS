#!/usr/bin/env node
/**
 * project-guard.js — Commander Automation, Layer 1 (deterministic)
 * Claude Code PostToolUse hook (Edit|Write|MultiEdit) + standalone CLI
 *
 * Enforces E-13: mechanically checkable project rules (forbidden
 * strings, secret patterns, banned identifiers) are checked by
 * tooling, not ACA memory.
 *
 * Config: .claude/project-guard.config.json (per project)
 *   {
 *     "forbidden":  [ { "pattern": "<JS regex>", "flags": "i",
 *                       "reason": "<shown when blocked>" } ],
 *     "extensions": [ ".ts", ".md", ... ]     // optional, has defaults
 *     "exclude":    [ "node_modules", ... ]   // optional, has defaults
 *   }
 * No config file, or empty "forbidden" list → guard inactive (exit 0).
 *
 * Modes:
 *   Hook mode (default): reads PostToolUse JSON on stdin, scans only
 *     the just-edited file. On violation returns {"decision":"block"}
 *     so the ACA must remove the pattern before continuing.
 *   CLI mode: `node .claude/hooks/project-guard.js --scan [dir]`
 *     scans the whole project tree; prints violations, exit code 1 if
 *     any found. This is the one-line manual pre-commit step for ACAs
 *     without hook support (E-13 graceful degradation) — and a final
 *     pre-push audit for everyone.
 *
 * Fails open on its own errors (never blocks work on a guard bug).
 * No dependencies. Node built-ins only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Per rule per file budget. A pathological pattern (catastrophic
// backtracking, e.g. "(a+)+$") would otherwise freeze every edit until
// the ACA's hook timeout. V8 regex execution is interruptible via vm
// timeouts, so each rule runs inside a timebox: hook mode skips a
// timed-out rule (fail open — guard bugs never block work), CLI scan
// mode reports it as a config defect.
const RULE_TIMEOUT_MS = 500;

const DEFAULT_EXTENSIONS = [
  '.js', '.jsx', '.ts', '.tsx', '.md', '.json', '.html', '.css',
  '.sql', '.yml', '.yaml', '.txt', '.bat', '.sh', '.env',
];
// .claude is excluded by default: the config file itself contains the
// forbidden patterns as literal strings and must not self-trigger.
// Archives cannot be pattern-scanned; a tracked zip holding a .env passed
// --scan clean on personal-web-page (v1.6). CLI scan reports them by name.
const ARCHIVE_EXTENSIONS = ['.zip', '.7z', '.rar', '.tar', '.gz', '.tgz'];

const DEFAULT_EXCLUDE = [
  'node_modules', '.git', '.next', 'dist', 'build', '.vercel', '.claude',
];

function loadConfig(projectDir) {
  const cfgPath = path.join(projectDir, '.claude', 'project-guard.config.json');
  if (!fs.existsSync(cfgPath)) return null;
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (!Array.isArray(cfg.forbidden) || cfg.forbidden.length === 0) return null;
    return {
      forbidden: cfg.forbidden,
      extensions: Array.isArray(cfg.extensions) && cfg.extensions.length
        ? cfg.extensions : DEFAULT_EXTENSIONS,
      exclude: Array.isArray(cfg.exclude) && cfg.exclude.length
        ? cfg.exclude : DEFAULT_EXCLUDE,
    };
  } catch (e) {
    return null; // corrupt config → guard inactive, never crash the session
  }
}

function scanFile(filePath, config, timedOutPatterns) {
  const violations = [];
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return violations; // unreadable/binary → out of scope for a text guard
  }
  const lines = text.split(/\r?\n/);
  for (const rule of config.forbidden) {
    let re;
    try {
      re = new RegExp(rule.pattern, rule.flags || '');
    } catch (e) {
      continue; // invalid pattern → skip that rule, keep the rest working
    }
    let hits;
    try {
      hits = vm.runInNewContext(
        'const h = []; for (let i = 0; i < lines.length; i++) ' +
          'if (re.test(lines[i])) h.push(i); h',
        { re, lines },
        { timeout: RULE_TIMEOUT_MS }
      );
    } catch (e) {
      // pathological pattern — record for CLI reporting, skip here
      if (timedOutPatterns) timedOutPatterns.add(rule.pattern);
      continue;
    }
    for (const i of hits) {
      violations.push({
        file: filePath,
        line: i + 1,
        pattern: rule.pattern,
        reason: rule.reason || 'forbidden pattern',
      });
    }
  }
  return violations;
}

function walk(dir, config, results, timedOut) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (config.exclude.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, config, results, timedOut);
    else if (ARCHIVE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase()))
      results.push({
        file: full,
        line: 0,
        pattern: 'archive file',
        reason: 'binary archive cannot be scanned — remove it from the repo or inspect it (E-4)',
      });
    else if (config.extensions.includes(path.extname(entry.name).toLowerCase()))
      results.push(...scanFile(full, config, timedOut));
  }
}

function formatViolation(v, projectDir) {
  const rel = path.relative(projectDir, v.file) || v.file;
  return `${rel}:${v.line} — ${v.reason} (pattern: ${v.pattern})`;
}

// ---- CLI mode -------------------------------------------------------
if (process.argv.includes('--scan')) {
  const argDir = process.argv[process.argv.indexOf('--scan') + 1];
  const projectDir = argDir && !argDir.startsWith('-') ? argDir : process.cwd();
  const config = loadConfig(projectDir);
  if (!config) {
    console.log('[project-guard] no active config — nothing to enforce.');
    process.exit(0);
  }
  const results = [];
  const timedOut = new Set();
  try {
    walk(projectDir, config, results, timedOut);
  } catch (e) {
    console.error('[project-guard] scan error: ' + e.message);
    process.exit(0); // fail open
  }
  if (timedOut.size > 0) {
    for (const p of timedOut)
      console.error(
        `[project-guard] WARNING: pattern timed out (>${RULE_TIMEOUT_MS}ms, ` +
          `likely catastrophic backtracking) and was NOT enforced: ${p} — fix this regex.`
      );
  }
  if (results.length === 0) {
    if (timedOut.size > 0) process.exit(1); // audit cannot vouch with a dead rule
    console.log('[project-guard] clean — no forbidden patterns found.');
    process.exit(0);
  }
  console.error(`[project-guard] ${results.length} violation(s):`);
  for (const v of results) console.error('  ' + formatViolation(v, projectDir));
  process.exit(1);
}

// ---- Hook mode (PostToolUse) ---------------------------------------
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input || '{}');
    const projectDir = data.cwd || process.cwd();
    const config = loadConfig(projectDir);
    if (!config) process.exit(0);

    const filePath =
      (data.tool_input && (data.tool_input.file_path || data.tool_input.path)) || null;
    if (!filePath || !fs.existsSync(filePath)) process.exit(0);
    if (!config.extensions.includes(path.extname(filePath).toLowerCase()))
      process.exit(0);
    const rel = path.relative(projectDir, filePath);
    if (rel.split(path.sep).some((seg) => config.exclude.includes(seg)))
      process.exit(0);

    const violations = scanFile(filePath, config);
    if (violations.length === 0) process.exit(0);

    const output = {
      decision: 'block',
      reason:
        'PROJECT GUARD (E-13): forbidden pattern written to a file. ' +
        'Remove it before continuing — this is a hook-enforced project ' +
        'rule, not a suggestion.\n' +
        violations.map((v) => formatViolation(v, projectDir)).join('\n'),
    };
    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  } catch (e) {
    process.exit(0); // never block work on a guard bug
  }
});
