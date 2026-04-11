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

required_files=(
  ".aur/PKGBUILD"
  ".aur/.SRCINFO"
  ".aur/cursor.desktop"
  ".aur/cursor-launcher.sh"
)

for path in "${required_files[@]}"; do
  if [[ ! -f "$path" ]]; then
    echo "Missing required file: $path" >&2
    exit 1
  fi
done

aur_https_url="https://aur.archlinux.org/${pkgname}.git"
aur_ssh_url="ssh://aur@aur.archlinux.org/${pkgname}.git"

if ! git ls-remote "$aur_https_url" HEAD >/dev/null 2>&1; then
  echo "AUR repository is unavailable: $aur_https_url" >&2
  exit 1
fi

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

git clone "$aur_ssh_url" "$tmpdir"

install -m644 ".aur/PKGBUILD" "$tmpdir/PKGBUILD"
install -m644 ".aur/.SRCINFO" "$tmpdir/.SRCINFO"
install -m644 ".aur/cursor.desktop" "$tmpdir/cursor.desktop"
install -m755 ".aur/cursor-launcher.sh" "$tmpdir/cursor-launcher.sh"

git -C "$tmpdir" config user.name "$AUR_USERNAME"
git -C "$tmpdir" config user.email "$AUR_EMAIL"
git -C "$tmpdir" add PKGBUILD .SRCINFO cursor.desktop cursor-launcher.sh

if git -C "$tmpdir" diff --cached --quiet; then
  echo "No AUR changes to publish for $pkgname."
  exit 0
fi

git -C "$tmpdir" commit -m "$commit_message"
git -C "$tmpdir" push origin HEAD:master
