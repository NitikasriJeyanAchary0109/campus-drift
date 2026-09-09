#!/usr/bin/env python3
"""
Lightweight Cisco IOS / FRR Interactive CLI Simulator
Provides real SSH terminal emulation for Netmiko and network automation tools.
Supports stateful configuration modifications, verification re-polling,
and pristine configuration reset for repeatable automated testing.
"""
import os
import re
import sys

ENV_FILE = "/etc/network/device.env"
if os.path.exists(ENV_FILE):
    try:
        with open(ENV_FILE) as f:
            for eline in f:
                if "=" in eline and not eline.startswith("#"):
                    k, v = eline.strip().split("=", 1)
                    os.environ[k] = v
    except Exception:
        pass

HOSTNAME = os.environ.get("DEVICE_HOSTNAME", "sw-classroom-01")
CONFIG_FILE = os.environ.get("CONFIG_FILE", "/etc/network/classroom_switch.cfg")
PRISTINE_FILE = f"{CONFIG_FILE}.pristine"


def init_pristine_config():
    """Save an untouched snapshot of the initial configuration for reset fixtures."""
    if os.path.exists(CONFIG_FILE) and not os.path.exists(PRISTINE_FILE):
        try:
            with open(CONFIG_FILE, "r") as src, open(PRISTINE_FILE, "w") as dst:
                dst.write(src.read())
        except Exception:
            pass


def reset_to_pristine() -> bool:
    """Restore the configuration file to its initial pristine state."""
    if os.path.exists(PRISTINE_FILE):
        try:
            with open(PRISTINE_FILE, "r") as src, open(CONFIG_FILE, "w") as dst:
                dst.write(src.read())
            return True
        except Exception:
            return False
    return False


def get_running_config() -> str:
    """Read configuration file from disk."""
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r") as f:
                return f.read().strip()
        except Exception:
            pass
    return f"""!
version 15.2
hostname {HOSTNAME}
!
interface FastEthernet0/1
 switchport mode access
!
line vty 0 4
 transport input ssh
!
end"""


def save_running_config(content: str):
    """Save updated configuration to disk."""
    try:
        with open(CONFIG_FILE, "w") as f:
            f.write(content.strip() + "\n")
    except Exception:
        pass


def mutate_config(cmd: str, context: dict) -> bool:
    """
    Apply configuration statements to running config and persist state to disk.
    Supports interface sub-mode, line sub-mode, and global commands.
    """
    cmd_strip = cmd.strip()
    cmd_lower = cmd_strip.lower()
    cfg_text = get_running_config()
    lines = cfg_text.splitlines()

    submode = context.get("submode")

    # 1. Interface context selection
    if cmd_lower.startswith("interface "):
        if_name = cmd_strip.split(None, 1)[1]
        context["submode"] = f"interface {if_name}"
        return True

    # 2. Line vty context selection
    if cmd_lower.startswith("line vty"):
        context["submode"] = "line vty"
        return True

    # 3. Port-security commands under interface sub-mode
    if submode and submode.startswith("interface "):
        target_if = submode.split(None, 1)[1]
        new_lines = []
        in_target_if = False

        if cmd_lower == "switchport port-security":
            has_ps = False
            for line in lines:
                stripped = line.strip()
                if stripped.lower() == f"interface {target_if.lower()}":
                    in_target_if = True
                    new_lines.append(line)
                    continue
                if in_target_if and (stripped.startswith("interface ") or stripped.startswith("line ") or stripped == "!"):
                    if not has_ps:
                        new_lines.append(" switchport port-security")
                    in_target_if = False
                elif in_target_if and stripped.lower() == "switchport port-security":
                    has_ps = True
                new_lines.append(line)
            if in_target_if and not has_ps:
                new_lines.append(" switchport port-security")
            save_running_config("\n".join(new_lines))
            return True

        elif cmd_lower == "no switchport port-security":
            for line in lines:
                stripped = line.strip()
                if stripped.lower() == f"interface {target_if.lower()}":
                    in_target_if = True
                    new_lines.append(line)
                    continue
                if in_target_if and (stripped.startswith("interface ") or stripped.startswith("line ") or stripped == "!"):
                    in_target_if = False
                if in_target_if and stripped.lower() == "switchport port-security":
                    continue  # Remove line
                new_lines.append(line)
            save_running_config("\n".join(new_lines))
            return True

    # 4. Transport input under line vty sub-mode
    if submode == "line vty":
        if cmd_lower.startswith("transport input "):
            new_lines = []
            in_vty = False
            replaced = False
            for line in lines:
                stripped = line.strip()
                if stripped.lower().startswith("line vty"):
                    in_vty = True
                    new_lines.append(line)
                    continue
                if in_vty and (stripped.startswith("interface ") or stripped.startswith("line ") or stripped == "!"):
                    if not replaced:
                        new_lines.append(f" {cmd_strip}")
                        replaced = True
                    in_vty = False
                elif in_vty and stripped.lower().startswith("transport input"):
                    new_lines.append(f" {cmd_strip}")
                    replaced = True
                    continue
                new_lines.append(line)
            if in_vty and not replaced:
                new_lines.append(f" {cmd_strip}")
            save_running_config("\n".join(new_lines))
            return True

    # 5. Global SNMP commands
    if cmd_lower.startswith("no snmp-server community"):
        tokens = cmd_strip.split()
        if len(tokens) >= 4:
            comm = tokens[3].lower()
            new_lines = [
                l for l in lines
                if not (l.strip().lower().startswith("snmp-server community") and comm in l.strip().lower())
            ]
            save_running_config("\n".join(new_lines))
            return True

    if cmd_lower.startswith("snmp-server community"):
        # Add if not present
        if not any(cmd_strip.lower() in l.strip().lower() for l in lines):
            # Insert before 'line vty' or 'end'
            idx = len(lines) - 1
            for i, l in enumerate(lines):
                if l.strip().lower().startswith("line vty"):
                    idx = i
                    break
            lines.insert(idx, cmd_strip)
            save_running_config("\n".join(lines))
        return True

    # 6. Global NTP commands
    if cmd_lower.startswith("no ntp server"):
        ip_token = cmd_strip.split()[-1]
        new_lines = [
            l for l in lines
            if not (l.strip().lower().startswith("ntp server") and ip_token in l.strip().lower())
        ]
        save_running_config("\n".join(new_lines))
        return True

    if cmd_lower.startswith("ntp server"):
        new_lines = [l for l in lines if not l.strip().lower().startswith("ntp server")]
        # Insert before line vty or end
        idx = len(new_lines) - 1
        for i, l in enumerate(new_lines):
            if l.strip().lower().startswith("line vty"):
                idx = i
                break
        new_lines.insert(idx, cmd_strip)
        save_running_config("\n".join(new_lines))
        return True

    return False


