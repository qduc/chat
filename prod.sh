#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.yml"
DC=(docker compose -f "$COMPOSE_FILE")

# Color codes for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

usage(){
  cat <<EOF
Usage: $(basename "$0") {up|down|restart|logs|ps|exec|migrate|backup|health} [args...]

Production Management Commands:
  up       Start services in production mode (default: detached)
  down     Stop and remove services
  restart  Restart services
  logs     View logs (default: follows all services)
  ps       Show service status
  health   Check service health status
  exec     Execute commands in containers (requires service name)
  migrate  Run database migrations (status|up|fresh with confirmation)
  backup   Create database backup

Examples:
  $(basename "$0") up                    # Start services in detached mode
  $(basename "$0") up --build            # Rebuild and start services
  $(basename "$0") logs -f backend       # Follow backend logs
  $(basename "$0") exec backend sh       # Open shell in backend container
  $(basename "$0") health                # Check health of all services
  $(basename "$0") migrate status        # Check migration status
  $(basename "$0") migrate up            # Apply pending migrations
  $(basename "$0") migrate fresh         # Reset database (requires confirmation)
  $(basename "$0") backup                # Create database backup

Safety Features:
  - Dangerous operations require confirmation
  - Production mode runs services detached by default
  - Health checks before critical operations
EOF
}

confirm() {
    local prompt="$1"
    local response

    echo -e "${YELLOW}WARNING: ${prompt}${NC}"
    read -p "Type 'yes' to confirm: " response

    if [ "$response" != "yes" ]; then
        echo -e "${RED}Operation cancelled.${NC}"
        return 1
    fi
    return 0
}

check_health() {
    echo "Checking service health..."
    local all_healthy=true

    for service in backend frontend; do
        if "${DC[@]}" ps --status running "$service" &>/dev/null; then
            if docker inspect "$("${DC[@]}" ps -q "$service" 2>/dev/null || echo '')" --format='{{.State.Health.Status}}' 2>/dev/null | grep -q "healthy"; then
                echo -e "${GREEN}✓${NC} $service is healthy"
            else
                health_status=$(docker inspect "$("${DC[@]}" ps -q "$service")" --format='{{.State.Health.Status}}' 2>/dev/null || echo "unknown")
                echo -e "${YELLOW}⚠${NC} $service health status: $health_status"
                all_healthy=false
            fi
        else
            echo -e "${RED}✗${NC} $service is not running"
            all_healthy=false
        fi
    done

    if [ "$all_healthy" = true ]; then
        echo -e "\n${GREEN}All services are healthy${NC}"
        return 0
    else
        echo -e "\n${YELLOW}Some services are not healthy${NC}"
        return 1
    fi
}

backup_database() {
    local timestamp
    timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_dir="$ROOT/backups"
    local backup_file="$backup_dir/prod_db_backup_$timestamp.db"

    mkdir -p "$backup_dir"

    echo "Creating database backup..."

    # Check if backend is running
    backend_cid="$("${DC[@]}" ps -q backend 2>/dev/null || echo '')"

    if [ -n "$backend_cid" ]; then
        "${DC[@]}" exec -T backend sh -c "cp /data/prod.db /data/backup_$timestamp.db"
        docker cp "$backend_cid:/data/backup_$timestamp.db" "$backup_file"
        "${DC[@]}" exec -T backend sh -c "rm /data/backup_$timestamp.db"
    else
        echo -e "${YELLOW}Backend is not running. Attempting to backup from volume...${NC}"
        # Create a temporary container to access the volume
        docker run --rm -v chat_db_data:/data -v "$backup_dir:/backup" alpine cp /data/prod.db "/backup/prod_db_backup_$timestamp.db"
    fi

    if [ -f "$backup_file" ]; then
        echo -e "${GREEN}✓${NC} Backup created: $backup_file"
        echo "Backup size: $(du -h "$backup_file" | cut -f1)"
        return 0
    else
        echo -e "${RED}✗${NC} Backup failed"
        return 1
    fi
}

