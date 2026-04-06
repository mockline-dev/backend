#!/usr/bin/env bash
# ─── Mockline Infrastructure Manager ─────────────────────────────────────────
# Manages Redis, ChromaDB, and OpenSandbox via Docker Compose.
#
# Usage:
#   ./scripts/infra.sh start      — pre-pull images, build, start all services
#   ./scripts/infra.sh stop       — stop all services
#   ./scripts/infra.sh restart    — stop then start
#   ./scripts/infra.sh status     — show containers + health
#   ./scripts/infra.sh logs       — tail logs for all services
#   ./scripts/infra.sh logs redis — tail logs for one service
#   ./scripts/infra.sh build      — rebuild the OpenSandbox image (no cache)
#   ./scripts/infra.sh clean      — stop + remove containers AND volumes
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# docker compose is run from the project root where docker-compose.yml lives
COMPOSE="docker compose -f $ROOT_DIR/docker-compose.yml --project-directory $ROOT_DIR"

# Images that must be pre-pulled on the host before OpenSandbox can provision
# sandbox containers. These are NOT pulled automatically by the compose services.
#
# python:3.11-slim  — primary sandbox image (~130MB). Used for Python code execution.
# opensandbox/execd — lightweight agent (~50MB) injected into every sandbox container.
#
# To add a new language in future, add its image here and update
# src/orchestration/sandbox/providers/opensandbox.provider.ts LANGUAGE_CONFIG.
SANDBOX_IMAGES=(
  "opensandbox/execd:latest"
  "python:3.11-slim"
)

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

info()    { echo -e "${CYAN}${BOLD}[mockline]${RESET} $*"; }
success() { echo -e "${GREEN}${BOLD}[mockline]${RESET} $*"; }
warn()    { echo -e "${YELLOW}${BOLD}[mockline]${RESET} $*"; }
error()   { echo -e "${RED}${BOLD}[mockline]${RESET} $*" >&2; }

# ── Helpers ───────────────────────────────────────────────────────────────────
check_docker() {
  if ! command -v docker &>/dev/null; then
    error "Docker is not installed. Install it from https://docs.docker.com/get-docker/"
    exit 1
  fi
  if ! docker info &>/dev/null 2>&1; then
    error "Docker daemon is not running. Start Docker Desktop or 'sudo systemctl start docker'."
    exit 1
  fi
}

pull_sandbox_images() {
  info "Pre-pulling OpenSandbox runtime images..."
  for image in "${SANDBOX_IMAGES[@]}"; do
    if docker image inspect "$image" &>/dev/null 2>&1; then
      success "Already present: $image"
    else
      info "Pulling $image ..."
      if docker pull "$image"; then
        success "Pulled: $image"
      else
        warn "Failed to pull $image — sandbox execution may fail until this image is available"
      fi
    fi
  done
}

wait_healthy() {
  local service=$1
  local max_wait=60  # seconds
  local elapsed=0
  info "Waiting for ${service} to become healthy..."
  while [[ $elapsed -lt $max_wait ]]; do
    local health
    health=$(docker inspect --format '{{.State.Health.Status}}' "mockline-${service}" 2>/dev/null || echo "")
    case "$health" in
      healthy)
        success "${service} is healthy"
        return 0
        ;;
      unhealthy)
        warn "${service} is unhealthy — check: ./scripts/infra.sh logs ${service}"
        return 1
        ;;
    esac
    sleep 2
    elapsed=$((elapsed + 2))
  done
  warn "${service} did not report healthy within ${max_wait}s"
}

connectivity_check() {
  echo ""
  info "Connectivity checks..."

  if docker exec mockline-redis redis-cli ping 2>/dev/null | grep -q PONG; then
    success "Redis         127.0.0.1:6379  PONG"
  else
    warn    "Redis         127.0.0.1:6379  not responding"
  fi

  if curl -sf http://127.0.0.1:8000/api/v2/heartbeat &>/dev/null; then
    success "ChromaDB      127.0.0.1:8000  heartbeat OK"
  else
    warn    "ChromaDB      127.0.0.1:8000  not responding"
  fi

  if curl -sf http://127.0.0.1:8080/health &>/dev/null; then
    success "OpenSandbox   127.0.0.1:8080  health OK"
  else
    warn    "OpenSandbox   127.0.0.1:8080  not responding"
  fi
}

print_endpoints() {
  echo ""
  echo -e "${BOLD}Endpoints (host localhost only):${RESET}"
  echo -e "  ${GREEN}Redis${RESET}         ${DIM}redis://127.0.0.1:6379${RESET}"
  echo -e "  ${GREEN}ChromaDB${RESET}      ${DIM}http://127.0.0.1:8000${RESET}"
  echo -e "  ${GREEN}OpenSandbox${RESET}   ${DIM}http://127.0.0.1:8080${RESET}"
  echo ""
}

# ── Commands ──────────────────────────────────────────────────────────────────
cmd_start() {
  check_docker

  info "Building OpenSandbox image (if not cached)..."
  $COMPOSE build opensandbox

  pull_sandbox_images

  info "Starting all services..."
  $COMPOSE up -d --remove-orphans

  wait_healthy redis
  wait_healthy chromadb
  wait_healthy opensandbox

  connectivity_check
  print_endpoints
  success "All services running."
}

cmd_stop() {
  check_docker
  info "Stopping all services..."
  $COMPOSE down
  success "Stopped."
}

cmd_restart() {
  cmd_stop
  echo ""
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
    $COMPOSE logs -f --tail=200 "$service"
  else
    $COMPOSE logs -f --tail=100
  fi
}

cmd_build() {
  check_docker
  info "Rebuilding mockline-opensandbox image (no cache)..."
  $COMPOSE build --no-cache opensandbox
  success "Build complete."
}

cmd_clean() {
  check_docker
  warn "This removes all Mockline containers AND data volumes (Redis + ChromaDB)."
  read -rp "Continue? [y/N] " confirm
  if [[ "${confirm,,}" == "y" ]]; then
    $COMPOSE down -v --remove-orphans
    success "Containers and volumes removed."
  else
    info "Cancelled."
  fi
}

# ── Entry point ───────────────────────────────────────────────────────────────
CMD="${1:-help}"
shift || true

case "$CMD" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_restart ;;
  status)  cmd_status ;;
  logs)    cmd_logs "${1:-}" ;;
  build)   cmd_build ;;
  clean)   cmd_clean ;;
  help|*)
    echo ""
    echo -e "${BOLD}Mockline Infrastructure Manager${RESET}"
    echo ""
    echo -e "${BOLD}Usage:${RESET}  ./scripts/infra.sh <command> [service]"
    echo ""
    echo -e "${BOLD}Commands:${RESET}"
    echo "  start              Build image, pre-pull sandbox images, start all services"
    echo "  stop               Stop all services"
    echo "  restart            Stop then start"
    echo "  status             Show container status and endpoints"
    echo "  logs [service]     Tail logs (all services, or filter by name)"
    echo "  build              Rebuild mockline-opensandbox image (no cache)"
    echo "  clean              Remove containers and ALL data volumes"
    echo ""
    echo -e "${BOLD}Services:${RESET}  redis | chromadb | opensandbox"
    echo ""
    echo -e "${BOLD}Config files (project root):${RESET}"
    echo "  docker-compose.yml       Service definitions"
    echo "  Dockerfile.opensandbox   OpenSandbox server image"
    echo "  sandbox.toml             OpenSandbox runtime config"
    echo ""
    ;;
esac
