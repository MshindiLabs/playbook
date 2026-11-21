#!/bin/sh
# Builds a tiny git repo for the no-comments eval "comment-mix".
#
# Scenario: a feature branch whose diff against main adds two TypeScript files
# full of comments. Some must go, some must stay, and one file outside the
# diff is a decoy.
#
# Result:
#   - current branch abc.feat.invoice-totals, one commit ahead of main
#   - in the diff (the scope):
#       src/invoice.ts
#         keep    the licence header
#         keep    the doc comment on the exported invoiceTotal (public contract)
#         delete  "loop over the lines and add them up" (narration)
#         delete  the commented-out line "total += line.price * line.qty * 1.2"
#         delete  the HACK comment about loadRates() being called twice; that
#                 is a surprise in our own code, so the double call is the
#                 thing to flag or fix, not to explain
#         a "do not remove" constraint comment on the order of discounts and
#         tax: offer to encode it (test, type or lint), then delete it
#       src/webhook.ts
#         keep    the comment about the raw body; an outside vendor's signing
#                 scheme forces it and the comment links the vendor docs
#         keep    // prettier-ignore
#         flag    the eslint-disable for no-floating-promises: it hides a
#                 dropped promise on recordEvent(), a correctness rule
#   - outside the diff (must not be touched):
#       src/legacy.ts   unchanged since main, full of narration comments
#
# The code is not meant to compile or run; only the comments matter.
#
# Usage: ./setup.sh [target-dir]
# Prints the path to the built repo on stdout. Only ever writes inside that
# target directory (created fresh if it doesn't exist).
set -eu

TARGET_DIR="${1:-$(mktemp -d)}"
mkdir -p "$TARGET_DIR"
cd "$TARGET_DIR"

git init -q -b main
git config user.name "Fixture Bot"
git config user.email "fixture-bot@example.com"
git config commit.gpgsign false

# --- commit 1 on main: the decoy and the helpers ---
mkdir -p src
cat > src/legacy.ts <<'EOF'
// This file holds the old rate table.
// It is loaded once at startup.

// the rates
export const LEGACY_RATES = { standard: 0.2, reduced: 0.05 };

// get a rate by name
export function legacyRate(name: 'standard' | 'reduced'): number {
  // return the rate
  return LEGACY_RATES[name];
}
EOF
cat > src/rates.ts <<'EOF'
export interface Rates {
  standard: number;
}

let cached: Rates | undefined;

export function loadRates(): Rates {
  const stale = cached;
  cached = { standard: 0.2 };
  return stale ?? cached;
}
EOF
git add src/legacy.ts src/rates.ts
git commit -q -m "feat(rates): add rate tables"

# --- commit 2 on the feature branch: the files in scope ---
git checkout -q -b abc.feat.invoice-totals
cat > src/invoice.ts <<'EOF'
/**
 * Copyright (c) Acme Shop contributors.
 * SPDX-License-Identifier: MIT
 */
import { loadRates, type Rates } from './rates';

export interface Line {
  unitPriceMinor: number;
  qty: number;
  discountMinor: number;
}

/**
 * Returns the invoice total in minor units (cents), tax included.
 * Public API of this package. Throws RangeError when a line has a negative quantity.
 */
export function invoiceTotal(lines: Line[]): number {
  // loop over the lines and add them up
  let total = 0;
  for (const line of lines) {
    if (line.qty < 0) throw new RangeError('qty must not be negative');
    // total += line.price * line.qty * 1.2;
    total += line.unitPriceMinor * line.qty;
  }

  // HACK: loadRates() sometimes hands back a stale table right after a deploy, so we
  // call it twice and use the second result. Not ideal, but it is fine for now and
  // changing the cache felt too risky this close to the release.
  loadRates();
  const rates = loadRates();

  // do not remove: discounts must come off before tax is added, or the finance report is wrong
  const afterDiscount = applyDiscounts(total, lines);
  return applyTax(afterDiscount, rates);
}

function applyDiscounts(total: number, lines: Line[]): number {
  return total - lines.reduce((sum, line) => sum + line.discountMinor, 0);
}

function applyTax(amount: number, rates: Rates): number {
  return Math.round(amount * (1 + rates.standard));
}
EOF
cat > src/webhook.ts <<'EOF'
import { verify } from 'paygate-sdk';

declare function recordEvent(body: Buffer): Promise<void>;

// Paygate signs the raw request body, byte for byte. Parsing the JSON and serialising it
// again changes the bytes and the signature check fails, so this handler must be given
// the unparsed body. https://example.com/paygate/docs/webhooks#signatures
export function handleWebhook(rawBody: Buffer, signature: string): boolean {
  if (!verify(rawBody, signature)) return false;

  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  recordEvent(rawBody);

  // prettier-ignore
  const identity = [1,0,0, 0,1,0, 0,0,1];
  return identity.length === 9;
}
EOF
git add src/invoice.ts src/webhook.ts
git commit -q -m "feat(invoice): add invoice totals and the payment webhook"

echo "$TARGET_DIR"
