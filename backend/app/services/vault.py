"""
Vault Credential Encryption Service
-----------------------------------
Provides encryption at rest for network device credentials per §13 of architecture.md.

NOTE: This Fernet-based local vault is implemented as the "dev vault"
for this student-project scope. In production, this module should be
swapped with an integration to a dedicated secrets manager (e.g.
HashiCorp Vault, AWS Secrets Manager, or CyberArk) using the
secret_ref as the vault path / secret ARN.
"""
import base64
import hashlib
from typing import Tuple, Optional
from uuid import UUID
from cryptography.fernet import Fernet
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.devices import DeviceCredential, Device


def _get_fernet() -> Fernet:
    """Derive a valid 32-byte urlsafe base64 Fernet key deterministically from SECRET_KEY."""
    derived_32 = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
    fernet_key = base64.urlsafe_b64encode(derived_32)
    return Fernet(fernet_key)


def encrypt_string(plaintext: str) -> bytes:
    """Encrypt a string to raw bytes using Fernet."""
    f = _get_fernet()
    return f.encrypt(plaintext.encode("utf-8"))


def decrypt_bytes(ciphertext: bytes) -> str:
    """Decrypt raw Fernet ciphertext bytes to plaintext string."""
    f = _get_fernet()
    return f.decrypt(ciphertext).decode("utf-8")


def store_device_credential(
    db: Session,
    device_id: UUID,
    username: str,
    secret: str,
    auth_type: str = "password",
) -> DeviceCredential:
    """
    Encrypt username and secret at rest and store in device_credentials.
    - username is encrypted into username_enc (BYTEA).
    - secret is encrypted and referenced via secret_ref (pointer to encrypted dev vault token).
    Never stores plaintext secrets in the database.
    """
    # 1. Encrypt username at rest
    username_encrypted = encrypt_string(username)

    # 2. Encrypt secret at rest for dev-vault
    secret_cipher_b64 = encrypt_string(secret).decode("utf-8")
    secret_ref = f"dev-vault:fernet:{secret_cipher_b64}"

    # Check if credential already exists for this device
    cred = db.query(DeviceCredential).filter(DeviceCredential.device_id == device_id).first()
    if cred:
        cred.username_enc = username_encrypted
        cred.secret_ref = secret_ref
        cred.auth_type = auth_type
    else:
        cred = DeviceCredential(
            device_id=device_id,
            username_enc=username_encrypted,
            secret_ref=secret_ref,
            auth_type=auth_type,
        )
        db.add(cred)

    db.commit()
    db.refresh(cred)
    return cred


def get_device_credential(
    db: Session,
    device_id: UUID,
) -> Optional[Tuple[str, str, str]]:
    """
    Internal service helper to retrieve decrypted credentials for SSH collection/remediation.
    Returns (username, secret, auth_type) or None.
    NEVER call this inside API responses.
    """
    cred = db.query(DeviceCredential).filter(DeviceCredential.device_id == device_id).first()
    if not cred:
        return None

    username = decrypt_bytes(cred.username_enc)

    secret = ""
    if cred.secret_ref.startswith("dev-vault:fernet:"):
        cipher_b64 = cred.secret_ref.replace("dev-vault:fernet:", "")
        secret = decrypt_bytes(cipher_b64.encode("utf-8"))

    return username, secret, cred.auth_type
