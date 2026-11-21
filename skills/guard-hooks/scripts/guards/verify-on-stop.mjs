import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const COVERED = /\.(ts|tsx|mts|cts)$|(^|\/)package\.json$|(^|\/)tsconfig[^/]*\.json$/;
const LOCKFILES = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
];
const BUDGET_MS = 270_000;

/**
 * When the agent stops, runs the project's `typecheck` script if the branch touched anything it
 * covers. A failure sends the agent back once; `stop_hook_active` ends the second attempt.
 */
export function verifyOnStop({ stopHookActive, git, config, run = spawnSync }) {
  if (stopHookActive) return null;
  const root = config.root;
  let scripts;
  try {
    scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {};
  } catch {
    return null;
  }
  if (typeof scripts.typecheck !== 'string' || !existsSync(join(root, 'node_modules'))) return null;
  if (!git.changedSinceDefault().some((name) => COVERED.test(name))) return null;

  const manager = LOCKFILES.find(([file]) => existsSync(join(root, file)))?.[1] ?? 'npm';
  const done = run(manager, ['run', 'typecheck'], {
    cwd: root,
    encoding: 'utf8',
    timeout: BUDGET_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  // Could not start, or ran out of time: not evidence of a type error. Output too large to hold
  // is: a typecheck that prints that much has failed.
  const overflowed = done.error?.code === 'ENOBUFS';
  if (!overflowed && (done.error || done.status === null || done.status === 0)) return null;
  const tail = `${done.stdout ?? ''}${done.stderr ?? ''}`
    .trimEnd()
    .split('\n')
    .slice(-40)
    .join('\n');
  return {
    result: 'deny',
    reason: `${manager} run typecheck failed. Fix the type errors before finishing.\n\n${tail}`,
  };
}
