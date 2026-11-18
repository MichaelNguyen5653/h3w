#!/usr/bin/env node
// Integration tests for h3w-mode-tracker.js — drives it via stdin with a temp
// CLAUDE_CONFIG_DIR and asserts the resulting flag state.
// Run: node --test tests/test_tracker.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const TRACKER = path.join(__dirname, '..', 'hooks', 'h3w-mode-tracker.js');
const { requestedMode } = require('../hooks/h3w-mode');

// Run the tracker with a given prompt against a fresh temp config dir.
// Returns the flag contents after the run (or null if the flag was removed).
function runTracker(prompt, { preActive, defaultMode = 'on' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h3w-trk-'));
  const flagPath = path.join(dir, '.h3w-active');
  if (preActive) fs.writeFileSync(flagPath, preActive, { mode: 0o600 });

  try {
    execFileSync(process.execPath, [TRACKER], {
      input: JSON.stringify({ prompt }),
      env: { ...process.env, CLAUDE_CONFIG_DIR: dir, H3W_DEFAULT_MODE: defaultMode },
      encoding: 'utf8',
      timeout: 5000,
    });
  } catch (e) { /* tracker silent-fails; we assert on flag state */ }

  let flag = null;
  try { flag = fs.readFileSync(flagPath, 'utf8').trim(); } catch (e) {}
  fs.rmSync(dir, { recursive: true, force: true });
  return flag;
}

test('shared parser only deactivates when off-verb targets h3w', () => {
  assert.equal(requestedMode('stop h3w'), 'off');
  assert.equal(requestedMode('normal mode'), 'off');
  assert.equal(requestedMode('use h3w to turn off the logger'), 'on');
  assert.equal(requestedMode('h3w please stop the server'), null);
});

// ── Activation ───────────────────────────────────────────────────────────────

test('/h3w activates at default level', () => {
  assert.equal(runTracker('/h3w'), 'on');
});

test('a leftover level argument still just activates', () => {
  // /h3w lite|full|ultra used to select an intensity. One mode now, so any
  // stray argument is ignored rather than rejected — old muscle memory works.
  assert.equal(runTracker('/h3w full'), 'on');
  assert.equal(runTracker('/h3w ultra'), 'on');
});

test('natural language "activate h3w" activates', () => {
  assert.equal(runTracker('please activate h3w'), 'on');
});

test('/h3w explicitly activates when default mode is off', () => {
  assert.equal(runTracker('/h3w', { defaultMode: 'off' }), 'on');
});

// ── Deactivation ─────────────────────────────────────────────────────────────

test('"stop h3w" deactivates', () => {
  assert.equal(runTracker('stop h3w', { preActive: 'on' }), null);
});

test('"/h3w off" deactivates', () => {
  assert.equal(runTracker('/h3w off', { preActive: 'on' }), null);
});

test('"normal mode" deactivates', () => {
  assert.equal(runTracker('normal mode', { preActive: 'on' }), null);
});

// ── Regression: must NOT deactivate on unrelated "off"/"stop" ─────────────────

test('REGRESSION: "use h3w to turn off the logger" stays active', () => {
  assert.equal(runTracker('use h3w to turn off the logger', { preActive: 'on' }), 'on');
});

test('REGRESSION: "h3w please stop the server" stays active', () => {
  assert.equal(runTracker('h3w please stop the server', { preActive: 'on' }), 'on');
});

// ── sections config: per-turn reinforcement line ─────────────────────────────
// `sections.prose`/`sections.code` in config.json must gate the same clauses
// in the reinforcement line as the SessionStart ruleset. The Boundaries
// carve-out ("Code/commits/security: write normal.") is always-on and ships
// regardless.

function runTrackerOutput(prompt, { preActive = 'on', sectionsValue } = {}) {
  const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'h3w-trk-'));
  const xdgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'h3w-trk-xdg-'));
  const flagPath = path.join(claudeDir, '.h3w-active');
  if (preActive) fs.writeFileSync(flagPath, preActive, { mode: 0o600 });
  if (sectionsValue !== undefined) {
    const h3wDir = path.join(xdgDir, 'h3w');
    fs.mkdirSync(h3wDir, { recursive: true });
    fs.writeFileSync(path.join(h3wDir, 'config.json'), JSON.stringify({ sections: sectionsValue }));
  }

  let stdout = '';
  try {
    stdout = execFileSync(process.execPath, [TRACKER], {
      input: JSON.stringify({ prompt }),
      env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir, XDG_CONFIG_HOME: xdgDir, H3W_DEFAULT_MODE: 'on' },
      encoding: 'utf8',
      timeout: 5000,
    });
  } catch (e) { /* tracker silent-fails */ }

  fs.rmSync(claudeDir, { recursive: true, force: true });
  fs.rmSync(xdgDir, { recursive: true, force: true });

  let context = null;
  try { context = JSON.parse(stdout).hookSpecificOutput.additionalContext; } catch (e) {}
  return context;
}

