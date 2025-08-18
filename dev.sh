#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.dev.yml"
DC=(docker compose -f "$COMPOSE_FILE")

usage(){
  cat <<EOF
Usage: $(basename "$0") {up|down|build|logs|ps} [args...]

Commands:
  up     Bring up services (passes remaining args through to docker compose up)
  down   Stop and remove services
  build  Build services
  logs   Follow logs (passes remaining args through to docker compose logs)
  ps     Show service status

Examples:
  $(basename "$0") up --build
  $(basename "$0") logs -f frontend
EOF
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
  build)
    "${DC[@]}" build "$@"
    ;;
  logs)
    "${DC[@]}" logs "$@"
    ;;
  ps)
    "${DC[@]}" ps "$@"
    ;;
  ""|-h|--help)
    usage
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    usage
    exit 2
    ;;
esac
