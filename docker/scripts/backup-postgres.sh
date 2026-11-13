#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILE="${PROJECT_DIR}/docker-compose.yml"
BACKUP_DIR="${BACKUP_DIR:-${PROJECT_DIR}/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [[ -f "${PROJECT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${PROJECT_DIR}/.env"
  set +a
fi

DB_USER="${POSTGRES_USER:-smart_guide}"
DB_NAME="${POSTGRES_DB:-smart_guide}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT_FILE="${BACKUP_DIR}/smart-guide-${DB_NAME}-${TIMESTAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

echo "[backup-postgres] Creating PostgreSQL backup: ${OUTPUT_FILE}"
docker compose -f "${COMPOSE_FILE}" exec -T postgres \
  pg_dump -U "${DB_USER}" --clean --if-exists "${DB_NAME}" | gzip -9 > "${OUTPUT_FILE}"

if [[ ! -s "${OUTPUT_FILE}" ]]; then
  echo "[backup-postgres] ERROR: Generated backup file is empty." >&2
  rm -f "${OUTPUT_FILE}"
  exit 1
fi

find "${BACKUP_DIR}" -type f -name "smart-guide-*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete || true
echo "[backup-postgres] Backup completed successfully (${OUTPUT_FILE})."
