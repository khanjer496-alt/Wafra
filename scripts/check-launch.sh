#!/usr/bin/env bash
set -uo pipefail

status=0

npm run check:store || status=1
npm run check:store-assets || status=1
npm run check:store-pricing || status=1
npm run release:check || status=1

exit "$status"
