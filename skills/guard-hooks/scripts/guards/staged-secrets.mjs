import { posix } from 'node:path';
import { parseGit, readCommitArgs } from '../lib/shell.mjs';

/** Shapes of real credentials. Each is specific enough that a match is worth stopping for. */
const SECRET_PATTERNS = [
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{50,}/],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ['Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI API key', /\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{40,}|\bsk-[A-Za-z0-9]{48}\b/],
  ['private key', /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/],
];
/** Keys that vendors publish in their own documentation. */
const DOCUMENTED_EXAMPLE = /\bAKIA[0-9A-Z]{9}EXAMPLE\b/;

/**
 * Files that hold local secrets by convention. Shared env files such as `.env.production` and
 * `.env.example` are committed on purpose in many projects, so only the local ones are named.
 * Certificates are judged by their content, since a `.pem` is often a public certificate.
 */
const SECRET_FILES = [
  ['a local env file', /(^|\/)\.env(\.[\w-]+)?\.local$|(^|\/)\.env$/],
  ['a key store', /\.(p12|pfx)$/i],
  ['an SSH private key', /(^|\/)id_(rsa|ed25519|ecdsa|dsa)$/],
];
const MAX_UNTRACKED_FILES = 200;

const secretIn = (line) => {
  const hit = SECRET_PATTERNS.find(([, pattern]) => pattern.test(line));
  return hit && !DOCUMENTED_EXAMPLE.test(line) ? hit[0] : null;
};

const ADD_VALUE_OPTIONS = new Set(['--chmod', '--pathspec-from-file']);

/**
 * What a `git add` will stage, as `{ everything, untracked, paths }`, or null when that cannot
 * be told from the command. `paths` are relative to the directory the command runs in.
 */
function readAdd(args) {
  const paths = [];
  let everything = false;
  let trackedOnly = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      paths.push(...args.slice(i + 1));
      break;
    }
    if (arg === '-A' || arg === '--all' || arg === '--no-ignore-removal') everything = true;
    else if (arg === '-u' || arg === '--update') trackedOnly = true;
    else if (ADD_VALUE_OPTIONS.has(arg)) return null;
    else if (arg.startsWith('--pathspec-from-file=')) return null;
    else if (!arg.startsWith('-')) paths.push(arg);
  }
  if (paths.some((path) => path.startsWith(':'))) return null;
  if (paths.length === 0 && !everything && !trackedOnly) return null;
  return { everything: paths.length === 0, untracked: !trackedOnly, paths };
}

/** A test for repo-relative names against the paths one `git add` named, from `prefix`. */
function addMatcher({ everything, paths }, prefix) {
  if (everything) return () => true;
  const tests = paths.map((path) => {
    const full = posix.normalize(posix.join(prefix, path)).replace(/\/$/, '');
    if (full === '.' || full === '') return () => true;
    if (!/[*?[]/.test(full)) return (name) => name === full || name.startsWith(`${full}/`);
    const source = full
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    const regex = new RegExp(`^${source}(/|$)`);
    return (name) => regex.test(name);
  });
  return (name) => tests.some((test) => test(name));
}

/** The first secret a list of diff text adds, as `{ file, kind }`. */
function secretInDiff(diff, include) {
  let file = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) file = line.slice(4).replace(/^b\//, '');
    else if (line.startsWith('+') && include(file)) {
      const kind = secretIn(line);
      if (kind) return { file, kind };
    }
  }
  return null;
}

/**
 * Blocks a commit whose changes add a credential or a file that holds them. It looks at what is
 * staged, and also at what `-a` or a `git add` earlier in the same line is about to stage.
 */
export function stagedSecrets({ commands, locate, config }) {
  // Per directory: tests for what earlier `git add`s in this line will have staged by commit time.
  const pendingAdds = new Map();
  for (const command of commands) {
    const parsed = parseGit(command.argv);
    const where = parsed && locate(command, parsed);
    if (!where) continue;
    const { repo } = where;
    if (parsed.sub === 'add' || parsed.sub === 'stage') {
      const added = readAdd(parsed.args);
      if (!added) continue;
      const matches = addMatcher(added, repo.prefix());
      const before = pendingAdds.get(where.cwd) ?? { tracked: [], untracked: [] };
      before.tracked.push(matches);
      if (added.untracked) before.untracked.push(matches);
      pendingAdds.set(where.cwd, before);
      continue;
    }
    if (parsed.sub !== 'commit') continue;
    const read = readCommitArgs(parsed.args);
    if (read.flags.includes('--dry-run')) continue;

    const scanned = (name) => !config.isSecretScanIgnored(name);
    const adding = pendingAdds.get(where.cwd) ?? { tracked: [], untracked: [] };
    const commitsTracked = read.flags.includes('--all') || read.shortFlags.includes('a');
    const fromWorktree = (name) =>
      commitsTracked || adding.tracked.some((matches) => matches(name));
    const untracked =
      adding.untracked.length > 0
        ? repo
            .untrackedNames()
            .filter((name) => adding.untracked.some((matches) => matches(name)))
            .slice(0, MAX_UNTRACKED_FILES)
        : [];
    const worktree =
      commitsTracked || adding.tracked.length > 0 ? repo.worktreeNames().filter(fromWorktree) : [];

    for (const name of [...repo.stagedNames(), ...worktree, ...untracked].filter(scanned)) {
      const hit = SECRET_FILES.find(([, pattern]) => pattern.test(name));
      if (hit) {
        return {
          result: 'deny',
          reason: `${name} is ${hit[0]} and this commit would include it. Leave it out (git restore --staged ${name}) and add it to .gitignore.`,
        };
      }
    }

    let found = secretInDiff(repo.stagedDiff(), scanned);
    if (!found && worktree.length > 0) {
      found = secretInDiff(repo.worktreeDiff(), (name) => scanned(name) && fromWorktree(name));
    }
    for (const name of found ? [] : untracked.filter(scanned)) {
      const kind = repo.readUntracked(name).split('\n').map(secretIn).find(Boolean);
      if (kind) found = { file: name, kind };
      if (found) break;
    }
    if (found) {
      return {
        result: 'deny',
        reason: `The change to ${found.file} adds what looks like a ${found.kind}. Remove it from the file, and rotate it if it is real. For a test fixture, list the path under "secretScanIgnore" in playbook-guards.json.`,
      };
    }
  }
  return null;
}
