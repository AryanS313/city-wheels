#!/usr/bin/env bash
# Builds and publishes only the browser game to the repository's gh-pages branch.
# Prerequisites: npm, git, gh authenticated for the repository.
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci --prefix web --no-audit --no-fund
npm test --prefix web
npm run build --prefix web
PUBLISH_DIR="$(mktemp -d)"
trap 'rm -rf "$PUBLISH_DIR"' EXIT
cp -R web/dist/. "$PUBLISH_DIR/"
cp LICENSE NOTICE "$PUBLISH_DIR/"
touch "$PUBLISH_DIR/.nojekyll"
REMOTE_URL="$(git remote get-url origin)"
git -C "$PUBLISH_DIR" init -b gh-pages
git -C "$PUBLISH_DIR" config credential.https://github.com.helper '!gh auth git-credential'
git -C "$PUBLISH_DIR" add .
git -C "$PUBLISH_DIR" -c user.name='City Wheels build' -c user.email='build@users.noreply.github.com' commit -m "Publish City Wheels browser prototype"
git -C "$PUBLISH_DIR" remote add origin "$REMOTE_URL"
# Lease protects a concurrently changed published branch.
PUBLISHED_SHA="$(git ls-remote origin refs/heads/gh-pages | cut -f1)"
git -C "$PUBLISH_DIR" push "--force-with-lease=refs/heads/gh-pages:$PUBLISHED_SHA" origin gh-pages
printf 'Browser build pushed. GitHub Pages must use gh-pages / (root).\n'
