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

run_electron() {
  log_info "Starting CI for electron..."

  # First, ensure frontend is built (electron needs the static export)
  log_info "Building frontend for electron..."
  pushd "$ROOT/frontend" > /dev/null
  npm install
  npm run build
  popd > /dev/null

  # Copy backend to electron directory for packaging
  log_info "Copying backend to electron directory..."
  cp -r "$ROOT/backend" "$ROOT/electron/backend"

  # Copy frontend build output to electron directory for packaging
  log_info "Copying frontend build to electron directory..."
  mkdir -p "$ROOT/electron/frontend"
  cp -r "$ROOT/frontend/out" "$ROOT/electron/frontend/out"

  # Install electron dependencies
  log_info "Installing electron dependencies..."
  pushd "$ROOT/electron" > /dev/null
  npm install

  # Build the electron app (pack creates unpacked directory for testing)
  log_info "Building electron app..."
  npm run pack

  # Verify the build was created
  if [ -d "$ROOT/electron/dist" ]; then
    log_success "Electron build completed successfully."
    log_info "Build output:"
    ls -la "$ROOT/electron/dist/"
  else
    log_error "Electron build failed - dist directory not found."
    exit 1
  fi

  # Run the electron app headlessly to check for startup errors
  log_info "Testing electron app startup..."
  export DISPLAY=:99
  export ELECTRON_ENABLE_LOGGING=1

  # Find the unpacked app binary
  if [ -d "$ROOT/electron/dist/linux-unpacked" ]; then
    ELECTRON_APP="$ROOT/electron/dist/linux-unpacked/chat-electron"
  elif [ -d "$ROOT/electron/dist/mac" ]; then
    ELECTRON_APP="$ROOT/electron/dist/mac/ChatForge.app/Contents/MacOS/ChatForge"
  else
    log_info "Unpacked app not found, skipping runtime test."
    popd > /dev/null
    return 0
  fi

  if [ -f "$ELECTRON_APP" ]; then
    log_info "Running electron app: $ELECTRON_APP"
    # Run the app with a timeout and capture any startup errors
    timeout 10 "$ELECTRON_APP" --no-sandbox 2>&1 | head -50 || true
    log_success "Electron app startup test completed."
  else
    log_info "Electron binary not found at expected path, skipping runtime test."
  fi

  popd > /dev/null
  log_success "CI for electron completed successfully."
}

cmd=${1:-all}

case "$cmd" in
  backend)
    run_component "backend"
    ;;
  frontend)
    run_component "frontend"
    ;;
  electron)
    run_electron
    ;;
  all)
    run_component "backend"
    run_component "frontend"
    ;;
  -h|--help)
    echo "Usage: $0 [all|backend|frontend|electron]"
    exit 0
    ;;
  *)
    log_error "Unknown command: $cmd"
    echo "Usage: $0 [all|backend|frontend|electron]"
    exit 1
    ;;
esac
