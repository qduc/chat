#!/bin/sh
set -e

APP_USER="${APP_USER:-node}"
APP_GROUP="${APP_GROUP:-node}"
INSTALL_ON_START="${INSTALL_ON_START:-1}"
JWT_SECRET_FILE="/data/.jwt_secret"

# Auto-generate JWT_SECRET if not provided
if [ -z "$JWT_SECRET" ]; then
  if [ -f "$JWT_SECRET_FILE" ]; then
    # Load existing secret from persistent storage
    JWT_SECRET=$(cat "$JWT_SECRET_FILE")
    export JWT_SECRET
    echo "Loaded JWT_SECRET from persistent storage"
  else
    # Generate a new secure secret
    JWT_SECRET=$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 64)
    export JWT_SECRET
    echo "Generated new JWT_SECRET (will be persisted after directory setup)"
    export JWT_SECRET_NEEDS_SAVE=1
  fi
fi

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

# Save auto-generated JWT_SECRET to persistent storage
if [ "$JWT_SECRET_NEEDS_SAVE" = "1" ] && [ -d "/data" ]; then
  echo "$JWT_SECRET" > "$JWT_SECRET_FILE"
  chmod 600 "$JWT_SECRET_FILE"
  echo "Saved JWT_SECRET to persistent storage"
  unset JWT_SECRET_NEEDS_SAVE
fi

exec "$@"
