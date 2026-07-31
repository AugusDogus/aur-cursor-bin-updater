#!/usr/bin/env bash

set -euo pipefail

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
if [[ ! -f "$manifest_path" ]]; then
  echo "Missing AUR publication manifest: $manifest_path" >&2
  exit 1
fi

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

published_files=()
while IFS=$'\t' read -r mode filename; do
  if [[ -z "$mode" && -z "$filename" ]]; then
    continue
  fi
  if [[ "$mode" != "644" && "$mode" != "755" ]]; then
    echo "Invalid AUR file mode in $manifest_path: $mode" >&2
    exit 1
  fi
  if [[ ! "$filename" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "Invalid AUR filename in $manifest_path: $filename" >&2
    exit 1
  fi
  source_path=".aur/$filename"
  if [[ ! -f "$source_path" ]]; then
    echo "Missing staged AUR file: $source_path" >&2
    exit 1
  fi
  install -m"$mode" "$source_path" "$tmpdir/$filename"
  published_files+=("$filename")
done < "$manifest_path"

if [[ ${#published_files[@]} -eq 0 ]]; then
  echo "AUR publication manifest is empty: $manifest_path" >&2
  exit 1
fi

git -C "$tmpdir" config user.name "$AUR_USERNAME"
git -C "$tmpdir" config user.email "$AUR_EMAIL"
git -C "$tmpdir" add -A -- .

if git -C "$tmpdir" diff --cached --quiet; then
  echo "No AUR changes to publish for $pkgname."
  exit 0
fi

git -C "$tmpdir" commit -m "$commit_message"
git -C "$tmpdir" push origin HEAD:master
