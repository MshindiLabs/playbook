#!/usr/bin/env node
// Adds the guard hooks to an agent's user-level config, or removes them.
//
//   node install.mjs                    print what would change; change nothing
//   node install.mjs --apply            write the entries (each changed file is backed up first)
//   node install.mjs --remove --apply   delete exactly the hooks this script added
//   node install.mjs --check            report each installed hook and whether its script exists
//   node install.mjs --agent codex      limit to one agent: claude or codex
//
// --apply copies this scripts directory to ~/.playbook/guard-hooks/scripts and points the hooks
// at the copy, so removing or updating the skill cannot leave a hook pointing at nothing. A hook
// whose script is missing fails open: the agent runs the tool and nothing says a guard is off.
//
// Without --agent it covers Claude Code, and Codex when ~/.codex exists. Claude Code reads
// ~/.claude/settings.json. Codex reads ~/.codex/hooks.json. Cursor imports the Claude Code
// entries from ~/.claude/settings.json and needs none of its own.
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
/** Every hook this script owns has this in its command, which is how it finds them again. */
const MARKER = 'guard-hooks/scripts/guard.mjs';

/** Where the scripts are copied to, and where every hook points. */
export const installedDir = (home) => join(home, '.playbook', 'guard-hooks', 'scripts');
export const installedGuard = (home) => join(installedDir(home), 'guard.mjs');

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? filesUnder(path) : [path];
    })
    .sort();
}

/** One hash over every file in a scripts directory, or null when the directory is missing. */
function fingerprint(dir) {
  if (!existsSync(dir)) return null;
  const hash = createHash('sha256');
  for (const file of filesUnder(dir)) {
    hash.update(relative(dir, file).split(sep).join('/'));
    hash.update(readFileSync(file));
  }
  return hash.digest('hex');
}

const sameDir = (a, b) => existsSync(a) && existsSync(b) && realpathSync(a) === realpathSync(b);

const TARGETS = {
  claude: {
    dir: (home) => join(home, '.claude'),
    file: (home) => join(home, '.claude', 'settings.json'),
    preToolMatchers: ['Bash', 'Edit|Write|MultiEdit|NotebookEdit'],
    // Claude Code tells a Stop hook when it is already continuing, which is what stops a loop.
    stop: true,
  },
  codex: {
    dir: (home) => join(home, '.codex'),
    file: (home) => join(home, '.codex', 'hooks.json'),
    preToolMatchers: ['Bash', 'apply_patch|Edit|Write'],
    stop: false,
  },
};

/** The hook entries for one agent, keyed by event. */
export function entriesFor(agent, guardPath) {
  const target = TARGETS[agent];
  const command = (event) => `node "${guardPath}" ${event} --agent ${agent}`;
  const entries = {
    PreToolUse: target.preToolMatchers.map((matcher) => ({
      matcher,
      hooks: [{ type: 'command', command: command('pre-tool'), timeout: 10 }],
    })),
  };
  if (target.stop)
    entries.Stop = [{ hooks: [{ type: 'command', command: command('stop'), timeout: 300 }] }];
  return entries;
}

const isOurs = (hook) => String(hook?.command ?? '').includes(MARKER);

/**
 * Returns the config with our hooks removed and, unless removing, the current ones added.
 * Only our own hooks are touched: a group that also holds someone else's hook keeps that hook,
 * and events we have nothing in are returned as they were.
 */
export function merge(config, entries, remove) {
  const hooks = { ...(config.hooks ?? {}) };
  const ownsOne = (group) => Array.isArray(group?.hooks) && group.hooks.some(isOurs);
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups) || !groups.some(ownsOne)) continue;
    // Only a group that held one of our hooks is rewritten, and dropped if nothing else was in it.
    const kept = groups.flatMap((group) => {
      if (!ownsOne(group)) return [group];
      const others = group.hooks.filter((hook) => !isOurs(hook));
      return others.length > 0 ? [{ ...group, hooks: others }] : [];
    });
    if (kept.length > 0) hooks[event] = kept;
    else delete hooks[event];
  }
  if (!remove) {
    for (const [event, groups] of Object.entries(entries)) {
      const existing = hooks[event] ?? [];
      if (!Array.isArray(existing))
        throw new Error(`hooks.${event} is not a list, so nothing can be added to it`);
      hooks[event] = [...existing, ...groups];
    }
  }
  const next = { ...config, hooks };
  if (Object.keys(hooks).length === 0 && config.hooks === undefined) delete next.hooks;
  return next;
}

/** Plans the change for one agent: `{ file, before, after, changed }`. Throws on a config it cannot read as an object. */
export function plan(agent, { home, guardPath, remove }) {
  const file = TARGETS[agent].file(home);
  const before = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const config = before === null || before.trim() === '' ? {} : JSON.parse(before);
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`${file} does not hold a JSON object`);
  }
  const merged = merge(config, entriesFor(agent, guardPath), remove);
  return {
    file,
    before,
    after: `${JSON.stringify(merged, null, 2)}\n`,
    changed: JSON.stringify(merged) !== JSON.stringify(config),
  };
}

