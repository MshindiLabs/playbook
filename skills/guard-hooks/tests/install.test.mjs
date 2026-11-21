import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { installedDir, installedGuard, run } from '../scripts/install.mjs';

const sourceDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const setup = ({ codexInstalled = true } = {}) => {
  const home = mkdtempSync(join(tmpdir(), 'guards-home-'));
  mkdirSync(join(home, '.claude'));
  if (codexInstalled) mkdirSync(join(home, '.codex'));
  const settings = join(home, '.claude', 'settings.json');
  const existing = {
    permissions: { deny: ['Read(~/.ssh/**)'] },
    hooks: {
      PostToolUse: [
        { matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'prettier --write' }] },
      ],
      Notification: [],
    },
  };
  writeFileSync(settings, JSON.stringify(existing, null, 2));
  return { home, settings, existing, codex: join(home, '.codex', 'hooks.json') };
};
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const quiet = { log: () => {} };
const backups = (home) =>
  readdirSync(join(home, '.claude')).filter((name) => name.includes('.bak-'));

test('without --apply nothing is written', () => {
  const { home, settings, existing, codex } = setup();
  run([], { home, sourceDir, ...quiet });
  assert.deepEqual(read(settings), existing);
  assert.equal(existsSync(codex), false);
});

test('--apply adds the entries, keeps everything else and backs the file up', () => {
  const { home, settings, existing, codex } = setup();
  run(['--apply'], { home, sourceDir, ...quiet });
  const after = read(settings);
  assert.deepEqual(after.permissions, existing.permissions);
  assert.deepEqual(after.hooks.PostToolUse, existing.hooks.PostToolUse);
  assert.deepEqual(after.hooks.Notification, [], 'an event we have nothing in is left as it was');
  assert.equal(after.hooks.PreToolUse.length, 2);
  assert.equal(
    after.hooks.PreToolUse[0].hooks[0].command,
    `node "${installedGuard(home)}" pre-tool --agent claude`,
  );
  assert.equal(after.hooks.Stop[0].hooks[0].timeout, 300);
  assert.equal(backups(home).length, 1);
  assert.equal(
    read(codex).hooks.PreToolUse[0].hooks[0].command,
    `node "${installedGuard(home)}" pre-tool --agent codex`,
  );
  assert.equal(read(codex).hooks.Stop, undefined, 'no stop hook where a loop guard is unconfirmed');
});

test('installing twice does not duplicate, and a moved install replaces the old path', () => {
  const { home, settings } = setup();
  run(['--apply'], { home, sourceDir, ...quiet });
  const once = readFileSync(settings, 'utf8');
  run(['--apply'], { home, sourceDir, ...quiet });
  assert.equal(readFileSync(settings, 'utf8'), once);
  assert.equal(backups(home).length, 1, 'an unchanged file is not backed up again');
  const old = read(settings);
  const elsewhere = 'node "/elsewhere/guard-hooks/scripts/guard.mjs" pre-tool --agent claude';
  for (const entry of old.hooks.PreToolUse) entry.hooks[0].command = elsewhere;
  writeFileSync(settings, JSON.stringify(old));
  run(['--apply'], { home, sourceDir, ...quiet });
  const commands = read(settings).hooks.PreToolUse.map((entry) => entry.hooks[0].command);
  assert.deepEqual(commands, [
    `node "${installedGuard(home)}" pre-tool --agent claude`,
    `node "${installedGuard(home)}" pre-tool --agent claude`,
  ]);
});

test('--remove restores the file exactly, and is a no-op where nothing was installed', () => {
  const { home, settings, existing, codex } = setup();
  run(['--remove', '--apply'], { home, sourceDir, ...quiet });
  assert.deepEqual(read(settings), existing);
  assert.equal(backups(home).length, 0);
  run(['--apply'], { home, sourceDir, ...quiet });
  run(['--remove', '--apply'], { home, sourceDir, ...quiet });
  assert.deepEqual(read(settings), existing);
  assert.deepEqual(read(codex), { hooks: {} });
});

