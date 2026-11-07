"""The remediation template engine renders from whitelisted templates in a sandbox, and fails loudly on a missing parameter."""
import pytest
from jinja2.exceptions import UndefinedError
from jinja2.sandbox import SecurityError
from app.services import remediation_templates as rt


def test_environment_is_sandboxed_and_strict():
    env = rt._jinja_env
    with pytest.raises(SecurityError):
        env.from_string("{{ ''.__class__.__mro__ }}").render()
    with pytest.raises(UndefinedError):
        env.from_string("no ntp server {{ missing }}").render()


def test_a_missing_parameter_never_becomes_an_empty_command():
    with pytest.raises(UndefinedError):
        rt._jinja_env.from_string("ip route {{ a }} {{ b }}").render(a="10.0.0.0")


def test_shell_metacharacters_are_rejected_before_rendering():
    with pytest.raises(rt.SecurityViolationError):
        rt.validate_ip_address("10.0.0.1; reload")
    with pytest.raises(rt.SecurityViolationError):
        rt.validate_interface_name("Gi0/1\nno shutdown")


# --- hardening round: sanitiser, dotted interface names, NTP hostnames and several servers -----------------------------
from app.services.remediation_templates import (  # noqa: E402
    SecurityViolationError as _SVE,
    render_remediation_commands as _render,
    sanitize_rendered_commands as _sanitize,
)


@pytest.mark.parametrize("bad", ["interface Gi0/1\x1a", "interface Gi0/1\x03", "banner motd \"x\"", "show ?", "ntp server a\\b", "x\x00y", "x\x1b[2Jy", "a'b"])
def test_sanitiser_refuses_control_characters_quotes_backslash_and_help(bad):
    with pytest.raises(_SVE):
        _sanitize([bad])


def test_sub_interface_names_are_kept_whole():
    cmds = _render("cisco_ios", "EXACT", "interface.GigabitEthernet0/0.100.port_security.enabled", "true", "false")
    assert cmds[0] == "interface GigabitEthernet0/0.100"


def test_ntp_hostname_is_accepted_and_every_other_server_is_removed():
    cmds = _render("cisco_ios", "EXACT", "ntp.server", "pool.ntp.org", "10.10.0.1, 66.6.6.6")
    assert cmds == ["no ntp server 10.10.0.1", "no ntp server 66.6.6.6", "ntp server pool.ntp.org"]


def test_ntp_keeps_the_expected_server_when_a_rogue_one_is_added():
    cmds = _render("cisco_ios", "EXACT", "ntp.server", "10.10.0.1", "10.10.0.1, 66.6.6.6")
    assert cmds == ["no ntp server 66.6.6.6", "ntp server 10.10.0.1"]


@pytest.mark.parametrize("bad", ["a b", "-bad.example", "x;y", "1.2.3.4\nreload", "a" * 64 + ".example"])
def test_ntp_server_rejects_non_hostnames(bad):
    with pytest.raises(_SVE):
        _render("cisco_ios", "EXACT", "ntp.server", bad, None)