migrate_command() {
    if [ $# -eq 0 ]; then
        echo "Migration subcommand required (status|up|fresh)" >&2
        exit 1
    fi

    local subcommand="$1"
    shift

    case "$subcommand" in
        status)
            echo "Checking migration status..."
            "${DC[@]}" exec -T backend npm run migrate status "$@"
            ;;
        up)
            echo -e "${YELLOW}Applying pending migrations...${NC}"
            if confirm "This will apply pending database migrations in PRODUCTION. Continue?"; then
                # Create backup before migration
                backup_database
                echo "Running migrations..."
                "${DC[@]}" exec -T backend npm run migrate up "$@"
                echo -e "${GREEN}✓${NC} Migrations applied successfully"
            fi
            ;;
        fresh)
            echo -e "${RED}⚠ DANGER: This will DELETE ALL DATA and reset the database!${NC}"
            if confirm "This will DESTROY the production database and reset all migrations. This action CANNOT be undone. Continue?"; then
                # Require second confirmation
                if confirm "Are you ABSOLUTELY SURE you want to reset the production database?"; then
                    # Create backup before destructive operation
                    backup_database
                    echo "Resetting database..."
                    "${DC[@]}" exec -T backend npm run migrate fresh "$@"
                    echo -e "${GREEN}✓${NC} Database reset complete"
                else
                    echo -e "${RED}Operation cancelled.${NC}"
                    exit 1
                fi
            else
                echo -e "${RED}Operation cancelled.${NC}"
                exit 1
            fi
            ;;
        *)
            echo "Unknown migration subcommand: $subcommand" >&2
            echo "Available: status, up, fresh" >&2
            exit 1
            ;;
    esac
}

if [ ! -f "$COMPOSE_FILE" ]; then
    echo -e "${RED}Error: compose file not found: $COMPOSE_FILE${NC}" >&2
    exit 1
fi

cmd=${1:-}
shift || true

case "$cmd" in
    up)
        # Default to detached mode in production unless -d is already specified
        if [[ ! " $* " =~ " -d " ]] && [[ ! " $* " =~ " --detach " ]]; then
            echo "Starting services in detached mode..."
            "${DC[@]}" up -d "$@"
        else
            "${DC[@]}" up "$@"
        fi
        echo -e "\n${GREEN}Services started${NC}"
        echo "Use '$(basename "$0") logs -f' to view logs"
        echo "Use '$(basename "$0") health' to check service health"
        ;;
    down)
        if confirm "This will stop all production services. Continue?"; then
            "${DC[@]}" down "$@"
            echo -e "${GREEN}✓${NC} Services stopped"
        fi
        ;;
    restart)
        echo "Restarting services..."
        "${DC[@]}" restart "$@"
        echo -e "${GREEN}✓${NC} Services restarted"
        ;;
    logs)
        # Default to following logs
        if [ $# -eq 0 ]; then
            "${DC[@]}" logs -f
        else
            "${DC[@]}" logs "$@"
        fi
        ;;
    ps)
        "${DC[@]}" ps "$@"
        ;;
    health)
        check_health
        ;;
    exec)
        if [ $# -eq 0 ]; then
            echo "Error: exec requires a service name" >&2
            echo "Example: $(basename "$0") exec backend sh" >&2
            exit 1
        fi

        # Add -T flag for non-interactive environments
        if [ -t 0 ] && [ -t 1 ]; then
            "${DC[@]}" exec "$@"
        else
            "${DC[@]}" exec -T "$@"
        fi
        ;;
    migrate)
        migrate_command "$@"
        ;;
    backup)
        backup_database
        ;;
    ""|-h|--help)
        usage
        ;;
    *)
        echo -e "${RED}Unknown command: $cmd${NC}" >&2
        usage
        exit 2
        ;;
esac
