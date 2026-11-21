import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  heredocBody,
  isUnexpanded,
  parseCommands,
  parseGit,
  readCommitArgs,
  tokenize,
} from '../scripts/lib/shell.mjs';

const tokens = (line) => tokenize(line).map((command) => command.tokens);
const argvs = (line) => parseCommands(line).map((command) => command.argv);

test('tokenize splits on separators outside quotes only', () => {
  assert.deepEqual(tokens(`git add . && git commit -m "a; b && c" | cat`), [
    ['git', 'add', '.'],
    ['git', 'commit', '-m', 'a; b && c'],
    ['cat'],
  ]);
});

test('tokenize keeps empty quoted arguments and joined quotes', () => {
  assert.deepEqual(tokens(`git commit -m '' --no-"verify"`), [
    ['git', 'commit', '-m', '', '--no-verify'],
  ]);
});

test('redirections are not commands and not arguments', () => {
  assert.deepEqual(argvs('git push origin feature 2>&1 | tail -3'), [
    ['git', 'push', 'origin', 'feature'],
    ['tail', '-3'],
  ]);
  assert.deepEqual(argvs('git push origin 2>/dev/null > out.txt'), [['git', 'push', 'origin']]);
  assert.deepEqual(argvs('git status &> /dev/null'), [['git', 'status']]);
});

test('a heredoc body is never read as commands, and is kept as the command stdin', () => {
  const line = `cat > release.sh <<'EOF'\ngit add -A\ngit commit --no-verify -m "Release"\ndon't stop\nEOF\ngit status`;
  const commands = parseCommands(line);
  assert.deepEqual(
    commands.map((command) => command.argv),
    [['cat'], ['git', 'status']],
  );
  assert.ok(commands[0].stdin.includes('git commit --no-verify'));
  const piped = parseCommands(`git commit -F - <<-MSG-1\n\tfeat: x\n\tMSG-1\n`);
  assert.equal(piped[0].stdin, '\tfeat: x');
  assert.deepEqual(argvs('cat <<< "git commit --no-verify" && git status'), [
    ['cat'],
    ['git', 'status'],
  ]);
});

test('parseCommands reads env, exports, prefix words and inline shell scripts', () => {
  assert.deepEqual(parseCommands(`HUSKY=0 sudo git commit -m x`)[0].env, { HUSKY: '0' });
  assert.deepEqual(parseCommands(`export HUSKY=0 && git commit -m x`)[0].env, { HUSKY: '0' });
  for (const line of [
    'timeout 60 git push',
    'sudo -u deploy git push',
    'nice -n 10 git push',
    '/usr/bin/git push',
    '(git push)',
    '{ git push; }',
    'if git push; then echo ok; fi',
    '! git push',
    'env -i git push',
  ]) {
    assert.deepEqual(argvs(line)[0], ['git', 'push'], line);
  }
  for (const line of [
    `bash -c "cd a && git push --no-verify"`,
    `bash -lc "cd a && git push --no-verify"`,
    `sh -ec 'cd a && git push --no-verify'`,
  ]) {
    assert.deepEqual(argvs(line), [['git', 'push', '--no-verify']], line);
  }
  assert.deepEqual(argvs('echo git push'), [['echo', 'git', 'push']]);
});

test('parseCommands follows cd, and gives up on a cd it cannot follow', () => {
  const dirs = (line) => parseCommands(line).map((command) => command.dir);
  assert.deepEqual(dirs('git status'), ['']);
  assert.deepEqual(dirs('cd packages/ui && git status'), ['packages/ui']);
  assert.deepEqual(dirs('cd a && cd ../b && git status'), ['b']);
  assert.deepEqual(dirs('cd /abs/repo && git status'), ['/abs/repo']);
  assert.deepEqual(dirs('cd "$ROOT" && git status'), [null]);
  assert.deepEqual(dirs('cd ~/x && git status'), [null]);
  assert.deepEqual(dirs('bash -c "cd sub && git status" && git log'), ['sub', '']);
});

