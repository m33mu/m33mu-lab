#!/bin/sh
# Build the workbench and run the Chromium interaction tests against web/dist.
# Pass a directory to keep screenshots.
set -eu
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
m33mu_root=${M33MU_ROOT:-"$repo_root/m33mu"}
m33mu_build=${M33MU_BUILD:-"$m33mu_root/build"}
if [ ! -d "$repo_root/node_modules/playwright-core" ]; then
  "${M33MU_NPM:-npm}" --prefix "$repo_root" ci
fi
"$repo_root/scripts/build-web-app.sh" >/dev/null
exec "${M33MU_NODE:-node}" "$repo_root/tests/browser/workbench.browser.mjs" "$@"
