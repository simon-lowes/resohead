#!/bin/sh
# GitHub rejects files over 100 MB, so files over 45 MB are committed in
# parts and joined again by the Dockerfile.
set -eu
cd "$(dirname "$0")/../site/public"
find . -type f -size +45M ! -name '*.part-*' | while read -r f; do
  rm -f "$f".part-*
  split -b 45m "$f" "$f.part-"
  rm "$f"
  echo "split $f"
done
