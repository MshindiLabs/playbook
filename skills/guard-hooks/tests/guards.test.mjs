import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { evaluate, respond } from '../scripts/guard.mjs';
import { verifyOnStop } from '../scripts/guards/verify-on-stop.mjs';
import { loadConfig } from '../scripts/lib/config.mjs';
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
const config = (over = {}) => ({
  root: '/repo',
  isEnabled: () => true,
  protectedBranches: [],
  conventionalCommits: true,
  isSecretScanIgnored: () => false,
  ...over,
});
/** Runs the shell guards. `repos` maps a directory to the reader for the repo found there. */
const shell = (command, { git = fakeGit(), cfg = config(), repos = {} } = {}) =>
  evaluate('pre-tool', normalize({ tool_name: 'Bash', tool_input: { command }, cwd: git.cwd }), {
    config: cfg,
    git,
    gitAt: (cwd) => repos[cwd] ?? fakeGit({ cwd }),
  });
const idOf = (finding) => (finding ? `${finding.id}:${finding.result}` : null);
const onMain = () => fakeGit({ currentBranch: () => 'main' });

test('no-verify blocks every way of skipping hooks', () => {
  for (const command of [
    'git commit --no-verify -m "fix: x"',
    'git commit -m "fix: x" --no-veri',
    'git commit -anm "fix: x"',
    'git add . && git commit -n -m "fix: x"',
    'git push --no-verify',
    'git -c core.hooksPath=/dev/null commit -m "fix: x"',
    'HUSKY=0 git commit -m "fix: x"',
    'export HUSKY=0 && git commit -m "fix: x"',
    'GIT_CONFIG_COUNT=1 git commit -m "fix: x"',
    'bash -c "git commit --no-verify -m \'fix: x\'"',
    'bash -lc "git commit --no-verify -m \'fix: x\'"',
    'git commit --no-"verify" -m "fix: x"',
    'timeout 60 git push --no-verify',
    '(git commit --no-verify -m "fix: x")',
    '/usr/bin/git commit --no-verify -m "fix: x"',
    `cat > note.txt <<'EOF'\nit's fine\nEOF\ngit commit --no-verify -m "fix: x"`,
  ]) {
    assert.equal(idOf(shell(command)), 'no-verify:deny', command);
  }
});

test('no-verify lets through commands that only mention the option', () => {
  for (const command of [
    'git commit -m "docs: explain --no-verify"',
    'git commit -m "fix: -n is not a flag here"',
    'git commit --trailer "--no-verify" -m "fix: x"',
    'git commit -uno -m "fix: x"',
    'git commit -Sbrian -m "fix: x"',
    'git push -n origin feature',
    'git merge --no-verify-signatures feature',
    'git log --no-verify',
    'echo git commit --no-verify',
    `cat > README.md <<'EOF'\ngit push --no-verify is now blocked\nEOF`,
    'git commit -m "fix: x"',
  ]) {
    assert.equal(shell(command), null, command);
  }
});

// Built at run time so this file never contains something that looks like a real credential.
const awsKey = `AK${'IA'}${'ABCDEFGHIJKLMNOP'}`;
const githubToken = `gh${'p_'}${'a'.repeat(36)}`;
const privateKey = `-----BEGIN RSA ${'PRIVATE'} KEY-----`;
const diffAdding = (file, text) => `+++ b/${file}\n+${text}\n`;

test('staged-secrets blocks a credential added by the staged diff', () => {
  for (const secret of [awsKey, githubToken, privateKey]) {
    const git = fakeGit({
      stagedDiff: () => diffAdding('src/config.ts', `const key = "${secret}";`),
    });
    const finding = shell('git commit -m "feat: add config"', { git });
    assert.equal(idOf(finding), 'staged-secrets:deny');
    assert.ok(finding.reason.includes('src/config.ts'));
    assert.ok(!finding.reason.includes(secret), 'the reason must not repeat the secret');
  }
});

test('staged-secrets ignores removed lines, documented example keys and ignored paths', () => {
  const removed = fakeGit({
    stagedDiff: () => `+++ b/a.ts\n-const key = "${awsKey}";\n+const key = process.env.KEY;\n`,
  });
  assert.equal(shell('git commit -m "fix: read the key from env"', { git: removed }), null);
  const documented = fakeGit({
    stagedDiff: () => diffAdding('docs/aws.md', `AK${'IA'}IOSFODNN7EXAMPLE`),
  });
  assert.equal(shell('git commit -m "docs: aws"', { git: documented }), null);
  const fixture = fakeGit({
    stagedDiff: () => diffAdding('evals/fixtures/leak.sh', awsKey),
    stagedNames: () => ['evals/fixtures/.env'],
  });
  const cfg = config({ isSecretScanIgnored: (name) => name.startsWith('evals/fixtures/') });
  assert.equal(shell('git commit -m "test: fixture"', { git: fixture, cfg }), null);
  assert.equal(
    idOf(shell('git commit -m "test: fixture"', { git: fixture })),
    'staged-secrets:deny',
  );
});

