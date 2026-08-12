"""Custom metadata schema for Aetheris.

Allows administrators to define custom fields (metadata schemas) that can be
attached to any entity type. Fields have a name, type, validation rules, and
optional default value. When an entity is created or updated, its custom
metadata is validated against the defined schema.

Supported field types: string, integer, float, boolean, enum, url, email.

Example:
    Define a "priority" field on conversations with type "enum" and
    values ["low", "medium", "high"]. Any conversation with custom metadata
    ``{"priority": "urgent"}`` would fail validation.
"""

from __future__ import annotations

import re
import time
import uuid
from dataclasses import dataclass
from threading import Lock
from typing import Any, Literal

from pydantic import BaseModel, Field


FieldType = Literal["string", "integer", "float", "boolean", "enum", "url", "email"]


class FieldDefinitionCreate(BaseModel):
    """Define a custom field schema."""
    name: str = Field(..., min_length=1, max_length=64, description="Field name (unique per entity type).")
    entity_type: str = Field(..., min_length=1, max_length=64, description="Entity type to attach to: conversation, prompt, file, etc.")
    field_type: FieldType = Field(..., description="Data type of the field.")
    description: str = Field(default="", max_length=500)
    required: bool = Field(default=False, description="Whether this field is required.")
    default_value: Any = Field(default=None, description="Default value if not provided.")
    enum_values: list[str] = Field(default_factory=list, description="Allowed values for enum type.")
    min_value: float | None = Field(default=None, description="Minimum value for numeric types.")
    max_value: float | None = Field(default=None, description="Maximum value for numeric types.")
    min_length: int | None = Field(default=None, description="Minimum length for string type.")
    max_length: int | None = Field(default=None, description="Maximum length for string type.")
    pattern: str = Field(default="", description="Regex pattern for string validation.")


class FieldDefinitionInfo(BaseModel):
    id: str
    name: str
    entity_type: str
    field_type: str
    description: str
    required: bool
    default_value: Any
    enum_values: list[str]
    min_value: float | None
    max_value: float | None
    min_length: int | None
    max_length: int | None
    pattern: str
    created_at: float


class ValidationError(BaseModel):
    field_name: str
    error: str


class ValidationResult(BaseModel):
    valid: bool
    errors: list[ValidationError]


# --- Internal -----------------------------------------------------------------

@dataclass
class _FieldDefinition:
    id: str
    name: str
    entity_type: str
    field_type: str
    description: str
    required: bool
    default_value: Any
    enum_values: list[str]
    min_value: float | None
    max_value: float | None
    min_length: int | None
    max_length: int | None
    pattern: str
    created_at: float

    def to_info(self) -> FieldDefinitionInfo:
        return FieldDefinitionInfo(
            id=self.id, name=self.name, entity_type=self.entity_type,
            field_type=self.field_type, description=self.description,
            required=self.required, default_value=self.default_value,
            enum_values=self.enum_values, min_value=self.min_value,
            max_value=self.max_value, min_length=self.min_length,
            max_length=self.max_length, pattern=self.pattern,
            created_at=self.created_at,
        )

    def validate(self, value: Any) -> str | None:
        """Validate a value against this field definition. Returns error message or None."""
        if value is None:
            if self.required:
                return f"Field '{self.name}' is required."
            return None

        if self.field_type == "string":
            if not isinstance(value, str):
                return f"Field '{self.name}' must be a string."
            if self.min_length is not None and len(value) < self.min_length:
                return f"Field '{self.name}' must be at least {self.min_length} characters."
            if self.max_length is not None and len(value) > self.max_length:
                return f"Field '{self.name}' must be at most {self.max_length} characters."
            if self.pattern and not re.match(self.pattern, value):
                return f"Field '{self.name}' does not match pattern '{self.pattern}'."

        elif self.field_type == "integer":
            if not isinstance(value, int) or isinstance(value, bool):
                return f"Field '{self.name}' must be an integer."
            if self.min_value is not None and value < self.min_value:
                return f"Field '{self.name}' must be >= {self.min_value}."
            if self.max_value is not None and value > self.max_value:
                return f"Field '{self.name}' must be <= {self.max_value}."

        elif self.field_type == "float":
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                return f"Field '{self.name}' must be a number."
            if self.min_value is not None and value < self.min_value:
                return f"Field '{self.name}' must be >= {self.min_value}."
            if self.max_value is not None and value > self.max_value:
                return f"Field '{self.name}' must be <= {self.max_value}."

        elif self.field_type == "boolean":
            if not isinstance(value, bool):
                return f"Field '{self.name}' must be a boolean."

        elif self.field_type == "enum":
            if str(value) not in self.enum_values:
                return f"Field '{self.name}' must be one of: {', '.join(self.enum_values)}."

        elif self.field_type == "url":
            if not isinstance(value, str) or not re.match(r"^https?://", value):
                return f"Field '{self.name}' must be a valid URL."

        elif self.field_type == "email":
            if not isinstance(value, str) or not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", value):
                return f"Field '{self.name}' must be a valid email."

        return None


