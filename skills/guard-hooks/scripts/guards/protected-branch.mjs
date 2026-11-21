import { parseGit, readCommitArgs } from '../lib/shell.mjs';

const PUSH_VALUE_OPTIONS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
const NEW_BRANCH_OPTIONS = new Set([
  '-b',
  '-B',
  '-c',
  '-C',
  '--create',
  '--force-create',
  '--orphan',
]);

/**
 * What a `git push` would update: 'all', null for the current branch, a list of branch names, or
 * 'none' when it pushes only tags.
 */
function pushTargets(args, branch) {
  const positional = [];
  let everything = false;
  let tagsOnly = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--all' || arg === '--mirror') everything = true;
    else if (arg === '--tags') tagsOnly = true;
    else if (PUSH_VALUE_OPTIONS.has(arg)) i++;
    else if (!arg.startsWith('-')) positional.push(arg);
  }
  if (everything) return 'all';
  const refspecs = positional.slice(1);
  if (refspecs.length === 0) return tagsOnly ? 'none' : null;
  return refspecs.map((spec) => {
    const target = spec
      .replace(/^\+/, '')
      .split(':')
      .pop()
      .replace(/^refs\/heads\//, '');
    return target === 'HEAD' || target === '@' ? branch : target;
  });
}

/**
 * The branch a `git checkout` or `git switch` leaves you on: a name, null when it is not clear,
 * or undefined when the command does not change branch.
 */
function switchedBranch(args) {
  const create = args.findIndex((arg) => NEW_BRANCH_OPTIONS.has(arg));
  if (create !== -1) return args[create + 1] ?? null;
  if (args.includes('--detach') || args.includes('-d')) return null;
  const targets = args.filter((arg) => !arg.startsWith('-'));
  // `git checkout -- file` and `git checkout <ref> <file>` restore files and stay on the branch.
  if (args.includes('--') || targets.length > 1) return undefined;
  return targets.length === 0 || targets[0] === '-' ? null : targets[0];
}

/** Asks before a commit on, or a push to, the default branch or a listed protected branch. */
export function protectedBranch({ commands, locate, config }) {
  // A branch change earlier in the line decides where a later commit lands.
  const switched = new Map();
  for (const command of commands) {
    const parsed = parseGit(command.argv);
    const where = parsed && locate(command, parsed);
    if (!where) continue;
    if (parsed.sub === 'checkout' || parsed.sub === 'switch') {
      const branch = switchedBranch(parsed.args);
      if (branch !== undefined) switched.set(where.cwd, branch);
      continue;
    }
    if (parsed.sub !== 'commit' && parsed.sub !== 'push') continue;
    const { repo } = where;
    const guarded = new Set([repo.defaultBranch(), ...config.protectedBranches].filter(Boolean));
    if (guarded.size === 0) continue;
    const branch = switched.has(where.cwd) ? switched.get(where.cwd) : repo.currentBranch();
    if (branch === null) continue;

    if (parsed.sub === 'commit') {
      if (readCommitArgs(parsed.args).flags.includes('--dry-run')) continue;
      if (guarded.has(branch)) {
        return {
          result: 'confirm',
          reason: `This commits directly on ${branch}. Work normally goes on a branch and lands through a pull request.`,
        };
      }
      continue;
    }
    const targets = pushTargets(parsed.args, branch);
    if (targets === 'none') continue;
    const hit =
      targets === 'all' ? [...guarded][0] : (targets ?? [branch]).find((name) => guarded.has(name));
    if (hit) {
      return {
        result: 'confirm',
        reason: `This pushes to ${hit}. Changes normally reach it through a pull request.`,
      };
    }
  }
  return null;
}
