from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)


def test_root_endpoint():
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert "message" in data
    assert "Campus Network Configuration-Drift Detector" in data["message"]


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] in ["ok", "degraded"]
    assert "project" in data
    assert "version" in data
    assert "timestamp" in data
    assert "database" in data


def test_api_health_endpoint():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] in ["ok", "degraded"]
    assert "database" in data


def test_health_reports_redis_and_headers_are_set():
    response = client.get("/api/health")
    data = response.json()
    assert "redis" in data
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-request-id"]


def test_a_request_id_sent_by_the_caller_is_echoed():
    response = client.get("/api/health", headers={"X-Request-ID": "abc123"})
    assert response.headers["x-request-id"] == "abc123"
