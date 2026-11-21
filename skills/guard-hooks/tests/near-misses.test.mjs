// Ordinary command lines that an earlier version of the guards blocked or missed. Each case here
// came out of a review, and names the shape that went wrong.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { evaluate, handle } from '../scripts/guard.mjs';
import { normalize } from '../scripts/lib/input.mjs';

const fakeGit = (over = {}) => ({
  cwd: '/repo',
  prefix: () => '',
  stagedDiff: () => '',
  worktreeDiff: () => '',
  stagedNames: () => [],
  worktreeNames: () => [],
  untrackedNames: () => [],
  readUntracked: () => '',
  currentBranch: () => 'feature',
  defaultBranch: () => 'main',
  changedSinceDefault: () => [],
  ...over,
});
const config = () => ({
  root: '/repo',
  isEnabled: () => true,
  protectedBranches: [],
  conventionalCommits: true,
  isSecretScanIgnored: () => false,
});
const shell = (command, { git = fakeGit(), repos = {} } = {}) =>
  evaluate('pre-tool', normalize({ tool_name: 'Bash', tool_input: { command }, cwd: git.cwd }), {
    config: config(),
    git,
    gitAt: (cwd) => repos[cwd] ?? fakeGit({ cwd }),
  });
const idOf = (finding) => (finding ? `${finding.id}:${finding.result}` : null);
const onMain = (over = {}) => fakeGit({ currentBranch: () => 'main', ...over });
const githubToken = `gh${'p_'}${'a'.repeat(36)}`;
const awsKey = `AK${'IA'}${'ABCDEFGHIJKLMNOP'}`;

test('words in a trailing comment are not arguments', () => {
  const withEnv = fakeGit({ untrackedNames: () => ['.env'] });
  for (const command of [
    'git commit -m "fix: x"  # no --no-verify needed',
    'git push origin feature  # PR goes against main',
    'git add src/a.ts  # not .env\ngit commit -m "fix: x"',
  ]) {
    assert.equal(shell(command, { git: withEnv }), null, command);
  }
});

test('restoring a file from another branch is not a branch switch', () => {
  for (const command of [
    'git checkout main package-lock.json && git commit -m "chore: restore lockfile"',
    'git checkout main -- package-lock.json && git commit -m "chore: restore lockfile"',
  ]) {
    assert.equal(shell(command), null, command);
    assert.equal(
      idOf(shell(command, { git: onMain() })),
      'protected-branch:confirm',
      'still on main, still asks',
    );
  }
  assert.equal(shell('git switch --detach main && git commit -m "fix: x"'), null);
  assert.equal(
    idOf(shell('git checkout main && git commit -m "fix: x"')),
    'protected-branch:confirm',
  );
});

test('a cd inside a subshell, or undone by popd, is not followed', () => {
  const repos = {
    '/main-checkout': onMain({ cwd: '/main-checkout' }),
    '/other': onMain({ cwd: '/other' }),
  };
  assert.equal(
    shell('(cd ../main-checkout && git pull) && git commit -m "feat: x"', { repos }),
    null,
  );
  assert.equal(shell('pushd ../other && git pull && popd && git push', { repos }), null);
  assert.equal(
    idOf(shell('cd ../other && git push', { repos })),
    'protected-branch:confirm',
    'a plain cd is followed',
  );
});

test('git add stages only what it says it stages', () => {
  const git = fakeGit({
    untrackedNames: () => ['.env', 'scratch/token.txt'],
    readUntracked: () => githubToken,
  });
  for (const command of [
    'git add -u && git commit -m "fix: x"',
    'git add src/*.ts && git commit -m "fix: x"',
    'git add --pathspec-from-file=list.txt && git commit -m "fix: x"',
    'git add :/src && git commit -m "fix: x"',
  ]) {
    assert.equal(shell(command, { git }), null, command);
  }
  assert.equal(
    idOf(shell('git add scratch && git commit -m "fix: x"', { git })),
    'staged-secrets:deny',
  );
  assert.equal(
    idOf(shell('git add "scratch/*.txt" && git commit -m "fix: x"', { git })),
    'staged-secrets:deny',
  );

  const inPackage = fakeGit({
    prefix: () => 'packages/ui/',
    untrackedNames: () => ['.env', 'apps/web/.env.local'],
  });
  assert.equal(
    shell('git add . && git commit -m "fix: x"', { git: inPackage }),
    null,
    'a dot is this directory, not the repo',
  );
  const ownEnv = fakeGit({
    prefix: () => 'packages/ui/',
    untrackedNames: () => ['packages/ui/.env'],
  });
  assert.equal(
    idOf(shell('git add . && git commit -m "fix: x"', { git: ownEnv })),
    'staged-secrets:deny',
  );

  const tracked = fakeGit({
    worktreeNames: () => ['src/a.ts'],
    worktreeDiff: () => `+++ b/src/a.ts\n+const k = "${awsKey}";\n`,
    untrackedNames: () => ['.env'],
  });
  assert.match(
    shell('git add -u && git commit -m "fix: x"', { git: tracked }).reason,
    /src\/a\.ts/,
  );
});

test('a message that cannot be read before the command runs is not judged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guards-'));
  mkdirSync(join(dir, 'sub'));
  // Every file a wrong reading could land on exists and is not a Conventional Commit.
  for (const name of ['msg.txt', '$MSG_FILE', 'sub/msg.txt'])
    writeFileSync(join(dir, name), 'Not conventional\n');
  const git = fakeGit({ cwd: dir });
  assert.equal(
    idOf(shell('git commit -F msg.txt', { git })),
    'commit-message:deny',
    'a readable file is judged',
  );
  for (const command of [
    'git commit -F "$MSG_FILE"',
    'cd "$ROOT" && git commit -F msg.txt',
    '(cd sub && true) && git commit -F msg.txt',
    'pushd sub && popd && git commit -F msg.txt',
    `git commit -F - <<EOF\n$TYPE: $SUMMARY\nEOF`,
    `gh pr create --title x --body-file - <<EOF\n$BODY\nEOF`,
  ]) {
    assert.equal(shell(command, { git }), null, command);
  }
});

test('a guard or a git read that throws lets the action through', () => {
  const payload = JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: 'git commit -m "feat: x"' },
    cwd: '/repo',
  });
  const explode = () => {
    throw new Error('git exploded');
  };
  const broken = () => fakeGit({ stagedNames: explode, defaultBranch: explode });
  assert.throws(
    () => shell('git commit -m "feat: x"', { git: broken() }),
    /git exploded/,
    'the guards themselves do throw',
  );

  const outcome = handle(payload, 'pre-tool', 'claude', { env: {}, gitAt: broken, load: config });
  assert.deepEqual([outcome.code, outcome.stdout], [0, '']);
  assert.match(outcome.stderr, /skipped after an internal error: git exploded/);

  const badConfig = handle(payload, 'pre-tool', 'claude', {
    env: {},
    gitAt: fakeGit,
    load: explode,
  });
  assert.equal(badConfig.code, 0);
  assert.equal(
    handle(payload, 'pre-tool', 'claude', { env: {}, gitAt: fakeGit, load: config }).code,
    0,
    'and a healthy run passes this commit',
  );
});

test('the stop check runs only when the harness says this is the first stop', () => {
  assert.equal(normalize({ stop_hook_active: false }).stopHookActive, false);
  for (const payload of [
    { stop_hook_active: true },
    {},
    { loop_count: 0 },
    { stop_hook_active: 'false' },
  ]) {
    assert.equal(normalize(payload).stopHookActive, true, JSON.stringify(payload));
  }
});
