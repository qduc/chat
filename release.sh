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

DRY_RUN=false
if [[ "$1" == "--dry-run" ]]; then
    DRY_RUN=true
    info "Dry run mode enabled. Will stop after frontend build."
fi

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

# Check if checks have already passed for this commit
IS_CLEAN=false
if git diff-index --quiet HEAD --; then
    IS_CLEAN=true
fi

CURRENT_COMMIT=$(git rev-parse HEAD)
SKIP_CHECKS=false
LAST_PASS_FILE=".git/last_test_passed_commit"

if [ "$IS_CLEAN" = true ] && [ -f "$LAST_PASS_FILE" ]; then
    LAST_COMMIT=$(cat "$LAST_PASS_FILE")
    if [ "$CURRENT_COMMIT" = "$LAST_COMMIT" ]; then
        SKIP_CHECKS=true
    fi
fi

if [ "$SKIP_CHECKS" = true ]; then
    success "Checks already passed for commit ${CURRENT_COMMIT:0:7}. Skipping lint, build, and tests."
else
    # Run lint check
    info "Running lint checks..."
    if ! npm --prefix backend run lint || ! npm --prefix frontend run lint; then
        error "Lint checks failed. Please fix the issues and try again."
    fi

    # Make sure frontend build succeeds
    info "Building frontend..."
    if ! npm --prefix frontend run build; then
        error "Frontend build failed. Please fix the issues and try again."
    fi

    # Run tests
    info "Running unit tests"
    if ! npm test; then
        error "Unit tests failed. Please fix the error and try again."
    fi

    # Record successful checks if working tree is clean
    if [ "$IS_CLEAN" = true ]; then
        echo "$CURRENT_COMMIT" > "$LAST_PASS_FILE"
    fi
fi

if [ "$DRY_RUN" = true ]; then
    success "Dry run: Frontend build successful. Stopping here."
    exit 0
fi

# Extract develop branch number
DEVELOP_NUM=$(echo "$CURRENT_BRANCH" | sed 's/develop_//')
NEXT_DEVELOP_NUM=$((DEVELOP_NUM + 1))
NEXT_DEVELOP_BRANCH="develop_${NEXT_DEVELOP_NUM}"

# Check for uncommitted changes
#if ! git diff-index --quiet HEAD --; then
#    error "You have uncommitted changes. Please commit or stash them first."
#fi

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

# Update CHANGELOG.md with Claude
info "Generating changelog entry with Claude..."

# Check if claude command is available
if ! command -v claude &> /dev/null; then
    warning "Claude CLI not found. Skipping automatic changelog update."
    warning "Please update CHANGELOG.md manually before continuing."
    read -p "Press Enter to continue after updating CHANGELOG.md..." -r
else
    # Get commits since last tag
    COMMITS=$(git log ${LATEST_TAG}..HEAD --pretty=format:"- %s (%h)" --no-merges)

    if grep -q "## \[${NEW_VERSION}\]" CHANGELOG.md; then
        success "Changelog entry for version ${NEW_VERSION} already exists in CHANGELOG.md. Skipping automated update."
    elif [ -z "$COMMITS" ]; then
        warning "No new commits found since ${LATEST_TAG}"
    else
        # Create temporary file for Claude prompt
        TEMP_PROMPT=$(mktemp)
        cat > "$TEMP_PROMPT" << EOF
Based on these git commits, generate a changelog entry for version ${NEW_VERSION}.

Git commits since ${LATEST_TAG}:
${COMMITS}

Current CHANGELOG.md Unreleased section:
$(sed -n '/## \[Unreleased\]/,/^---$/p' CHANGELOG.md)

Please generate a changelog entry following the Keep a Changelog format with these sections as needed:
- Added (new features)
- Changed (improvements to existing features)
- Fixed (bug fixes)
- Deprecated (features being phased out)
- Breaking Changes (changes requiring user action)

Format the output exactly as:
## [${NEW_VERSION}] - $(date +%Y-%m-%d)

### Section Name
- Description

