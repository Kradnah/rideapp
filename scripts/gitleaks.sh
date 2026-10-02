#!/usr/bin/env sh
# Ejecuta gitleaks con el binario local si existe y, si no, con su imagen de Docker (7.8).
#   scripts/gitleaks.sh staged   → solo lo que está en el índice (pre-commit)
#   scripts/gitleaks.sh history  → todo el historial (pre-push)
set -eu

mode="${1:-staged}"
case "$mode" in
  staged)  args="git --pre-commit --staged --redact --no-banner" ;;
  history) args="git --redact --no-banner" ;;
  *) echo "Uso: $0 staged|history" >&2; exit 2 ;;
esac

if command -v gitleaks >/dev/null 2>&1; then
  # shellcheck disable=SC2086
  exec gitleaks $args .
fi

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "gitleaks: no hay binario ni Docker en marcha. Instálalo (winget install gitleaks) o abre Docker." >&2
  exit 1
fi

# En Git Bash de Windows, pwd -W da la ruta que entiende Docker Desktop.
repo="$(pwd -W 2>/dev/null || pwd)"
# shellcheck disable=SC2086
MSYS_NO_PATHCONV=1 exec docker run --rm -v "$repo:/repo" -w /repo zricethezav/gitleaks:v8.30.1 $args .
