// Reads the hook payload an agent writes to stdin and reduces it to what the guards need.

const MAX_BYTES = 1024 * 1024;

/** Reads stdin up to 1 MiB. Returns null when there is more: a cut-off payload is not trusted. */
export async function readStdin(stream = process.stdin) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > MAX_BYTES) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const PATCH_FILE = /^\*\*\* (?:Update|Delete|Add) File: (.+)$/gm;
const EDIT_TOOL = /patch|edit|write/i;
const SHELL = /(^|\/)(sh|bash|zsh|dash)$/;

/** An argv-style command as one line. `["bash", "-lc", "script"]` becomes the script itself. */
function fromArgv(argv) {
  const words = argv.map(String);
  const flag = words.findIndex((word, i) => i > 0 && /^-[A-Za-z]*c$/.test(word));
  if (SHELL.test(words[0] ?? '') && flag !== -1 && words[flag + 1] !== undefined)
    return words[flag + 1];
  return words
    .map((word) => (/^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`))
    .join(' ');
}

/** Reduces a hook payload to `{ command, filePaths, cwd, stopHookActive }`. */
export function normalize(payload) {
  const input = payload?.tool_input ?? {};
  const raw = input.command ?? input.cmd;
  const text = Array.isArray(raw) ? fromArgv(raw) : typeof raw === 'string' ? raw : null;
  const filePaths = [];
  for (const key of ['file_path', 'path', 'notebook_path']) {
    if (typeof input[key] === 'string') filePaths.push(input[key]);
  }
  for (const edit of Array.isArray(input.edits) ? input.edits : []) {
    if (typeof edit?.file_path === 'string') filePaths.push(edit.file_path);
  }
  // Patch-style edit tools carry the paths inside the patch text, under one of several keys.
  const isEditTool = EDIT_TOOL.test(String(payload?.tool_name ?? ''));
  for (const patch of [input.patch, input.input, isEditTool ? text : null]) {
    if (typeof patch === 'string')
      for (const m of patch.matchAll(PATCH_FILE)) filePaths.push(m[1].trim());
  }
  return {
    command: isEditTool || filePaths.length > 0 ? null : text,
    filePaths: [...new Set(filePaths)],
    cwd: typeof payload?.cwd === 'string' ? payload.cwd : process.cwd(),
    // Only an explicit `false` means "first stop". A harness that does not send the field gives
    // no way to tell a first stop from a repeat, so it is treated as a repeat.
    stopHookActive: payload?.stop_hook_active !== false,
  };
}
