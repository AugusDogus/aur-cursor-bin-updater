#!/usr/bin/env bash

set -euo pipefail

script_directory=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/aur-payload.sh
source "$script_directory/lib/aur-payload.sh"

usage() {
  echo "Usage: $0 <pkgname> <commit-message>" >&2
  exit 1
}

if [[ $# -ne 2 ]]; then
  usage
fi

pkgname=$1
commit_message=$2

manifest_path=".aur/.publish-manifest"
aur_https_url="https://aur.archlinux.org/${pkgname}.git"
aur_ssh_url="ssh://aur@aur.archlinux.org/${pkgname}.git"

if ! git ls-remote "$aur_https_url" HEAD >/dev/null 2>&1; then
  echo "AUR repository is unavailable: $aur_https_url" >&2
  exit 1
fi

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

git clone "$aur_ssh_url" "$tmpdir"

# The manifest describes the complete AUR payload. Removing the tracked
# worktree first ensures deleted manifest entries are deleted remotely.
git -C "$tmpdir" rm -r --ignore-unmatch -- . >/dev/null
materialize_aur_payload "$manifest_path" ".aur" "$tmpdir"

git -C "$tmpdir" config user.name "$AUR_USERNAME"
git -C "$tmpdir" config user.email "$AUR_EMAIL"
git -C "$tmpdir" add -A -- .

if git -C "$tmpdir" diff --cached --quiet; then
  echo "No AUR changes to publish for $pkgname."
  exit 0
fi

git -C "$tmpdir" commit -m "$commit_message"
git -C "$tmpdir" push origin HEAD:master
