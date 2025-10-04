#!/bin/bash
set -e

APP_USER="${APP_USER:-node}"
APP_GROUP="${APP_GROUP:-node}"
INSTALL_ON_START="${INSTALL_ON_START:-1}"

if [ "$(id -u)" = "0" ]; then
  ADJUST_PATHS="/data"
  if [ -n "$IMAGE_STORAGE_PATH" ]; then
    ADJUST_PATHS="$ADJUST_PATHS $IMAGE_STORAGE_PATH"
  fi

  echo "$ADJUST_PATHS" | tr ' ' '\n' | while read -r path; do
    [ -z "$path" ] && continue
    if [ ! -e "$path" ]; then
      mkdir -p "$path"
    fi
    echo "Adjusting ownership for $path"
    chown -R "$APP_USER:$APP_GROUP" "$path"
  done

  if [ -z "$SU_EXEC_DONE" ]; then
    export SU_EXEC_DONE=1
    exec su-exec "$APP_USER:$APP_GROUP" "$0" "$@"
  else
    echo "Already switched user, not re-executing."
    exit 1
  fi
fi

if [ "$INSTALL_ON_START" = "1" ] && [ -f package.json ]; then
  echo "Installing npm dependencies..."
  npm install
fi

exec "$@"
