#!/usr/bin/env bash
# BSD tar producer for device inputs. No source mutation or consumer filtering.
set -euo pipefail
if [ "$#" -ne 3 ]; then
  echo '{"phase":"packaging","errorClass":"InvalidArguments"}'; exit 64
fi
archive=$1; source_root=$2; prefix=$3
case "$prefix" in Payload|Products) ;; *)
  echo '{"phase":"packaging","errorClass":"InvalidPrefix"}'; exit 64 ;;
esac
# --no-mac-metadata disables packaging-only copyfile/AppleDouble records for
# this invocation. -h keeps the reviewed dereference behavior. All normal
# paths, contents and modes still come directly from tar's source traversal.
# No retry/fallback, xattr clearing, member stripping or validation relaxation.
if tar --no-mac-metadata -czhf "$archive" -C "$source_root" "$prefix" >/dev/null 2>&1; then
  exit 0
else
  result=$?
  printf '{"phase":"packaging","errorClass":"TarFailure","returnCode":%d}\n' "$result"
  exit "$result"
fi
