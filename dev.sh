#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.dev.yml"
DC=(docker compose -f "$COMPOSE_FILE")
ENV_FILE="$ROOT/backend/.env"
ENV_EXAMPLE="$ROOT/backend/.env.example"

# Function to generate a 32-byte hex encryption key
generate_encryption_key() {
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
}

# Function to ensure .env file exists (copy from .env.example if missing)
ensure_env_file() {
    if [ ! -f "$ENV_FILE" ]; then
        if [ -f "$ENV_EXAMPLE" ]; then
            echo "Creating $ENV_FILE from $ENV_EXAMPLE..."
            cp "$ENV_EXAMPLE" "$ENV_FILE"
        else
            echo "Warning: $ENV_EXAMPLE not found, creating empty $ENV_FILE"
            touch "$ENV_FILE"
        fi
    fi
}

# Function to ensure ENCRYPTION_MASTER_KEY is set in .env
ensure_encryption_key() {
    # Check if key is already set (non-empty value after '=')
    if grep -q '^ENCRYPTION_MASTER_KEY=[^[:space:]]' "$ENV_FILE" 2>/dev/null; then
        local key
        key=$(grep '^ENCRYPTION_MASTER_KEY=' "$ENV_FILE" | cut -d'=' -f2- | tr -d '[:space:]')
        if [ -n "$key" ]; then
            echo "ENCRYPTION_MASTER_KEY is already configured"
            return 0
        fi
    fi

    # Also check if it's set as empty (commented out or empty value)
    if grep -qE '^ENCRYPTION_MASTER_KEY=' "$ENV_FILE" 2>/dev/null; then
        local current_value
        current_value=$(grep '^ENCRYPTION_MASTER_KEY=' "$ENV_FILE" | cut -d'=' -f2-)
        if [ -n "$current_value" ]; then
            echo "ENCRYPTION_MASTER_KEY is already configured"
            return 0
        fi
    fi

    # Generate and set the key
    echo "ENCRYPTION_MASTER_KEY not found or empty. Generating..."
    local new_key
    new_key=$(generate_encryption_key)

    # Remove any existing ENCRYPTION_MASTER_KEY line and append the new one
    grep -v '^ENCRYPTION_MASTER_KEY=' "$ENV_FILE" > "$ENV_FILE.tmp" 2>/dev/null || cp "$ENV_FILE" "$ENV_FILE.tmp"
    echo "ENCRYPTION_MASTER_KEY=$new_key" >> "$ENV_FILE.tmp"
    mv "$ENV_FILE.tmp" "$ENV_FILE"

    echo "Generated ENCRYPTION_MASTER_KEY and saved to $ENV_FILE"
    echo "IMPORTANT: Save this key securely! It is required to decrypt sensitive data."
    echo "  ENCRYPTION_MASTER_KEY=$new_key"
}

# Pre-flight checks
ensure_env_file
ensure_encryption_key

usage(){
  cat <<EOF
Usage: $(basename "$0") {up|down|build|logs|ps|exec} [args...]

Commands:
  up      Bring up services (passes remaining args through to docker compose up)
  down    Stop and remove services
  restart Restart services
  build   Build services
  logs    Follow logs (passes remaining args through to docker compose logs)
  ps      Show service status
  exec    Execute commands in containers (requires service name)
  migrate Run database migrations in backend container

Examples:
  $(basename "$0") up --build
  $(basename "$0") logs -f frontend
  $(basename "$0") exec backend npm test
  $(basename "$0") exec frontend npm run build
  $(basename "$0") exec backend sh -c "ls -la"
  $(basename "$0") migrate status
  $(basename "$0") migrate up
  $(basename "$0") migrate fresh
EOF
}

