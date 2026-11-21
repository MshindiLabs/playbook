import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { run } from '../scripts/install.mjs';

const guardPath = '/opt/skills/guard-hooks/scripts/guard.mjs';
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
  run([], { home, guardPath, ...quiet });
  assert.deepEqual(read(settings), existing);
  assert.equal(existsSync(codex), false);
});

test('--apply adds the entries, keeps everything else and backs the file up', () => {
  const { home, settings, existing, codex } = setup();
  run(['--apply'], { home, guardPath, ...quiet });
  const after = read(settings);
  assert.deepEqual(after.permissions, existing.permissions);
  assert.deepEqual(after.hooks.PostToolUse, existing.hooks.PostToolUse);
  assert.deepEqual(after.hooks.Notification, [], 'an event we have nothing in is left as it was');
  assert.equal(after.hooks.PreToolUse.length, 2);
  assert.equal(
    after.hooks.PreToolUse[0].hooks[0].command,
    `node "${guardPath}" pre-tool --agent claude`,
  );
  assert.equal(after.hooks.Stop[0].hooks[0].timeout, 300);
  assert.equal(backups(home).length, 1);
  assert.equal(
    read(codex).hooks.PreToolUse[0].hooks[0].command,
    `node "${guardPath}" pre-tool --agent codex`,
  );
  assert.equal(read(codex).hooks.Stop, undefined, 'no stop hook where a loop guard is unconfirmed');
});

test('installing twice does not duplicate, and a moved install replaces the old path', () => {
  const { home, settings } = setup();
  run(['--apply'], { home, guardPath, ...quiet });
  const once = readFileSync(settings, 'utf8');
  run(['--apply'], { home, guardPath, ...quiet });
  assert.equal(readFileSync(settings, 'utf8'), once);
  assert.equal(backups(home).length, 1, 'an unchanged file is not backed up again');
  const moved = '/elsewhere/guard-hooks/scripts/guard.mjs';
  run(['--apply'], { home, guardPath: moved, ...quiet });
  const commands = read(settings).hooks.PreToolUse.map((entry) => entry.hooks[0].command);
  assert.deepEqual(commands, [
    `node "${moved}" pre-tool --agent claude`,
    `node "${moved}" pre-tool --agent claude`,
  ]);
});

test('--remove restores the file exactly, and is a no-op where nothing was installed', () => {
  const { home, settings, existing, codex } = setup();
  run(['--remove', '--apply'], { home, guardPath, ...quiet });
  assert.deepEqual(read(settings), existing);
  assert.equal(backups(home).length, 0);
  run(['--apply'], { home, guardPath, ...quiet });
  run(['--remove', '--apply'], { home, guardPath, ...quiet });
  assert.deepEqual(read(settings), existing);
  assert.deepEqual(read(codex), { hooks: {} });
});

test("someone else's hook in our matcher group survives reinstall and removal", () => {
  const { home, settings } = setup();
  run(['--apply'], { home, guardPath, ...quiet });
  const withTheirs = read(settings);
  const theirs = { type: 'command', command: 'their-audit.sh' };
  withTheirs.hooks.PreToolUse[0].hooks.push(theirs);
  writeFileSync(settings, JSON.stringify(withTheirs));
  run(['--apply'], { home, guardPath, ...quiet });
  const all = read(settings).hooks.PreToolUse.flatMap((group) =>
    group.hooks.map((hook) => hook.command),
  );
  assert.equal(all.filter((command) => command === 'their-audit.sh').length, 1);
  assert.equal(all.filter((command) => command.includes('guard.mjs')).length, 2);
  run(['--remove', '--apply'], { home, guardPath, ...quiet });
  assert.deepEqual(read(settings).hooks.PreToolUse, [{ matcher: 'Bash', hooks: [theirs] }]);
});

test('two applies in the same instant keep both backups', () => {
  const { home } = setup();
  const now = () => new Date('2026-11-21T10:00:00.000Z');
  run(['--apply'], { home, guardPath, now, ...quiet });
  run(['--remove', '--apply'], { home, guardPath, now, ...quiet });
  assert.equal(backups(home).length, 2);
});

test('an empty config file is treated as empty, and a non-object or broken one stops the run', () => {
  const { home, settings, codex } = setup();
  writeFileSync(settings, '  \n');
  run(['--apply', '--agent', 'claude'], { home, guardPath, ...quiet });
  assert.equal(read(settings).hooks.PreToolUse.length, 2);
  for (const text of ['{ not json', '[]', 'null', '"x"']) {
    writeFileSync(settings, text);
    assert.throws(() => run(['--apply'], { home, guardPath, ...quiet }), undefined, text);
    assert.equal(readFileSync(settings, 'utf8'), text);
    assert.equal(existsSync(codex), false, 'nothing is written when any file cannot be read');
  }
});

test('--agent limits the change, and Codex is skipped unasked when it is not installed', () => {
  const { home, settings, codex } = setup();
  run(['--apply', '--agent', 'codex'], { home, guardPath, ...quiet });
  assert.equal(read(settings).hooks.PreToolUse, undefined);
  assert.ok(read(codex).hooks.PreToolUse);
  assert.throws(() => run(['--agent', 'vim'], { home, guardPath, ...quiet }), /unknown agent/);

  const fresh = setup({ codexInstalled: false });
  run(['--apply'], { home: fresh.home, guardPath, ...quiet });
  assert.equal(existsSync(join(fresh.home, '.codex')), false);
  run(['--apply', '--agent', 'codex'], { home: fresh.home, guardPath, ...quiet });
  assert.ok(read(fresh.codex).hooks.PreToolUse);
});

test('odd shapes beside our hooks are kept, and an event that is not a list stops the run', () => {
  const { home, settings } = setup();
  run(['--apply', '--agent', 'claude'], { home, guardPath, ...quiet });
  const config = read(settings);
  const odd = [{ matcher: 'Read' }, { matcher: 'Grep', hooks: [] }];
  config.hooks.PreToolUse.push(...odd);
  writeFileSync(settings, JSON.stringify(config));
  run(['--apply', '--agent', 'claude'], { home, guardPath, ...quiet });
  run(['--remove', '--apply', '--agent', 'claude'], { home, guardPath, ...quiet });
  assert.deepEqual(read(settings).hooks.PreToolUse, odd);

  const notAList = { hooks: { PreToolUse: { matcher: 'Bash' } } };
  writeFileSync(settings, JSON.stringify(notAList));
  assert.throws(
    () => run(['--apply', '--agent', 'claude'], { home, guardPath, ...quiet }),
    /hooks\.PreToolUse is not a list/,
  );
  assert.deepEqual(read(settings), notAList);
});
