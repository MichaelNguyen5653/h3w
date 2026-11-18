#!/usr/bin/env node
// h3w: cross-platform installer.
//
// Detects the AI coding agents on this machine and installs h3w for each:
//   - Claude Code  → plugin (marketplace add + install), fallback to standalone
//                    hooks + settings.json merge + statusline badge
//   - Pi           → Pi package (extension + skill)
//   - Gemini CLI   → gemini extensions install
//   - Codex        → fenced ruleset appended to ~/.codex/AGENTS.md
//   - Copilot CLI  → fenced ruleset + postToolUse compression hook in ~/.copilot
//   - OpenCode     → fenced ruleset + skills + plugin in its global config root
//   - Hermes       → skills copy in ~/.hermes/skills (Agent Skills standard)
//   - Cursor/Windsurf/Cline/Kiro/Copilot/Antigravity → project rule file dropped into CWD
//
// Usage:
//   npx github:MichaelNguyen5653/h3w                 auto-detect + install
//   npx github:MichaelNguyen5653/h3w --list          show detected agents, install nothing
//   npx github:MichaelNguyen5653/h3w --only claude   install for one agent
//   npx github:MichaelNguyen5653/h3w --dry-run       print actions, change nothing
//   npx github:MichaelNguyen5653/h3w --uninstall     remove what we installed
//   npx github:MichaelNguyen5653/h3w mcp wrap        route stdio MCP servers through the compressor
//   npx github:MichaelNguyen5653/h3w --help
//
// Pure stdlib, zero runtime deps.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const SETTINGS = require('./lib/settings');
const MCP = require('./lib/mcp');
const TOOLS = require('./lib/tools');
const { getOpencodeDir, getOpencodeStateDir } = require('../hooks/h3w-config');

const REPO = 'MichaelNguyen5653/h3w';
const IS_WIN = process.platform === 'win32';

// Repo root = parent of bin/. Installed package or local clone both work.
const REPO_ROOT = path.resolve(__dirname, '..');

// ── Provider matrix ─────────────────────────────────────────────────────────
// scope: 'global' installs once for the whole machine/user.
//        'project' writes a per-repo rule file into the current directory
//        (that's how Cursor/Cline/Copilot rules actually work).
const PROVIDERS = [
  { id: 'claude',   label: 'Claude Code',   scope: 'global',  detect: 'cmd:claude' },
  { id: 'pi',       label: 'Pi',            scope: 'global',  detect: 'cmd:pi' },
  { id: 'gemini',   label: 'Gemini CLI',    scope: 'global',  detect: 'cmd:gemini' },
  { id: 'codex',    label: 'Codex CLI',     scope: 'global',  detect: 'cmd:codex||dir:~/.codex' },
  { id: 'copilot-cli', label: 'Copilot CLI', scope: 'global',  detect: 'cmd:copilot' },
  { id: 'opencode', label: 'OpenCode',        scope: 'global',  detect: 'cmd:opencode' },
  { id: 'hermes',   label: 'Hermes Agent',    scope: 'global',  detect: 'cmd:hermes||dir:~/.hermes' },
  { id: 'cursor',   label: 'Cursor',        scope: 'project', detect: 'cmd:cursor||dir:~/.cursor',
    rule: '.cursor/rules/h3w.mdc' },
  { id: 'windsurf', label: 'Windsurf',      scope: 'project', detect: 'cmd:windsurf||dir:~/.windsurf||dir:~/.codeium/windsurf',
    rule: '.windsurf/rules/h3w.md' },
  { id: 'cline',    label: 'Cline',         scope: 'project', detect: 'vscode-ext:cline',
    rule: '.clinerules/h3w.md' },
  { id: 'kiro',     label: 'Kiro',          scope: 'project', detect: 'cmd:kiro||dir:~/.kiro',
    rule: '.kiro/steering/h3w.md' },
  { id: 'copilot',  label: 'GitHub Copilot',scope: 'project', detect: 'vscode-ext:github.copilot||vscode-ext:github.copilot-chat',
    rule: '.github/copilot-instructions.md' },
  // Antigravity IDE (`antigravity`) and its CLI (`agy`, antigravity-cli) both
  // load workspace rules from .agents/rules/*.md.
  { id: 'antigravity', label: 'Antigravity', scope: 'project', detect: 'cmd:antigravity||cmd:agy||dir:~/.antigravity',
    rule: '.agents/rules/h3w.md' },
];

// ── argv ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { dryRun: false, force: false, list: false, uninstall: false,
                 noColor: false, help: false, stats: false, update: false, only: [], configDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--dry-run': opts.dryRun = true; break;
      case '--force': opts.force = true; break;
      case '--list': opts.list = true; break;
      case '--stats': opts.stats = true; break;
      // --update is --force narrowed to what is already there: refresh every
      // agent that has h3w, add it to none that don't.
      case '--update': opts.update = true; opts.force = true; break;
      case '--uninstall': case '-u': opts.uninstall = true; break;
      case '--no-color': opts.noColor = true; break;
      case '-h': case '--help': opts.help = true; break;
      case '--': break; // npx sometimes forwards the literal end-of-options marker
      case '--only': {
        const v = argv[++i];
        if (!v) die('error: --only requires an agent id');
        opts.only.push(v);
        break;
      }
      case '--config-dir': {
        const v = argv[++i];
        if (!v || v.startsWith('--')) die('error: --config-dir requires a path');
        opts.configDir = expandHome(v);
        break;
      }
      default: die(`error: unknown flag: ${a}\nrun 'npx github:MichaelNguyen5653/h3w --help' for usage`);
    }
  }
  if (opts.only.length) {
    const known = new Set(PROVIDERS.map(p => p.id));
    for (const id of opts.only) if (!known.has(id)) die(`error: unknown agent: ${id}\n  see 'npx github:MichaelNguyen5653/h3w --list'`);
  }
  return opts;
}

function die(msg) { process.stderr.write(msg + '\n'); process.exit(2); }

// ── color ───────────────────────────────────────────────────────────────────
function makeChalk(noColor) {
  const use = !noColor && process.stdout.isTTY && !process.env.NO_COLOR;
  const wrap = (c) => (s) => use ? `\x1b[${c}m${s}\x1b[0m` : s;
  return { orange: wrap('38;5;172'), dim: wrap('2'), red: wrap('31'), green: wrap('32'), yellow: wrap('33') };
}

// ── detection ───────────────────────────────────────────────────────────────
function expandHome(p) { return p.replace(/^~/, os.homedir()).replace(/^\$HOME/, os.homedir()); }

