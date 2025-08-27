#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.dev.yml"
DC=(docker compose -f "$COMPOSE_FILE")

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

Examples:
  $(basename "$0") up --build
  $(basename "$0") logs -f frontend
  $(basename "$0") exec backend npm test
  $(basename "$0") exec frontend npm run build
  $(basename "$0") exec backend sh -c "ls -la"
EOF
}

test_backend() {
    echo "Running backend tests..."
    npm --prefix backend test
}

test_frontend() {
    echo "Running frontend tests..."
    npm --prefix frontend test
}

test_all() {
    echo "Running all tests..."
    test_backend
    if [ $? -eq 0 ]; then
        test_frontend
    else
        echo "Backend tests failed, skipping frontend tests"
        exit 1
    fi
}

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Error: compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

cmd=${1:-}
shift || true
case "$cmd" in
  up)
    "${DC[@]}" up "$@"
    ;;
  down)
    "${DC[@]}" down "$@"
    ;;
  restart)
    "${DC[@]}" restart "$@"
    ;;
  build)
    "${DC[@]}" build "$@"
    ;;
  logs)
    "${DC[@]}" logs "$@"
    ;;
  ps)
    "${DC[@]}" ps "$@"
    ;;
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
      test_all
      ;;
  test:backend)
      test_backend
      ;;
  test:frontend)
      test_frontend
      ;;
  *)
    echo "Unknown command: $cmd" >&2
    usage
    exit 2
    ;;
esac
