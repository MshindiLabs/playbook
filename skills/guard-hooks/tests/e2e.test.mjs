import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const guard = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'guard.mjs');
const hook = (event, payload, { agent = 'claude', env = {} } = {}) =>
  spawnSync(process.execPath, [guard, event, '--agent', agent], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, PLAYBOOK_GUARDS_DISABLED: '', ...env },
  });

/** A real repository on `main`, with a fake `origin/main` when `withRemote` is set. */
function repo({ withRemote = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'guards-repo-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('commit', '-q', '--allow-empty', '-m', 'chore: start');
  if (withRemote) {
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  }
  return { dir, git };
}
const bash = (dir, command) => ({ tool_name: 'Bash', tool_input: { command }, cwd: dir });
const allowed = (result) => result.status === 0 && result.stdout === '';

test('a staged env file blocks the commit, and unstaging it clears the block', () => {
  const { dir, git } = repo();
  writeFileSync(join(dir, '.env'), 'TOKEN=value\n');
  git('add', '-f', '.env');
  const blocked = hook('pre-tool', bash(dir, 'git commit -m "chore: add env"'));
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /\[playbook guard: staged-secrets\] \.env is a local env file/);
  assert.equal(blocked.stdout, '');
  git('rm', '-q', '--cached', '.env');
  assert.ok(allowed(hook('pre-tool', bash(dir, 'git commit -m "chore: nothing"'))));
});

test('git add and commit in one line is scanned before anything is staged', () => {
  const { dir } = repo();
  mkdirSync(join(dir, 'src'));
  writeFileSync(
    join(dir, 'src', 'keys.ts'),
    `export const token = "gh${'p_'}${'b'.repeat(36)}";\n`,
  );
  const blocked = hook('pre-tool', bash(dir, 'git add -A && git commit -m "feat: keys"'));
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /src\/keys\.ts adds what looks like a GitHub token/);
  writeFileSync(
    join(dir, 'playbook-guards.json'),
    JSON.stringify({ secretScanIgnore: ['src/keys.ts'] }),
  );
  assert.ok(allowed(hook('pre-tool', bash(dir, 'git add -A && git commit -m "feat: keys"'))));
});

test('a commit on the default branch asks in Claude Code and blocks in Codex', () => {
  const { dir } = repo({ withRemote: true });
  const command = bash(dir, 'git commit --allow-empty -m "chore: on main"');
  const asked = hook('pre-tool', command);
  assert.equal(asked.status, 0);
  const decision = JSON.parse(asked.stdout).hookSpecificOutput;
  assert.equal(decision.hookEventName, 'PreToolUse');
  assert.equal(decision.permissionDecision, 'ask');
  assert.match(decision.permissionDecisionReason, /commits directly on main/);

  const blocked = hook('pre-tool', command, { agent: 'codex' });
  assert.equal(blocked.status, 2);
  assert.equal(blocked.stdout, '');

  assert.ok(
    allowed(
      hook(
        'pre-tool',
        bash(dir, 'git checkout -b feat/x && git commit --allow-empty -m "feat: x"'),
      ),
    ),
  );
});

test('a repo with no remote has no protected branch', () => {
  const { dir } = repo();
  assert.ok(
    allowed(hook('pre-tool', bash(dir, 'git commit --allow-empty -m "chore: on main, no origin"'))),
  );
});

test('the off switch disables one guard and leaves the others on', () => {
  const { dir } = repo();
  const command = bash(dir, 'git commit --no-verify -m "bad subject"');
  assert.match(hook('pre-tool', command).stderr, /no-verify/);
  assert.match(
    hook('pre-tool', command, { env: { PLAYBOOK_GUARDS_DISABLED: 'no-verify' } }).stderr,
    /commit-message/,
  );
  assert.ok(allowed(hook('pre-tool', command, { env: { PLAYBOOK_GUARDS_DISABLED: 'all' } })));
});

test('a guard that cannot read its input, or fails inside, lets the action through', () => {
  for (const payload of [
    'not json',
    '',
    '{"tool_input":',
    'null',
    '[]',
    '{"tool_input":{"command":42}}',
    'x'.repeat(1024 * 1024 + 10),
  ]) {
    assert.ok(allowed(hook('pre-tool', payload)), payload.slice(0, 30));
  }
  // The cwd does not exist, so every git read fails. That must not turn into a block.
  assert.ok(
    allowed(
      hook(
        'pre-tool',
        bash('/nonexistent/dir', 'git add -A && git commit -m "feat: x" && git push'),
      ),
    ),
  );
  assert.ok(allowed(hook('', bash('/tmp', 'git commit --no-verify'))), 'no event name');
});

/** A project whose typecheck script always fails, on a branch that changed TypeScript. */
function failingProject() {
  const { dir } = repo();
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ scripts: { typecheck: 'echo "a.ts(1,1): error TS2322" && exit 2' } }),
  );
  mkdirSync(join(dir, 'node_modules'));
  writeFileSync(join(dir, 'a.ts'), 'const a: number = "x";\n');
  return dir;
}

test('stop sends the agent back on a failing typecheck, once', () => {
  const dir = failingProject();
  const env = { CLAUDE_PROJECT_DIR: dir };
  const first = hook('stop', { cwd: dir, stop_hook_active: false }, { env });
  assert.equal(first.status, 2);
  assert.match(first.stderr, /\[playbook guard: verify-on-stop\] npm run typecheck failed/);
  assert.match(first.stderr, /TS2322/);
  assert.ok(
    allowed(hook('stop', { cwd: dir, stop_hook_active: true }, { env })),
    'already continuing: never a second block',
  );
  assert.ok(
    allowed(hook('stop', { cwd: dir }, { env })),
    'no loop signal from the harness: do not run',
  );
  assert.ok(
    allowed(
      hook(
        'stop',
        { cwd: dir, stop_hook_active: false },
        { env: { ...env, PLAYBOOK_GUARDS_DISABLED: 'verify-on-stop' } },
      ),
    ),
  );
});

test('stop does nothing in a project without a typecheck script', () => {
  const { dir } = repo();
  assert.ok(
    allowed(
      hook('stop', { cwd: dir, stop_hook_active: false }, { env: { CLAUDE_PROJECT_DIR: dir } }),
    ),
  );
});
