import pytest
from app.core.security import (
    get_password_hash,
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
)


def test_password_hashing_roundtrip():
    """Verify password hashing generates secure salt and correctly validates."""
    password = "CampusDriftSecurePass2026!"
    hashed = get_password_hash(password)

    assert hashed != password
    assert hashed.startswith("$2")  # bcrypt hash identifier
    assert verify_password(password, hashed) is True
    assert verify_password("WrongPassword!", hashed) is False


def test_password_unique_salt():
    """Verify the same password hashed twice yields different bcrypt hashes due to salt."""
    pwd = "SamePasswordTwice"
    hash1 = get_password_hash(pwd)
    hash2 = get_password_hash(pwd)

    assert hash1 != hash2
    assert verify_password(pwd, hash1) is True
    assert verify_password(pwd, hash2) is True


def test_jwt_access_token_issue_and_verify():
    """Verify JWT access token encoding and decoding with expected claims."""
    payload = {
        "sub": "b0e457f6-6c84-4861-bb1c-d784a9e5c46b",
        "username": "neteng_user",
        "role": "NetworkEngineer",
    }
    token = create_access_token(payload)
    assert isinstance(token, str)

    decoded = decode_token(token)
    assert decoded["sub"] == payload["sub"]
    assert decoded["username"] == "neteng_user"
    assert decoded["role"] == "NetworkEngineer"
    assert decoded["type"] == "access"
    assert "exp" in decoded


def test_jwt_refresh_token_issue_and_verify():
    """Verify JWT refresh token carries type 'refresh'."""
    payload = {
        "sub": "b0e457f6-6c84-4861-bb1c-d784a9e5c46b",
        "username": "neteng_user",
        "role": "NetworkEngineer",
    }
    refresh_token = create_refresh_token(payload)
    decoded = decode_token(refresh_token)

    assert decoded["sub"] == payload["sub"]
    assert decoded["type"] == "refresh"


def test_jwt_tampered_token():
    """Verify tampered or invalid token raises ValueError on decode."""
    token = create_access_token({"sub": "test", "username": "admin", "role": "Admin"})
    tampered_token = token[:-5] + "xxxxx"

    with pytest.raises(ValueError) as excinfo:
        decode_token(tampered_token)
    assert "Invalid or expired token" in str(excinfo.value)
