#!/usr/bin/env bash
# ─── Mockline Infrastructure Manager ─────────────────────────────────────────
# Manages Redis, ChromaDB, and OpenSandbox via Docker Compose.
#
# Usage:
#   ./scripts/infra.sh start      — start all services
#   ./scripts/infra.sh stop       — stop all services
#   ./scripts/infra.sh restart    — restart all services
#   ./scripts/infra.sh status     — show running containers + health
#   ./scripts/infra.sh logs       — tail all service logs
#   ./scripts/infra.sh logs redis — tail logs for a specific service
#   ./scripts/infra.sh build      — rebuild the OpenSandbox image
#   ./scripts/infra.sh clean      — stop + remove containers AND volumes
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$SCRIPT_DIR/../infra"
COMPOSE="docker compose -f $INFRA_DIR/docker-compose.yml"

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

info()    { echo -e "${CYAN}${BOLD}[infra]${RESET} $*"; }
success() { echo -e "${GREEN}${BOLD}[infra]${RESET} $*"; }
warn()    { echo -e "${YELLOW}${BOLD}[infra]${RESET} $*"; }
error()   { echo -e "${RED}${BOLD}[infra]${RESET} $*" >&2; }

# ── Helpers ───────────────────────────────────────────────────────────────────
check_docker() {
  if ! command -v docker &>/dev/null; then
    error "Docker is not installed or not in PATH."
    exit 1
  fi
  if ! docker info &>/dev/null; then
    error "Docker daemon is not running. Start it first."
    exit 1
  fi
}

wait_healthy() {
  local service=$1
  local max_attempts=30
  local attempt=0
  info "Waiting for $service to become healthy..."
  while [[ $attempt -lt $max_attempts ]]; do
    local state
    state=$($COMPOSE ps --format json "$service" 2>/dev/null \
      | python3 -c "import sys,json; data=json.load(sys.stdin); print(data.get('Health','') if isinstance(data,dict) else next((d.get('Health','') for d in data if d.get('Service')=='$service'), ''))" 2>/dev/null || echo "")
    if [[ "$state" == "healthy" ]]; then
      success "$service is healthy"
      return 0
    fi
    sleep 2
    ((attempt++))
  done
  warn "$service did not become healthy within expected time (check logs)"
}

print_endpoints() {
  echo ""
  echo -e "${BOLD}Service endpoints (all on localhost):${RESET}"
  echo -e "  ${GREEN}Redis${RESET}       → ${BOLD}127.0.0.1:6379${RESET}"
  echo -e "  ${GREEN}ChromaDB${RESET}    → ${BOLD}http://127.0.0.1:8000${RESET}"
  echo -e "  ${GREEN}OpenSandbox${RESET} → ${BOLD}http://127.0.0.1:8080${RESET}"
  echo ""
}

# ── Commands ─────────────────────────────────────────────────────────────────
cmd_start() {
  check_docker
  info "Starting infrastructure services..."
  $COMPOSE up -d --remove-orphans
  echo ""
  wait_healthy redis
  wait_healthy chromadb
  wait_healthy opensandbox
  print_endpoints
  success "All services are up."

  # Quick connectivity check
  info "Running connectivity checks..."
  if redis-cli -h 127.0.0.1 -p 6379 ping &>/dev/null 2>&1; then
    success "Redis PING → PONG"
  else
    warn "Redis not reachable yet (may still be starting)"
  fi

  if curl -sf http://127.0.0.1:8000/api/v2/heartbeat &>/dev/null; then
    success "ChromaDB heartbeat OK"
  else
    warn "ChromaDB not reachable yet"
  fi

  if curl -sf http://127.0.0.1:8080/health &>/dev/null; then
    success "OpenSandbox health OK"
  else
    warn "OpenSandbox not reachable yet"
  fi
}

cmd_stop() {
  check_docker
  info "Stopping infrastructure services..."
  $COMPOSE down
  success "All services stopped."
}

cmd_restart() {
  cmd_stop
  cmd_start
}

cmd_status() {
  check_docker
  echo ""
  $COMPOSE ps
  print_endpoints
}

cmd_logs() {
  check_docker
  local service="${1:-}"
  if [[ -n "$service" ]]; then
    $COMPOSE logs -f --tail=100 "$service"
  else
    $COMPOSE logs -f --tail=50
  fi
}

cmd_build() {
  check_docker
  info "Rebuilding OpenSandbox image..."
  $COMPOSE build --no-cache opensandbox
  success "Build complete."
}

cmd_clean() {
  check_docker
  warn "This will remove all containers AND their data volumes."
  read -rp "Are you sure? [y/N] " confirm
  if [[ "${confirm,,}" == "y" ]]; then
    $COMPOSE down -v --remove-orphans
    success "Containers and volumes removed."
  else
    info "Cancelled."
  fi
}

# ── Entry point ───────────────────────────────────────────────────────────────
CMD="${1:-help}"

case "$CMD" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_restart ;;
  status)  cmd_status ;;
  logs)    cmd_logs "${2:-}" ;;
  build)   cmd_build ;;
  clean)   cmd_clean ;;
  help|*)
    echo ""
    echo -e "${BOLD}Usage:${RESET} ./scripts/infra.sh <command> [service]"
    echo ""
    echo -e "${BOLD}Commands:${RESET}"
    echo "  start           Start Redis, ChromaDB, and OpenSandbox"
    echo "  stop            Stop all services"
    echo "  restart         Stop then start all services"
    echo "  status          Show container status and endpoints"
    echo "  logs [service]  Tail logs (optionally filter by service name)"
    echo "  build           Rebuild the OpenSandbox Docker image"
    echo "  clean           Remove containers and ALL data volumes"
    echo ""
    echo -e "${BOLD}Services:${RESET} redis | chromadb | opensandbox"
    echo ""
    ;;
esac