test('staged-secrets blocks local secret files and passes shared and example ones', () => {
  for (const name of [
    '.env',
    'apps/web/.env.local',
    '.env.production.local',
    'certs/store.p12',
    '.ssh/id_ed25519',
  ]) {
    const git = fakeGit({ stagedNames: () => [name] });
    assert.equal(idOf(shell('git commit -m "chore: x"', { git })), 'staged-secrets:deny', name);
  }
  const shared = [
    '.env.example',
    '.env.local.example',
    '.env.test',
    '.env.production',
    'certs/ca.pem',
    'slides.key',
    'src/environment.ts',
  ];
  assert.equal(
    shell('git commit -m "chore: x"', { git: fakeGit({ stagedNames: () => shared }) }),
    null,
  );
});

test('staged-secrets looks at the working tree for commit -a', () => {
  const git = fakeGit({
    worktreeNames: () => ['.env'],
    worktreeDiff: () => diffAdding('a.ts', awsKey),
  });
  assert.equal(shell('git commit -m "chore: x"', { git }), null);
  assert.equal(idOf(shell('git commit -am "chore: x"', { git })), 'staged-secrets:deny');
  assert.equal(shell('git commit -uall -m "chore: x"', { git }), null, '-uall is not -a');
});

test('staged-secrets sees what a git add in the same line is about to stage', () => {
  const git = fakeGit({
    untrackedNames: () => ['.env', 'src/new.ts', 'other/keys.ts'],
    readUntracked: (name) => (name === 'other/keys.ts' ? `export const k = "${githubToken}";` : ''),
    worktreeNames: () => ['src/app.ts'],
    worktreeDiff: () => diffAdding('src/app.ts', `const k = "${awsKey}";`),
  });
  assert.equal(
    idOf(shell('git add -A && git commit -m "feat: x"', { git })),
    'staged-secrets:deny',
  );
  assert.equal(idOf(shell('git add . && git commit -m "feat: x"', { git })), 'staged-secrets:deny');
  const named = shell('git add other && git commit -m "feat: x"', { git });
  assert.match(named.reason, /other\/keys\.ts adds what looks like a GitHub token/);
  assert.match(
    shell('git add src/app.ts && git commit -m "feat: x"', { git }).reason,
    /src\/app\.ts/,
  );
  assert.equal(
    shell('git add src/new.ts && git commit -m "feat: x"', { git }),
    null,
    'only the named path counts',
  );
  assert.equal(shell('git commit -m "feat: x"', { git }), null, 'nothing staged, nothing added');
  const inSubdir = fakeGit({
    prefix: () => 'packages/ui/',
    untrackedNames: () => ['packages/ui/.env'],
  });
  assert.equal(
    idOf(shell('git add .env && git commit -m "feat: x"', { git: inSubdir })),
    'staged-secrets:deny',
  );
});

test('commit-message blocks attribution footers', () => {
  for (const command of [
    'git commit -m "fix: x" -m "Co-Authored-By: Someone <a@b.c>"',
    `git commit -m "$(cat <<'EOF'\nfix: x\n\nGenerated with [Claude Code](https://example.com)\nEOF\n)"`,
    `git commit -m "$(cat <<'EOF'\nfix: x\n\n\u{1F916} Generated with Claude Code\nEOF\n)"`,
    `git commit -F - <<'EOF'\nfix: x\n\nCo-authored-by: A <a@b.c>\nEOF`,
    'gh pr create --title "fix: x" --body "Summary\n\nco-authored-by: A <a@b.c>"',
    'gh pr edit 12 --body="Generated by Codex"',
    'git commit -m "$SUBJECT" -m "Co-authored-by: A <a@b.c>"',
  ]) {
    assert.equal(idOf(shell(command)), 'commit-message:deny', command);
  }
});

