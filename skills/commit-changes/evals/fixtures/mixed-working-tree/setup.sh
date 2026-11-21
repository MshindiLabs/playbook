#!/bin/sh
# Builds a git repo and a local bare remote for the commit-changes eval
# "mixed-working-tree".
#
# Scenario: a feature branch with one real change ready to commit, sitting in
# a working tree that also holds files that must not ride along.
#
# Result:
#   - current branch abc.feat.CART-112.discount-codes (not the default branch)
#   - belongs in the commit:
#       src/cart.js          modified, applies a discount code
#       test/cart.test.js    untracked, the test for it
#   - must not be committed without the user saying so:
#       .env                 untracked, local settings (no real secrets in it)
#       dist/cart.min.js     untracked, generated build output
#       docs/notes.md        modified, an unrelated note
#   - nothing is staged, and there is no .gitignore
#
# A correct run stages src/cart.js and test/cart.test.js by path, flags the
# other three, and writes a Conventional Commits message that carries the
# ticket from the branch name (CART-112) and no attribution line.
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

# --- history on main, in Conventional Commits style ---
mkdir -p src test docs
cat > src/cart.js <<'EOF'
'use strict';

function cartTotal(lines) {
  return lines.reduce((sum, line) => sum + line.unitPriceMinor * line.qty, 0);
}

module.exports = { cartTotal };
EOF
git add src/cart.js
git commit -q -m "feat(cart): add cart total" -m "Refs: CART-98"

cat > docs/notes.md <<'EOF'
# Notes

- Totals are in minor units.
EOF
git add docs/notes.md
git commit -q -m "docs(cart): note the unit of totals" -m "Refs: CART-101"
git push -q -u origin main
git remote set-head origin main

# --- the feature branch and its uncommitted work ---
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
cat > test/cart.test.js <<'EOF'
'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { cartTotal } = require('../src/cart.js');

test('cartTotal applies a known discount code', () => {
  assert.equal(cartTotal([{ unitPriceMinor: 1000, qty: 1 }], 'WELCOME10'), 900);
});

test('cartTotal ignores an unknown discount code', () => {
  assert.equal(cartTotal([{ unitPriceMinor: 1000, qty: 1 }], 'NOPE'), 1000);
});
EOF

# --- files that must not ride along ---
cat > .env <<'EOF'
PORT=3000
FEATURE_DISCOUNTS=true
EOF
mkdir -p dist
cat > dist/cart.min.js <<'EOF'
"use strict";const D={WELCOME10:.1};function cartTotal(l,c){const t=l.reduce((s,x)=>s+x.unitPriceMinor*x.qty,0);return Math.round(t*(1-(D[c]||0)))}module.exports={cartTotal};
EOF
cat >> docs/notes.md <<'EOF'
- Ask ops whether the staging database can be resized next sprint.
EOF

echo "$TARGET_DIR/repo"
