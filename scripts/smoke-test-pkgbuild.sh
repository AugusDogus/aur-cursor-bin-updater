#!/usr/bin/env bash

set -euo pipefail

if (( $# != 1 )); then
  echo "Usage: scripts/smoke-test-pkgbuild.sh <PKGBUILD>" >&2
  exit 2
fi

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
pkgbuild_path=$(realpath "$1")

case "$(uname -m)" in
  x86_64)
    CARCH=x86_64
    expected_elf_machine="Advanced Micro Devices X86-64"
    ;;
  aarch64 | arm64)
    CARCH=aarch64
    expected_elf_machine="AArch64"
    ;;
  *)
    echo "Unsupported native architecture: $(uname -m)" >&2
    exit 2
    ;;
esac

source_array_name="source_${CARCH}"
checksum_array_name="sha512sums_${CARCH}"

smoke_directory=$(mktemp -d)
trap 'rm -rf -- "$smoke_directory"' EXIT

# shellcheck source=/dev/null
source "$pkgbuild_path"

declare -n architecture_sources="$source_array_name"
declare -n architecture_checksums="$checksum_array_name"

if (( ${#architecture_sources[@]} == 0 )) ||
  (( ${#architecture_sources[@]} != ${#architecture_checksums[@]} )); then
  echo "Missing source or checksum for $CARCH in $pkgbuild_path" >&2
  exit 1
fi

srcdir="$smoke_directory/src"
pkgdir="$smoke_directory/pkg"
mkdir -p "$srcdir" "$pkgdir"

for index in "${!architecture_sources[@]}"; do
  source_entry=${architecture_sources[$index]:-}
  expected_checksum=${architecture_checksums[$index]:-}
  if [[ -z "$source_entry" || -z "$expected_checksum" || "$expected_checksum" == "SKIP" ]]; then
    echo "Missing or unverifiable source checksum for $CARCH at index $index" >&2
    exit 1
  fi

  source_filename=${source_entry%%::*}
  source_url=${source_entry#*::}
  if [[ "$source_url" == "$source_entry" ]]; then
    echo "Architecture source must use filename::URL syntax: $source_entry" >&2
    exit 1
  fi

  curl \
    --fail \
    --location \
    --proto '=https' \
    --proto-redir '=https' \
    --connect-timeout 15 \
    --max-time 600 \
    --retry 3 \
    --show-error \
    --output "$srcdir/$source_filename" \
    "$source_url"

  actual_checksum=$(sha512sum "$srcdir/$source_filename")
  actual_checksum=${actual_checksum%% *}
  if [[ "$actual_checksum" != "$expected_checksum" ]]; then
    echo "Checksum mismatch for $source_filename" >&2
    echo "Expected: $expected_checksum" >&2
    echo "Actual:   $actual_checksum" >&2
    exit 1
  fi
done

install -Dm644 \
  "$repo_root/packaging/common/cursor.desktop" \
  "$srcdir/cursor.desktop"
install -Dm755 \
  "$repo_root/packaging/common/cursor-launcher.sh" \
  "$srcdir/cursor-launcher.sh"

(
  cd "$srcdir"
  package
)

cursor_binary="$pkgdir/usr/share/cursor/cursor"
if [[ ! -x "$cursor_binary" ]]; then
  echo "Packaged Cursor binary is missing or not executable: $cursor_binary" >&2
  exit 1
fi

if ! LC_ALL=C readelf -h "$cursor_binary" |
  grep -Eq "^[[:space:]]*Machine:[[:space:]]+$expected_elf_machine\$"; then
  echo "Packaged Cursor binary does not target $expected_elf_machine" >&2
  LC_ALL=C readelf -h "$cursor_binary" >&2
  exit 1
fi

echo "Native $CARCH package smoke test passed."