test('parseGit separates global options from the subcommand', () => {
  assert.deepEqual(
    parseGit(['git', '-C', 'pkg', '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'x']),
    {
      configs: ['core.hooksPath=/dev/null'],
      dir: 'pkg',
      sub: 'commit',
      args: ['-m', 'x'],
    },
  );
  assert.equal(parseGit(['ls']), null);
});

test('readCommitArgs does not read an option value as a flag', () => {
  const read = readCommitArgs([
    '-am',
    'fix: -n is fine',
    '--trailer',
    '--no-verify',
    '-F',
    'msg.txt',
    '--message=two',
  ]);
  assert.equal(read.shortFlags, 'a');
  assert.deepEqual(read.messages, ['fix: -n is fine', 'two']);
  assert.deepEqual(read.files, ['msg.txt']);
  assert.deepEqual(read.flags, ['--trailer', '--message']);
  assert.equal(readCommitArgs(['-an', '-m', 'x']).shortFlags, 'an');
});

test('readCommitArgs treats -u and -S values as values, not flags', () => {
  assert.equal(readCommitArgs(['-uno', '-m', 'x']).shortFlags, '');
  assert.equal(readCommitArgs(['-uall']).shortFlags, '');
  assert.equal(readCommitArgs(['-Sbrian']).shortFlags, '');
  assert.equal(readCommitArgs(['-aS']).shortFlags, 'a');
});

test('heredocBody unwraps the cat heredoc form and leaves other values alone', () => {
  assert.equal(heredocBody("$(cat <<'EOF'\nfeat: add x\n\nbody\nEOF\n)"), 'feat: add x\n\nbody');
  assert.equal(heredocBody("$(cat <<'COMMIT-MSG'\nfeat: add x\nCOMMIT-MSG\n)"), 'feat: add x');
  assert.equal(heredocBody('plain'), 'plain');
});

test('a heredoc message with quotes, separators and parentheses stays one argument', () => {
  const line = `git commit -m "$(cat <<'EOF'\nfix: say "hi there" (a) b; c && d\n\nbody\nEOF\n)" && git push`;
  const commands = parseCommands(line);
  assert.equal(commands.length, 2);
  const { messages } = readCommitArgs(parseGit(commands[0].argv).args);
  assert.equal(heredocBody(messages[0]), 'fix: say "hi there" (a) b; c && d\n\nbody');
  assert.deepEqual(commands[1].argv, ['git', 'push']);
});

test('isUnexpanded spots values the shell has not expanded yet', () => {
  for (const text of ['$MSG', '${MSG}', '$(cat msg.txt)', '`cat msg`'])
    assert.equal(isUnexpanded(text), true, text);
  for (const text of ['feat: x', 'fix: costs $5', 'docs: a $ sign'])
    assert.equal(isUnexpanded(text), false, text);
});

test('odd input never throws', () => {
  for (const line of [
    '',
    '   ',
    '"unterminated',
    "'",
    '$(',
    '$((',
    '<<',
    'cat <<EOF',
    '&&',
    ';;',
    ')',
    '{',
    'git',
    'bash -c',
    'a=b',
    '\\',
  ]) {
    assert.doesNotThrow(() => parseCommands(line), line);
  }
});

test('a comment runs to the end of its line and is not arguments', () => {
  assert.deepEqual(argvs('git push origin feat/x  # PR goes against main'), [
    ['git', 'push', 'origin', 'feat/x'],
  ]);
  assert.deepEqual(argvs(`git status # don't stop\ngit commit -m "fix: x #12"`), [
    ['git', 'status'],
    ['git', 'commit', '-m', 'fix: x #12'],
  ]);
  assert.deepEqual(argvs('git log origin/main#frag'), [['git', 'log', 'origin/main#frag']]);
});

test('quoted arguments are data even when they look like redirections or grouping', () => {
  assert.deepEqual(argvs('git commit -m "<wip>" --grep ">" -m "fix: }"'), [
    ['git', 'commit', '-m', '<wip>', '--grep', '>', '-m', 'fix: }'],
  ]);
  assert.deepEqual(argvs('git stash apply stash@{0}'), [['git', 'stash', 'apply', 'stash@{0}']]);
  assert.deepEqual(argvs('git show HEAD:{file}'), [['git', 'show', 'HEAD:{file}']]);
  assert.deepEqual(argvs("git log --format='%(refname)'"), [['git', 'log', '--format=%(refname)']]);
  assert.deepEqual(argvs('git commit -m "a -> b" && git diff HEAD~1 > out.patch'), [
    ['git', 'commit', '-m', 'a -> b'],
    ['git', 'diff', 'HEAD~1'],
  ]);
});

test('the directory is unknown after a subshell cd or a popd', () => {
  const dirs = (line) => parseCommands(line).map((command) => command.dir);
  assert.deepEqual(dirs('(cd ../other && git pull) && git commit -m x'), [null, null]);
  assert.deepEqual(dirs('pushd ../other && git pull && popd && git push'), ['../other', null]);
});