function hasCmd(cmd) {
  try {
    if (IS_WIN) return cp.spawnSync('where', [cmd], { stdio: 'ignore' }).status === 0;
    return cp.spawnSync('sh', ['-c', `command -v '${cmd.replace(/'/g, "")}'`], { stdio: 'ignore' }).status === 0;
  } catch (_) { return false; }
}

function safeStat(p, method) { try { return fs.statSync(p)[method](); } catch (_) { return false; } }

function vscodeExt(needle) {
  const roots = ['.vscode/extensions', '.vscode-server/extensions', '.cursor/extensions', '.windsurf/extensions']
    .map(r => path.join(os.homedir(), r));
  const re = new RegExp(needle.replace(/\./g, '\\.'), 'i');
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    try { if (fs.readdirSync(r).some(e => re.test(e))) return true; } catch (_) {}
  }
  return false;
}

function detectMatch(spec) {
  for (const clause of spec.split('||')) {
    const c = clause.trim();
    const colon = c.indexOf(':');
    const kind = c.slice(0, colon), val = expandHome(c.slice(colon + 1));
    let ok = false;
    if (kind === 'cmd') ok = hasCmd(val);
    else if (kind === 'dir') ok = safeStat(val, 'isDirectory');
    else if (kind === 'file') ok = safeStat(val, 'isFile');
    else if (kind === 'vscode-ext') ok = vscodeExt(val);
    if (ok) return true;
  }
  return false;
}

function providerDetected(provider) {
  return detectMatch(provider.detect) ||
    (provider.id === 'opencode' && safeStat(opencodeDir(), 'isDirectory'));
}