test('commit-message passes prose that only mentions tools or attribution', () => {
  for (const command of [
    'git commit -m "feat: label messages generated by AI"',
    'git commit -m "fix: summaries generated by Claude were truncated"',
    'git commit -m "fix: ids generated by cursor-based pagination"',
    'git commit -m "test: cover the Generated with Claude Code footer"',
    'git commit -m "docs: explain why Co-authored-by: lines are rejected"',
    'gh pr create --title "feat: x" --body "Adds a \u{1F916} icon to the bot badge"',
    'git log --grep="Co-authored-by"',
  ]) {
    assert.equal(shell(command), null, command);
  }
});

test('commit-message requires a Conventional Commits subject', () => {
  assert.equal(idOf(shell('git commit -m "Fixed the thing"')), 'commit-message:deny');
  assert.equal(idOf(shell('git commit -m "feature: x"')), 'commit-message:deny');
  assert.equal(idOf(shell(`git commit -F - <<EOF\nFixed the thing\nEOF`)), 'commit-message:deny');
  for (const subject of [
    'feat: add x',
    'fix(api)!: drop y',
    'chore: version packages',
    'revert: undo x',
    'Merge branch a into b',
    'fixup! feat: add x',
  ]) {
    assert.equal(shell(`git commit -m "${subject}"`), null, subject);
  }
  assert.equal(
    shell('git commit -m "Fixed the thing"', { cfg: config({ conventionalCommits: false }) }),
    null,
  );
});

test('commit-message does not judge a message it cannot read yet', () => {
  for (const command of [
    'git commit -m "$MSG"',
    'git commit -m "$(cat /tmp/msg.txt)"',
    `git commit -m "$(printf 'feat: x\\n\\nbody')"`,
    'git commit',
    'git commit --amend --no-edit',
    'git commit -F "$MSG_FILE"',
    'cd "$ROOT" && git commit -F msg.txt',
  ]) {
    assert.equal(shell(command), null, command);
  }
});

test('commit-message reads -F files, but not one the same line writes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guards-'));
  writeFileSync(join(dir, 'msg.txt'), 'fix: x\n\nCo-authored-by: A <a@b.c>\n');
  mkdirSync(join(dir, 'sub'));
  writeFileSync(join(dir, 'sub', 'msg.txt'), 'Not conventional\n');
  const git = fakeGit({ cwd: dir });
  assert.equal(idOf(shell('git commit -F msg.txt', { git })), 'commit-message:deny');
  assert.match(shell('cd sub && git commit -F msg.txt', { git }).reason, /Not conventional/);
  assert.equal(shell('printf "feat: y" > msg.txt && git commit -F msg.txt', { git }), null);
  assert.equal(shell('git commit -F missing.txt', { git }), null);
});

test('protected-branch asks before a commit on, or a push to, the default branch', () => {
  assert.equal(
    idOf(shell('git commit -m "fix: x"', { git: onMain() })),
    'protected-branch:confirm',
  );
  for (const command of [
    'git push',
    'git push origin HEAD',
    'git push -u origin HEAD',
    'git push origin 2>/dev/null',
    'git push --follow-tags',
  ]) {
    assert.equal(idOf(shell(command, { git: onMain() })), 'protected-branch:confirm', command);
  }
  for (const command of [
    'git push origin main',
    'git push origin feature:main',
    'git push -f origin +HEAD:refs/heads/main',
    'git push --all',
    'git switch main && git commit -m "fix: x"',
  ]) {
    assert.equal(idOf(shell(command)), 'protected-branch:confirm', command);
  }
});

test('protected-branch passes ordinary branch work', () => {
  for (const command of [
    'git commit -m "fix: x"',
    'git push',
    'git push -u origin feature',
    'git push origin feature:feature',
    'git push origin HEAD',
  ]) {
    assert.equal(shell(command), null, command);
  }
  for (const command of [
    'git checkout -b feat/x && git add -A && git commit -m "feat: x"',
    'git switch -c feat/x && git commit -m "feat: x" && git push -u origin feat/x',
    'git switch -c feat/x && git push -u origin HEAD',
    'git push --tags',
    'git push origin --tags',
    'git commit --dry-run -m "fix: x"',
    'cd "$WORKTREE" && git commit -m "fix: x"',
    'git checkout - && git commit -m "fix: x"',
  ]) {
    assert.equal(shell(command, { git: onMain() }), null, command);
  }
  const local = fakeGit({ currentBranch: () => 'main', defaultBranch: () => '' });
  assert.equal(
    shell('git commit -m "fix: x"', { git: local }),
    null,
    'no remote, nothing to protect',
  );
  const listed = shell('git push origin release', {
    cfg: config({ protectedBranches: ['release'] }),
  });
  assert.equal(idOf(listed), 'protected-branch:confirm');
});

