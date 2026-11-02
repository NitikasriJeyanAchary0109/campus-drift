#!/usr/bin/env bash
set -e

echo "=== Running Backend Linter (ruff) ==="
./.venv/bin/ruff check backend

echo "=== Running Frontend Linter (eslint) ==="
(cd frontend && npm run lint)

echo "=== All lint checks passed! ==="
