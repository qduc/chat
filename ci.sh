#!/usr/bin/env bash
set -euo pipefail

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

run_component() {
  local component=$1
  local dir="$ROOT/$component"

  log_info "Starting CI for $component..."

  if [ ! -d "$dir" ]; then
    log_error "Directory $dir does not exist."
    exit 1
  fi

  pushd "$dir" > /dev/null

  log_info "Installing dependencies for $component..."
  npm install

  log_info "Linting $component..."
  npm run lint

  log_info "Testing $component..."
  npm test

  popd > /dev/null
  log_success "CI for $component completed successfully."
}

cmd=${1:-all}

case "$cmd" in
  backend)
    run_component "backend"
    ;;
  frontend)
    run_component "frontend"
    ;;
  all)
    run_component "backend"
    run_component "frontend"
    ;;
  -h|--help)
    echo "Usage: $0 [all|backend|frontend]"
    exit 0
    ;;
  *)
    log_error "Unknown command: $cmd"
    echo "Usage: $0 [all|backend|frontend]"
    exit 1
    ;;
esac
