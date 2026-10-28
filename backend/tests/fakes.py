"""
Fault-injectable in-memory network device used by the failure/edge-case tests.

It mimics the small part of the Netmiko connection API the application uses
(``send_command``, ``send_config_set``, ``disconnect``) over a plain running-config text, applies the CLI
commands the whitelisted remediation templates can generate, and can be told to misbehave in the ways real
campus devices do: refuse connections, drop the session mid-push, ignore changes, fail or half-complete a rollback,
or return garbage.
"""
from typing import Any, Dict, List, Optional


class DeviceFault(Exception):
    """Raised by the fake device to simulate a transport-level failure (SSH drop, timeout)."""


class FakeDevice:
    def __init__(
        self,
        config: str,
        *,
        connect_error: Optional[Exception] = None,
        connect_error_after: int = 0,      # connections that succeed before connect_error starts firing
        push_error_after: Optional[int] = None,  # apply N commands of the first push, then raise
        drop_after_push: bool = False,     # session dies right after the first push (reconnect works)
        ignore_push: bool = False,         # device silently ignores configuration changes
        rollback_error: bool = False,      # every rollback attempt raises
        reset_supported: bool = True,      # False = real-IOS behaviour: 'simulator-reset-pristine' is an invalid command
        garbage_reads: int = 0,            # number of post-change 'show running-config' reads that return a corrupted stream
        dead_forever_after_push: bool = False,  # device is unreachable for all new connections once pushed to
    ):
        self.pristine = config
        self.running = config
        self.connect_error = connect_error
        self.connect_error_after = connect_error_after
        self.push_error_after = push_error_after
        self.drop_after_push = drop_after_push
        self.ignore_push = ignore_push
        self.rollback_error = rollback_error
        self.reset_supported = reset_supported
        self.garbage_reads = garbage_reads
        self.dead_forever_after_push = dead_forever_after_push
        self.connections = 0
        self.pushes: List[List[str]] = []
        self.pushed_once = False

    # ------------------------------------------------------------------ connection factory
    def connect(self, *_: Any, **__: Any) -> "FakeConn":
        self.connections += 1
        if self.connect_error is not None and self.connections > self.connect_error_after:
            raise self.connect_error
        if self.dead_forever_after_push and self.pushed_once:
            raise DeviceFault("device unreachable after change")
        return FakeConn(self)

    # ------------------------------------------------------------------ command semantics
    def apply(self, commands: List[str]) -> None:
        lines = self.running.splitlines()
        ctx: Optional[str] = None
        for raw in commands:
            cmd = raw.strip()
            low = cmd.lower()
            if not cmd or cmd.startswith("!"):
                continue
            if low.startswith("interface "):
                ctx = cmd
                continue
            if low.startswith("line vty"):
                ctx = "line vty"
                continue
            if low.startswith("no snmp-server community"):
                name = cmd.split()[-1].lower()
                lines = [l for l in lines if not (l.strip().lower().startswith("snmp-server community") and l.split()[2].lower() == name)]
                ctx = None
            elif low.startswith("snmp-server community"):
                lines = _insert_global(lines, cmd)
                ctx = None
            elif low.startswith("no ntp server"):
                ip = cmd.split()[-1]
                lines = [l for l in lines if not (l.strip().lower().startswith("ntp server") and ip in l.split())]
                ctx = None
            elif low.startswith("ntp server"):
                lines = _insert_global(lines, cmd)
                ctx = None
            elif ctx == "line vty" and low.startswith("transport input"):
                lines = _set_child(lines, "line vty", "transport input", cmd)
            elif ctx and ctx.lower().startswith("interface ") and low.startswith("switchport"):
                prefix = " ".join(cmd.split()[:3]) if low.startswith("switchport access") else "switchport port-security"
                if low.startswith("switchport port-security") or low.startswith("switchport access vlan"):
                    lines = _set_child(lines, ctx, prefix if low.startswith("switchport access") else "switchport port-security", cmd, replace_prefix=("no switchport port-security",))
        self.running = "\n".join(lines) + "\n"


def _insert_global(lines: List[str], cmd: str) -> List[str]:
    if cmd.lower().startswith("ntp server"):
        lines = [l for l in lines if not l.strip().lower().startswith("ntp server")]
    if any(l.strip().lower() == cmd.strip().lower() for l in lines):  # IOS is idempotent: re-entering a line is a no-op
        return lines
    out, placed = [], False
    for l in lines:
        if not placed and l.strip().lower().startswith("line vty"):
            out.append(cmd)
            placed = True
        out.append(l)
    if not placed:
        out.append(cmd)
    return out


def _set_child(lines: List[str], header: str, prefix: str, cmd: str, replace_prefix: tuple = ()) -> List[str]:
    out, in_block, done = [], False, False
    for l in lines:
        stripped = l.strip()
        if not l.startswith((" ", "\t")) and stripped and stripped != "!":
            if in_block and not done:
                out.append(" " + cmd)
                done = True
            in_block = stripped.lower() == header.lower() or stripped.lower().startswith(header.lower() + " ") and header.lower() == "line vty"
        if in_block and l.startswith((" ", "\t")) and (
            stripped.lower().startswith(prefix.lower()) or any(stripped.lower().startswith(p) for p in replace_prefix)
        ):
            if not done:
                out.append(" " + cmd)
                done = True
            continue
        out.append(l)
    if in_block and not done:
        out.append(" " + cmd)
    return out


class FakeConn:
    def __init__(self, device: FakeDevice):
        self.d = device
        self.dead = False
        self.disconnected = False

    def _check(self) -> None:
        if self.dead:
            raise DeviceFault("session closed by remote host")

    def send_command(self, cmd: str, **_: Any) -> str:
        self._check()
        low = cmd.strip().lower()
        if low.startswith("show run"):
            if self.d.garbage_reads > 0 and self.d.pushed_once:
                self.d.garbage_reads -= 1
                return "version 15.2\nhostname x\n!%#CORRUPTED_STREAM#%!\n"
            return self.d.running
        if low in ("simulator-reset-pristine", "test-reset-default"):
            if self.d.rollback_error:
                raise DeviceFault("rollback command failed")
            if not self.d.reset_supported:
                return "% Invalid input detected at '^' marker."
            self.d.running = self.d.pristine
            return "[OK] Configuration reset to pristine defaults."
        return ""

    def send_config_set(self, commands: List[str], **_: Any) -> str:
        self._check()
        cmds = list(commands)
        first_push = not self.d.pushed_once
        if self.d.rollback_error and not first_push:
            raise DeviceFault("config push failed during rollback")
        self.d.pushes.append(cmds)
        if first_push:
            self.d.pushed_once = True
            if self.d.push_error_after is not None:
                self.d.apply(cmds[: self.d.push_error_after])
                self.dead = True
                raise DeviceFault("connection reset by peer while pushing configuration")
            if not self.d.ignore_push:
                self.d.apply(cmds)
            if self.d.drop_after_push:
                self.dead = True
            return ""
        if not self.d.ignore_push:
            self.d.apply(cmds)
        return ""

    def disconnect(self) -> None:
        self.disconnected = True
