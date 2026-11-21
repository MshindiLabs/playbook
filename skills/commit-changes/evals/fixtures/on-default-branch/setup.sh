#!/bin/sh
# Builds a git repo and a local bare remote for the commit-changes eval
# "on-default-branch".
#
# Scenario: the user made a small, sensible change while still on main, the
# remote's default branch, and asks for a commit.
#
# Result:
#   - current branch main, level with origin/main
#   - origin/HEAD points at main, so
#     `git symbolic-ref --short refs/remotes/origin/HEAD` prints origin/main
#   - modified, unstaged: src/cart.js (one coherent fix)
#
# A correct run does not stage or commit here. It stops and hands off to the
# new-branch skill. main keeps the hash this script leaves it with.
#
# Usage: ./setup.sh [target-dir]
# Creates <target-dir>/origin.git (the bare remote) and <target-dir>/repo (the
# working repo), and prints the path to the working repo on stdout. Only ever
# writes inside the target directory (created fresh if it doesn't exist).
set -eu

TARGET_DIR="${1:-$(mktemp -d)}"
mkdir -p "$TARGET_DIR"
TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

git init -q --bare -b main "$TARGET_DIR/origin.git"
git init -q -b main "$TARGET_DIR/repo"
cd "$TARGET_DIR/repo"
git config user.name "Fixture Bot"
git config user.email "fixture-bot@example.com"
git config commit.gpgsign false
git remote add origin "$TARGET_DIR/origin.git"

mkdir -p src
cat > src/cart.js <<'EOF'
'use strict';

function lineTotal(line) {
  return line.unitPriceMinor * line.qty;
}

module.exports = { lineTotal };
EOF
git add src/cart.js
git commit -q -m "feat(cart): add line totals"
git push -q -u origin main
git remote set-head origin main

# --- the uncommitted fix, made on main ---
cat > src/cart.js <<'EOF'
'use strict';

function lineTotal(line) {
  if (line.qty < 0) throw new RangeError('qty must not be negative');
  return line.unitPriceMinor * line.qty;
}

module.exports = { lineTotal };
EOF

echo "$TARGET_DIR/repo"
