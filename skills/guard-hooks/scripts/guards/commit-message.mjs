import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { heredocBody, isUnexpanded, parseGit, readCommitArgs } from '../lib/shell.mjs';

/** Footer lines, matched from the start of a line so prose that mentions a tool is not caught. */
const ATTRIBUTION = [
  /^[ \t]*co-authored-by:/im,
  /^[ \t]*(?:\u{1F916}[ \t]*)?generated (?:with|by) \[?(?:claude|codex|cursor|copilot|chatgpt|gemini|aider|windsurf)\b/imu,
];
const CONVENTIONAL =
  /^(feat|fix|chore|docs|refactor|test|perf|build|ci|style|revert)(\([^()\s]+\))?!?: \S/;
/** Subjects git or its tooling writes for us. */
const GENERATED_SUBJECT = /^(Merge |Revert "|fixup! |squash! |amend! )/;

const hasAttribution = (text) => ATTRIBUTION.some((pattern) => pattern.test(text));

/**
 * The text of a message option, or null when it cannot be known before the command runs: a value
 * the shell still has to expand, or a file that an earlier part of the same line writes.
 */
function readable(value) {
  const text = heredocBody(value);
  return isUnexpanded(text) ? null : text;
}

function fileText(path, cwd, command, line) {
  if (path === '-')
    return command.stdin === null || isUnexpanded(command.stdin) ? null : command.stdin;
  if (isUnexpanded(path) || line.split(path).length > 2) return null;
  try {
    return readFileSync(resolve(cwd, path), 'utf8');
  } catch {
    return null;
  }
}

/** Values of the body options of `gh pr create` and `gh pr edit`. */
function prBodies(command, cwd, line) {
  const { argv } = command;
  const bodies = [];
  for (let i = 3; i < argv.length; i++) {
    const [name, inline] = argv[i].split(/=(.*)/s);
    const value = () => inline ?? argv[++i] ?? '';
    if (name === '--body' || name === '-b') bodies.push(readable(value()));
    else if (name === '--body-file' || name === '-F')
      bodies.push(fileText(value(), cwd, command, line));
  }
  return bodies.filter((text) => text !== null);
}

/** Blocks attribution lines in commits and PR bodies, and commit subjects that are not Conventional Commits. */
export function commitMessage({ commands, command: line, locate, config }) {
  for (const command of commands) {
    const { argv } = command;
    if (argv[0] === 'gh' && argv[1] === 'pr' && (argv[2] === 'create' || argv[2] === 'edit')) {
      const where = locate(command, null);
      if (where && prBodies(command, where.cwd, line).some(hasAttribution)) {
        return {
          result: 'deny',
          reason: 'The pull request body has an attribution or co-author line. Remove it.',
        };
      }
      continue;
    }
    const parsed = parseGit(argv);
    if (parsed?.sub !== 'commit') continue;
    const read = readCommitArgs(parsed.args);
    const where = locate(command, parsed);
    const parts = [
      ...read.messages.map(readable),
      ...read.files.map((path) => (where ? fileText(path, where.cwd, command, line) : null)),
    ];
    const known = parts.filter((text) => text !== null);
    if (hasAttribution(known.join('\n\n'))) {
      return {
        result: 'deny',
        reason: 'The commit message has an attribution or co-author line. Remove it.',
      };
    }
    // The subject is the first line of the first part. If that part is unreadable, do not guess.
    if (parts.length === 0 || parts[0] === null || !config.conventionalCommits) continue;
    const subject =
      parts[0].split('\n').find((text) => text.trim() !== '' && !text.startsWith('#')) ?? '';
    if (!GENERATED_SUBJECT.test(subject) && !CONVENTIONAL.test(subject)) {
      return {
        result: 'deny',
        reason: `The commit subject "${subject.slice(0, 80)}" is not a Conventional Commit. Use "<type>(<scope>): <summary>" with a type such as feat, fix, chore, docs, refactor or test.`,
      };
    }
  }
  return null;
}