test('protected-branch reads the repo a cd or -C points at', () => {
  const worktree = fakeGit({ cwd: '/repo/.worktrees/x', currentBranch: () => 'feat/x' });
  const mainCheckout = fakeGit({ cwd: '/elsewhere', currentBranch: () => 'main' });
  const repos = { '/repo/.worktrees/x': worktree, '/elsewhere': mainCheckout };
  assert.equal(shell('cd .worktrees/x && git commit -m "feat: x"', { git: onMain(), repos }), null);
  assert.equal(shell('git -C .worktrees/x commit -m "feat: x"', { git: onMain(), repos }), null);
  assert.equal(
    idOf(shell('cd /elsewhere && git commit -m "feat: x"', { repos })),
    'protected-branch:confirm',
  );
});

test('a deny outranks a confirm, and a disabled guard is skipped', () => {
  assert.equal(
    idOf(shell('git commit --no-verify -m "fix: x"', { git: onMain() })),
    'no-verify:deny',
  );
  const cfg = config({ isEnabled: (id) => id !== 'no-verify' });
  assert.equal(
    idOf(shell('git commit --no-verify -m "fix: x"', { git: onMain(), cfg })),
    'protected-branch:confirm',
  );
});

test('commands without git or gh are not parsed, and unknown events do nothing', () => {
  assert.equal(shell('pnpm test && rm -rf dist'), null);
  const ctx = { config: config(), git: onMain(), gitAt: fakeGit };
  assert.equal(
    evaluate('', normalize({ tool_input: { command: 'git commit --no-verify' } }), ctx),
    null,
  );
  assert.equal(evaluate('session-start', normalize({}), ctx), null);
});

const edit = (payload, cwd) =>
  evaluate('pre-tool', normalize({ ...payload, cwd }), {
    config: config(),
    git: fakeGit(),
    gitAt: fakeGit,
  });

test('config-protection asks before changing an existing config, and passes new files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guards-'));
  mkdirSync(join(dir, '.husky'));
  mkdirSync(join(dir, '.claude'));
  for (const name of [
    'eslint.config.mjs',
    '.prettierrc',
    '.husky/pre-commit',
    '.claude/settings.json',
  ]) {
    writeFileSync(join(dir, name), '');
    assert.equal(
      idOf(edit({ tool_input: { file_path: join(dir, name) } }, dir)),
      'config-protection:confirm',
      name,
    );
  }
  assert.equal(
    edit({ tool_input: { file_path: join(dir, 'commitlint.config.js') } }, dir),
    null,
    'a new file passes',
  );
  writeFileSync(join(dir, 'tsconfig.json'), '');
  assert.equal(edit({ tool_input: { file_path: join(dir, 'tsconfig.json') } }, dir), null);
  assert.equal(
    idOf(edit({ tool_input: { edits: [{ file_path: '.prettierrc' }] } }, dir)),
    'config-protection:confirm',
  );
});

test('config-protection guards the switch file even before it exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guards-'));
  assert.equal(
    idOf(
      edit(
        { tool_name: 'Write', tool_input: { file_path: join(dir, 'playbook-guards.json') } },
        dir,
      ),
    ),
    'config-protection:confirm',
  );
});

test('a patch-style edit is read as an edit, whichever key carries the patch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guards-'));
  writeFileSync(join(dir, '.prettierrc'), '');
  const patch = '*** Begin Patch\n*** Update File: .prettierrc\n@@\n git commit --no-verify\n';
  for (const toolInput of [
    { patch },
    { input: patch },
    { command: patch },
    { command: ['apply_patch', patch] },
  ]) {
    const finding = edit({ tool_name: 'apply_patch', tool_input: toolInput }, dir);
    assert.equal(idOf(finding), 'config-protection:confirm', Object.keys(toolInput)[0]);
  }
  const readme = '*** Begin Patch\n*** Update File: README.md\n@@\n git commit --no-verify\n';
  assert.equal(edit({ tool_name: 'apply_patch', tool_input: { command: readme } }, dir), null);
});

test('an argv-style shell command is read as the script it runs', () => {
  const run = (command) =>
    evaluate('pre-tool', normalize({ tool_name: 'Bash', tool_input: { command }, cwd: '/repo' }), {
      config: config(),
      git: fakeGit(),
      gitAt: fakeGit,
    });
  assert.equal(idOf(run(['bash', '-lc', 'git commit --no-verify -m "fix: x"'])), 'no-verify:deny');
  assert.equal(run(['git', 'commit', '-m', 'docs: explain --no-verify']), null);
  assert.equal(idOf(run(['git', 'commit', '-m', "it's broken"])), 'commit-message:deny');
});

