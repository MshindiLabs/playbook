#!/usr/bin/env node
// Entry point for the playbook guard hooks.
//
//   node guard.mjs pre-tool --agent claude    before a shell command or a file edit
//   node guard.mjs stop --agent claude        when the agent is about to stop
//
// The hook payload arrives as JSON on stdin. Exit 0 lets the action through, exit 2 blocks it
// with the reason on stderr. Any failure inside this script exits 0: a broken guard never blocks.
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commitMessage } from './guards/commit-message.mjs';
import { configProtection } from './guards/config-protection.mjs';
import { noVerify } from './guards/no-verify.mjs';
import { protectedBranch } from './guards/protected-branch.mjs';
import { stagedSecrets } from './guards/staged-secrets.mjs';
import { verifyOnStop } from './guards/verify-on-stop.mjs';
import { loadConfig } from './lib/config.mjs';
import { createGit } from './lib/git.mjs';
import { normalize, readStdin } from './lib/input.mjs';
import { parseCommands } from './lib/shell.mjs';

const SHELL_GUARDS = [
  ['no-verify', noVerify],
  ['staged-secrets', stagedSecrets],
  ['commit-message', commitMessage],
  ['protected-branch', protectedBranch],
];
const EDIT_GUARDS = [['config-protection', configProtection]];
const STOP_GUARDS = [['verify-on-stop', verifyOnStop]];

/** Runs the guards for one event. Returns the finding to act on, a deny before a confirm, or null. */
export function evaluate(event, input, { config, git, gitAt }) {
  if (event !== 'pre-tool' && event !== 'stop') return null;
  let guards = STOP_GUARDS;
  /**
   * The repository a parsed command acts on, as `{ cwd, repo }`, following `cd` earlier in the
   * line and `git -C`. Null when a `cd` went somewhere unknown: the guards then leave it alone.
   */
  const locate = (command, parsed) => {
    if (command.dir === null) return null;
    const cwd = resolve(git.cwd, command.dir, parsed?.dir ?? '');
    return { cwd, repo: cwd === resolve(git.cwd) ? git : gitAt(cwd) };
  };
  const ctx = { ...input, config, git, locate };
  if (event === 'pre-tool') {
    if (input.command !== null) {
      // Only git and gh commands are guarded, so everything else returns before any parsing.
      if (!/\b(git|gh)\b/.test(input.command)) return null;
      guards = SHELL_GUARDS;
      ctx.commands = parseCommands(input.command);
    } else if (input.filePaths.length > 0) {
      guards = EDIT_GUARDS;
    } else {
      return null;
    }
  }
  let confirm = null;
  for (const [id, guard] of guards) {
    if (!config.isEnabled(id)) continue;
    const finding = guard(ctx);
    if (finding?.result === 'deny') return { id, ...finding };
    if (finding?.result === 'confirm') confirm ??= { id, ...finding };
  }
  return confirm;
}

const offSwitch = (id) =>
  `To switch this guard off, set PLAYBOOK_GUARDS_DISABLED=${id} in the environment the agent starts in.`;

/** Turns a finding into what the agent's hook protocol expects: `{ stdout, stderr, code }`. */
export function respond(finding, agent) {
  if (!finding) return { stdout: '', stderr: '', code: 0 };
  const label = `[playbook guard: ${finding.id}]`;
  if (finding.result === 'confirm' && agent === 'claude') {
    const decision = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: `${label} ${finding.reason}`,
      },
    };
    return { stdout: JSON.stringify(decision), stderr: '', code: 0 };
  }
  const override =
    finding.result === 'confirm'
      ? ` This agent cannot ask for confirmation here, so the action is blocked. If the user wants it, they can run it themselves. ${offSwitch(finding.id)}`
      : ` ${offSwitch(finding.id)}`;
  return { stdout: '', stderr: `${label} ${finding.reason}${override}\n`, code: 2 };
}

/**
 * Handles one hook call from its raw stdin text and returns `{ stdout, stderr, code }`. Any
 * failure in here, in a guard or in a git read lets the action through: a broken guard never blocks.
 */
export function handle(
  raw,
  event,
  agent,
  { env = process.env, gitAt = createGit, load = loadConfig } = {},
) {
  try {
    if (raw === null) return { stdout: '', stderr: '', code: 0 };
    const input = normalize(raw.trim() === '' ? {} : JSON.parse(raw));
    const cwd = event === 'stop' ? (env.CLAUDE_PROJECT_DIR ?? input.cwd) : input.cwd;
    const finding = evaluate(event, input, { config: load(cwd, env), git: gitAt(cwd), gitAt });
    return respond(finding, agent);
  } catch (error) {
    return {
      stdout: '',
      stderr: `[playbook guard] skipped after an internal error: ${error?.message ?? error}\n`,
      code: 0,
    };
  }
}

if (
  process.argv[1] &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
) {
  const [event, ...rest] = process.argv.slice(2);
  const agent = rest.includes('--agent') ? rest[rest.indexOf('--agent') + 1] : 'claude';
  let outcome;
  try {
    outcome = handle(await readStdin(), event, agent);
  } catch {
    outcome = { stdout: '', stderr: '', code: 0 };
  }
  if (outcome.stdout) process.stdout.write(outcome.stdout);
  if (outcome.stderr) process.stderr.write(outcome.stderr);
  process.exitCode = outcome.code;
}
