"""Startup guard: a production deployment must not run with the committed development secrets."""
import pytest
from pydantic import ValidationError

from app.core.config import Settings

STRONG = "k" * 40
OTHER = "v" * 40


def make(**over):
    base = dict(ENVIRONMENT="production", DEBUG=False, SECRET_KEY=STRONG, VAULT_KEY=OTHER, ITSM_WEBHOOK_SECRET="w" * 40,
                SSH_STRICT_HOST_KEYS=True, SSH_KNOWN_HOSTS_FILE="/etc/campus_drift/known_hosts")
    base.update(over)
    return Settings(_env_file=None, **base)


def test_development_defaults_are_accepted():
    s = Settings(_env_file=None)
    assert s.ENVIRONMENT == "development"
    assert s.SECRET_KEY == Settings.DEFAULT_SECRET_KEY


def test_valid_production_config_starts():
    assert make().ENVIRONMENT == "production"


@pytest.mark.parametrize(
    "over, needle",
    [
        (dict(SECRET_KEY=Settings.DEFAULT_SECRET_KEY), "SECRET_KEY"),
        (dict(SECRET_KEY="short"), "SECRET_KEY"),
        (dict(VAULT_KEY=None), "VAULT_KEY"),
        (dict(VAULT_KEY="short"), "VAULT_KEY"),
        (dict(VAULT_KEY=STRONG), "differ"),
        (dict(ITSM_WEBHOOK_SECRET=Settings.DEFAULT_ITSM_WEBHOOK_SECRET), "ITSM_WEBHOOK_SECRET"),
        (dict(DEBUG=True), "DEBUG"),
        (dict(SSH_STRICT_HOST_KEYS=False), "SSH_STRICT_HOST_KEYS"),
        (dict(SSH_KNOWN_HOSTS_FILE=None), "SSH_KNOWN_HOSTS_FILE"),
        (dict(ALLOW_TEST_HOOKS=True), "ALLOW_TEST_HOOKS"),
        (dict(ITSM_REQUIRE_TIMESTAMP=False), "ITSM_REQUIRE_TIMESTAMP"),
    ],
)
def test_production_refuses_insecure_values(over, needle):
    with pytest.raises(ValidationError) as exc:
        make(**over)
    assert needle in str(exc.value)


def test_all_problems_are_reported_together():
    with pytest.raises(ValidationError) as exc:
        Settings(_env_file=None, ENVIRONMENT="production")
    msg = str(exc.value)
    for needle in ("SECRET_KEY", "VAULT_KEY", "ITSM_WEBHOOK_SECRET", "DEBUG"):
        assert needle in msg


def test_environment_name_is_case_insensitive():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, ENVIRONMENT="Production")


def test_vault_uses_vault_key_when_set_and_secret_key_otherwise(monkeypatch):
    from app.services import vault

    monkeypatch.setattr(vault.settings, "VAULT_KEY", None)
    legacy = vault.encrypt_string("pw")
    monkeypatch.setattr(vault.settings, "VAULT_KEY", OTHER)
    with pytest.raises(Exception):
        vault.decrypt_bytes(legacy)             # a different key cannot read the old ciphertext
    assert vault.decrypt_bytes(vault.encrypt_string("pw")) == "pw"
    monkeypatch.setattr(vault.settings, "VAULT_KEY", None)
    assert vault.decrypt_bytes(legacy) == "pw"  # dev fallback is unchanged


def test_production_defaults_close_the_lab_hooks_and_require_timestamps():
    s = make()
    assert s.ALLOW_TEST_HOOKS is False and s.ITSM_REQUIRE_TIMESTAMP is True


def test_development_defaults_keep_the_lab_hooks_and_do_not_require_timestamps():
    s = Settings(_env_file=None)
    assert s.ALLOW_TEST_HOOKS is True and s.ITSM_REQUIRE_TIMESTAMP is False
