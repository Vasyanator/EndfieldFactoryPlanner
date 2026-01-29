#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="${ROOT_DIR}/../data"
DST_DIR="${ROOT_DIR}/public/data"

if [[ ! -d "${SRC_DIR}" ]]; then
  echo "[sync-data] Source directory not found: ${SRC_DIR}" >&2
  exit 1
fi

mkdir -p "${DST_DIR}"

if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete "${SRC_DIR}/" "${DST_DIR}/"
else
  # Fallback when rsync is unavailable.
  rm -rf "${DST_DIR}"/*
  cp -a "${SRC_DIR}/." "${DST_DIR}/"
fi

MANIFEST_PATH="${ROOT_DIR}/public/data/manifest.json"
mapfile -t JSON_FILES < <(find "${SRC_DIR}" -type f -name '*.json' ! -name 'manifest.json' | sort)

{
  echo "{"
  echo "  \"generatedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"jsonFiles\": ["
  for i in "${!JSON_FILES[@]}"; do
    rel_path="${JSON_FILES[$i]#${SRC_DIR}/}"
    comma=","
    if [[ "$i" -eq "$((${#JSON_FILES[@]} - 1))" ]]; then
      comma=""
    fi
    echo "    \"${rel_path}\"${comma}"
  done
  echo "  ]"
  echo "}"
} > "${MANIFEST_PATH}"

echo "[sync-data] Wrote manifest: ${MANIFEST_PATH}"
echo "[sync-data] Synced ${SRC_DIR} -> ${DST_DIR}"
