#!/bin/bash

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
info() {
    echo -e "${BLUE}ℹ ${NC}$1"
}

success() {
    echo -e "${GREEN}✓${NC} $1"
}

error() {
    echo -e "${RED}✗${NC} $1"
    exit 1
}

warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    error "Not in a git repository"
fi

# Get current branch
CURRENT_BRANCH=$(git branch --show-current)
info "Current branch: ${CURRENT_BRANCH}"

# Verify we're on a develop branch
if [[ ! $CURRENT_BRANCH =~ ^develop_[0-9]+$ ]]; then
    error "Must be on a develop_X branch (e.g., develop_5). Current branch: ${CURRENT_BRANCH}"
fi

# Extract develop branch number
DEVELOP_NUM=$(echo "$CURRENT_BRANCH" | sed 's/develop_//')
NEXT_DEVELOP_NUM=$((DEVELOP_NUM + 1))
NEXT_DEVELOP_BRANCH="develop_${NEXT_DEVELOP_NUM}"

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
    error "You have uncommitted changes. Please commit or stash them first."
fi

# Check for unpushed commits on current branch
UNPUSHED=$(git log origin/${CURRENT_BRANCH}..HEAD --oneline 2>/dev/null || echo "")
if [ -n "$UNPUSHED" ]; then
    warning "You have unpushed commits on ${CURRENT_BRANCH}:"
    echo "$UNPUSHED"
    read -p "Do you want to continue? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        error "Release cancelled"
    fi
fi

# Fetch latest changes
info "Fetching latest changes from origin..."
git fetch origin

# Get latest tag
LATEST_TAG=$(git tag --sort=-v:refname | head -1)
if [ -z "$LATEST_TAG" ]; then
    LATEST_TAG="v0.0.0"
    warning "No existing tags found. Using ${LATEST_TAG} as base."
else
    success "Latest tag: ${LATEST_TAG}"
fi

# Parse version (remove 'v' prefix)
VERSION=${LATEST_TAG#v}
IFS='.' read -r MAJOR MINOR PATCH <<< "$VERSION"

# Ask user for release type
echo ""
echo "Current version: ${LATEST_TAG}"
echo "Available release types:"
echo "  1) Patch release (${MAJOR}.${MINOR}.$((PATCH + 1)))"
echo "  2) Minor release (${MAJOR}.$((MINOR + 1)).0)"
echo "  3) Major release ($((MAJOR + 1)).0.0)"
echo ""
read -p "Select release type (1/2/3): " -n 1 -r RELEASE_TYPE
echo ""

case $RELEASE_TYPE in
    1)
        NEW_VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))"
        RELEASE_NAME="patch"
        ;;
    2)
        NEW_VERSION="${MAJOR}.$((MINOR + 1)).0"
        RELEASE_NAME="minor"
        ;;
    3)
        NEW_VERSION="$((MAJOR + 1)).0.0"
        RELEASE_NAME="major"
        ;;
    *)
        error "Invalid release type selected"
        ;;
esac

NEW_TAG="v${NEW_VERSION}"

# Confirm release
echo ""
info "Release Summary:"
echo "  Current branch: ${CURRENT_BRANCH}"
echo "  Release type: ${RELEASE_NAME}"
echo "  New version: ${NEW_TAG}"
echo "  Next develop branch: ${NEXT_DEVELOP_BRANCH}"
echo ""
read -p "Proceed with release? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    error "Release cancelled"
fi

# Start release process
info "Starting release process..."

# Switch to main and pull latest
info "Switching to main branch..."
git checkout main
git pull origin main

# Merge develop branch with --no-ff
info "Merging ${CURRENT_BRANCH} into main (--no-ff)..."
if ! git merge --no-ff "${CURRENT_BRANCH}" -m "Merge ${CURRENT_BRANCH} for release ${NEW_TAG}"; then
    error "Merge failed. Please resolve conflicts and run 'git merge --continue', then re-run this script."
fi
success "Merged ${CURRENT_BRANCH} into main"

# Create tag
info "Creating tag ${NEW_TAG}..."
git tag -a "${NEW_TAG}" -m "Release ${NEW_TAG}"
success "Created tag ${NEW_TAG}"

# Push main branch and tag
info "Pushing main branch and tag to origin..."
git push origin main
git push origin "${NEW_TAG}"
success "Pushed main and ${NEW_TAG} to origin"

# Create and checkout next develop branch
info "Creating new develop branch: ${NEXT_DEVELOP_BRANCH}..."
git checkout -b "${NEXT_DEVELOP_BRANCH}"
success "Created and checked out ${NEXT_DEVELOP_BRANCH}"

# Push new develop branch
info "Pushing ${NEXT_DEVELOP_BRANCH} to origin..."
git push -u origin "${NEXT_DEVELOP_BRANCH}"
success "Pushed ${NEXT_DEVELOP_BRANCH} to origin"

# Summary
echo ""
success "Release completed successfully! 🎉"
echo ""
echo "Summary:"
echo "  ✓ Released: ${NEW_TAG}"
echo "  ✓ Main branch updated and pushed"
echo "  ✓ Current branch: ${NEXT_DEVELOP_BRANCH}"
echo "  ✓ Old develop branch: ${CURRENT_BRANCH} (still exists)"
echo ""
info "You can now start working on ${NEXT_DEVELOP_BRANCH}"
info "Don't forget to update CHANGELOG.md if you maintain one!"
