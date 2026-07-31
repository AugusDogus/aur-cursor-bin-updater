#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <expected-sha> <target-ref> <failure-message>" >&2
  exit 1
fi

expected_sha=$1
target_ref=$2
failure_message=$3

git fetch --no-tags origin "$target_ref"
remote_sha=$(git rev-parse FETCH_HEAD)
if [[ "$remote_sha" != "$expected_sha" ]]; then
  echo "$target_ref advanced from $expected_sha to $remote_sha; $failure_message" >&2
  exit 1
fi