test("someone else's hook in our matcher group survives reinstall and removal", () => {
  const { home, settings } = setup();
  run(['--apply'], { home, sourceDir, ...quiet });
  const withTheirs = read(settings);
  const theirs = { type: 'command', command: 'their-audit.sh' };
  withTheirs.hooks.PreToolUse[0].hooks.push(theirs);
  writeFileSync(settings, JSON.stringify(withTheirs));
  run(['--apply'], { home, sourceDir, ...quiet });
  const all = read(settings).hooks.PreToolUse.flatMap((group) =>
    group.hooks.map((hook) => hook.command),
  );
  assert.equal(all.filter((command) => command === 'their-audit.sh').length, 1);
  assert.equal(all.filter((command) => command.includes('guard.mjs')).length, 2);
  run(['--remove', '--apply'], { home, sourceDir, ...quiet });
  assert.deepEqual(read(settings).hooks.PreToolUse, [{ matcher: 'Bash', hooks: [theirs] }]);
});

test('two applies in the same instant keep both backups', () => {
  const { home } = setup();
  const now = () => new Date('2026-11-21T10:00:00.000Z');
  run(['--apply'], { home, sourceDir, now, ...quiet });
  run(['--remove', '--apply'], { home, sourceDir, now, ...quiet });
  assert.equal(backups(home).length, 2);
});

test('an empty config file is treated as empty, and a non-object or broken one stops the run', () => {
  const { home, settings, codex } = setup();
  writeFileSync(settings, '  \n');
  run(['--apply', '--agent', 'claude'], { home, sourceDir, ...quiet });
  assert.equal(read(settings).hooks.PreToolUse.length, 2);
  for (const text of ['{ not json', '[]', 'null', '"x"']) {
    writeFileSync(settings, text);
    assert.throws(() => run(['--apply'], { home, sourceDir, ...quiet }), undefined, text);
    assert.equal(readFileSync(settings, 'utf8'), text);
    assert.equal(existsSync(codex), false, 'nothing is written when any file cannot be read');
  }
});

test('--agent limits the change, and Codex is skipped unasked when it is not installed', () => {
  const { home, settings, codex } = setup();
  run(['--apply', '--agent', 'codex'], { home, sourceDir, ...quiet });
  assert.equal(read(settings).hooks.PreToolUse, undefined);
  assert.ok(read(codex).hooks.PreToolUse);
  assert.throws(() => run(['--agent', 'vim'], { home, sourceDir, ...quiet }), /unknown agent/);

  const fresh = setup({ codexInstalled: false });
  run(['--apply'], { home: fresh.home, sourceDir, ...quiet });
  assert.equal(existsSync(join(fresh.home, '.codex')), false);
  run(['--apply', '--agent', 'codex'], { home: fresh.home, sourceDir, ...quiet });
  assert.ok(read(fresh.codex).hooks.PreToolUse);
});

test('odd shapes beside our hooks are kept, and an event that is not a list stops the run', () => {
  const { home, settings } = setup();
  run(['--apply', '--agent', 'claude'], { home, sourceDir, ...quiet });
  const config = read(settings);
  const odd = [{ matcher: 'Read' }, { matcher: 'Grep', hooks: [] }];
  config.hooks.PreToolUse.push(...odd);
  writeFileSync(settings, JSON.stringify(config));
  run(['--apply', '--agent', 'claude'], { home, sourceDir, ...quiet });
  run(['--remove', '--apply', '--agent', 'claude'], { home, sourceDir, ...quiet });
  assert.deepEqual(read(settings).hooks.PreToolUse, odd);

  const notAList = { hooks: { PreToolUse: { matcher: 'Bash' } } };
  writeFileSync(settings, JSON.stringify(notAList));
  assert.throws(
    () => run(['--apply', '--agent', 'claude'], { home, sourceDir, ...quiet }),
    /hooks\.PreToolUse is not a list/,
  );
  assert.deepEqual(read(settings), notAList);
});

const lines = () => {
  const out = [];
  return { out, log: (line) => out.push(line) };
};

test('--apply copies the scripts, and the hooks keep working after the skill is deleted', () => {
  const { home } = setup();
  const skill = mkdtempSync(join(tmpdir(), 'guards-skill-'));
  cpSync(sourceDir, join(skill, 'scripts'), { recursive: true });
  run(['--apply', '--agent', 'claude'], { home, sourceDir: join(skill, 'scripts'), ...quiet });
  rmSync(skill, { recursive: true });

  const command = read(join(home, '.claude', 'settings.json')).hooks.PreToolUse[0].hooks[0].command;
  const script = /"([^"]+)"/.exec(command)[1];
  const payload = {
    tool_name: 'Bash',
    tool_input: { command: 'git commit --no-verify -m "x: y"' },
  };
  const blocked = spawnSync('node', [script, 'pre-tool', '--agent', 'claude'], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    cwd: home,
  });
  assert.equal(blocked.status, 2, blocked.stderr);
  assert.match(blocked.stderr, /playbook guard: no-verify/);
});

