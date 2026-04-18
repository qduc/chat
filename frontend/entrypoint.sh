#!/bin/sh
set -e

# Install dependencies
echo "Installing npm dependencies..."
npm install

# If this container is being used to run a production build, override the dev
# service's NODE_ENV so Next.js behaves the same way it does on the host and in
# the dedicated Docker build stage.
case "$*" in
	*"npm run build"*|*"next build"*)
		export NODE_ENV=production
		;;
esac

# Execute the original command
exec "$@"
