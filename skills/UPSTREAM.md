# Upstream provenance

Some skills and agents in this package are ported from
[cursor/plugins](https://github.com/cursor/plugins) at commit
`d42aff08aa58965d2735c4ead61a9af82b89d0d0`.

- `pstack` is MIT licensed, Copyright (c) 2026 Lauren Tan.
- `cursor-team-kit` and `thermos` are MIT licensed, Copyright (c) 2026 Cursor.

Each ported skill directory carries its upstream `LICENSE.txt`. Edit the ported files here, not
upstream. Pull upstream changes by hand and record what differs in the `Changes` column.

`Local` is a path relative to `playbook/`: a skill directory or a single file.
`pnpm --filter playbook test` checks that every listed path exists, is agent-neutral and has
links that resolve.

| Local | Upstream | Changes |
| ----- | -------- | ------- |