test_backend() {
    echo "Running backend tests inside docker container..."
    backend_cid="$("${DC[@]}" ps -q backend)"
    set +e
    if [ $# -gt 0 ]; then
      # Normalize args so host paths like `backend/__tests__/...` work
      # inside the container where the backend package root is mounted at /app.
      # Strip a leading `backend/` from any non-option arg.
      normalized_args=()
      for a in "$@"; do
        if [[ "$a" != -* ]]; then
          # Remove leading "backend/" if present
          normalized_args+=("${a#backend/}")
        else
          normalized_args+=("$a")
        fi
      done

      # Run only the specified test(s) with ESM support. Use `npm test --` so
      # the execution occurs in the backend package context and args are
      # forwarded correctly to Jest.
      if [ -n "$backend_cid" ]; then
        output=$("${DC[@]}" exec -T backend env NODE_OPTIONS=--experimental-vm-modules npm test -- "${normalized_args[@]}" 2>&1)
        rc=$?
      else
        output=$("${DC[@]}" run --rm -T backend env NODE_OPTIONS=--experimental-vm-modules npm test -- "${normalized_args[@]}" 2>&1)
        rc=$?
      fi
    else
      # Run all tests as before
      if [ -n "$backend_cid" ]; then
        output=$("${DC[@]}" exec -T backend env NODE_OPTIONS=--experimental-vm-modules npm test 2>&1)
        rc=$?
      else
        output=$("${DC[@]}" run --rm -T backend env NODE_OPTIONS=--experimental-vm-modules npm test 2>&1)
        rc=$?
      fi
    fi
    set -e
    # Filter output to show only FAIL lines and their details, plus summary
    echo "$output" | awk '/^FAIL/ {print; flag=1} flag && /^ / {print} /^Test Suites:/ || /^Tests:/ || /^Snapshots:/ || /^Time:/ {print; flag=0}'
    return $rc
}

test_frontend() {
    extra=()
    echo "Running frontend tests inside docker container..."
    # If the frontend service is already running, exec into it; otherwise start a one-off run
    frontend_cid="$("${DC[@]}" ps -q frontend)"
    # Forward extra args to `npm test` when provided
    if [ $# -gt 0 ]; then
      extra=(-- "$@")
    fi
    set +e
    if [ -n "$frontend_cid" ]; then
      output=$("${DC[@]}" exec -T frontend npm test "${extra[@]:-}" 2>&1)
      rc=$?
    else
      output=$("${DC[@]}" run --rm -T frontend npm test "${extra[@]:-}" 2>&1)
      rc=$?
    fi
    set -e
    # Filter output to show only FAIL lines and their details, plus summary
    echo "$output" | awk '/^FAIL/ {print; flag=1} flag && /^ / {print} /^Test Suites:/ || /^Tests:/ || /^Snapshots:/ || /^Time:/ {print; flag=0}'
    return $rc
}

test_all() {
    echo "Running all tests inside docker containers..."
    # Temporarily disable errexit so we can inspect the exit code and decide
    # whether to run frontend tests after backend tests.
    set +e
  # Pass through any args to backend tests
  test_backend "$@"
    rc=$?
    set -e
    if [ $rc -eq 0 ]; then
    test_frontend "$@"
    else
        echo "Backend tests failed, skipping frontend tests"
        return $rc
    fi
}

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Error: compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

cmd=${1:-}
shift || true
case "$cmd" in
  exec)
    # Add -T flag to disable TTY allocation for non-interactive environments (CI, AI tools)
    if [ -t 0 ] && [ -t 1 ]; then
      # Interactive terminal detected
      "${DC[@]}" exec "$@"
    else
      # Non-interactive environment (CI, AI tools, etc.)
      "${DC[@]}" exec -T "$@"
    fi
    ;;
  ""|-h|--help)
    usage
    ;;
  test)
    test_all "$@"
      ;;
  test:backend)
    test_backend "$@"
      ;;
  test:frontend)
    test_frontend "$@"
      ;;
  migrate)
    # Run migration commands in backend container
    if [ $# -eq 0 ]; then
      echo "Migration subcommand required (status|up|fresh)" >&2
      exit 1
    fi
    subcommand="$1"
    shift
    case "$subcommand" in
      status|up|fresh)
        echo "Running migration: $subcommand"
        if [ -t 0 ] && [ -t 1 ]; then
          "${DC[@]}" exec backend npm run migrate "$subcommand" "$@"
        else
          "${DC[@]}" exec -T backend npm run migrate "$subcommand" "$@"
        fi
        ;;
      *)
        echo "Unknown migration subcommand: $subcommand" >&2
        echo "Available: status, up, fresh" >&2
        exit 1
        ;;
    esac
    ;;
  *)
    # Pass through to docker compose for any other command
    "${DC[@]}" "$cmd" "$@"
    ;;
esac
