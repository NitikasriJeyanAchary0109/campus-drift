"""
Database seed script:
Creates default roles, 3 users (one per role), and 5 campus device groups.
Idempotent — safely checks for existing records before inserting.
"""
import os
import sys

# Ensure backend root is on sys.path
backend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "backend"))
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

from app.core.database import SessionLocal, Base, engine
from app.core.security import get_password_hash
from app.models.users import Role, User
from app.models.devices import DeviceGroup

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
        for group_info in DEVICE_GROUPS_DATA:
            group = db.query(DeviceGroup).filter(DeviceGroup.name == group_info["name"]).first()
            if not group:
                group = DeviceGroup(
                    name=group_info["name"],
                    criticality_weight=group_info["criticality_weight"],
                )
                db.add(group)
                db.commit()
                print(f"  ✓ Created Device Group: {group_info['name']} (weight: {group_info['criticality_weight']})")
            else:
                print(f"  • Device Group exists: {group_info['name']}")

        print("✨ Database seed completed successfully.")

    except Exception as e:
        db.rollback()
        print(f"❌ Error during seeding: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_database()