test('reinforcement: no config → unchanged (byte-identical to prior hardcoded line)', () => {
  const line = runTrackerOutput('hello');
  assert.equal(
    line,
    'H3W ACTIVE. ' +
      'Prose: drop articles/filler/pleasantries/hedging. Fragments OK. Recommendation: 1-2 lines. Caveats: "Topic: state. Consequence." Close: "Next: A, B. Proceed?" Steps, security warnings: full. ' +
      'Code: YAGNI ladder first (reuse → stdlib → native → dep → one line → min code). ' +
      'Code/commits/security: write normal.'
  );
});

test('reinforcement: sections.prose false drops the prose clause, keeps code + boundaries', () => {
  const line = runTrackerOutput('hello', { sectionsValue: { prose: false } });
  assert.ok(!line.includes('Prose:'), line);
  assert.ok(line.includes('Code: YAGNI ladder'), line);
  assert.ok(line.includes('Code/commits/security: write normal.'), line);
});

test('reinforcement: sections.code false drops the code clause, keeps prose + boundaries', () => {
  const line = runTrackerOutput('hello', { sectionsValue: { code: false } });
  assert.ok(!line.includes('Code: YAGNI ladder'), line);
  assert.ok(line.includes('Prose:'), line);
  assert.ok(line.includes('Code/commits/security: write normal.'), line);
});

test('reinforcement: both false still ships the always-on Boundaries clause', () => {
  const line = runTrackerOutput('hello', { sectionsValue: { prose: false, code: false } });
  assert.ok(!line.includes('Prose:'), line);
  assert.ok(!line.includes('Code: YAGNI ladder'), line);
  assert.equal(line, 'H3W ACTIVE. Code/commits/security: write normal.');
});

test('reinforcement: malformed sections value falls back to enabled, no throw', () => {
  for (const malformed of ['off', null, 5, [], { prose: 'no' }]) {
    const line = runTrackerOutput('hello', { sectionsValue: malformed });
    assert.ok(line.includes('Prose:'), JSON.stringify(malformed));
    assert.ok(line.includes('Code: YAGNI ladder'), JSON.stringify(malformed));
  }
});

// ── resume nudge ─────────────────────────────────────────────────────────────

function runWithTranscript(minutesAgo, context) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h3w-trk-'));
  fs.writeFileSync(path.join(dir, '.h3w-active'), 'on', { mode: 0o600 });
  const transcript = path.join(dir, 'session.jsonl');
  const entry = {
    type: 'assistant',
    timestamp: new Date(Date.now() - minutesAgo * 60000).toISOString(),
    message: { model: 'claude-opus-5-5', usage: { input_tokens: 5, cache_creation_input_tokens: 1000, cache_read_input_tokens: context - 1005, output_tokens: 50 } },
  };
  fs.writeFileSync(transcript, JSON.stringify({ type: 'user', message: { content: 'hi' } }) + '\n' + JSON.stringify(entry) + '\n');
  try {
    const out = execFileSync(process.execPath, [TRACKER], {
      input: JSON.stringify({ prompt: 'next task', transcript_path: transcript }),
      env: { ...process.env, CLAUDE_CONFIG_DIR: dir, H3W_DEFAULT_MODE: 'on' },
      encoding: 'utf8',
      timeout: 5000,
    });
    return JSON.parse(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('resume nudge: big context after an expired cache warns the user', () => {
  const out = runWithTranscript(180, 480000);
  assert.match(out.systemMessage, /3 h idle/);
  assert.match(out.systemMessage, /~480k-token context/);
  assert.match(out.systemMessage, /\/compact/);
  assert.ok(out.hookSpecificOutput.additionalContext.startsWith('H3W ACTIVE.'));
});

test('resume nudge: silent while the cache is warm or the context is small', () => {
  assert.equal(runWithTranscript(20, 480000).systemMessage, undefined);
  assert.equal(runWithTranscript(180, 60000).systemMessage, undefined);
});
