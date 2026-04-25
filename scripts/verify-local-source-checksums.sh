#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: $0 <pkgbuild> <source-file> [<source-file> ...]" >&2
  exit 1
}

if [[ $# -lt 2 ]]; then
  usage
fi

pkgbuild=$1
shift

if [[ ! -f "$pkgbuild" ]]; then
  echo "Missing PKGBUILD: $pkgbuild" >&2
  exit 1
fi

mapfile -t expected_sums < <(
  awk '
    /^sha512sums=\(/ { in_array = 1; line = substr($0, index($0, "(") + 1) }
    in_array && NR > 1 { line = $0 }
    in_array {
      sub(/\).*/, "", line)
      while (match(line, /'\''[^'\'']*'\''|"[^"]*"/)) {
        value = substr(line, RSTART + 1, RLENGTH - 2)
        print value
        line = substr(line, RSTART + RLENGTH)
      }
      if ($0 ~ /\)/) in_array = 0
    }
  ' "$pkgbuild"
)

status=0
source_index=1
for source_file in "$@"; do
  if [[ ! -f "$source_file" ]]; then
    echo "Missing source file: $source_file" >&2
    status=1
    source_index=$((source_index + 1))
    continue
  fi

  expected=${expected_sums[$source_index]:-}
  actual=$(sha512sum "$source_file" | awk '{ print $1 }')

  if [[ -z "$expected" ]]; then
    echo "Missing sha512sums entry $source_index for $source_file" >&2
    status=1
  elif [[ "$expected" != "$actual" ]]; then
    echo "Checksum mismatch for $source_file" >&2
    echo "  expected: $expected" >&2
    echo "  actual:   $actual" >&2
    status=1
  fi

  source_index=$((source_index + 1))
done

exit "$status"
