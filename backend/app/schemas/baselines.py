"""
Pydantic Schemas for Baseline Management Service
------------------------------------------------
Provides schemas for baseline definitions, rules, and hybrid YAML ingestion
per §8, §9, and §12 of architecture.md.
"""
from datetime import datetime
from typing import List, Optional
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, field_validator


VALID_RULE_TYPES = {"EXACT", "REGEX", "MUST_EXIST", "MUST_NOT_EXIST"}


class BaselineRuleBase(BaseModel):
    key_path: str = Field(..., description="Configuration key path, e.g. line.vty.transport_input")
    expected_value: str = Field(..., description="Expected value for comparison")
    rule_type: str = Field(
        ...,
        description="Rule type: EXACT, REGEX, MUST_EXIST, MUST_NOT_EXIST",
    )
    severity_weight: int = Field(
        ...,
        ge=1,
        le=100,
        description="Rule severity weight from 1 to 100",
    )
    hard_compliance: bool = Field(
        default=False,
        description="If True, violates baseline regardless of valid change ticket",
    )
    description: Optional[str] = Field(
        default=None,
        description="Security rationale or impact description (why this matters)",
    )

    @field_validator("rule_type")
    @classmethod
    def validate_rule_type(cls, v: str) -> str:
        v_upper = v.upper().strip()
        if v_upper not in VALID_RULE_TYPES:
            raise ValueError(f"rule_type must be one of {sorted(VALID_RULE_TYPES)}, got '{v}'")
        return v_upper


class BaselineRuleCreate(BaselineRuleBase):
    pass


class BaselineRuleOut(BaselineRuleBase):
    id: UUID
    baseline_id: UUID

    model_config = ConfigDict(from_attributes=True)


class BaselineCreate(BaseModel):
    name: Optional[str] = Field(None, description="Human-readable baseline name (e.g. Lab-Baseline-v3)")
    device_group_id: Optional[UUID] = Field(None, description="UUID of the targeted device group")
    device_group_name: Optional[str] = Field(None, description="Name of device group (used when parsing YAML)")
    vendor: Optional[str] = Field(None, description="Network vendor (e.g. cisco_ios, frr)")
    rules: Optional[List[BaselineRuleCreate]] = Field(default_factory=list, description="List of baseline rules")
    yaml_content: Optional[str] = Field(None, description="Raw YAML baseline string for hybrid YAML ingestion")


class BaselineOut(BaseModel):
    id: UUID
    name: str
    device_group_id: UUID
    device_group_name: Optional[str] = None
    vendor: str
    version: int
    is_active: bool
    created_by: UUID
    created_at: datetime
    rules_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class BaselineDetailOut(BaselineOut):
    rules: List[BaselineRuleOut] = []


class BaselineActivateResponse(BaseModel):
    message: str
    baseline_id: UUID
    activated: bool
    previous_active_baseline_id: Optional[UUID] = None
