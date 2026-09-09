import pytest
from netmiko import ConnectHandler


def test_ssh_connection_classroom_switch():
    """
    Integration test verifying Netmiko can establish an SSH connection
    to the simulated Cisco IOS classroom switch and retrieve running config.
    """
    device_params = {
        "device_type": "cisco_ios",
        "host": "localhost",
        "port": 2222,
        "username": "cisco",
        "password": "cisco123",
        "fast_cli": False,
        "timeout": 10,
    }

    try:
        conn = ConnectHandler(**device_params)
    except Exception as e:
        pytest.skip(f"Simulated device not reachable on port 2222: {e}")

    try:
        prompt = conn.find_prompt()
        assert "sw-classroom-01" in prompt
        assert prompt.endswith("#")

        output = conn.send_command("show running-config")
        assert "hostname sw-classroom-01" in output
        assert "vlan 10" in output
        assert "interface FastEthernet0/1" in output
        assert "line vty 0 4" in output
    finally:
        conn.disconnect()


def test_ssh_connection_lab_router():
    """
    Integration test verifying Netmiko can establish an SSH connection
    to the simulated FRR lab router and retrieve running config.
    """
    device_params = {
        "device_type": "cisco_ios",
        "host": "localhost",
        "port": 2224,
        "username": "admin",
        "password": "admin123",
        "fast_cli": False,
        "timeout": 10,
    }

    try:
        conn = ConnectHandler(**device_params)
    except Exception as e:
        pytest.skip(f"Simulated device not reachable on port 2224: {e}")

    try:
        prompt = conn.find_prompt()
        assert "rtr-lab-01" in prompt
        assert prompt.endswith("#")

        output = conn.send_command("show running-config")
        assert "hostname rtr-lab-01" in output
        assert "GigabitEthernet0/0" in output
        assert "router ospf 1" in output
    finally:
        conn.disconnect()


def test_ssh_connection_hostel_switch():
    """
    Integration test verifying Netmiko can establish an SSH connection
    to the simulated Cisco IOS hostel switch and retrieve running config,
    confirming distinct configurations and intentional drift.
    """
    device_params = {
        "device_type": "cisco_ios",
        "host": "localhost",
        "port": 2223,
        "username": "cisco",
        "password": "cisco123",
        "fast_cli": False,
        "timeout": 10,
    }

    try:
        conn = ConnectHandler(**device_params)
    except Exception as e:
        pytest.skip(f"Simulated device not reachable on port 2223: {e}")

    try:
        prompt = conn.find_prompt()
        assert "sw-hostel-01" in prompt
        assert prompt.endswith("#")

        output = conn.send_command("show running-config")
        assert "hostname sw-hostel-01" in output
        assert "vlan 30" in output
        assert "snmp-server community public RO" in output
        assert "transport input telnet ssh" in output
    finally:
        conn.disconnect()
