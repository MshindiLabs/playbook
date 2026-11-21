#!/bin/sh
# Builds a tiny git repo for the blast-radius eval "slug-normalisation-change".
#
# Scenario: a two-line change makes toSlug() lowercase its input and strip
# accents. The unit test still passes. What the diff does not show is that
# slugs made by the old toSlug() are stored in data/posts.json, and one code
# path looks a post up by building a slug from its title again.
#
# Result:
#   - current branch abc.feat.slug-normalise, one commit ahead of main; the
#     commit changes only src/slug.mjs
#   - data/posts.json holds slugs written by the old function:
#       "Hello-World", "Café-Menu", "release-notes"
#   - src/posts.mjs  findByTitle() compares a stored slug with toSlug(title).
#                    After the change it returns undefined for "Hello World"
#                    and "Café Menu". This is the real breakage, and no symbol
#                    search for toSlug leads to the JSON file.
#   - src/posts.mjs  postUrl() reads the stored slug and is unaffected
#   - src/feed.mjs   calls toSlug() for anchor ids that are built on every
#                    render and stored nowhere. It is a caller that grep
#                    finds and that is safe: the decoy.
#   - `npm test` passes on main and on the branch
#
# Everything runs on Node's standard library, so the claim can be proven by
# running the real code:
#   node -e "import('./src/posts.mjs').then(m => console.log(m.findByTitle('Hello World')))"
# prints the post on main and undefined on the branch.
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

# --- commit 1 on main ---
mkdir -p src test data
cat > package.json <<'EOF'
{
  "name": "acme-blog",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
EOF
cat > src/slug.mjs <<'EOF'
export function toSlug(title) {
  return title.trim().replace(/\s+/g, '-');
}
EOF
cat > data/posts.json <<'EOF'
[
  { "id": 1, "title": "Hello World", "slug": "Hello-World" },
  { "id": 2, "title": "Café Menu", "slug": "Café-Menu" },
  { "id": 3, "title": "release notes", "slug": "release-notes" }
]
EOF
cat > src/posts.mjs <<'EOF'
import { readFileSync } from 'node:fs';
import { toSlug } from './slug.mjs';

const posts = JSON.parse(readFileSync(new URL('../data/posts.json', import.meta.url), 'utf8'));

export function findByTitle(title) {
  return posts.find((post) => post.slug === toSlug(title));
}

export function postUrl(post) {
  return `/posts/${post.slug}`;
}

export function createPost(title) {
  const post = { id: posts.length + 1, title, slug: toSlug(title) };
  posts.push(post);
  return post;
}
EOF
cat > src/feed.mjs <<'EOF'
import { toSlug } from './slug.mjs';

export function renderFeed(items) {
  return items
    .map((item) => `<h2 id="${toSlug(item.title)}">${item.title}</h2>`)
    .join('\n');
}
EOF
cat > test/slug.test.mjs <<'EOF'
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toSlug } from '../src/slug.mjs';

test('toSlug joins words with a dash', () => {
  assert.equal(toSlug('  release   notes '), 'release-notes');
});
EOF
git add package.json src/slug.mjs src/posts.mjs src/feed.mjs data/posts.json test/slug.test.mjs
git commit -q -m "feat(blog): add posts, feed and slugs"

# --- commit 2 on the feature branch: the change under review ---
git checkout -q -b abc.feat.slug-normalise
cat > src/slug.mjs <<'EOF'
export function toSlug(title) {
  const plain = title.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return plain.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
EOF
git add src/slug.mjs
git commit -q -m "feat(slug): lowercase slugs and strip accents"

echo "$TARGET_DIR"
