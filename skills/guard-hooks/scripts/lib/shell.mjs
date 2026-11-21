// A small, quote-aware reading of a shell command line. It is not a shell: variables, command
// substitution and encoded strings are left as written. It exists so a guard can tell
// `git commit --no-verify` from `git commit -m "explain --no-verify"`.
import { isAbsolute, join } from 'node:path';

/** Words that run the command after them. Their own options and values are skipped. */
const PREFIXES = new Set([
  'sudo',
  'env',
  'command',
  'time',
  'nohup',
  'exec',
  'builtin',
  'timeout',
  'nice',
  'ionice',
  'stdbuf',
  'if',
  'then',
  'else',
  'elif',
  'while',
  'until',
  'do',
  '!',
  '{',
  '(',
]);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash']);
const GUARDED = new Set(['git', 'gh']);
const MAX_DEPTH = 3;

const HEREDOC_SUBSTITUTION =
  /\$\(\s*cat\s+<<-?\s*(['"]?)([^\s'")]+)\1[ \t]*\n[\s\S]*?\n[ \t]*\2\s*\)/y;
const HEREDOC_START = /<<(-?)[ \t]*(?:'([^']*)'|"([^"]*)"|([^\s;&|()<>]+))/y;

/** Index just past the `$( ... )` that starts at `start`. Its text is kept verbatim. */
function substitutionEnd(line, start) {
  HEREDOC_SUBSTITUTION.lastIndex = start;
  const heredoc = HEREDOC_SUBSTITUTION.exec(line);
  if (heredoc) return start + heredoc[0].length;
  let depth = 0;
  for (let i = start + 1; i < line.length; i++) {
    if (line[i] === '(') depth++;
    else if (line[i] === ')' && --depth === 0) return i + 1;
  }
  return line.length;
}

/**
 * Reads the heredoc bodies that start after the newline at `newline`, one per pending heredoc,
 * and stores each on the command that opened it. Returns the index of the last character read.
 */
function readHeredocs(line, newline, pending) {
  let at = newline;
  for (const { delimiter, stripTabs, command } of pending) {
    const body = [];
    let closed = false;
    while (at < line.length - 1 && !closed) {
      let end = line.indexOf('\n', at + 1);
      if (end === -1) end = line.length;
      const text = line.slice(at + 1, end);
      at = end;
      if ((stripTabs ? text.replace(/^\t+/, '') : text).trimEnd() === delimiter) closed = true;
      else body.push(text);
    }
    command.stdin = body.join('\n');
  }
  return at;
}

/**
 * Splits a command line into commands: `{ tokens, quoted, stdin }`, with quotes removed from the tokens,
 * `quoted` holding the indexes of tokens that had any,
 * and `stdin` holding a heredoc body when the command has one. Heredoc bodies are never read as
 * commands.
 */
export function tokenize(line) {
  const commands = [];
  let command = { tokens: [], quoted: new Set(), stdin: null };
  let wasQuoted = false;
  let token = '';
  let hasToken = false;
  let quote = null;
  let pending = [];
  const endToken = () => {
    if (hasToken) {
      if (wasQuoted) command.quoted.add(command.tokens.length);
      command.tokens.push(token);
    }
    token = '';
    hasToken = false;
    wasQuoted = false;
  };
  const endCommand = () => {
    endToken();
    if (command.tokens.length > 0) commands.push(command);
    command = { tokens: [], quoted: new Set(), stdin: null };
  };
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '$' && line[i + 1] === '(' && quote !== "'") {
      const end = substitutionEnd(line, i);
      token += line.slice(i, end);
      hasToken = true;
      i = end - 1;
    } else if (quote === "'") {
      if (ch === "'") quote = null;
      else token += ch;
    } else if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === '\\' && '"\\$`'.includes(line[i + 1] ?? '')) token += line[++i];
      else token += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      hasToken = true;
      wasQuoted = true;
    } else if (ch === '\\' && i + 1 < line.length) {
      if (line[i + 1] !== '\n') token += line[i + 1];
      hasToken = true;
      i++;
    } else if (ch === '<' && line.startsWith('<<<', i)) {
      // A here-string: its value is input for the command, not part of it.
      endToken();
      command.tokens.push('<<<');
      i += 2;
    } else if (ch === '<' && line[i + 1] === '<') {
      HEREDOC_START.lastIndex = i;
      const start = HEREDOC_START.exec(line);
      if (start) {
        endToken();
        pending.push({
          delimiter: start[2] ?? start[3] ?? start[4],
          stripTabs: start[1] === '-',
          command,
        });
        i += start[0].length - 1;
      } else {
        token += ch;
        hasToken = true;
      }
    } else if (ch === '#' && !hasToken) {
      // A comment runs to the end of the line. Its words are not arguments.
      const end = line.indexOf('\n', i);
      i = (end === -1 ? line.length : end) - 1;
    } else if (ch === ' ' || ch === '\t') {
      endToken();
    } else if (ch === '\n') {
      if (pending.length > 0) {
        i = readHeredocs(line, i, pending);
        pending = [];
      }
      endCommand();
    } else if (ch === ';') {
      endCommand();
    } else if (ch === '&' && (line[i - 1] === '>' || line[i - 1] === '<' || line[i + 1] === '>')) {
      // `2>&1` and `&>file` are redirections, not the end of a command.
      token += ch;
      hasToken = true;
    } else if (ch === '&' || ch === '|') {
      if (line[i + 1] === ch) i++;
      endCommand();
    } else {
      token += ch;
      hasToken = true;
    }
  }
  endCommand();
  return commands;
}

