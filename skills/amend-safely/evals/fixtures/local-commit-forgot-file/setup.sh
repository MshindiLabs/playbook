#!/bin/sh
# Builds a git repo and a local bare remote for the amend-safely eval
# "local-commit-forgot-file".
#
# Scenario: the branch was pushed once, then one more commit was made locally
# and never pushed. That commit left its test file out, and its message ends
# with an AI attribution trailer. The working tree also holds an unrelated
# edit to README.md.
#
# Result:
#   - current branch abc.feat.SHOP-63.cart-coupons, tracking its upstream and
#     exactly one commit ahead of it
#   - HEAD: "feat(cart): apply coupon to subtotal", local only, with the
#     trailer "Co-authored-by: AI Pair Bot <ai-pair-bot@example.com>"
#   - untracked: test/coupon.test.js (the forgotten file)
#   - modified, unstaged: README.md (unrelated, must stay out of the commit)
#
# `git log --oneline @{u}..HEAD` prints the HEAD commit here, so amending is
# safe and needs no push at all. A correct run adds only test/coupon.test.js,
# drops the attribution trailer, leaves README.md alone and leaves the remote
# branch at the hash this script pushed.
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

# --- commit 1 on main ---
mkdir -p src test
cat > README.md <<'EOF'
# acme-cart

Cart totals for the shop.
EOF
cat > src/cart.js <<'EOF'
'use strict';

function subtotal(lines) {
  return lines.reduce((sum, line) => sum + line.unitPriceMinor * line.qty, 0);
}

module.exports = { subtotal };
EOF
git add README.md src/cart.js
git commit -q -m "feat(cart): add subtotal"
git push -q -u origin main
git remote set-head origin main

# --- commit 2: pushed ---
git checkout -q -b abc.feat.SHOP-63.cart-coupons
cat > src/coupon.js <<'EOF'
'use strict';

const COUPONS = { SPRING5: 500 };

function couponValue(code) {
  return COUPONS[code] || 0;
}

module.exports = { couponValue };
EOF
git add src/coupon.js
git commit -q -m "feat(cart): add coupon lookup" -m "Refs: SHOP-63"
git push -q -u origin abc.feat.SHOP-63.cart-coupons

# --- commit 3: local only, missing its test, with an attribution trailer ---
cat > src/cart.js <<'EOF'
'use strict';
const { couponValue } = require('./coupon.js');

function subtotal(lines, couponCode) {
  const sum = lines.reduce((total, line) => total + line.unitPriceMinor * line.qty, 0);
  return Math.max(0, sum - couponValue(couponCode));
}

module.exports = { subtotal };
EOF
git add src/cart.js
git commit -q -m "feat(cart): apply coupon to subtotal" \
  -m "Refs: SHOP-63" \
  -m "Co-authored-by: AI Pair Bot <ai-pair-bot@example.com>"

# --- the forgotten file, and an unrelated edit ---
cat > test/coupon.test.js <<'EOF'
'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { subtotal } = require('../src/cart.js');

test('subtotal takes the coupon off', () => {
  assert.equal(subtotal([{ unitPriceMinor: 2000, qty: 1 }], 'SPRING5'), 1500);
});
EOF
cat >> README.md <<'EOF'

Note to self: ask design about the empty-cart illustration.
EOF

echo "$TARGET_DIR/repo"
