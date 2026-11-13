#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <backup-file.sql.gz> [--yes]" >&2
  exit 1
fi

BACKUP_FILE="$1"
AUTO_CONFIRM="${2:-}"

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "[restore-postgres] ERROR: File not found: ${BACKUP_FILE}" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILE="${PROJECT_DIR}/docker-compose.yml"

if [[ -f "${PROJECT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${PROJECT_DIR}/.env"
  set +a
fi

DB_USER="${POSTGRES_USER:-smart_guide}"
DB_NAME="${POSTGRES_DB:-smart_guide}"

if [[ "${AUTO_CONFIRM}" != "--yes" ]]; then
  read -r -p "Restore ${BACKUP_FILE} into PostgreSQL database '${DB_NAME}'? This will overwrite existing data [y/N]: " CONFIRM
  if [[ ! "${CONFIRM}" =~ ^[Yy]$ ]]; then
    echo "[restore-postgres] Aborted."
    exit 0
  fi
fi

echo "[restore-postgres] Restoring ${BACKUP_FILE} into ${DB_NAME}..."
gunzip -c "${BACKUP_FILE}" | docker compose -f "${COMPOSE_FILE}" exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U "${DB_USER}" -d "${DB_NAME}"

echo "[restore-postgres] Restore completed successfully."