def main():
    init_pristine_config()
    config_mode = False
    context = {"submode": None}
    prompt = f"{HOSTNAME}# "

    sys.stdout.write(f"\r\n{prompt}")
    sys.stdout.flush()

    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
        except Exception:
            break

        cmd = line.strip()

        if not cmd:
            sys.stdout.write(f"{prompt}")
            sys.stdout.flush()
            continue

        cmd_lower = cmd.lower()

        # Handle exit / quit
        if cmd_lower in ["exit", "quit"]:
            if context.get("submode"):
                context["submode"] = None
                prompt = f"{HOSTNAME}(config)# "
                sys.stdout.write(f"\r\n{prompt}")
                sys.stdout.flush()
                continue
            elif config_mode:
                config_mode = False
                prompt = f"{HOSTNAME}# "
                sys.stdout.write(f"\r\n{prompt}")
                sys.stdout.flush()
                continue
            else:
                sys.stdout.write("\r\nConnection closed by foreign host.\r\n")
                sys.stdout.flush()
                break

        # Handle 'end' from config mode
        if cmd_lower == "end" and config_mode:
            config_mode = False
            context["submode"] = None
            prompt = f"{HOSTNAME}# "
            sys.stdout.write(f"\r\n{prompt}")
            sys.stdout.flush()
            continue

        # Handle configuration terminal
        if cmd_lower in ["conf t", "configure terminal", "config t"]:
            config_mode = True
            context["submode"] = None
            prompt = f"{HOSTNAME}(config)# "
            sys.stdout.write(f"\r\nEnter configuration commands, one per line.  End with CNTL/Z.\r\n{prompt}")
            sys.stdout.flush()
            continue

        # Handle terminal settings (Netmiko sends these automatically)
        if (
            cmd_lower.startswith("terminal length")
            or cmd_lower.startswith("terminal width")
            or cmd_lower.startswith("terminal no editing")
        ):
            sys.stdout.write(f"\r\n{prompt}")
            sys.stdout.flush()
            continue

        # Handle enable
        if cmd_lower.startswith("enable"):
            config_mode = False
            context["submode"] = None
            prompt = f"{HOSTNAME}# "
            sys.stdout.write(f"\r\n{prompt}")
            sys.stdout.flush()
            continue

        # Handle test reset command for fixture isolation
        if cmd_lower in ["simulator-reset-pristine", "test-reset-default"]:
            reset_to_pristine()
            sys.stdout.write(f"\r\n[OK] Configuration reset to pristine defaults.\r\n{prompt}")
            sys.stdout.flush()
            continue

        # Handle 'show running-config'
        if (
            cmd_lower.startswith("show run")
            or cmd_lower.startswith("show running-config")
            or cmd_lower == "display current-configuration"
        ):
            cfg = get_running_config()
            sys.stdout.write(f"\r\nBuilding configuration...\r\n\r\nCurrent configuration : {len(cfg)} bytes\r\n{cfg}\r\n{prompt}")
            sys.stdout.flush()
            continue

        # Handle 'show version'
        if cmd_lower.startswith("show ver") or cmd_lower.startswith("show version"):
            sys.stdout.write(
                f"\r\nCisco IOS Software, C2960X Software (C2960X-UNIVERSALK9-M), Version 15.2(7)E4, RELEASE SOFTWARE (fc3)\r\n"
                f"Technical Support: http://www.cisco.com/techsupport\r\n"
                f"Model: Catalyst 2960-X\r\n"
                f"Uptime: 4 weeks, 2 days, 1 hour, 12 minutes\r\n"
                f"System serial number: FOC2234ABCD\r\n"
                f"{prompt}"
            )
            sys.stdout.flush()
            continue

        # Handle write memory / copy run start
        if cmd_lower in ["write memory", "wr", "write", "copy run start"]:
            sys.stdout.write(f"\r\nBuilding configuration...\r\n[OK]\r\n{prompt}")
            sys.stdout.flush()
            continue

        # Inside config mode: execute mutation
        if config_mode:
            mutate_config(cmd, context)
            if context.get("submode"):
                if context["submode"].startswith("interface "):
                    prompt = f"{HOSTNAME}(config-if)# "
                elif context["submode"] == "line vty":
                    prompt = f"{HOSTNAME}(config-line)# "
            else:
                prompt = f"{HOSTNAME}(config)# "
            sys.stdout.write(f"\r\n{prompt}")
        else:
            sys.stdout.write(f"\r\n{prompt}")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
