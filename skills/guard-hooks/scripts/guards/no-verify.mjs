import { parseGit, readCommitArgs } from '../lib/shell.mjs';

const HOOKED = new Set([
  'commit',
  'push',
  'merge',
  'rebase',
  'cherry-pick',
  'am',
  'pull',
  'revert',
]);
/** Options that take the next argument, so their value is never read as a flag. */
const VALUE_OPTIONS = new Set([
  '-m',
  '--message',
  '-F',
  '--file',
  '-X',
  '--strategy-option',
  '-s',
  '--strategy',
  '-o',
  '--push-option',
  '--onto',
  '-x',
  '--exec',
  '--trailer',
  '--author',
  '--date',
]);

const isNoVerify = (arg) => arg.length >= 6 && '--no-verify'.startsWith(arg);
const REASON =
  'git hooks must run. Remove the option that skips them and fix what the hook reports.';

/** Blocks every way of skipping git hooks on a command that would run them. */
export function noVerify({ commands }) {
  for (const { env, argv } of commands) {
    const git = parseGit(argv);
    if (!git || !HOOKED.has(git.sub)) continue;
    if (/^(0|false)$/i.test(env.HUSKY ?? ''))
      return { result: 'deny', reason: `HUSKY=0 skips the git hooks: ${REASON}` };
    if (Object.keys(env).some((name) => name.startsWith('GIT_CONFIG_'))) {
      return {
        result: 'deny',
        reason: `GIT_CONFIG_* on a git command can redirect its hooks: ${REASON}`,
      };
    }
    if (git.configs.some((setting) => /^core\.hookspath(=|$)/i.test(setting))) {
      return { result: 'deny', reason: `-c core.hooksPath redirects the git hooks: ${REASON}` };
    }
    if (git.sub === 'commit') {
      const read = readCommitArgs(git.args);
      if (read.flags.some(isNoVerify) || read.shortFlags.includes('n')) {
        return { result: 'deny', reason: `git commit was asked to skip its hooks: ${REASON}` };
      }
      continue;
    }
    for (let i = 0; i < git.args.length; i++) {
      const arg = git.args[i];
      if (arg === '--') break;
      if (VALUE_OPTIONS.has(arg)) i++;
      else if (isNoVerify(arg))
        return { result: 'deny', reason: `git ${git.sub} was asked to skip its hooks: ${REASON}` };
    }
  }
  return null;
}