/** Copies `file` to a backup name that does not exist yet, and returns that name. */
function backUp(file, now) {
  const stamp = now().toISOString().replace(/[-:.]/g, '').replace('Z', '');
  let name = `${file}.bak-${stamp}`;
  for (let n = 2; existsSync(name); n++) name = `${file}.bak-${stamp}-${n}`;
  copyFileSync(file, name);
  return name;
}

/** Our hooks in one agent's config, as `{ event, command, script }`. */
function installedHooks(agent, home) {
  const file = TARGETS[agent].file(home);
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  const config = text.trim() === '' ? {} : JSON.parse(text);
  return Object.entries(config?.hooks ?? {}).flatMap(([event, groups]) =>
    (Array.isArray(groups) ? groups : [])
      .flatMap((group) => (Array.isArray(group?.hooks) ? group.hooks : []))
      .filter(isOurs)
      .map((hook) => ({
        event,
        command: hook.command,
        script: /"([^"]+)"/.exec(hook.command)?.[1] ?? null,
      })),
  );
}

/**
 * Reports every installed hook. Returns false when a hook points at a script that is not there,
 * which is the state where the agent runs with no guards and says nothing.
 */
export function check({ home, sourceDir, agents, log }) {
  let sound = true;
  let found = 0;
  for (const agent of agents) {
    for (const hook of installedHooks(agent, home)) {
      found++;
      const present = hook.script !== null && existsSync(hook.script);
      if (!present) sound = false;
      log(
        `${agent}: ${hook.event} -> ${hook.script ?? hook.command}: ${present ? 'ok' : 'MISSING'}`,
      );
    }
  }
  if (found === 0) {
    log('No guard hooks are installed.');
    return true;
  }
  const dest = installedDir(home);
  if (!sound) {
    log(
      '\nA hook points at a script that is not there, so that guard is off. Run the installer with --apply to repair it.',
    );
  } else if (!sameDir(sourceDir, dest) && fingerprint(sourceDir) !== fingerprint(dest)) {
    log(
      `\nThe installed copy in ${dest} differs from this skill's scripts. Run the installer with --apply to refresh it.`,
    );
  }
  return sound;
}

/** Runs the installer. Returns false only when `--check` finds a hook with no script. */
export function run(
  argv,
  { home = homedir(), sourceDir, log = console.log, now = () => new Date() } = {},
) {
  const apply = argv.includes('--apply');
  const remove = argv.includes('--remove');
  const only = argv.includes('--agent') ? argv[argv.indexOf('--agent') + 1] : null;
  if (only !== null && !TARGETS[only])
    throw new Error(`unknown agent "${only}": use claude or codex`);
  // Unasked, do not create a config directory for an agent that is not installed.
  const agents = only
    ? [only]
    : Object.keys(TARGETS).filter(
        (agent) => agent === 'claude' || existsSync(TARGETS[agent].dir(home)),
      );
  if (argv.includes('--check')) return check({ home, sourceDir, agents, log });

  const dest = installedDir(home);
  const guardPath = installedGuard(home);
  const copyNeeded =
    !remove && !sameDir(sourceDir, dest) && fingerprint(sourceDir) !== fingerprint(dest);

  // Plan everything first, so one unreadable file stops the run before any file is written.
  const steps = agents.map((agent) => ({ agent, ...plan(agent, { home, guardPath, remove }) }));
  if (copyNeeded) {
    if (apply) {
      rmSync(dest, { recursive: true, force: true });
      cpSync(sourceDir, dest, { recursive: true });
      log(`copied the guard scripts to ${dest}`);
    } else {
      log(`would copy the guard scripts to ${dest}`);
    }
  }
  for (const step of steps) {
    const { agent, file } = step;
    if (!step.changed) {
      log(`${agent}: ${file} already ${remove ? 'has no guard hooks' : 'has the guard hooks'}`);
      continue;
    }
    if (!apply) {
      log(
        `${agent}: would ${remove ? 'remove the guard hooks from' : 'write the guard hooks to'} ${file}`,
      );
      if (!remove) log(JSON.stringify(entriesFor(agent, guardPath), null, 2));
      continue;
    }
    mkdirSync(dirname(file), { recursive: true });
    if (step.before !== null) log(`${agent}: backed up ${file} to ${backUp(file, now)}`);
    writeFileSync(file, step.after);
    log(
      `${agent}: ${remove ? 'removed the guard hooks from' : 'wrote the guard hooks to'} ${file}`,
    );
  }
  // The copy goes only when no agent still has a hook pointing at it.
  if (remove && existsSync(dest)) {
    const stillUsed = Object.keys(TARGETS).some((agent) => {
      try {
        return installedHooks(agent, home).length > 0;
      } catch {
        return true;
      }
    });
    if (!stillUsed && apply) {
      rmSync(dest, { recursive: true, force: true });
      log(`deleted ${dest}`);
    } else if (!apply && only === null) {
      log(`would delete ${dest}`);
    }
  }
  if (!apply) log('\nNothing was changed. Run again with --apply to make these changes.');
  else if (!remove && agents.includes('codex'))
    log('\nCodex runs a hook only after you trust it: open Codex and run /hooks.');
  return true;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(scriptPath)) {
  try {
    if (!run(process.argv.slice(2), { sourceDir: dirname(realpathSync(scriptPath)) }))
      process.exitCode = 1;
  } catch (error) {
    console.error(`install failed: ${error.message}`);
    process.exitCode = 1;
  }
}
