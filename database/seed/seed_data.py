"""
Database seed script:
Creates default roles, 3 users (one per role), 5 campus device groups,
and 3 simulated network devices with encrypted credentials.
Idempotent — safely checks for existing records before inserting.
"""
import os
import sys

# Ensure backend root is on sys.path
backend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "backend"))
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.users import Role, User
from app.models.devices import DeviceGroup, Device
from app.models.baselines import Baseline
from app.schemas.baselines import BaselineCreate, BaselineRuleCreate
from app.services.baseline import create_baseline
from app.services.vault import store_device_credential

# Roles & Users configuration
ROLES_DATA = ["Admin", "NetworkEngineer", "Viewer"]

USERS_DATA = [
    {
        "username": "admin",
        "password": "admin123",
        "role": "Admin",
    },
    {
        "username": "neteng",
        "password": "neteng123",
        "role": "NetworkEngineer",
    },
    {
        "username": "viewer",
        "password": "viewer123",
        "role": "Viewer",
    },
]

# Campus device groups from architecture.md §8 & §16
DEVICE_GROUPS_DATA = [
    {"name": "Classroom", "criticality_weight": 1.0},
    {"name": "Hostel", "criticality_weight": 0.8},
    {"name": "Office", "criticality_weight": 1.0},
    {"name": "Lab", "criticality_weight": 1.2},
    {"name": "PublicEvent", "criticality_weight": 0.5},
]

# Simulated network devices corresponding to Docker services
DEVICES_DATA = [
    {
        "hostname": "sw-classroom-01",
        "ip_address": "10.10.1.10",
        "vendor": "cisco_ios",
        "model": "Catalyst 2960-X",
        "group_name": "Classroom",
        "status": "ONLINE",
        "username": "cisco",
        "secret": "cisco123",
        "auth_type": "password",
    },
    {
        "hostname": "sw-hostel-01",
        "ip_address": "10.10.2.10",
        "vendor": "cisco_ios",
        "model": "Catalyst 2960-X",
        "group_name": "Hostel",
        "status": "ONLINE",
        "username": "cisco",
        "secret": "cisco123",
        "auth_type": "password",
    },
    {
        "hostname": "rtr-lab-01",
        "ip_address": "10.10.4.1",
        "vendor": "frr",
        "model": "FRR Virtual Router",
        "group_name": "Lab",
        "status": "ONLINE",
        "username": "admin",
        "secret": "admin123",
        "auth_type": "password",
    },
]