// ── spawn helpers ───────────────────────────────────────────────────────────
function quoteWin(a) {
  if (!IS_WIN) return a;
  if (a === '' || /[\s"]/.test(a)) return '"' + String(a).replace(/\\(?=\\*"|$)/g, '\\\\').replace(/"/g, '\\"') + '"';
  return a;
}
function spawnX(cmd, args, o) {
  if (IS_WIN) return cp.spawnSync(`${cmd} ${args.map(quoteWin).join(' ')}`, [], Object.assign({ shell: true }, o || {}));
  return cp.spawnSync(cmd, args, o || {});
}
function run(cmd, args, dry) {
  if (dry) { process.stdout.write(`  would run: ${cmd} ${args.join(' ')}\n`); return { status: 0 }; }
  process.stdout.write(`  $ ${cmd} ${args.join(' ')}\n`);
  return spawnX(cmd, args, { stdio: 'inherit' });
}

// spawnSync reports a missing binary as { status: null, error: ENOENT } and a
// signal death as { status: null, signal }. `(r.status || 0) === 0` reads both
// as success, so a machine without the CLI was told the install succeeded.
// Only an explicit exit code of 0 counts.
function ranOk(r) {
  return !!r && !r.error && r.status === 0;
}
function capture(cmd, args) {
  try { return spawnX(cmd, args, { encoding: 'utf8' }); } catch (_) { return { status: 1, stdout: '', stderr: '' }; }
}

// ── config dir ──────────────────────────────────────────────────────────────
function claudeDir(opts) {
  if (opts.configDir) return opts.configDir;
  if (process.env.CLAUDE_CONFIG_DIR) return process.env.CLAUDE_CONFIG_DIR;
  return path.join(os.homedir(), '.claude');
}

// Home dir for h3w-managed global targets. H3W_HOME overrides it
// (tests, containers); mirrors the CLAUDE_CONFIG_DIR precedent for Claude.
function homeDir() { return process.env.H3W_HOME || os.homedir(); }

function opencodeDir() { return getOpencodeDir({ home: homeDir() }); }
// Copilot CLI reads hooks, instructions and MCP config under COPILOT_HOME.
function copilotDir() { return process.env.COPILOT_HOME || path.join(homeDir(), '.copilot'); }
function opencodeStateDir() { return getOpencodeStateDir({ home: homeDir() }); }
function opencodeMajor() {
  let r = capture('opencode', ['--version']);
  if (!ranOk(r)) r = capture('opencode2', ['--version']);
  const match = ranOk(r) && String(r.stdout || '').match(/(\d+)\./);
  return match ? Number(match[1]) : 1;
}

// ── what is already installed ───────────────────────────────────────────────
// Every install path skips when h3w is already present, which is right for
// `npx github:MichaelNguyen5653/h3w` and useless for an upgrade: the run reports success and changes
// nothing. --update pairs this check with --force so a refresh touches exactly
// the agents that already have it.
function installedFor(id, opts) {
  try {
    switch (id) {
      case 'claude': {
        if (hasCmd('claude')) {
          const r = capture('claude', ['plugin', 'list']);
          if (r.status === 0 && /h3w/i.test(r.stdout || '')) return true;
        }
        const settings = SETTINGS.readSettings(path.join(claudeDir(opts), 'settings.json'));
        const hooks = (settings && settings.hooks) || {};
        for (const event of Object.keys(hooks)) {
          for (const entry of hooks[event] || []) {
            for (const h of (entry && entry.hooks) || []) {
              if (typeof h.command === 'string' && h.command.includes('h3w-')) return true;
            }
          }
        }
        return false;
      }
      case 'pi':
        return hasCmd('pi') && piSources(capture('pi', ['list']).stdout).length > 0;
      case 'gemini': {
        if (!hasCmd('gemini')) return false;
        const r = capture('gemini', ['extensions', 'list']);
        return r.status === 0 && /h3w/i.test(r.stdout || '');
      }
      case 'codex': {
        const md = path.join(homeDir(), '.codex', 'AGENTS.md');
        return fs.existsSync(md) && fs.readFileSync(md, 'utf8').includes(FENCE_BEGIN);
      }
      case 'opencode': {
        try {
          const md = path.join(opencodeDir(), 'AGENTS.md');
          if (fs.existsSync(md) && fs.readFileSync(md, 'utf8').includes(FENCE_BEGIN)) return true;
        } catch (_) {}
        return fs.existsSync(path.join(opencodeDir(), 'skills', 'h3w', 'SKILL.md'));
      }
      case 'hermes':
        return fs.existsSync(path.join(homeDir(), '.hermes', 'skills', 'h3w', 'SKILL.md'));
      case 'copilot-cli':
        return fs.existsSync(path.join(copilotDir(), 'hooks', 'h3w.json'));
      default: {
        const prov = PROVIDERS.find(x => x.id === id);
        return !!(prov && prov.rule && fs.existsSync(path.join(process.cwd(), prov.rule)));
      }
    }
  } catch (e) { return false; }
}

// ── Claude Code ─────────────────────────────────────────────────────────────
function installClaude(ctx) {
  const { say, note, warn, opts, results } = ctx;
  results.detected++;
  say('→ Claude Code detected');

  let pluginOK = false;
  if (hasCmd('claude')) {
    let already = false;
    if (!opts.force) {
      const r = capture('claude', ['plugin', 'list']);
      if (r.status === 0 && /h3w/i.test(r.stdout || '')) already = true;
    }
    if (already) {
      note('  h3w plugin already installed (use --force to reinstall)');
      results.skipped.push(['claude', 'plugin already installed']);
      pluginOK = true;
    } else {
      // `plugin install` is a no-op for an already-installed plugin, so an
      // upgrade (--update / --force) has to go through `plugin update`.
      const present = opts.force && /h3w/i.test(capture('claude', ['plugin', 'list']).stdout || '');
      const r1 = run('claude', ['plugin', 'marketplace', 'add', REPO], opts.dryRun);
      const r2 = run('claude', ['plugin', present ? 'update' : 'install', 'h3w@h3w'], opts.dryRun);
      if (ranOk(r1) && ranOk(r2)) { results.installed.push('claude'); pluginOK = true; }
      else warn('  claude plugin install failed, falling back to standalone hooks');
    }
  } else {
    note('  claude CLI not on PATH, wiring standalone hooks in settings.json');
  }

  if (!pluginOK) {
    const r = installClaudeHooks(ctx);
    if (r === 'ok') results.installed.push('claude-hooks');
    else if (r === 'skip') results.skipped.push(['claude-hooks', 'already wired']);
    else results.failed.push(['claude-hooks', r]);
  } else {
    note('  hooks: plugin manifest handles SessionStart + UserPromptSubmit + PostToolUse');
    // Plugin path won, so drop any standalone wiring left by an earlier run, or
    // both copies of every hook run on each event and the PostToolUse pair
    // dedups first-seen output against itself.
    const settingsPath = path.join(claudeDir(opts), 'settings.json');
    const settings = SETTINGS.readSettings(settingsPath);
    if (settings && SETTINGS.removeHooks(settings, 'h3w-') > 0) {
      if (!opts.dryRun) {
        SETTINGS.validateHookFields(settings);
        SETTINGS.writeSettings(settingsPath, settings);
      }
      note('  removed superseded standalone hook entries from settings.json');
    }
  }
  process.stdout.write('\n');
}

// Standalone wiring: copy hooks into <configDir>/h3w-hooks/ and merge
// settings.json. Used when the plugin path is unavailable.
function installClaudeHooks(ctx) {
  const { opts, warn, note } = ctx;
  const cfg = claudeDir(opts);
  const hooksSrc = path.join(REPO_ROOT, 'hooks');
  const hooksDst = path.join(cfg, 'h3w-hooks');
  const settingsPath = path.join(cfg, 'settings.json');
  const HOOK_FILES = ['package.json', 'h3w-config.js', 'h3w-activate.js',
                      'h3w-mode.js', 'h3w-mode-tracker.js', 'h3w-compress-output.js',
                      'h3w-statusline.sh', 'h3w-statusline.ps1'];

  if (opts.dryRun) {
    note(`  would copy ${HOOK_FILES.length} hook files → ${hooksDst}`);
    note(`  would merge SessionStart + UserPromptSubmit + PostToolUse + statusline → ${settingsPath}`);
    return 'ok';
  }

  fs.mkdirSync(hooksDst, { recursive: true });
  for (const f of HOOK_FILES) {
    const s = path.join(hooksSrc, f);
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(hooksDst, f));
  }
  try { fs.chmodSync(path.join(hooksDst, 'h3w-statusline.sh'), 0o755); } catch (_) {}

  const settings = SETTINGS.readSettings(settingsPath);
  if (settings === null) { warn('  settings.json unparseable; not touching it.'); return 'settings.json unparseable'; }

  const bak = settingsPath + '.bak';
  if (fs.existsSync(settingsPath) && !fs.existsSync(bak)) { try { fs.copyFileSync(settingsPath, bak); } catch (_) {} }

  const node = process.execPath;
  const activate = path.join(hooksDst, 'h3w-activate.js');
  const tracker = path.join(hooksDst, 'h3w-mode-tracker.js');
  const compress = path.join(hooksDst, 'h3w-compress-output.js');

  SETTINGS.addCommandHook(settings, 'SessionStart',
    { command: `"${node}" "${activate}"`, marker: 'h3w-activate', timeout: 5, statusMessage: 'Loading h3w mode...' });
  SETTINGS.addCommandHook(settings, 'UserPromptSubmit',
    { command: `"${node}" "${tracker}"`, marker: 'h3w-mode-tracker', timeout: 5, statusMessage: 'Tracking h3w mode...' });
  SETTINGS.addCommandHook(settings, 'PostToolUse',
    { command: `"${node}" "${compress}"`, marker: 'h3w-compress-output', timeout: 10,
      matcher: 'Bash|Agent|WebFetch|WebSearch|Grep|Glob|mcp__.*', statusMessage: 'Compressing tool output...' });

  const psHost = IS_WIN && hasCmd('pwsh') ? 'pwsh' : (IS_WIN ? 'powershell' : null);
  const slCmd = IS_WIN
    ? `${psHost} -NoProfile -ExecutionPolicy Bypass -File "${path.join(hooksDst, 'h3w-statusline.ps1')}"`
    : `bash "${path.join(hooksDst, 'h3w-statusline.sh')}"`;
  if (!settings.statusLine) {
    settings.statusLine = { type: 'command', command: slCmd };
    process.stdout.write('  statusline badge configured.\n');
  } else {
    const existing = typeof settings.statusLine === 'string' ? settings.statusLine : (settings.statusLine.command || '');
    if (existing.includes('h3w-statusline')) process.stdout.write('  statusline badge already configured.\n');
    else process.stdout.write('  NOTE: existing statusline detected, H3W badge NOT added (see docs/install-windows.md).\n');
  }

  SETTINGS.validateHookFields(settings);
  SETTINGS.writeSettings(settingsPath, settings);
  process.stdout.write(`  hooks wired in ${settingsPath}\n`);
  return 'ok';
}

// ── Pi ──────────────────────────────────────────────────────────────────────
function piSources(output) {
  return String(output || '').split('\n').map(line => line.trim())
    .filter(line => /^git:.*github\.com\/MichaelNguyen5653\/h3w(?:@|$)/i.test(line))
    .map(source => source.replace(/@[^/@]+$/, ''));
}

function installPi(ctx) {
  const { say, note, opts, results } = ctx;
  results.detected++;
  say('→ Pi detected');
  if (!opts.force) {
    const installed = piSources(capture('pi', ['list']).stdout);
    if (installed.length) {
      note('  h3w package already installed (use --force)');
      results.skipped.push(['pi', 'already installed']); process.stdout.write('\n'); return;
    }
  }
  const r = run('pi', ['install', 'git:github.com/MichaelNguyen5653/h3w'], opts.dryRun);
  if (ranOk(r)) results.installed.push('pi');
  else results.failed.push(['pi', 'pi package install failed']);
  process.stdout.write('\n');
}

// ── Gemini ──────────────────────────────────────────────────────────────────
function installGemini(ctx) {
  const { say, note, opts, results } = ctx;
  results.detected++;
  say('→ Gemini CLI detected');
  if (!opts.force) {
    const r = capture('gemini', ['extensions', 'list']);
    if (r.status === 0 && /h3w/i.test(r.stdout || '')) {
      note('  h3w extension already installed (use --force)');
      results.skipped.push(['gemini', 'already installed']); process.stdout.write('\n'); return;
    }
  }
  const r = run('gemini', ['extensions', 'install', `https://github.com/${REPO}`], opts.dryRun);
  if (ranOk(r)) results.installed.push('gemini');
  else results.failed.push(['gemini', 'gemini extensions install failed']);
  process.stdout.write('\n');
}

// Skills-root helpers for Agent-Skills hosts (OpenCode, Hermes). Both load
// one dir per skill through the host's native `skill` tool, so the bundled
// skills/ tree copies over verbatim: no conversion, no second system
// message, existing user instructions untouched.
function ownedSkillNames() {
  var srcRoot = path.join(REPO_ROOT, 'skills');
  try {
    return fs.readdirSync(srcRoot).filter(function (n) {
      try {
        return fs.statSync(path.join(srcRoot, n)).isDirectory()
          && fs.existsSync(path.join(srcRoot, n, 'SKILL.md'));
      } catch (_) { return false; }
    });
  } catch (_) { return []; }
}

// Overwrites stale files, keeps foreign siblings, never touches files
// outside the named skill dirs. Returns files written.
function copySkills(dstRoot, opts) {
  var names = ownedSkillNames();
  var written = 0;
  for (var i = 0; i < names.length; i++) {
    var src = path.join(REPO_ROOT, 'skills', names[i]);
    var dst = path.join(dstRoot, names[i]);
    var files = fs.readdirSync(src);
    if (!opts.dryRun) fs.mkdirSync(dst, { recursive: true });
    for (var j = 0; j < files.length; j++) {
      var st = null;
      try { st = fs.statSync(path.join(src, files[j])); } catch (_) { continue; }
      if (!st.isFile()) continue;
      if (opts.dryRun) { written++; continue; }
      fs.copyFileSync(path.join(src, files[j]), path.join(dst, files[j]));
      written++;
    }
  }
  return written;
}

// Removes only the skill dirs h3w owns; foreign skills stay put.
function pruneSkills(dstRoot) {
  var removed = 0;
  var names = ownedSkillNames();
  for (var i = 0; i < names.length; i++) {
    var dst = path.join(dstRoot, names[i]);
    if (fs.existsSync(dst)) {
      fs.rmSync(dst, { recursive: true, force: true });
      removed++;
    }
  }
  return removed;
}

// Fenced AGENTS.md append/refresh for Codex-style targets. Appends after
// existing content (never prepends, never clobbers), refreshes one fenced
// block in place under --force. Returns 'installed', 'refreshed', 'skipped'.
function writeFencedRuleset(target, opts, note) {
  var raw = fs.readFileSync(path.join(REPO_ROOT, 'AGENTS.md'), 'utf8');
  var block = FENCE_BEGIN + '\n' + raw.trimEnd() + '\n' + FENCE_END + '\n';
  fs.mkdirSync(path.dirname(target), { recursive: true });
  var existing = '';
  try { existing = fs.readFileSync(target, 'utf8'); } catch (_) {}
  if (existing.indexOf(FENCE_BEGIN) !== -1) {
    if (!opts.force) {
      note('  ' + target + ' already contains h3w ruleset (--force to refresh)');
      return 'skipped';
    }
    var b = existing.indexOf(FENCE_BEGIN);
    var e = existing.indexOf(FENCE_END, b);
    // A begin marker with no end marker means the file was hand-edited or a
    // write was cut short. Everything after the begin marker is then user
    // content of unknown extent, so refuse rather than guess: rewriting would
    // delete the rest of their global instructions.
    if (e === -1) {
      note('  ' + target + ' has a h3w-begin marker with no h3w-end; leaving it alone');
      note('  remove the stray marker by hand, then re-run');
      return 'skipped';
    }
    var tail = existing.slice(e + FENCE_END.length);
    if (tail.charAt(0) === '\n') tail = tail.slice(1);
    fs.writeFileSync(target, existing.slice(0, b) + block + tail, { mode: 0o644 });
    process.stdout.write('  refreshed ruleset in ' + target + '\n');
    return 'refreshed';
  }
  var sep = '';
  if (existing) {
    if (existing.slice(-2) === '\n\n') sep = '';
    else if (existing.slice(-1) === '\n') sep = '\n';
    else sep = '\n\n';
  }
  fs.writeFileSync(target, existing + sep + block, { mode: 0o644 });
  process.stdout.write('  installed: ' + target + '\n');
  return 'installed';
}

// ── Codex (fenced ruleset in ~/.codex/AGENTS.md) ────────────────────────────
const FENCE_BEGIN = '<!-- h3w-begin -->';
const FENCE_END = '<!-- h3w-end -->';

function installCodex(ctx) {
  const { say, note, opts, results } = ctx;
  results.detected++;
  say('\u2192 Codex detected');
  const target = path.join(homeDir(), '.codex', 'AGENTS.md');

  if (opts.dryRun) { note('  would write h3w ruleset to ' + target); results.installed.push('codex'); process.stdout.write('\n'); return; }

  try {
    const st = writeFencedRuleset(target, opts, note);
    if (st === 'installed') results.installed.push('codex');
    else results.skipped.push(['codex', 'already present']);
  } catch (e) { results.failed.push(['codex', (e && e.message) || 'write failed']); }
  process.stdout.write('\n');
}

// ── OpenCode ─────────────────────────────────────────────────────────────
// Global AGENTS.md carries the always-on output axis next to existing user
// instructions; the bundled skills copy under the same OpenCode config root
// for on-demand loading via the native skill tool
// (the global skills dir is scanned by default, so skills.paths needs no
// edit and no second system message is added).
// Copies the version-matched OpenCode plugin and shared compressor core.
// V1 gets plugins/h3w.js; V2 gets the directory plugin plugins/h3w/.
// The source entrypoints stay separate and both load the same CommonJS core.
// h3w-hooks/package.json pins that core as CommonJS under type:module roots.
function copyOpencodePlugin(root, major) {
  const pluginDir = path.join(root, 'plugins');
  const v2 = major >= 2;
  const entryDir = v2 ? path.join(pluginDir, 'h3w') : pluginDir;
  const hooksDir = path.join(entryDir, 'h3w-hooks');
  const files = [
    [v2 ? '.opencode/plugins-v2/h3w/index.mjs' : '.opencode/plugins/h3w.mjs', path.join(entryDir, v2 ? 'index.js' : 'h3w.js')],
    ...(v2 ? [['.opencode/plugins-v2/h3w/setup.cjs', path.join(entryDir, 'setup.cjs')]] : []),
    ['hooks/h3w-compress-output.js', path.join(hooksDir, 'h3w-compress-output.js')],
    ['hooks/h3w-config.js', path.join(hooksDir, 'h3w-config.js')],
  ];
  fs.mkdirSync(hooksDir, { recursive: true });
  var n = 0;
  for (var i = 0; i < files.length; i++) {
    fs.copyFileSync(path.join(REPO_ROOT, files[i][0]), files[i][1]);
    n++;
  }
  fs.writeFileSync(path.join(hooksDir, 'package.json'), '{ "type": "commonjs" }\n');
  n++;
  return n;
}

function installOpencode(ctx) {
  const { say, note, opts, results } = ctx;
  results.detected++;
  say('\u2192 OpenCode detected');
  const root = opencodeDir();
  const target = path.join(root, 'AGENTS.md');
  const skillsDst = path.join(root, 'skills');
  const major = opencodeMajor();
  const pluginDst = path.join(root, 'plugins', major >= 2 ? 'h3w' : '');

  if (opts.dryRun) {
    note('  would write h3w ruleset to ' + target);
    note('  would copy skills to ' + skillsDst);
    note('  would copy compression plugin to ' + pluginDst);
    results.installed.push('opencode');
    process.stdout.write('\n');
    return;
  }

  try {
    const st = writeFencedRuleset(target, opts, note);
    const stale = major >= 2 ? ['h3w.js', 'h3w-hooks'] : ['h3w'];
    for (const rel of stale) fs.rmSync(path.join(root, 'plugins', rel), { recursive: true, force: true });
    const n = copySkills(skillsDst, opts);
    process.stdout.write('  installed: ' + n + ' skill file(s) to ' + skillsDst + '\n');
    const p = copyOpencodePlugin(root, major);
    process.stdout.write('  installed: ' + p + ' plugin file(s) to ' + pluginDst + '\n');
    if (st === 'installed') results.installed.push('opencode');
    else results.skipped.push(['opencode', 'ruleset already present; skills + plugin refreshed']);
  } catch (e) { results.failed.push(['opencode', (e && e.message) || 'write failed']); }
  process.stdout.write('\n');
}

// ── Copilot CLI ─────────────────────────────────────────────────────────────
// Rules: fenced block in ~/.copilot/copilot-instructions.md, Copilot CLI's
// user-level instructions file. Input axis: a user-level postToolUse hook
// (~/.copilot/hooks/h3w.json, no workspace admission needed) running the
// shared compressor, which already speaks Copilot's camelCase payload and
// answers with modifiedResult. Verified live on Copilot CLI 1.0.95: a
// 13.9k-char shell result reached the model at ~100 lines with the mid-log
// error line and the `<shellId: 0 completed with exit code 0>` tail intact.
function copilotHookConfig(hookPath) {
  return JSON.stringify({
    version: 1,
    hooks: {
      postToolUse: [{
        type: 'command',
        bash: 'node "' + hookPath + '"',
        powershell: 'node "' + hookPath + '"',
        timeoutSec: 10,
      }],
    },
  }, null, 2) + '\n';
}

function installCopilotCli(ctx) {
  const { say, note, opts, results } = ctx;
  results.detected++;
  say('\u2192 Copilot CLI detected');
  const root = copilotDir();
  const rules = path.join(root, 'copilot-instructions.md');
  const hooksDir = path.join(root, 'h3w-hooks');
  const hookFile = path.join(root, 'hooks', 'h3w.json');

  if (opts.dryRun) {
    note('  would write h3w ruleset to ' + rules);
    note('  would copy compressor to ' + hooksDir);
    note('  would write postToolUse hook ' + hookFile);
    results.installed.push('copilot-cli');
    process.stdout.write('\n');
    return;
  }

  try {
    const st = writeFencedRuleset(rules, opts, note);
    fs.mkdirSync(hooksDir, { recursive: true });
    for (const f of ['h3w-compress-output.js', 'h3w-config.js']) {
      fs.copyFileSync(path.join(REPO_ROOT, 'hooks', f), path.join(hooksDir, f));
    }
    fs.writeFileSync(path.join(hooksDir, 'package.json'), '{ "type": "commonjs" }\n');
    const hookExisted = fs.existsSync(hookFile);
    if (!hookExisted || opts.force) {
      fs.mkdirSync(path.dirname(hookFile), { recursive: true });
      fs.writeFileSync(hookFile, copilotHookConfig(path.join(hooksDir, 'h3w-compress-output.js')), { mode: 0o644 });
      process.stdout.write('  installed: ' + hookFile + '\n');
    }
    if (st === 'installed' || !hookExisted) results.installed.push('copilot-cli');
    else results.skipped.push(['copilot-cli', 'already present; compressor refreshed']);
  } catch (e) { results.failed.push(['copilot-cli', (e && e.message) || 'write failed']); }
  process.stdout.write('\n');
}

// ── Hermes ──────────────────────────────────────────────────────────
// Agent-Skills host: bundled skills land verbatim in ~/.hermes/skills, where
// Hermes discovers them as /h3w slash commands. No ruleset is injected:
// Hermes already reads project AGENTS.md, which carries the always-on axis
// when the repo ships it. Portable: honors H3W_HOME, no hardcoded paths.
function installHermes(ctx) {
  const { say, opts, results } = ctx;
  results.detected++;
  say('\u2192 Hermes Agent detected');
  const skillsDst = path.join(homeDir(), '.hermes', 'skills');

  if (opts.dryRun) {
    process.stdout.write('  would copy skills to ' + skillsDst + '\n');
    results.installed.push('hermes');
    process.stdout.write('\n');
    return;
  }

  try {
    const n = copySkills(skillsDst, opts);
    process.stdout.write('  installed: ' + n + ' skill file(s) to ' + skillsDst + '\n');
    results.installed.push('hermes');
  } catch (e) { results.failed.push(['hermes', (e && e.message) || 'copy failed']); }
  process.stdout.write('\n');
}

// ── Project-scoped rule agents (Cursor/Windsurf/Cline/Kiro/Copilot/Antigravity)
function installProjectRule(ctx, prov) {
  const { say, note, warn, opts, results } = ctx;
  results.detected++;
  say(`→ ${prov.label} detected`);
  const src = path.join(REPO_ROOT, prov.rule);
  const dst = path.join(process.cwd(), prov.rule);

  if (!fs.existsSync(src)) { warn(`  missing source rule ${prov.rule} (run scripts/build-rules.js)`); results.failed.push([prov.id, 'source rule missing']); process.stdout.write('\n'); return; }

  if (opts.dryRun) { note(`  would write ${dst} (project-scoped)`); results.installed.push(prov.id); process.stdout.write('\n'); return; }

  if (fs.existsSync(dst) && !opts.force) {
    note(`  ${prov.rule} already in this project (--force to overwrite)`);
    results.skipped.push([prov.id, 'already in project']); process.stdout.write('\n'); return;
  }
  try {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    process.stdout.write(`  installed: ${dst}  (project-scoped)\n`);
    results.installed.push(prov.id);
  } catch (e) { results.failed.push([prov.id, (e && e.message) || 'copy failed']); }
  process.stdout.write('\n');
}

// ── uninstall ───────────────────────────────────────────────────────────────
function uninstall(ctx) {
  const { say, note, warn, opts, c } = ctx;
  say(c.orange('h3w uninstall'));
  let touched = 0;

  const wants = id => !opts.only.length || opts.only.includes(id);

  if (wants('claude')) {
    // Claude plugin
    if (hasCmd('claude') && !opts.dryRun) {
      const r = capture('claude', ['plugin', 'list']);
      if (r.status === 0 && /h3w/i.test(r.stdout || '')) {
        run('claude', ['plugin', 'uninstall', 'h3w@h3w'], opts.dryRun); touched++;
      }
    }

    // Claude standalone hooks + statusline
    const cfg = claudeDir(opts);
    const settingsPath = path.join(cfg, 'settings.json');
    const settings = SETTINGS.readSettings(settingsPath);
    if (settings) {
      const removed = SETTINGS.removeHooks(settings, 'h3w-');
      let slRemoved = false;
      if (settings.statusLine && typeof settings.statusLine.command === 'string'
          && settings.statusLine.command.includes('h3w-statusline')) { delete settings.statusLine; slRemoved = true; }
      if (removed > 0 || slRemoved) {
        if (!opts.dryRun) { SETTINGS.validateHookFields(settings); SETTINGS.writeSettings(settingsPath, settings); }
        note(`  removed ${removed} hook entr${removed === 1 ? 'y' : 'ies'}${slRemoved ? ' + statusline' : ''} from settings.json`);
        touched++;
      }
    }
    // Tool schemas denied by `npx github:MichaelNguyen5653/h3w tools trim`: remove exactly those entries.
    try {
      const restored = TOOLS.restore(cfg, { dryRun: opts.dryRun });
      if (restored.length) { note(`  removed tool deny entries added by h3w: ${restored.join(', ')}`); touched++; }
    } catch (e) { warn('  ' + e.message); }
    for (const d of ['h3w-hooks', 'h3w-spill']) {
      const dst = path.join(cfg, d);
      if (fs.existsSync(dst)) { if (!opts.dryRun) fs.rmSync(dst, { recursive: true, force: true }); note(`  removed ${dst}`); touched++; }
    }

    for (const f of ['.h3w-active', '.h3w-session-turns', '.h3w-statusline-suffix',
                     '.h3w-compress-stats.json', '.h3w-compress-last.json', '.h3w-update-check.json']) {
      const p = path.join(cfg, f);
      if (fs.existsSync(p)) { if (!opts.dryRun) { try { fs.unlinkSync(p); } catch (_) {} } note(`  removed ${p}`); touched++; }
    }
  }

  if (wants('pi') && hasCmd('pi')) {
    const sources = piSources(capture('pi', ['list']).stdout);
    for (const source of sources) {
      if (ranOk(run('pi', ['remove', source], opts.dryRun))) touched++;
    }
  }

  if (wants('codex')) {
    const codexMd = path.join(homeDir(), '.codex', 'AGENTS.md');
    if (fs.existsSync(codexMd)) {
      const txt = fs.readFileSync(codexMd, 'utf8');
      if (txt.includes(FENCE_BEGIN)) {
        const stripped = txt.replace(new RegExp(`\\n?${FENCE_BEGIN}[\\s\\S]*?${FENCE_END}\\n?`), '\n').replace(/\n{3,}/g, '\n\n');
        if (!opts.dryRun) fs.writeFileSync(codexMd, stripped, { mode: 0o644 });
        note(`  removed h3w block from ${codexMd}`); touched++;
      }
    }
  }

  if (wants('opencode')) {
    const ocRoot = opencodeDir();
    const ocState = opencodeStateDir();
    const ocMd = path.join(ocRoot, 'AGENTS.md');
    if (fs.existsSync(ocMd)) {
      const txt = fs.readFileSync(ocMd, 'utf8');
      const b = txt.indexOf(FENCE_BEGIN);
      const e = b === -1 ? -1 : txt.indexOf(FENCE_END, b);
      if (b !== -1 && e === -1) {
        note('  ' + ocMd + ' has a h3w-begin marker with no h3w-end; leaving it alone');
      } else if (b !== -1) {
        const tail = txt.slice(e + FENCE_END.length).replace(/^\n/, '');
        const stripped = (txt.slice(0, b) + tail).replace(/\n{3,}/g, '\n\n');
        if (!opts.dryRun) fs.writeFileSync(ocMd, stripped, { mode: 0o644 });
        note('  removed h3w block from ' + ocMd); touched++;
      }
    }
    const ocSkills = path.join(ocRoot, 'skills');
    const ocGone = opts.dryRun ? ownedSkillNames().filter(function (nm) { return fs.existsSync(path.join(ocSkills, nm)); }).length : pruneSkills(ocSkills);
    if (ocGone > 0) { note('  removed ' + ocGone + ' h3w skill dir(s) from ' + ocSkills); touched++; }

    const ocPlugins = path.join(ocRoot, 'plugins');
    for (const rel of ['h3w.js', 'h3w-hooks', 'h3w']) {
      const dst = path.join(ocPlugins, rel);
      if (fs.existsSync(dst)) { if (!opts.dryRun) fs.rmSync(dst, { recursive: true, force: true }); note('  removed ' + dst); touched++; }
    }
    for (const f of ['h3w-spill', 'h3w-dedup', '.h3w-compress-stats.json', '.h3w-compress-last.json']) {
      const p = path.join(ocState, f);
      if (fs.existsSync(p)) { if (!opts.dryRun) fs.rmSync(p, { recursive: true, force: true }); note('  removed ' + p); touched++; }
    }
  }

  if (wants('hermes')) {
    const hSkills = path.join(homeDir(), '.hermes', 'skills');
    const hGone = opts.dryRun ? ownedSkillNames().filter(function (nm) { return fs.existsSync(path.join(hSkills, nm)); }).length : pruneSkills(hSkills);
    if (hGone > 0) { note('  removed ' + hGone + ' h3w skill dir(s) from ' + hSkills); touched++; }
  }

  if (wants('copilot-cli')) {
    const cpRoot = copilotDir();
    const cpMd = path.join(cpRoot, 'copilot-instructions.md');
    if (fs.existsSync(cpMd)) {
      const txt = fs.readFileSync(cpMd, 'utf8');
      const b = txt.indexOf(FENCE_BEGIN);
      const e = b === -1 ? -1 : txt.indexOf(FENCE_END, b);
      if (b !== -1 && e !== -1) {
        const tail = txt.slice(e + FENCE_END.length).replace(/^\n/, '');
        const stripped = (txt.slice(0, b) + tail).replace(/\n{3,}/g, '\n\n').replace(/\n{2,}$/, '\n');
        if (!opts.dryRun) fs.writeFileSync(cpMd, stripped, { mode: 0o644 });
        note('  removed h3w block from ' + cpMd); touched++;
      }
    }
    for (const rel of [path.join('hooks', 'h3w.json'), 'h3w-hooks', 'h3w-spill', 'h3w-dedup',
                       '.h3w-compress-stats.json']) {
      const p = path.join(cpRoot, rel);
      if (fs.existsSync(p)) { if (!opts.dryRun) fs.rmSync(p, { recursive: true, force: true }); note('  removed ' + p); touched++; }
    }
  }

  // MCP servers routed through the proxy by `npx github:MichaelNguyen5653/h3w mcp wrap`: restore
  // their original commands before anything else could remove the proxy.
  if (!opts.only.length) {
    const r = MCP.run(['unwrap'].concat(opts.dryRun ? ['--dry-run'] : []), () => {});
    if (r.changed) { note('  restored ' + r.changed + ' MCP server command(s) wrapped by `h3w mcp wrap`'); touched++; }
    const pd = MCP.proxyDir();
    if (fs.existsSync(pd)) { if (!opts.dryRun) fs.rmSync(pd, { recursive: true, force: true }); note('  removed ' + pd); touched++; }
  }

  if (!opts.only.length || opts.only.some(id => PROVIDERS.find(p => p.id === id).scope === 'project')) {
    note('');
    note('Project-scoped rule files (.cursor/, .windsurf/, .clinerules/, .kiro/, .agents/rules/, .github/copilot-instructions.md)');
    note('live in your project repos, so remove them per-project with git if you added them there.');
  }
  say(touched ? c.green(`\nUninstalled. ${touched} item(s) cleaned.`) : c.yellow('\nNothing to uninstall.'));
}

// ── help / banner ───────────────────────────────────────────────────────────
function printHelp(c) {
  process.stdout.write(`${c.orange('h3w')}: maximum-efficiency dev mode installer

Usage:
  npx github:MichaelNguyen5653/h3w [flags]

Flags:
  --list           Detect agents and print them; install nothing
  --stats          Print tool-output savings recorded so far; change nothing
  --update         Refresh every agent that already has h3w; install none
  --only <id>      Limit install/uninstall to one agent (repeatable)
  --dry-run        Print actions, change nothing
  --force          Reinstall / overwrite even if already present
  --uninstall, -u  Remove what h3w installed (also restores wrapped MCP servers)
  --config-dir <p> Override Claude config dir (default: $CLAUDE_CONFIG_DIR or ~/.claude)
  --no-color       Disable ANSI color
  --help, -h       This help

Agents: ${PROVIDERS.map(p => p.id).join(', ')}

MCP output compression (opt-in, any agent that launches stdio MCP servers):
  npx github:MichaelNguyen5653/h3w mcp wrap   [--only <id>] [--file <mcp.json>] [--dry-run]
  npx github:MichaelNguyen5653/h3w mcp unwrap [--only <id>] [--file <mcp.json>] [--dry-run]
  npx github:MichaelNguyen5653/h3w mcp status
  Targets: ${[...new Set(MCP.targets().map(t => t.id))].join(', ')}. Never Claude Code
  (its own hook already compresses MCP output).

Tool schemas (Claude Code; every request carries every loaded tool's schema):
  npx github:MichaelNguyen5653/h3w tools            # schema size vs. your own calls, last 30 days
  npx github:MichaelNguyen5653/h3w tools trim       # deny the heavy tools you have not used [--days N] [--dry-run]
  npx github:MichaelNguyen5653/h3w tools restore    # remove exactly what trim added

Examples:
  npx github:MichaelNguyen5653/h3w                  # auto-detect + install
  npx github:MichaelNguyen5653/h3w --only claude    # just Claude Code
  npx github:MichaelNguyen5653/h3w --dry-run        # preview
  npx github:MichaelNguyen5653/h3w --stats          # what the compressor has saved
  npx github:MichaelNguyen5653/h3w mcp wrap         # compress MCP tool output in Cursor, Codex, Gemini, ...
  npx github:MichaelNguyen5653/h3w --update  # upgrade what is already installed
`);
}

// ── stats ───────────────────────────────────────────────────────────────────
// Reads the compressor's ledger. Input axis only, and deliberately so: chars
// elided have a real baseline (we know exactly what was cut), while the output
// axis has none, since there is no way to know what the model would have written
// without the ruleset, which is what the benchmark arms are for. A counter that
// blended the two would be inventing the interesting half.
function printStats(c, opts) {
  const only = opts.only.length === 1 ? opts.only[0] : null;
  const dir = only === 'opencode' ? opencodeStateDir()
    : only === 'copilot-cli' ? copilotDir()
    : claudeDir(opts);
  const p = path.join(dir, '.h3w-compress-stats.json');
  process.stdout.write(c.orange('h3w') + ': tool-output savings\n\n');

  let stats = null;
  try {
    if (!fs.lstatSync(p).isSymbolicLink()) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (parsed && Number.isFinite(parsed.savedChars) && Number.isFinite(parsed.events)) stats = parsed;
    }
  } catch (e) {}

  if (!stats || stats.events === 0) {
    process.stdout.write('  no compression recorded yet\n\n');
    process.stdout.write(c.dim(`  ledger: ${p}\n`));
    process.stdout.write(c.dim('  it fills as the compressor elides oversized tool output.\n'));
    process.stdout.write(c.dim("  nothing there after real use? check `npx github:MichaelNguyen5653/h3w --list` and that h3w is active.\n"));
    return;
  }

  const chars = stats.savedChars;
  const tokens = Math.floor(chars / 4);
  const per = Math.round(chars / stats.events);
  const fmt = (n) => n.toLocaleString('en-US');
  process.stdout.write(`  saved:      ${c.green(fmt(chars) + ' chars')}  (~${fmt(tokens)} tokens)\n`);
  process.stdout.write(`  outputs:    ${fmt(stats.events)} compressed, ${fmt(per)} chars each on average\n\n`);
  process.stdout.write(c.dim('  A floor, not an estimate: every saved byte also stops being re-sent\n'));
  process.stdout.write(c.dim('  on every later request in that session.\n\n'));
  process.stdout.write(c.dim(`  ledger: ${p}\n`));
  process.stdout.write(c.dim('  per-transcript detail: node benchmarks/replay-compress.js (in a repo clone)\n'));
}