Only include sections that have changes. Keep descriptions concise and user-focused. Output ONLY the changelog entry, nothing else.
EOF

        # Generate changelog with Claude
        CHANGELOG_ENTRY=$(claude -p "$(cat "$TEMP_PROMPT")")
        rm "$TEMP_PROMPT"

        if [ -n "$CHANGELOG_ENTRY" ]; then
            # Create backup of CHANGELOG.md
            cp CHANGELOG.md CHANGELOG.md.backup

            # Insert new entry after the Unreleased section
            # Find the line number where the first release section starts (after ---)
            INSERT_LINE=$(grep -n "^---$" CHANGELOG.md | head -1 | cut -d: -f1)

            if [ -n "$INSERT_LINE" ]; then
                # Insert the new changelog entry
                {
                    head -n "$INSERT_LINE" CHANGELOG.md
                    echo ""
                    echo "$CHANGELOG_ENTRY"
                    echo ""
                    tail -n +$((INSERT_LINE + 1)) CHANGELOG.md
                } > CHANGELOG.md.new

                mv CHANGELOG.md.new CHANGELOG.md

                # Clear the Unreleased section
                {
                    sed -n '1,/## \[Unreleased\]/p' CHANGELOG.md
                    echo ""
                    echo "### Added"
                    echo "<!-- New features coming in the next release -->"
                    echo ""
                    echo "### Changed"
                    echo "<!-- Improvements to existing features -->"
                    echo ""
                    echo "### Fixed"
                    echo "<!-- Bug fixes -->"
                    echo ""
                    echo "### Deprecated"
                    echo "<!-- Features being phased out -->"
                    echo ""
                    echo "### Breaking Changes"
                    echo "<!-- Changes that require user action -->"
                    echo ""
                    sed -n '/^---$/,$p' CHANGELOG.md
                } > CHANGELOG.md.new

                mv CHANGELOG.md.new CHANGELOG.md

                success "Changelog entry generated and inserted"

                # Show the generated entry
                echo ""
                info "Generated changelog entry:"
                echo "$CHANGELOG_ENTRY"
                echo ""

                # Commit the changelog update
                git add CHANGELOG.md
                git commit -m "docs: update CHANGELOG.md for release ${NEW_TAG}"
                success "Committed changelog update to ${CURRENT_BRANCH}"

                # Remove backup
                rm CHANGELOG.md.backup
            else
                error "Could not find insertion point in CHANGELOG.md"
            fi
        else
            warning "Claude did not generate a changelog entry. Skipping automatic update."
            rm CHANGELOG.md.backup 2>/dev/null || true
        fi
    fi
fi

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

NEW_DEVELOP_BRANCH_CREATED=false
echo ""
read -p "Do you want to create the next develop branch (${NEXT_DEVELOP_BRANCH})? (y/n) " -n 1 -r CREATE_DEVELOP_BRANCH
echo ""
if [[ $CREATE_DEVELOP_BRANCH =~ ^[Yy]$ ]]; then
    # Create and checkout next develop branch
    info "Creating new develop branch: ${NEXT_DEVELOP_BRANCH}..."
    git checkout -b "${NEXT_DEVELOP_BRANCH}"
    success "Created and checked out ${NEXT_DEVELOP_BRANCH}"

    # Push new develop branch
    info "Pushing ${NEXT_DEVELOP_BRANCH} to origin..."
    git push -u origin "${NEXT_DEVELOP_BRANCH}"
    success "Pushed ${NEXT_DEVELOP_BRANCH} to origin"
    NEW_DEVELOP_BRANCH_CREATED=true
else
    info "Skipping creation of new develop branch."
fi


# Summary
echo ""
success "Release completed successfully! 🎉"
echo ""
echo "Summary:"
echo "  ✓ Released: ${NEW_TAG}"
echo "  ✓ Main branch updated and pushed"
if [ "$NEW_DEVELOP_BRANCH_CREATED" = true ]; then
    echo "  ✓ Current branch: ${NEXT_DEVELOP_BRANCH}"
    echo "  ✓ Old develop branch: ${CURRENT_BRANCH} (still exists)"
    echo ""
    info "You can now start working on ${NEXT_DEVELOP_BRANCH}"
else
    git checkout -
    echo "  ⚠ No new develop branch was created. Current branch remains ${CURRENT_BRANCH}."
fi