test('verify-on-stop sends the agent back once on a failing typecheck', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guards-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { typecheck: 'tsc' } }));
  writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
  mkdirSync(join(dir, 'node_modules'));
  const git = fakeGit({ changedSinceDefault: () => ['src/a.ts'] });
  const calls = [];
  const failing = (cmd, args) => (
    calls.push([cmd, ...args]),
    { status: 2, stdout: 'a.ts(1,1): error TS2322', stderr: '' }
  );
  const base = { git, config: config({ root: dir }) };

  const finding = verifyOnStop({ ...base, stopHookActive: false, run: failing });
  assert.equal(finding.result, 'deny');
  assert.ok(finding.reason.includes('TS2322'));
  assert.deepEqual(calls, [['pnpm', 'run', 'typecheck']]);

  assert.equal(verifyOnStop({ ...base, stopHookActive: true, run: failing }), null, 'never loops');
  assert.equal(verifyOnStop({ ...base, stopHookActive: false, run: () => ({ status: 0 }) }), null);
  assert.equal(
    verifyOnStop({
      ...base,
      stopHookActive: false,
      run: () => ({ status: null, error: new Error('timeout') }),
    }),
    null,
  );
  const overflow = () => ({
    status: null,
    error: Object.assign(new Error('too much'), { code: 'ENOBUFS' }),
    stdout: 'error TS1',
    stderr: '',
  });
  assert.equal(verifyOnStop({ ...base, stopHookActive: false, run: overflow }).result, 'deny');
  const docsOnly = fakeGit({ changedSinceDefault: () => ['README.md'] });
  assert.equal(verifyOnStop({ ...base, git: docsOnly, stopHookActive: false, run: failing }), null);
});

test('respond blocks with exit 2, and asks only where the agent can ask', () => {
  const deny = { id: 'no-verify', result: 'deny', reason: 'r' };
  const confirm = { id: 'protected-branch', result: 'confirm', reason: 'r' };
  assert.deepEqual(respond(null, 'claude'), { stdout: '', stderr: '', code: 0 });
  assert.equal(respond(deny, 'claude').code, 2);
  assert.equal(respond(deny, 'claude').stdout, '');

  const asked = respond(confirm, 'claude');
  assert.equal(asked.code, 0);
  assert.equal(JSON.parse(asked.stdout).hookSpecificOutput.permissionDecision, 'ask');

  const blocked = respond(confirm, 'codex');
  assert.equal(blocked.code, 2);
  assert.equal(blocked.stdout, '');
  assert.ok(blocked.stderr.includes('PLAYBOOK_GUARDS_DISABLED=protected-branch'));
});

test('loadConfig merges the environment switch and the project file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guards-'));
  writeFileSync(
    join(dir, 'playbook-guards.json'),
    JSON.stringify({
      disabled: ['Protected-Branch'],
      protectedBranches: ['release'],
      conventionalCommits: false,
      secretScanIgnore: ['evals/', '**/fixtures/*'],
    }),
  );
  const loaded = loadConfig(dir, { PLAYBOOK_GUARDS_DISABLED: 'no-verify, staged-secrets' });
  assert.equal(loaded.isEnabled('no-verify'), false);
  assert.equal(loaded.isEnabled('protected-branch'), false);
  assert.equal(loaded.isEnabled('commit-message'), true);
  assert.deepEqual(loaded.protectedBranches, ['release']);
  assert.equal(loaded.conventionalCommits, false);
  assert.equal(loaded.isSecretScanIgnored('evals/a/b.sh'), true);
  assert.equal(loaded.isSecretScanIgnored('x/fixtures/key.sh'), true);
  assert.equal(loaded.isSecretScanIgnored('src/a.ts'), false);
  assert.equal(
    loadConfig(dir, { PLAYBOOK_GUARDS_DISABLED: 'all' }).isEnabled('commit-message'),
    false,
  );
});

test('loadConfig falls back to defaults for a missing or malformed file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guards-'));
  for (const text of [null, 'null', '[]', '"x"', '{ not json']) {
    if (text !== null) writeFileSync(join(dir, 'playbook-guards.json'), text);
    const loaded = loadConfig(dir, {});
    assert.equal(loaded.isEnabled('no-verify'), true, String(text));
    assert.equal(loaded.conventionalCommits, true);
    assert.equal(loaded.isSecretScanIgnored('a'), false);
  }
});
