"""SSH settings shared by every connection the platform opens to a device."""
from typing import Any, Dict

from app.core.config import settings


def ssh_security_params() -> Dict[str, Any]:
    """
    Netmiko arguments that make the connection verify the device's host key.

    With SSH_STRICT_HOST_KEYS the key must already be in SSH_KNOWN_HOSTS_FILE (`ssh-keyscan -p <port> <host>` pins it; a device on a
    non-default port is listed as ``[host]:port``). An unknown or changed key refuses the connection, so someone sitting between the
    platform and a switch cannot collect the stored login or feed back a fake "verified" configuration. Without it Netmiko accepts
    any key, which is acceptable only for the lab (production refuses to start that way).
    """
    if not settings.SSH_STRICT_HOST_KEYS:
        return {}
    return {
        "ssh_strict": True,
        "system_host_keys": False,
        "alt_host_keys": True,
        "alt_key_file": settings.SSH_KNOWN_HOSTS_FILE,
    }
