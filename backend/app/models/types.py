import uuid
from typing import Any
from sqlalchemy import types
from sqlalchemy.dialects import postgresql
import json


class StringArrayType(types.TypeDecorator):
    """
    Platform-independent array of strings.
    Uses PostgreSQL ARRAY(Text) when running against Postgres,
    and JSON when running on SQLite or other engines.
    """
    impl = types.JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(postgresql.ARRAY(types.Text()))
        else:
            return dialect.type_descriptor(types.JSON())

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if dialect.name == "postgresql":
            return list(value)
        return json.dumps(list(value))

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if dialect.name == "postgresql":
            return list(value)
        if isinstance(value, str):
            return json.loads(value)
        return list(value)


def JSONB_compat():
    """Returns PostgreSQL JSONB with generic JSON fallback for SQLite."""
    return types.JSON().with_variant(postgresql.JSONB, "postgresql")
