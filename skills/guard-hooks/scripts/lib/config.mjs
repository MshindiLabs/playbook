// Switches: the PLAYBOOK_GUARDS_DISABLED environment variable, and an optional
// playbook-guards.json at the project root.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const CONFIG_FILE = 'playbook-guards.json';

/** Nearest directory at or above `start` holding the config file or a `.git` entry. */
export function projectRoot(start) {
  let dir = start;
  for (let i = 0; i < 40; i++) {
    if (existsSync(join(dir, CONFIG_FILE)) || existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

/** Matches a path against patterns: a directory or file prefix, or a glob where `*` spans anything. */
function pathMatcher(patterns) {
  const tests = patterns.map((pattern) => {
    const clean = pattern.replace(/^\.\//, '').replace(/\/+$/, '');
    if (!clean.includes('*')) return (path) => path === clean || path.startsWith(`${clean}/`);
    const source = clean
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    const regex = new RegExp(`^${source}$`);
    return (path) => regex.test(path);
  });
  return (path) => tests.some((test) => test(path));
}

export function loadConfig(cwd, env = process.env) {
  const root = projectRoot(cwd);
  let file = {};
  try {
    const parsed = JSON.parse(readFileSync(join(root, CONFIG_FILE), 'utf8'));
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) file = parsed;
  } catch {
    // No file, or one that does not parse: defaults apply.
  }
  const list = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []);
  const fromEnv = (env.PLAYBOOK_GUARDS_DISABLED ?? '')
    .split(',')
    .map((id) => id.trim().toLowerCase());
  const disabled = new Set(
    [...fromEnv, ...list(file.disabled).map((id) => id.toLowerCase())].filter(Boolean),
  );
  return {
    root,
    isEnabled: (id) => !disabled.has('all') && !disabled.has(id),
    protectedBranches: list(file.protectedBranches),
    conventionalCommits: file.conventionalCommits !== false,
    /** True for a repo-relative path the secret scan should skip: test fixtures, example keys. */
    isSecretScanIgnored: pathMatcher(list(file.secretScanIgnore)),
  };
}