# --- Manager ------------------------------------------------------------------

class CustomFieldManager:
    """Thread-safe custom field schema manager."""

    def __init__(self, max_fields: int = 500) -> None:
        self._fields: dict[str, _FieldDefinition] = {}
        self._lock = Lock()
        self._max = max_fields

    def create(self, body: FieldDefinitionCreate) -> _FieldDefinition:
        with self._lock:
            if len(self._fields) >= self._max:
                raise ValueError(f"Maximum of {self._max} field definitions reached.")
            # Check for duplicate name per entity type
            for f in self._fields.values():
                if f.name == body.name and f.entity_type == body.entity_type:
                    raise ValueError(f"Field '{body.name}' already defined for '{body.entity_type}'.")
            field_def = _FieldDefinition(
                id=f"cfdef_{uuid.uuid4().hex[:8]}",
                name=body.name, entity_type=body.entity_type,
                field_type=body.field_type, description=body.description,
                required=body.required, default_value=body.default_value,
                enum_values=body.enum_values, min_value=body.min_value,
                max_value=body.max_value, min_length=body.min_length,
                max_length=body.max_length, pattern=body.pattern,
                created_at=time.time(),
            )
            self._fields[field_def.id] = field_def
        return field_def

    def get(self, field_id: str) -> _FieldDefinition | None:
        with self._lock:
            return self._fields.get(field_id)

    def delete(self, field_id: str) -> bool:
        with self._lock:
            return self._fields.pop(field_id, None) is not None

    def list_fields(self, *, entity_type: str | None = None) -> list[_FieldDefinition]:
        with self._lock:
            fields = list(self._fields.values())
        if entity_type:
            fields = [f for f in fields if f.entity_type == entity_type]
        return sorted(fields, key=lambda f: (f.entity_type, f.name))

    def validate(self, entity_type: str, data: dict[str, Any]) -> ValidationResult:
        """Validate custom metadata against the defined schema."""
        with self._lock:
            schema = [f for f in self._fields.values() if f.entity_type == entity_type]
        errors = []
        for field_def in schema:
            value = data.get(field_def.name)
            error = field_def.validate(value)
            if error:
                errors.append(ValidationError(field_name=field_def.name, error=error))
        return ValidationResult(valid=len(errors) == 0, errors=errors)

    def apply_defaults(self, entity_type: str, data: dict[str, Any]) -> dict[str, Any]:
        """Apply default values for any missing fields."""
        with self._lock:
            schema = [f for f in self._fields.values() if f.entity_type == entity_type]
        result = dict(data)
        for field_def in schema:
            if field_def.name not in result and field_def.default_value is not None:
                result[field_def.name] = field_def.default_value
        return result

    def stats(self) -> dict[str, Any]:
        with self._lock:
            by_entity: dict[str, int] = {}
            for f in self._fields.values():
                by_entity[f.entity_type] = by_entity.get(f.entity_type, 0) + 1
            return {
                "total": len(self._fields),
                "by_entity_type": by_entity,
            }


_manager: CustomFieldManager | None = None


def get_custom_field_manager() -> CustomFieldManager:
    global _manager
    if _manager is None:
        _manager = CustomFieldManager()
    return _manager


__all__ = [
    "CustomFieldManager", "FieldDefinitionCreate", "FieldDefinitionInfo",
    "ValidationResult", "ValidationError", "get_custom_field_manager",
]