test('without --apply the scripts are not copied', () => {
  const { home } = setup();
  run([], { home, sourceDir, ...quiet });
  assert.equal(existsSync(installedDir(home)), false);
});

test('a changed skill refreshes the copy, and the copy can remove itself', () => {
  const { home, settings, existing } = setup();
  run(['--apply'], { home, sourceDir, ...quiet });
  writeFileSync(join(installedDir(home), 'guard.mjs'), '// stale\n');
  writeFileSync(join(installedDir(home), 'left-over.mjs'), '');
  run(['--apply'], { home, sourceDir, ...quiet });
  assert.equal(
    readFileSync(installedGuard(home), 'utf8'),
    readFileSync(join(sourceDir, 'guard.mjs'), 'utf8'),
  );
  assert.equal(existsSync(join(installedDir(home), 'left-over.mjs')), false);

  run(['--remove', '--apply'], { home, sourceDir: installedDir(home), ...quiet });
  assert.deepEqual(read(settings), existing);
  assert.equal(existsSync(installedDir(home)), false);
});

test('removing for one agent keeps the copy while another agent still uses it', () => {
  const { home } = setup();
  run(['--apply'], { home, sourceDir, ...quiet });
  run(['--remove', '--apply', '--agent', 'claude'], { home, sourceDir, ...quiet });
  assert.equal(existsSync(installedGuard(home)), true);
  run(['--remove', '--apply', '--agent', 'codex'], { home, sourceDir, ...quiet });
  assert.equal(existsSync(installedDir(home)), false);
});

test('--check passes on a sound install and on no install, and changes nothing', () => {
  const { home, settings } = setup();
  const none = lines();
  assert.equal(run(['--check'], { home, sourceDir, log: none.log }), true);
  assert.match(none.out.join('\n'), /No guard hooks are installed/);

  run(['--apply'], { home, sourceDir, ...quiet });
  const before = readFileSync(settings, 'utf8');
  const sound = lines();
  assert.equal(run(['--check'], { home, sourceDir, log: sound.log }), true);
  assert.equal(sound.out.filter((line) => line.endsWith(': ok')).length, 5);
  assert.doesNotMatch(sound.out.join('\n'), /differs|MISSING/);
  assert.equal(readFileSync(settings, 'utf8'), before);
});

test('--check fails on a hook whose script is gone', () => {
  const { home } = setup();
  run(['--apply'], { home, sourceDir, ...quiet });
  rmSync(installedDir(home), { recursive: true });
  const report = lines();
  assert.equal(run(['--check'], { home, sourceDir, log: report.log }), false);
  assert.match(report.out.join('\n'), /MISSING/);
  assert.match(report.out.join('\n'), /that guard is off/);
});

test('--check says when the installed copy is out of date', () => {
  const { home } = setup();
  run(['--apply'], { home, sourceDir, ...quiet });
  writeFileSync(installedGuard(home), '// stale\n');
  const report = lines();
  assert.equal(run(['--check'], { home, sourceDir, log: report.log }), true);
  assert.match(report.out.join('\n'), /differs from this skill/);
});

test('--check says when the hooks still run from outside the copy', () => {
  const { home, settings } = setup();
  run(['--apply', '--agent', 'claude'], { home, sourceDir, ...quiet });
  const config = read(settings);
  const elsewhere = mkdtempSync(join(tmpdir(), 'guards-old-'));
  cpSync(sourceDir, join(elsewhere, 'guard-hooks', 'scripts'), { recursive: true });
  const command = `node "${join(elsewhere, 'guard-hooks', 'scripts', 'guard.mjs')}" pre-tool --agent claude`;
  for (const entry of config.hooks.PreToolUse) entry.hooks[0].command = command;
  config.hooks.Stop[0].hooks[0].command = command.replace('pre-tool', 'stop');
  writeFileSync(settings, JSON.stringify(config));
  rmSync(installedDir(home), { recursive: true });

  const report = lines();
  assert.equal(run(['--check'], { home, sourceDir, log: report.log }), true);
  assert.match(report.out.join('\n'), /there is none yet/);
  assert.doesNotMatch(report.out.join('\n'), /differs|MISSING/);
});

test('the command line exits 1 when --check finds a dangling hook', () => {
  const { home } = setup();
  run(['--apply'], { home, sourceDir, ...quiet });
  rmSync(installedDir(home), { recursive: true });
  const result = spawnSync('node', [join(sourceDir, 'install.mjs'), '--check'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
});
