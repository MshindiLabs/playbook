// The few git reads the guards need. Every call is bounded and returns '' on any failure,
// so a guard treats "could not tell" as "nothing to report".
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_UNTRACKED_BYTES = 512 * 1024;

function git(cwd, args) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

const lines = (text) => text.split('\n').filter((line) => line !== '');

/** A reader for the repository at `cwd`. File names it returns are relative to the repo root. */
export function createGit(cwd) {
  return {
    cwd,
    /** Path of `cwd` inside the repo, '' at the root, with a trailing slash otherwise. */
    prefix: () => git(cwd, ['rev-parse', '--show-prefix']).trim(),
    stagedDiff: () => git(cwd, ['diff', '--cached', '--no-color', '-U0']),
    worktreeDiff: () => git(cwd, ['diff', '--no-color', '-U0']),
    stagedNames: () => lines(git(cwd, ['diff', '--cached', '--name-only', '--diff-filter=d'])),
    worktreeNames: () => lines(git(cwd, ['diff', '--name-only', '--diff-filter=d'])),
    untrackedNames: () =>
      lines(git(cwd, ['ls-files', '--others', '--exclude-standard', '--full-name'])),
    /** Text of an untracked file, or '' when it is large, binary or unreadable. */
    readUntracked: (name) => {
      try {
        const path = join(git(cwd, ['rev-parse', '--show-toplevel']).trim(), name);
        if (statSync(path).size > MAX_UNTRACKED_BYTES) return '';
        const text = readFileSync(path, 'utf8');
        return text.includes('\u0000') ? '' : text;
      } catch {
        return '';
      }
    },
    currentBranch: () => git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']).trim(),
    /** The remote's default branch, or '' when there is no `origin` to protect. */
    defaultBranch: () => {
      const head = git(cwd, [
        'symbolic-ref',
        '--quiet',
        '--short',
        'refs/remotes/origin/HEAD',
      ]).trim();
      if (head !== '') return head.replace(/^origin\//, '');
      const remote = lines(git(cwd, ['branch', '-r', '--format=%(refname:short)']));
      return ['main', 'master'].find((name) => remote.includes(`origin/${name}`)) ?? '';
    },
    changedSinceDefault: () => {
      const base = git(cwd, ['merge-base', 'HEAD', 'origin/HEAD']).trim();
      return [
        ...lines(git(cwd, ['diff', '--name-only', base !== '' ? base : 'HEAD'])),
        ...lines(git(cwd, ['ls-files', '--others', '--exclude-standard', '--full-name'])),
      ];
    },
  };
}