def seed_database():
    print("🌱 Starting database seed...")
    db = SessionLocal()
    try:
        # 1. Seed Roles
        roles_by_name = {}
        for role_name in ROLES_DATA:
            role = db.query(Role).filter(Role.name == role_name).first()
            if not role:
                role = Role(name=role_name)
                db.add(role)
                db.commit()
                db.refresh(role)
                print(f"  ✓ Created Role: {role_name}")
            else:
                print(f"  • Role exists: {role_name}")
            roles_by_name[role_name] = role

        # 2. Seed Users
        for user_info in USERS_DATA:
            user = db.query(User).filter(User.username == user_info["username"]).first()
            if not user:
                role = roles_by_name[user_info["role"]]
                user = User(
                    username=user_info["username"],
                    password_hash=get_password_hash(user_info["password"]),
                    role_id=role.id,
                    is_active=True,
                )
                db.add(user)
                db.commit()
                print(f"  ✓ Created User: {user_info['username']} ({user_info['role']})")
            else:
                print(f"  • User exists: {user_info['username']}")

        # 3. Seed Campus Device Groups
        groups_by_name = {}
        for group_info in DEVICE_GROUPS_DATA:
            group = db.query(DeviceGroup).filter(DeviceGroup.name == group_info["name"]).first()
            if not group:
                group = DeviceGroup(
                    name=group_info["name"],
                    criticality_weight=group_info["criticality_weight"],
                )
                db.add(group)
                db.commit()
                db.refresh(group)
                print(f"  ✓ Created Device Group: {group_info['name']} (weight: {group_info['criticality_weight']})")
            else:
                print(f"  • Device Group exists: {group_info['name']}")
            groups_by_name[group_info["name"]] = group

        # 4. Seed Simulated Devices + Encrypted Credentials
        for dev_info in DEVICES_DATA:
            device = db.query(Device).filter(Device.hostname == dev_info["hostname"]).first()
            group = groups_by_name.get(dev_info["group_name"])
            if not group:
                continue

            if not device:
                device = Device(
                    hostname=dev_info["hostname"],
                    ip_address=dev_info["ip_address"],
                    vendor=dev_info["vendor"],
                    model=dev_info["model"],
                    device_group_id=group.id,
                    status=dev_info["status"],
                )
                db.add(device)
                db.commit()
                db.refresh(device)
                print(f"  ✓ Created Device: {device.hostname} ({device.ip_address}) in {dev_info['group_name']}")
            else:
                print(f"  • Device exists: {device.hostname}")

            # Store encrypted credentials via Vault service
            cred = store_device_credential(
                db=db,
                device_id=device.id,
                username=dev_info["username"],
                secret=dev_info["secret"],
                auth_type=dev_info["auth_type"],
            )
            print(f"    🔒 Encrypted credentials stored for {device.hostname} (ref: {cred.secret_ref[:35]}...)")

        # 5. Seed Baselines per §12
        admin_user = db.query(User).filter(User.username == "admin").first()
        admin_id = admin_user.id if admin_user else None

        BASELINES_SEED = [
            {
                "name": "Lab-Baseline-v3",
                "group_name": "Lab",
                "vendor": "frr",
                "rules": [
                    {
                        "key_path": "line.vty.transport_input",
                        "expected_value": "ssh",
                        "rule_type": "EXACT",
                        "severity_weight": 90,
                        "hard_compliance": True,
                    },
                    {
                        "key_path": "snmp.community.public.exists",
                        "expected_value": "false",
                        "rule_type": "MUST_NOT_EXIST",
                        "severity_weight": 95,
                        "hard_compliance": True,
                    },
                    {
                        "key_path": "interface.*.port_security.enabled",
                        "expected_value": "true",
                        "rule_type": "MUST_EXIST",
                        "severity_weight": 60,
                        "hard_compliance": False,
                    },
                    {
                        "key_path": "ntp.server",
                        "expected_value": "10.10.0.1",
                        "rule_type": "EXACT",
                        "severity_weight": 20,
                        "hard_compliance": False,
                    },
                ],
            },
            {
                "name": "Classroom-Baseline-v1",
                "group_name": "Classroom",
                "vendor": "cisco_ios",
                "rules": [
                    {
                        "key_path": "line.vty.transport_input",
                        "expected_value": "ssh",
                        "rule_type": "EXACT",
                        "severity_weight": 90,
                        "hard_compliance": True,
                    },
                    {
                        "key_path": "snmp.community.public.exists",
                        "expected_value": "false",
                        "rule_type": "MUST_NOT_EXIST",
                        "severity_weight": 95,
                        "hard_compliance": True,
                    },
                    {
                        "key_path": "interface.FastEthernet0/1.port_security.enabled",
                        "expected_value": "true",
                        "rule_type": "EXACT",
                        "severity_weight": 70,
                        "hard_compliance": False,
                    },
                    {
                        "key_path": "interface.FastEthernet0/2.port_security.enabled",
                        "expected_value": "true",
                        "rule_type": "EXACT",
                        "severity_weight": 70,
                        "hard_compliance": False,
                    },
                    {
                        "key_path": "ntp.server",
                        "expected_value": "10.10.0.1",
                        "rule_type": "EXACT",
                        "severity_weight": 20,
                        "hard_compliance": False,
                    },
                ],
            },
            {
                "name": "Hostel-Baseline-v1",
                "group_name": "Hostel",
                "vendor": "cisco_ios",
                "rules": [
                    {
                        "key_path": "line.vty.transport_input",
                        "expected_value": "ssh",
                        "rule_type": "EXACT",
                        "severity_weight": 90,
                        "hard_compliance": True,
                    },
                    {
                        "key_path": "snmp.community.public.exists",
                        "expected_value": "false",
                        "rule_type": "MUST_NOT_EXIST",
                        "severity_weight": 95,
                        "hard_compliance": True,
                    },
                    {
                        "key_path": "interface.FastEthernet0/1.port_security.enabled",
                        "expected_value": "true",
                        "rule_type": "EXACT",
                        "severity_weight": 70,
                        "hard_compliance": False,
                    },
                    {
                        "key_path": "ntp.server",
                        "expected_value": "10.10.0.1",
                        "rule_type": "EXACT",
                        "severity_weight": 20,
                        "hard_compliance": False,
                    },
                ],
            },
        ]

        for b_seed in BASELINES_SEED:
            existing_b = db.query(Baseline).filter(Baseline.name == b_seed["name"]).first()
            if not existing_b:
                group = groups_by_name.get(b_seed["group_name"])
                if group and admin_id:
                    b_create = BaselineCreate(
                        name=b_seed["name"],
                        device_group_id=group.id,
                        vendor=b_seed["vendor"],
                        rules=[BaselineRuleCreate(**r) for r in b_seed["rules"]],
                    )
                    b_obj = create_baseline(
                        db=db,
                        baseline_in=b_create,
                        creator_user_id=admin_id,
                        activate_on_create=True,
                    )
                    print(f"  ✓ Created Baseline: {b_obj.name} (v{b_obj.version}, {len(b_obj.rules)} rules) in {b_seed['group_name']}")
            else:
                print(f"  • Baseline exists: {b_seed['name']}")

        print("✨ Database seed completed successfully.")

    except Exception as e:
        db.rollback()
        print(f"❌ Error during seeding: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_database()