function printList(c) {
  process.stdout.write(c.orange('h3w') + ': detected agents:\n\n');
  for (const p of PROVIDERS) {
    const found = providerDetected(p);
    const mark = found ? c.green('✓') : c.dim('·');
    const scope = p.scope === 'project' ? c.dim(' (project-scoped)') : '';
    process.stdout.write(`  ${mark} ${p.label}${scope}\n`);
  }
  process.stdout.write('\nRun ' + c.orange('npx github:MichaelNguyen5653/h3w') + ' to install for the detected (✓) agents.\n');
}

// ── main ────────────────────────────────────────────────────────────────────
function main() {
  if (process.argv[2] === 'mcp') return MCP.main(process.argv.slice(3));
  if (process.argv[2] === 'tools') {
    const args = process.argv.slice(3);
    const i = args.indexOf('--config-dir');
    const dir = i >= 0 ? expandHome(args.splice(i, 2)[1] || '') : claudeDir({});
    try { return TOOLS.main(args, dir); } catch (e) { die('error: ' + e.message); }
  }
  const opts = parseArgs(process.argv.slice(2));
  const c = makeChalk(opts.noColor);

  if (opts.help) return printHelp(c);
  if (opts.list) return printList(c);
  if (opts.stats) return printStats(c, opts);

  const results = { detected: 0, installed: [], skipped: [], failed: [] };
  const say = (s) => process.stdout.write(s + '\n');
  const note = (s) => process.stdout.write(c.dim(s) + '\n');
  const warn = (s) => process.stdout.write(c.yellow(s) + '\n');
  const ctx = { say, note, warn, opts, results, c };

  if (opts.uninstall) return uninstall(ctx);

  say(c.orange(opts.update ? '╭─ h3w updater ─╮' : '╭─ h3w installer ─╮'));
  say(c.dim(opts.dryRun ? '  (dry run, nothing will change)' : '  maximum signal, minimum noise'));
  say('');

  let targets = PROVIDERS.filter(p => opts.only.length ? opts.only.includes(p.id) : providerDetected(p));
  if (opts.update) targets = targets.filter(p => installedFor(p.id, opts));
  if (targets.length === 0) {
    if (opts.update) {
      warn('Nothing to update: h3w is not installed for any detected agent.');
      note('Run `npx github:MichaelNguyen5653/h3w` to install it, or `npx github:MichaelNguyen5653/h3w --list` to see what we look for.');
      note('Project-scoped agents (Cursor, Windsurf, Cline, Kiro, Copilot, Antigravity) are per-repo:');
      note('run this from the project that has the rule file.');
      return;
    }
    warn('No supported agents detected.');
    note('Run `npx github:MichaelNguyen5653/h3w --list` to see what we look for, or `--only <id>` to force one.');
    return;
  }

  for (const p of targets) {
    if (p.id === 'claude') installClaude(ctx);
    else if (p.id === 'pi') installPi(ctx);
    else if (p.id === 'gemini') installGemini(ctx);
    else if (p.id === 'codex') installCodex(ctx);
    else if (p.id === 'opencode') installOpencode(ctx);
    else if (p.id === 'hermes') installHermes(ctx);
    else if (p.id === 'copilot-cli') installCopilotCli(ctx);
    else installProjectRule(ctx, p);
  }

  // Summary
  say(c.orange('── summary ──'));
  say(`  detected:  ${results.detected}`);
  if (results.installed.length) say(c.green(`  installed: ${results.installed.join(', ')}`));
  if (results.skipped.length)   say(c.dim(`  skipped:   ${results.skipped.map(s => s[0]).join(', ')}`));
  if (results.failed.length)    say(c.red(`  failed:    ${results.failed.map(s => s[0] + ' (' + s[1] + ')').join(', ')}`));
  say('');
  if (!opts.dryRun && results.installed.length) {
    say(c.orange('Done.') + ' Restart your agent. Type ' + c.orange('/h3w') + ' in Claude Code or Pi, or just start coding.');
    note('If h3w earns its keep, a star helps others find it: https://github.com/MichaelNguyen5653/h3w');
  }
  process.exit(results.failed.length ? 1 : 0);
}

main();
