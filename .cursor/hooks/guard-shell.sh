#!/bin/sh
# Cursor beforeShellExecution hook. The project root is the cwd Cursor uses;
# cd anyway so a different cwd still finds the checker. stdin is the hook JSON.
# hooks.json sets failClosed, so a missing node denies the command.
cd "$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)" || exit 2
exec node .cursor/hooks/guard-shell.mjs
