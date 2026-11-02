#!/usr/bin/env bash
set -e

echo "=== 1. Checking Backend Code Quality (ruff) ==="
./.venv/bin/ruff check backend

echo "=== 2. Running Backend Unit Tests (pytest) ==="
PYTHONPATH=backend ./.venv/bin/pytest backend/tests/unit

echo "=== 3. Checking Frontend Code Quality (eslint) ==="
(cd frontend && npm run lint)

echo "=== 4. Checking Frontend Type Safety & Build (tsc) ==="
(cd frontend && npm run build)

echo "=== All pre-commit quality checks passed successfully! ==="
