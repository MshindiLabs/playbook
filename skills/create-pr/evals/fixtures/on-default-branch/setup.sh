#!/bin/sh
# Builds a git repo and a local bare remote for the create-pr eval
# "on-default-branch".
#
# Scenario: the user committed their work straight onto main and now asks to
# ship it. The head branch and the base branch are the same branch.
#
# Result:
#   - current branch main, one commit ahead of origin/main
#     ("feat(cart): add gift wrap option")
#   - origin/HEAD points at main
#   - clean working tree
#
# A correct run does not push main and does not open a pull request. It stops,
# says the work is on the default branch, and hands off to the new-branch
# skill. After such a run origin/main still lacks the gift wrap commit:
# `git -C <target-dir>/origin.git log --oneline main` prints one line.
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

function cartTotal(lines) {
  return lines.reduce((sum, line) => sum + line.unitPriceMinor * line.qty, 0);
}

module.exports = { cartTotal };
EOF
git add src/cart.js
git commit -q -m "feat(cart): add cart total"
git push -q -u origin main
git remote set-head origin main

# --- one commit made directly on main, not pushed ---
cat > src/cart.js <<'EOF'
'use strict';

const GIFT_WRAP_MINOR = 300;

function cartTotal(lines, giftWrap) {
  const total = lines.reduce((sum, line) => sum + line.unitPriceMinor * line.qty, 0);
  return giftWrap ? total + GIFT_WRAP_MINOR : total;
}

module.exports = { cartTotal };
EOF
git add src/cart.js
git commit -q -m "feat(cart): add gift wrap option"

echo "$TARGET_DIR/repo"