const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;
const REDIRECT_WITH_TARGET = /^\d*(>>?|<|&>>?)&?\S+$/;
const REDIRECT_ALONE = /^\d*(>>?|<|<<<|&>>?)$/;
const DURATION = /^\d+(\.\d+)?[smhd]?$/;
const baseName = (token) => token.slice(token.lastIndexOf('/') + 1);
const isGuarded = (token) => GUARDED.has(baseName(token ?? ''));

/** Drops redirections, and the grouping characters a subshell or block wraps a command in. */
function plainTokens(tokens, quoted) {
  const out = [];
  let lastIsPlain = false;
  for (let i = 0; i < tokens.length; i++) {
    // A quoted argument is data, whatever it looks like: `-m "<wip>"`, `--grep ">"`.
    const plain = !quoted.has(i);
    if (plain && REDIRECT_ALONE.test(tokens[i])) i++;
    else if (!plain || !REDIRECT_WITH_TARGET.test(tokens[i])) {
      out.push(tokens[i]);
      lastIsPlain = plain;
    }
  }
  if (out.length > 0 && !quoted.has(0)) out[0] = out[0].replace(/^[({]+(?=.)/, '');
  const last = out.length - 1;
  // `push)` closes a subshell. `stash@{0}` and `%(refname)` keep their own brackets.
  if (last >= 0 && lastIsPlain && !/[({]/.test(out[last]))
    out[last] = out[last].replace(/(?<=.)[)}]+$/, '');
  return out;
}

/** Splits leading `NAME=value` assignments and prefix words from the command they run. */
function splitPrefix(tokens) {
  const env = {};
  let i = 0;
  while (i < tokens.length) {
    const assign = ASSIGNMENT.exec(tokens[i]);
    if (assign) {
      env[assign[1]] = assign[2];
      i++;
    } else if (PREFIXES.has(tokens[i])) {
      i++;
      // Skip the prefix word's own options, one value per option, and a timeout's duration.
      while (i < tokens.length && !isGuarded(tokens[i])) {
        if (tokens[i].startsWith('-')) {
          i++;
          const value = tokens[i] ?? '';
          const isValue =
            value !== '' &&
            !value.startsWith('-') &&
            !isGuarded(value) &&
            !PREFIXES.has(value) &&
            !ASSIGNMENT.test(value);
          if (isValue) i++;
        } else if (DURATION.test(tokens[i])) {
          i++;
        } else {
          break;
        }
      }
    } else {
      break;
    }
  }
  const argv = tokens.slice(i);
  if (argv.length > 0 && isGuarded(argv[0])) argv[0] = baseName(argv[0]);
  return { env, argv };
}

/** Where a `cd` leads from `dir`, or null when the target is not a literal path. */
function changeDir(dir, target) {
  if (dir === null || target === undefined || target === '-' || /[$`~*?]/.test(target)) return null;
  return isAbsolute(target) ? target : join(dir, target);
}

/** The script a `sh -c "..."` style command runs, or undefined. */
function inlineScript(argv) {
  if (!SHELLS.has(baseName(argv[0]))) return undefined;
  for (let i = 1; i < argv.length; i++) {
    if (/^-[A-Za-z]*c$/.test(argv[i])) return argv[i + 1];
    if (!argv[i].startsWith('-')) return undefined;
  }
  return undefined;
}

/**
 * Returns every command the line would run, in order, as `{ env, argv, dir, stdin }`.
 *
 * - `env` holds `NAME=value` assignments on the command and earlier `export`s in the line.
 * - Prefix words such as `sudo` and `timeout 60` are dropped, and `sh -c "..."` is read as the
 *   commands inside it.
 * - `dir` is the directory earlier `cd`s lead to, relative to where the line starts ('' when
 *   unchanged), or null when a `cd` went somewhere this reader cannot follow: a variable, a
 *   subshell, a `popd`.
 */
export function parseCommands(line, depth = 0, state = { dir: '', env: {} }) {
  const out = [];
  for (const { tokens, quoted, stdin } of tokenize(line)) {
    const { env, argv } = splitPrefix(plainTokens(tokens, quoted));
    if (argv.length === 0) continue;
    if (argv[0] === 'cd' || argv[0] === 'pushd' || argv[0] === 'popd') {
      // A `cd` inside `( ... )` or `{ ... }` ends with the group, and `popd` returns somewhere
      // this reader did not record. Either way the directory is no longer known.
      const grouped = !quoted.has(0) && /^[({]/.test(tokens[0]);
      state.dir = grouped || argv[0] === 'popd' ? null : changeDir(state.dir, argv[1]);
      continue;
    }
    if (argv[0] === 'export') {
      for (const arg of argv.slice(1)) {
        const assign = ASSIGNMENT.exec(arg);
        if (assign) state.env[assign[1]] = assign[2];
      }
      continue;
    }
    const merged = { ...state.env, ...env };
    const script = inlineScript(argv);
    if (script !== undefined && depth < MAX_DEPTH) {
      out.push(...parseCommands(script, depth + 1, { dir: state.dir, env: merged }));
    } else {
      out.push({ env: merged, argv, dir: state.dir, stdin });
    }
  }
  return out;
}

const GIT_GLOBAL_WITH_VALUE = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--config-env',
  '--exec-path',
]);

/** Reads a git command: its `-c key=value` settings, `-C` directory, subcommand and arguments. */
export function parseGit(argv) {
  if (argv[0] !== 'git') return null;
  const configs = [];
  let dir = null;
  let i = 1;
  for (; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('-')) break;
    if (arg === '-c') configs.push(argv[i + 1] ?? '');
    if (arg === '-C') dir = argv[i + 1] ?? null;
    if (GIT_GLOBAL_WITH_VALUE.has(arg)) i++;
  }
  return { configs, dir, sub: argv[i] ?? null, args: argv.slice(i + 1) };
}

/** Options of `git commit` that consume the next argument. */
const COMMIT_VALUE_LONG = new Set([
  '--message',
  '--file',
  '--reuse-message',
  '--reedit-message',
  '--author',
  '--date',
  '--fixup',
  '--squash',
  '--trailer',
  '--cleanup',
  '--template',
  '--pathspec-from-file',
]);
const COMMIT_VALUE_SHORT = new Set(['m', 'F', 'C', 'c', 't']);
/** Short options whose value, when present, is attached: `-uno`, `-S<keyid>`. */
const COMMIT_ATTACHED_SHORT = new Set(['u', 'S']);

/**
 * Walks `git commit` arguments and reports the flags, messages and message files, without
 * mistaking an option's value for an option.
 */
export function readCommitArgs(args) {
  const out = { flags: [], shortFlags: '', messages: [], files: [] };
  const take = (name, value) => {
    if (name === '--message' || name === 'm') out.messages.push(value);
    if (name === '--file' || name === 'F') out.files.push(value);
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') break;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = eq === -1 ? arg : arg.slice(0, eq);
      out.flags.push(name);
      if (COMMIT_VALUE_LONG.has(name))
        take(name, eq === -1 ? (args[++i] ?? '') : arg.slice(eq + 1));
    } else if (/^-[A-Za-z]/.test(arg)) {
      for (let j = 1; j < arg.length; j++) {
        const letter = arg[j];
        if (COMMIT_ATTACHED_SHORT.has(letter)) break;
        if (COMMIT_VALUE_SHORT.has(letter)) {
          const attached = arg.slice(j + 1);
          take(letter, attached !== '' ? attached : (args[++i] ?? ''));
          break;
        }
        out.shortFlags += letter;
      }
    }
  }
  return out;
}

/** Returns the body when a value is `$(cat <<'EOF' ... EOF)`, the form agents use for messages. */
export function heredocBody(value) {
  const match =
    /^\$\(\s*cat\s+<<-?\s*(['"]?)([^\s'")]+)\1[ \t]*\n([\s\S]*?)\n[ \t]*\2\s*\)\s*$/.exec(value);
  return match ? match[3] : value;
}

/** True when the shell would still expand something in the text, so its final value is unknown. */
export const isUnexpanded = (text) => /\$[({A-Za-z_]|`/.test(text);
