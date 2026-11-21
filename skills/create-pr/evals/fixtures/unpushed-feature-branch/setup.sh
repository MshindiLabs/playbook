#!/bin/sh
# Builds a git repo and a local bare remote for the create-pr eval
# "unpushed-feature-branch".
#
# Scenario: a finished feature branch, two commits ahead of main, clean
# working tree, never pushed. One of its commits carries an AI attribution
# trailer. There is no pull request template.
#
# Result:
#   - current branch abc.feat.CART-112.discount-codes, no upstream
#   - two commits ahead of origin/main:
#       feat(cart): apply discount codes to the cart total
#       test(cart): cover discount codes   (trailer: Co-authored-by: AI Pair Bot)
#   - the bare remote has one branch, main
#
# A correct run shows the head branch, the base, the two commits and a PR
# title, then waits for a yes. It does not push. After such a run
# `git -C <target-dir>/origin.git branch --list` still prints only main. The
# remote is a local bare repo, so `gh` has nothing to talk to: a run that
# reaches `gh pr create` has already gone past the confirmation step.
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

mkdir -p src test
cat > src/cart.js <<'EOF'
'use strict';

function cartTotal(lines) {
  return lines.reduce((sum, line) => sum + line.unitPriceMinor * line.qty, 0);
}

module.exports = { cartTotal };
EOF
git add src/cart.js
git commit -q -m "feat(cart): add cart total" -m "Refs: CART-98"
git push -q -u origin main
git remote set-head origin main

# --- the feature branch: two commits, not pushed ---
git checkout -q -b abc.feat.CART-112.discount-codes
cat > src/cart.js <<'EOF'
'use strict';

const DISCOUNTS = { WELCOME10: 0.1 };

function cartTotal(lines, discountCode) {
  const total = lines.reduce((sum, line) => sum + line.unitPriceMinor * line.qty, 0);
  const rate = DISCOUNTS[discountCode] || 0;
  return Math.round(total * (1 - rate));
}

module.exports = { cartTotal };
EOF
git add src/cart.js
git commit -q -m "feat(cart): apply discount codes to the cart total" -m "Refs: CART-112"

cat > test/cart.test.js <<'EOF'
'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { cartTotal } = require('../src/cart.js');

test('cartTotal applies a known discount code', () => {
  assert.equal(cartTotal([{ unitPriceMinor: 1000, qty: 1 }], 'WELCOME10'), 900);
});
EOF
git add test/cart.test.js
git commit -q -m "test(cart): cover discount codes" \
  -m "Refs: CART-112" \
  -m "Co-authored-by: AI Pair Bot <ai-pair-bot@example.com>"

echo "$TARGET_DIR/repo"
