#!/usr/bin/env bash

materialize_aur_payload() {
  if (( $# != 3 )); then
    echo "Usage: materialize_aur_payload <manifest> <source-directory> <destination-directory>" >&2
    return 2
  fi

  local manifest_path=$1
  local source_directory=$2
  local destination_directory=$3
  local file_count=0
  local pkgbuild_count=0
  local mode filename source_path index
  local -a modes=() filenames=()
  local -A seen_filenames=()

  if [[ ! -f "$manifest_path" ]]; then
    echo "Missing AUR publication manifest: $manifest_path" >&2
    return 1
  fi

  while IFS=$'\t' read -r mode filename; do
    if [[ -z "$mode" && -z "$filename" ]]; then
      continue
    fi
    if [[ "$mode" != "644" && "$mode" != "755" ]]; then
      echo "Invalid AUR file mode in $manifest_path: $mode" >&2
      return 1
    fi
    if [[ ! "$filename" =~ ^[A-Za-z0-9._-]+$ ]]; then
      echo "Invalid AUR filename in $manifest_path: $filename" >&2
      return 1
    fi
    if [[ ${seen_filenames["$filename"]+present} ]]; then
      echo "Duplicate AUR filename in $manifest_path: $filename" >&2
      return 1
    fi
    seen_filenames["$filename"]=1
    modes+=("$mode")
    filenames+=("$filename")
    file_count=$((file_count + 1))
    if [[ "$filename" == "PKGBUILD" ]]; then
      pkgbuild_count=$((pkgbuild_count + 1))
    fi
  done < "$manifest_path"

  if (( file_count == 0 )); then
    echo "AUR publication manifest is empty: $manifest_path" >&2
    return 1
  fi
  if (( pkgbuild_count != 1 )); then
    echo "AUR publication manifest must contain exactly one PKGBUILD, found $pkgbuild_count" >&2
    return 1
  fi

  for filename in "${filenames[@]}"; do
    source_path="$source_directory/$filename"
    if [[ ! -f "$source_path" ]]; then
      echo "Missing staged AUR file: $source_path" >&2
      return 1
    fi
  done

  for index in "${!filenames[@]}"; do
    mode=${modes[$index]}
    filename=${filenames[$index]}
    install -m"$mode" \
      "$source_directory/$filename" \
      "$destination_directory/$filename"
  done
}
