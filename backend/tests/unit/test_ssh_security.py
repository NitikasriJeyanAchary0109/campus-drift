from app.core import ssh
from app.core.config import settings


def test_lab_default_adds_no_host_key_arguments(monkeypatch):
    monkeypatch.setattr(settings, "SSH_STRICT_HOST_KEYS", False)
    assert ssh.ssh_security_params() == {}


def test_strict_mode_pins_host_keys_to_the_known_hosts_file(monkeypatch):
    monkeypatch.setattr(settings, "SSH_STRICT_HOST_KEYS", True)
    monkeypatch.setattr(settings, "SSH_KNOWN_HOSTS_FILE", "/etc/campus_drift/known_hosts")
    assert ssh.ssh_security_params() == {
        "ssh_strict": True, "system_host_keys": False, "alt_host_keys": True, "alt_key_file": "/etc/campus_drift/known_hosts",
    }


def test_every_device_connection_uses_the_shared_parameters(monkeypatch):
    """Both places that open an SSH session (collection and remediation) must pass the host-key arguments to Netmiko."""
    from app.services import collection, remediation
    monkeypatch.setattr(settings, "SSH_STRICT_HOST_KEYS", True)
    monkeypatch.setattr(settings, "SSH_KNOWN_HOSTS_FILE", "/tmp/kh")
    seen = []

    def fake_connect_handler(**kwargs):
        seen.append(kwargs)
        raise RuntimeError("stop here")

    monkeypatch.setattr(remediation, "ConnectHandler", fake_connect_handler)
    monkeypatch.setattr(remediation, "get_device_credential", lambda db, did: ("u", "p", "password"))
    monkeypatch.setattr(remediation, "resolve_device_endpoint", lambda d: ("10.0.0.1", 22))

    class D:
        id = "1"
        hostname = "h"
    try:
        remediation._connect_to_device(None, D())
    except RuntimeError:
        pass
    assert seen and seen[0]["ssh_strict"] is True and seen[0]["alt_key_file"] == "/tmp/kh"
    assert "ssh_security_params" in open(collection.__file__).read()
