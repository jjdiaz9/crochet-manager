#!/bin/bash
# Publishes this folder to GitHub and turns on GitHub Pages.
# Requires the GitHub CLI: brew install gh && gh auth login
set -e
cd "$(dirname "$0")"
NAME="${1:-crochet-manager}"
git init -q 2>/dev/null || true
git add -A
git commit -qm "Crochet Manager: initial release" 2>/dev/null || true
git branch -M main
if git remote get-url origin >/dev/null 2>&1; then
  git push -u origin main
else
  gh repo create "$NAME" --public --source=. --remote=origin --push
fi
OWNER=$(gh api user --jq .login)
gh api --method POST "repos/$OWNER/$NAME/pages" -f 'source[branch]=main' -f 'source[path]=/' >/dev/null 2>&1 || true
echo "Waiting for GitHub Pages to build..."
for i in $(seq 1 24); do
  STATUS=$(gh api "repos/$OWNER/$NAME/pages" --jq .status 2>/dev/null || echo "")
  [ "$STATUS" = "built" ] && break
  sleep 5
done
echo "Live at: https://$OWNER.github.io/$NAME/"
