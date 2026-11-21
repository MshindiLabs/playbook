import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { CONFIG_FILE } from '../lib/config.mjs';

const PROTECTED_NAMES = [
  /^\.eslintrc(\..+)?$/,
  /^eslint\.config\.[cm]?[jt]s$/,
  /^\.eslintignore$/,
  /^\.prettierrc(\..+)?$/,
  /^prettier\.config\.[cm]?[jt]s$/,
  /^\.prettierignore$/,
  /^biome\.jsonc?$/,
  /^\.commitlintrc(\..+)?$/,
  /^commitlint\.config\.[cm]?[jt]s$/,
  /^\.lintstagedrc(\..+)?$/,
  /^lint-staged\.config\.[cm]?[jt]s$/,
  /^\.?lefthook(-local)?\.(ya?ml|toml|json)$/,
];
const PROTECTED_PATHS = [
  /(^|\/)\.husky\/(?!_\/)/,
  /(^|\/)\.claude\/settings(\.local)?\.json$/,
  /(^|\/)\.codex\/hooks\.json$/,
  /(^|\/)\.cursor\/hooks\.json$/,
];

/**
 * Asks before an existing lint, format, git-hook or agent-hook config is changed, so a failing
 * check gets fixed in the code and not loosened in the config. New files pass.
 */
export function configProtection({ filePaths, cwd }) {
  for (const path of filePaths) {
    const absolute = resolve(cwd, path);
    const name = basename(absolute);
    const slashed = absolute.replaceAll('\\', '/');
    // The guards' own switch file is protected even before it exists: creating it can turn them off.
    const guarded =
      name === CONFIG_FILE ||
      ((PROTECTED_NAMES.some((pattern) => pattern.test(name)) ||
        PROTECTED_PATHS.some((pattern) => pattern.test(slashed))) &&
        existsSync(absolute));
    if (guarded) {
      return {
        result: 'confirm',
        reason: `${path} configures linting, formatting or hooks. If a check is failing, fix the code. Change this file only if the user asked for that.`,
      };
    }
  }
  return null;
}
