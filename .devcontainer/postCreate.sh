#!/usr/bin/env bash
set -euo pipefail

# No-op placeholder for any post-start actions; currently just a banner
cat <<'EOT'
Workspace container is up. Backend and frontend are starting under Docker Compose.
Use the integrated terminal to run tests or scripts against /workspace.
EOT
