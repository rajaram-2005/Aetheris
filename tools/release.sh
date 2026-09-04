#!/usr/bin/env bash
#
# Cut an Aetheris release from a working tree — the local twin of ci/release.yml.
#
#   bash tools/release.sh                # monthly bump, full checks, commit + tag + push
#   bash tools/release.sh --patch        # hot-fix inside the current month
#   bash tools/release.sh --set 2027.3.1
#   bash tools/release.sh --no-push      # stop after the local commit + tag (review first)
#   bash tools/release.sh --skip-checks  # only if you already ran them (not recommended)
#
# What it does: verify → bump VERSION everywhere → write the CHANGELOG → commit → tag → push.
# The GitHub Release and the desktop installers are produced by ci/release.yml; pushing the tag
# does not trigger them, so create the release with `gh release create v<version> -F RELEASE_NOTES.md`
# (or let the scheduled workflow do the whole thing on the 1st of the month).
set -euo pipefail

cd "$(dirname "$0")/.."

PUSH=1
CHECKS=1
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --no-push) PUSH=0 ;;
    --skip-checks) CHECKS=0 ;;
    *) ARGS+=("$arg") ;;
  esac
done

if [ -n "$(git status --porcelain)" ]; then
  echo "release: the working tree is dirty — commit or stash first:" >&2
  git status --short >&2
  exit 1
fi

previous="$(node -p "require('./package.json').version")"

if [ "$CHECKS" = "1" ]; then
  echo "release: verifying (typecheck → tests → evals → build)"
  ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
  npm run typecheck
  npm test
  npm run eval
  NEXT_TELEMETRY_DISABLED=1 npm run build
fi

npx tsx tools/bump-version.mjs ${ARGS[@]+"${ARGS[@]}"}
version="$(cat VERSION)"
if [ "$version" = "$previous" ]; then
  echo "release: the version did not change ($version) — refusing to re-release it" >&2
  exit 1
fi

npx tsx tools/changelog.mjs --version "$version"
npx tsx tools/release-notes.mjs --version "$version" --file RELEASE_NOTES.md

git add VERSION package.json desktop/package.json public/manifest.webmanifest CHANGELOG.md
git commit -m "release: $version"
git tag -a "v$version" -m "Aetheris $version"

echo
echo "release: $previous → $version  (tag v$version)"
if [ "$PUSH" = "1" ]; then
  branch="$(git rev-parse --abbrev-ref HEAD)"
  git push origin "$branch"
  git push origin "v$version"
  echo "release: pushed $branch and v$version"
else
  echo "release: --no-push — push with: git push origin \"$(git rev-parse --abbrev-ref HEAD)\" && git push origin v$version"
fi
echo "release: publish it with: gh release create v$version --title \"Aetheris $version\" --notes-file RELEASE_NOTES.md"
echo "release: then build installers with ci/release-desktop.yml (version=$version, publish_tag=v$version)"
