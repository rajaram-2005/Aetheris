"""Tests for Aetheris v0.6.0 features: feature flags, API keys, playground, batch, activity, custom fields."""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from aetheris.main import app
from aetheris.core.rate_limiter import get_limiter


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    limiter = get_limiter()
    for cid in ("testclient", "127.0.0.1", "unknown"):
        limiter.reset(cid)
    yield
    for cid in ("testclient", "127.0.0.1", "unknown"):
        limiter.reset(cid)


client = TestClient(app)


# =============================================================================
# Feature flags unit tests
# =============================================================================

class TestFeatureFlags:
    def test_create_flag(self):
        from aetheris.core.feature_flags import FeatureFlagManager, FlagCreate
        mgr = FeatureFlagManager()
        flag = mgr.create(FlagCreate(key="new-ui", description="New UI rollout", enabled=True))
        assert flag.key == "new-ui"
        assert flag.enabled is True

    def test_evaluate_enabled_flag(self):
        from aetheris.core.feature_flags import FeatureFlagManager, FlagCreate
        mgr = FeatureFlagManager()
        mgr.create(FlagCreate(key="feat-a", enabled=True))
        assert mgr.evaluate("feat-a") is True

    def test_evaluate_disabled_flag(self):
        from aetheris.core.feature_flags import FeatureFlagManager, FlagCreate
        mgr = FeatureFlagManager()
        mgr.create(FlagCreate(key="feat-b", enabled=False))
        assert mgr.evaluate("feat-b") is False

    def test_evaluate_nonexistent_flag(self):
        from aetheris.core.feature_flags import FeatureFlagManager
        mgr = FeatureFlagManager()
        assert mgr.evaluate("no-such-flag") is False

    def test_rollout_percentage(self):
        from aetheris.core.feature_flags import FeatureFlagManager, FlagCreate
        mgr = FeatureFlagManager()
        mgr.create(FlagCreate(key="partial", rollout_percentage=50.0))
        # Deterministic: same user should always get same result
        result_a = mgr.evaluate("partial", {"id": "user_123"})
        result_b = mgr.evaluate("partial", {"id": "user_123"})
        assert result_a == result_b

    def test_overrides(self):
        from aetheris.core.feature_flags import FeatureFlagManager, FlagCreate
        mgr = FeatureFlagManager()
        mgr.create(FlagCreate(key="override-test", enabled=True, overrides={"vip_user": True, "blocked": False}))
        assert mgr.evaluate("override-test", {"id": "vip_user"}) is True
        assert mgr.evaluate("override-test", {"id": "blocked"}) is False

    def test_rules_match(self):
        from aetheris.core.feature_flags import FeatureFlagManager, FlagCreate
        mgr = FeatureFlagManager()
        mgr.create(FlagCreate(key="eng-only", enabled=True, rules=[{"field": "mode", "op": "eq", "value": "engineering"}]))
        assert mgr.evaluate("eng-only", {"mode": "engineering"}) is True

    def test_toggle_flag(self):
        from aetheris.core.feature_flags import FeatureFlagManager, FlagCreate
        mgr = FeatureFlagManager()
        flag = mgr.create(FlagCreate(key="toggle-me", enabled=True))
        toggled = mgr.toggle(flag.id)
        assert toggled.enabled is False
        toggled2 = mgr.toggle(flag.id)
        assert toggled2.enabled is True

    def test_duplicate_key_rejected(self):
        from aetheris.core.feature_flags import FeatureFlagManager, FlagCreate
        mgr = FeatureFlagManager()
        mgr.create(FlagCreate(key="dup", enabled=True))
        with pytest.raises(ValueError, match="already exists"):
            mgr.create(FlagCreate(key="dup", enabled=False))

    def test_list_flags(self):
        from aetheris.core.feature_flags import FeatureFlagManager, FlagCreate
        mgr = FeatureFlagManager()
        mgr.create(FlagCreate(key="on", enabled=True))
        mgr.create(FlagCreate(key="off", enabled=False))
        assert len(mgr.list_flags()) == 2
        assert len(mgr.list_flags(enabled=True)) == 1

    def test_delete_flag(self):
        from aetheris.core.feature_flags import FeatureFlagManager, FlagCreate
        mgr = FeatureFlagManager()
        flag = mgr.create(FlagCreate(key="del", enabled=True))
        assert mgr.delete(flag.id) is True

    def test_flag_stats(self):
        from aetheris.core.feature_flags import FeatureFlagManager, FlagCreate
        mgr = FeatureFlagManager()
        mgr.create(FlagCreate(key="s1", enabled=True))
        mgr.create(FlagCreate(key="s2", enabled=False))
        stats = mgr.stats()
        assert stats["total"] == 2
        assert stats["enabled"] == 1
        assert stats["disabled"] == 1

    def test_evaluate_all(self):
        from aetheris.core.feature_flags import FeatureFlagManager, FlagCreate
        mgr = FeatureFlagManager()
        mgr.create(FlagCreate(key="ea1", enabled=True))
        mgr.create(FlagCreate(key="ea2", enabled=False))
        results = mgr.evaluate_all()
        assert results["ea1"] is True
        assert results["ea2"] is False


# =============================================================================
# API key management unit tests
# =============================================================================

class TestApiKeyManager:
    def test_create_key(self):
        from aetheris.core.api_keys import ApiKeyManager, ApiKeyCreate
        mgr = ApiKeyManager()
        result = mgr.create(ApiKeyCreate(name="test-key", scopes=["chat:read"]))
        assert result.name == "test-key"
        assert result.key.startswith("aeth_")
        assert "chat:read" in result.scopes

    def test_verify_key(self):
        from aetheris.core.api_keys import ApiKeyManager, ApiKeyCreate
        mgr = ApiKeyManager()
        created = mgr.create(ApiKeyCreate(name="verify-test"))
        ak = mgr.verify(created.key)
        assert ak is not None
        assert ak.name == "verify-test"
        assert ak.usage_count == 1

    def test_verify_invalid_key(self):
        from aetheris.core.api_keys import ApiKeyManager
        mgr = ApiKeyManager()
        assert mgr.verify("aeth_invalid_key_12345") is None

    def test_revoke_key(self):
        from aetheris.core.api_keys import ApiKeyManager, ApiKeyCreate
        mgr = ApiKeyManager()
        created = mgr.create(ApiKeyCreate(name="revoke-test"))
        ak = mgr.get(created.id)
        assert mgr.revoke(created.id) is True
        # Revoked key should not verify
        assert mgr.verify(created.key) is None

    def test_rotate_key(self):
        from aetheris.core.api_keys import ApiKeyManager, ApiKeyCreate
        mgr = ApiKeyManager()
        created = mgr.create(ApiKeyCreate(name="rotate-test", scopes=["chat:read", "chat:write"]))
        new_key = mgr.rotate(created.id)
        assert new_key is not None
        assert new_key.key.startswith("aeth_")
        # Old key should be revoked
        assert mgr.verify(created.key) is None
        # New key should work
        assert mgr.verify(new_key.key) is not None

    def test_expiring_key(self):
        from aetheris.core.api_keys import ApiKeyManager, ApiKeyCreate
        mgr = ApiKeyManager()
        created = mgr.create(ApiKeyCreate(name="expiring", expires_in_seconds=1))
        ak = mgr.verify(created.key)
        assert ak is not None
        time.sleep(1.1)
        assert mgr.verify(created.key) is None

    def test_has_scope(self):
        from aetheris.core.api_keys import ApiKeyManager, ApiKeyCreate
        mgr = ApiKeyManager()
        created = mgr.create(ApiKeyCreate(name="scoped", scopes=["chat:read"]))
        ak = mgr.get(created.id)
        assert mgr.has_scope(created.id, "chat:read") is True
        assert mgr.has_scope(created.id, "admin:write") is False

    def test_key_stats(self):
        from aetheris.core.api_keys import ApiKeyManager, ApiKeyCreate
        mgr = ApiKeyManager()
        mgr.create(ApiKeyCreate(name="k1"))
        mgr.create(ApiKeyCreate(name="k2"))
        stats = mgr.stats()
        assert stats["total"] == 2
        assert stats["active"] == 2

    def test_list_keys(self):
        from aetheris.core.api_keys import ApiKeyManager, ApiKeyCreate
        mgr = ApiKeyManager()
        mgr.create(ApiKeyCreate(name="active-key"))
        created2 = mgr.create(ApiKeyCreate(name="revoked-key"))
        mgr.revoke(created2.id)
        assert len(mgr.list_keys()) == 2
        assert len(mgr.list_keys(revoked=False)) == 1

    def test_delete_key(self):
        from aetheris.core.api_keys import ApiKeyManager, ApiKeyCreate
        mgr = ApiKeyManager()
        created = mgr.create(ApiKeyCreate(name="del"))
        assert mgr.delete(created.id) is True


# =============================================================================
# Playground history unit tests
# =============================================================================

class TestPlaygroundStore:
    def test_create_entry(self):
        from aetheris.core.playground import PlaygroundStore, PlaygroundEntryCreate
        store = PlaygroundStore()
        entry = store.create(PlaygroundEntryCreate(
            model="pro", mode="general",
            messages=[{"role": "user", "content": "Hello"}],
            response_content="Hi there!", prompt_tokens=10, response_tokens=5,
        ))
        assert entry.model == "pro"
        assert entry.response_content == "Hi there!"

    def test_list_entries(self):
        from aetheris.core.playground import PlaygroundStore, PlaygroundEntryCreate
        store = PlaygroundStore()
        store.create(PlaygroundEntryCreate(model="pro", messages=[{"role": "user", "content": "A"}]))
        store.create(PlaygroundEntryCreate(model="quick", messages=[{"role": "user", "content": "B"}]))
        assert len(store.list_entries()) == 2
        assert len(store.list_entries(model="pro")) == 1

    def test_search_entries(self):
        from aetheris.core.playground import PlaygroundStore, PlaygroundEntryCreate
        store = PlaygroundStore()
        store.create(PlaygroundEntryCreate(
            model="pro", messages=[{"role": "user", "content": "Explain quantum computing"}],
            response_content="Quantum computing uses qubits...",
        ))
        results = store.search("quantum")
        assert len(results) >= 1

    def test_replay_request(self):
        from aetheris.core.playground import PlaygroundStore, PlaygroundEntryCreate
        store = PlaygroundStore()
        entry = store.create(PlaygroundEntryCreate(
            model="pro", mode="engineering", temperature=0.3,
            messages=[{"role": "user", "content": "Write code"}],
            system_prompt="You are an expert coder.",
        ))
        replay = store.get_replay_request(entry.id)
        assert replay is not None
        assert replay["model"] == "pro"
        assert replay["temperature"] == 0.3
        assert replay["system_prompt"] == "You are an expert coder."

    def test_fingerprint_dedup(self):
        from aetheris.core.playground import PlaygroundStore, PlaygroundEntryCreate
        store = PlaygroundStore()
        e1 = store.create(PlaygroundEntryCreate(model="pro", messages=[{"role": "user", "content": "Hello"}]))
        e2 = store.create(PlaygroundEntryCreate(model="pro", messages=[{"role": "user", "content": "Hello"}]))
        assert e1.fingerprint == e2.fingerprint  # Same request = same fingerprint

    def test_delete_entry(self):
        from aetheris.core.playground import PlaygroundStore, PlaygroundEntryCreate
        store = PlaygroundStore()
        entry = store.create(PlaygroundEntryCreate(model="pro", messages=[]))
        assert store.delete(entry.id) is True

    def test_playground_stats(self):
        from aetheris.core.playground import PlaygroundStore, PlaygroundEntryCreate
        store = PlaygroundStore()
        store.create(PlaygroundEntryCreate(model="pro", messages=[], prompt_tokens=100, response_tokens=50))
        stats = store.stats()
        assert stats["total"] == 1
        assert stats["total_tokens"] == 150


# =============================================================================
# Batch operations unit tests
# =============================================================================

class TestBatchOperations:
    def test_single_create_conversation(self):
        from aetheris.core.batch import execute_batch, BatchRequest, BatchOperation
        result = execute_batch(BatchRequest(
            operations=[BatchOperation(id="op1", type="create_conversation", params={"title": "Batch Test", "mode": "general"})],
        ))
        assert result.status == "completed"
        assert len(result.operations) == 1
        assert result.operations[0].status == "success"
        assert "id" in result.operations[0].result

    def test_multiple_operations(self):
        from aetheris.core.batch import execute_batch, BatchRequest, BatchOperation
        result = execute_batch(BatchRequest(
            operations=[
                BatchOperation(id="op1", type="create_conversation", params={"title": "Conv 1"}),
                BatchOperation(id="op2", type="create_conversation", params={"title": "Conv 2"}),
            ],
        ))
        assert result.status == "completed"
        assert len(result.operations) == 2
        assert all(op.status == "success" for op in result.operations)

    def test_dependent_operations(self):
        from aetheris.core.batch import execute_batch, BatchRequest, BatchOperation
        result = execute_batch(BatchRequest(
            operations=[
                BatchOperation(id="op1", type="create_conversation", params={"title": "With Msg"}),
                BatchOperation(id="op2", type="append_message", params={"conversation_id": "${op1.id}", "role": "user", "content": "Hello"}, depends_on=["op1"]),
            ],
        ))
        assert result.status == "completed"
        assert result.operations[0].status == "success"
        assert result.operations[1].status == "success"

    def test_unknown_operation_type(self):
        from aetheris.core.batch import execute_batch, BatchRequest, BatchOperation
        result = execute_batch(BatchRequest(
            operations=[BatchOperation(type="unknown_op", params={})],
        ))
        assert result.status == "failed"

    def test_stop_on_error(self):
        from aetheris.core.batch import execute_batch, BatchRequest, BatchOperation
        result = execute_batch(BatchRequest(
            operations=[
                BatchOperation(type="create_conversation", params={"title": "OK"}),
                BatchOperation(type="unknown_op", params={}),
                BatchOperation(type="create_conversation", params={"title": "Should skip"}),
            ],
            stop_on_error=True,
        ))
        assert result.status == "partial"

    def test_rollback_on_error(self):
        from aetheris.core.batch import execute_batch, BatchRequest, BatchOperation
        result = execute_batch(BatchRequest(
            operations=[
                BatchOperation(type="create_conversation", params={"title": "Rollback me"}),
                BatchOperation(type="unknown_op", params={}),
            ],
            rollback_on_error=True,
        ))
        assert result.status == "rolled_back"


# =============================================================================
# Activity timeline unit tests
# =============================================================================

class TestActivityTimeline:
    def test_record_activity(self):
        from aetheris.core.activity import ActivityManager, ActivityCreate
        mgr = ActivityManager()
        entry = mgr.record(ActivityCreate(type="request", action="create", actor="user_1", target_type="conversation", detail="Created conversation"))
        assert entry.type == "request"
        assert entry.actor == "user_1"

    def test_list_activities(self):
        from aetheris.core.activity import ActivityManager, ActivityCreate
        mgr = ActivityManager()
        mgr.record(ActivityCreate(type="request", action="create", actor="user_1"))
        mgr.record(ActivityCreate(type="tool_call", action="execute", actor="system"))
        assert len(mgr.list_activities()) == 2
        assert len(mgr.list_activities(type="request")) == 1
        assert len(mgr.list_activities(actor="system")) == 1

    def test_search_activities(self):
        from aetheris.core.activity import ActivityManager, ActivityCreate
        mgr = ActivityManager()
        mgr.record(ActivityCreate(type="error", action="fail", detail="Database connection timeout"))
        results = mgr.search("timeout")
        assert len(results) >= 1

    def test_count_by_type(self):
        from aetheris.core.activity import ActivityManager, ActivityCreate
        mgr = ActivityManager()
        mgr.record(ActivityCreate(type="request", action="create"))
        mgr.record(ActivityCreate(type="request", action="update"))
        mgr.record(ActivityCreate(type="error", action="fail"))
        counts = mgr.count_by_type()
        assert counts["request"] == 2
        assert counts["error"] == 1

    def test_time_filtering(self):
        from aetheris.core.activity import ActivityManager, ActivityCreate
        mgr = ActivityManager()
        mgr.record(ActivityCreate(type="request", action="old"))
        cutoff = time.time()
        mgr.record(ActivityCreate(type="request", action="new"))
        recent = mgr.list_activities(since=cutoff)
        assert len(recent) >= 1
        assert recent[0].action == "new"

    def test_severity_filter(self):
        from aetheris.core.activity import ActivityManager, ActivityCreate
        mgr = ActivityManager()
        mgr.record(ActivityCreate(type="error", action="fail", severity="error"))
        mgr.record(ActivityCreate(type="request", action="ok", severity="info"))
        assert len(mgr.list_activities(severity="error")) == 1

    def test_activity_stats(self):
        from aetheris.core.activity import ActivityManager, ActivityCreate
        mgr = ActivityManager()
        mgr.record(ActivityCreate(type="request", action="create", severity="info"))
        stats = mgr.stats()
        assert stats["total"] == 1

    def test_clear_activities(self):
        from aetheris.core.activity import ActivityManager, ActivityCreate
        mgr = ActivityManager()
        mgr.record(ActivityCreate(type="request", action="create"))
        count = mgr.clear()
        assert count == 1
        assert len(mgr.list_activities()) == 0


# =============================================================================
# Custom fields unit tests
# =============================================================================

class TestCustomFields:
    def test_create_field(self):
        from aetheris.core.custom_fields import CustomFieldManager, FieldDefinitionCreate
        mgr = CustomFieldManager()
        fd = mgr.create(FieldDefinitionCreate(name="priority", entity_type="conversation", field_type="enum", enum_values=["low", "medium", "high"]))
        assert fd.name == "priority"
        assert fd.field_type == "enum"

    def test_validate_valid_data(self):
        from aetheris.core.custom_fields import CustomFieldManager, FieldDefinitionCreate
        mgr = CustomFieldManager()
        mgr.create(FieldDefinitionCreate(name="priority", entity_type="conversation", field_type="enum", enum_values=["low", "medium", "high"]))
        result = mgr.validate("conversation", {"priority": "high"})
        assert result.valid is True
        assert len(result.errors) == 0

    def test_validate_invalid_data(self):
        from aetheris.core.custom_fields import CustomFieldManager, FieldDefinitionCreate
        mgr = CustomFieldManager()
        mgr.create(FieldDefinitionCreate(name="priority", entity_type="conversation", field_type="enum", enum_values=["low", "medium", "high"]))
        result = mgr.validate("conversation", {"priority": "urgent"})
        assert result.valid is False
        assert len(result.errors) == 1

    def test_validate_required_field(self):
        from aetheris.core.custom_fields import CustomFieldManager, FieldDefinitionCreate
        mgr = CustomFieldManager()
        mgr.create(FieldDefinitionCreate(name="owner", entity_type="conversation", field_type="string", required=True))
        result = mgr.validate("conversation", {})
        assert result.valid is False
        assert any("required" in e.error for e in result.errors)

    def test_validate_integer_range(self):
        from aetheris.core.custom_fields import CustomFieldManager, FieldDefinitionCreate
        mgr = CustomFieldManager()
        mgr.create(FieldDefinitionCreate(name="score", entity_type="conversation", field_type="integer", min_value=0, max_value=100))
        assert mgr.validate("conversation", {"score": 50}).valid is True
        assert mgr.validate("conversation", {"score": 150}).valid is False

    def test_validate_string_pattern(self):
        from aetheris.core.custom_fields import CustomFieldManager, FieldDefinitionCreate
        mgr = CustomFieldManager()
        mgr.create(FieldDefinitionCreate(name="code", entity_type="file", field_type="string", pattern=r"^[A-Z]{2}-\d{4}$"))
        assert mgr.validate("file", {"code": "AB-1234"}).valid is True
        assert mgr.validate("file", {"code": "invalid"}).valid is False

    def test_validate_email(self):
        from aetheris.core.custom_fields import CustomFieldManager, FieldDefinitionCreate
        mgr = CustomFieldManager()
        mgr.create(FieldDefinitionCreate(name="contact", entity_type="connection", field_type="email"))
        assert mgr.validate("connection", {"contact": "user@example.com"}).valid is True
        assert mgr.validate("connection", {"contact": "not-an-email"}).valid is False

    def test_validate_boolean(self):
        from aetheris.core.custom_fields import CustomFieldManager, FieldDefinitionCreate
        mgr = CustomFieldManager()
        mgr.create(FieldDefinitionCreate(name="active", entity_type="connection", field_type="boolean"))
        assert mgr.validate("connection", {"active": True}).valid is True
        assert mgr.validate("connection", {"active": "yes"}).valid is False

    def test_apply_defaults(self):
        from aetheris.core.custom_fields import CustomFieldManager, FieldDefinitionCreate
        mgr = CustomFieldManager()
        mgr.create(FieldDefinitionCreate(name="priority", entity_type="conversation", field_type="enum", enum_values=["low", "medium", "high"], default_value="medium"))
        result = mgr.apply_defaults("conversation", {})
        assert result["priority"] == "medium"

    def test_duplicate_field_rejected(self):
        from aetheris.core.custom_fields import CustomFieldManager, FieldDefinitionCreate
        mgr = CustomFieldManager()
        mgr.create(FieldDefinitionCreate(name="dup", entity_type="conversation", field_type="string"))
        with pytest.raises(ValueError, match="already defined"):
            mgr.create(FieldDefinitionCreate(name="dup", entity_type="conversation", field_type="string"))

    def test_list_fields(self):
        from aetheris.core.custom_fields import CustomFieldManager, FieldDefinitionCreate
        mgr = CustomFieldManager()
        mgr.create(FieldDefinitionCreate(name="f1", entity_type="conversation", field_type="string"))
        mgr.create(FieldDefinitionCreate(name="f2", entity_type="prompt", field_type="integer"))
        assert len(mgr.list_fields()) == 2
        assert len(mgr.list_fields(entity_type="conversation")) == 1

    def test_delete_field(self):
        from aetheris.core.custom_fields import CustomFieldManager, FieldDefinitionCreate
        mgr = CustomFieldManager()
        fd = mgr.create(FieldDefinitionCreate(name="del", entity_type="conversation", field_type="string"))
        assert mgr.delete(fd.id) is True

    def test_custom_fields_stats(self):
        from aetheris.core.custom_fields import CustomFieldManager, FieldDefinitionCreate
        mgr = CustomFieldManager()
        mgr.create(FieldDefinitionCreate(name="s1", entity_type="conversation", field_type="string"))
        stats = mgr.stats()
        assert stats["total"] == 1


# =============================================================================
# API endpoint tests
# =============================================================================

class TestFeatureFlagEndpoints:
    def test_create_flag(self):
        resp = client.post("/v1/flags", json={"key": "test-flag", "description": "A test flag", "enabled": True})
        assert resp.status_code == 201
        assert resp.json()["key"] == "test-flag"

    def test_list_flags(self):
        resp = client.get("/v1/flags")
        assert resp.status_code == 200

    def test_evaluate_flags(self):
        resp = client.get("/v1/flags/evaluate?context=user_1")
        assert resp.status_code == 200
        assert "evaluations" in resp.json()

    def test_toggle_flag(self):
        create = client.post("/v1/flags", json={"key": "toggle-endpoint", "enabled": True})
        flag_id = create.json()["id"]
        resp = client.post(f"/v1/flags/{flag_id}/toggle")
        assert resp.status_code == 200
        assert resp.json()["enabled"] is False

    def test_delete_flag(self):
        create = client.post("/v1/flags", json={"key": "del-flag", "enabled": True})
        flag_id = create.json()["id"]
        resp = client.delete(f"/v1/flags/{flag_id}")
        assert resp.status_code == 200


class TestApiKeyEndpoints:
    def test_create_key(self):
        resp = client.post("/v1/keys", json={"name": "test-api-key", "scopes": ["chat:read"]})
        assert resp.status_code == 201
        data = resp.json()
        assert data["key"].startswith("aeth_")
        assert "chat:read" in data["scopes"]

    def test_list_keys(self):
        resp = client.get("/v1/keys")
        assert resp.status_code == 200
        assert "available_scopes" in resp.json()

    def test_revoke_key(self):
        create = client.post("/v1/keys", json={"name": "revoke-me"})
        key_id = create.json()["id"]
        resp = client.post(f"/v1/keys/{key_id}/revoke")
        assert resp.status_code == 200

    def test_rotate_key(self):
        create = client.post("/v1/keys", json={"name": "rotate-me", "scopes": ["chat:read"]})
        key_id = create.json()["id"]
        resp = client.post(f"/v1/keys/{key_id}/rotate")
        assert resp.status_code == 200
        assert resp.json()["key"].startswith("aeth_")


class TestPlaygroundEndpoints:
    def test_record_entry(self):
        resp = client.post("/v1/playground", json={
            "model": "pro", "mode": "general",
            "messages": [{"role": "user", "content": "Hello"}],
            "response_content": "Hi!", "prompt_tokens": 5, "response_tokens": 3,
        })
        assert resp.status_code == 201

    def test_list_entries(self):
        resp = client.get("/v1/playground")
        assert resp.status_code == 200

    def test_search_playground(self):
        resp = client.get("/v1/playground/search?q=hello")
        assert resp.status_code == 200

    def test_replay(self):
        create = client.post("/v1/playground", json={
            "model": "pro", "messages": [{"role": "user", "content": "Replay me"}],
            "temperature": 0.5, "system_prompt": "Be helpful.",
        })
        entry_id = create.json()["id"]
        resp = client.get(f"/v1/playground/{entry_id}/replay")
        assert resp.status_code == 200
        assert resp.json()["temperature"] == 0.5


class TestBatchEndpoint:
    def test_batch_create(self):
        resp = client.post("/v1/batch", json={
            "operations": [
                {"id": "op1", "type": "create_conversation", "params": {"title": "Batch 1"}},
                {"id": "op2", "type": "create_conversation", "params": {"title": "Batch 2"}},
            ],
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "completed"
        assert len(data["operations"]) == 2

    def test_batch_with_dependencies(self):
        resp = client.post("/v1/batch", json={
            "operations": [
                {"id": "op1", "type": "create_conversation", "params": {"title": "Parent"}},
                {"id": "op2", "type": "append_message", "params": {"conversation_id": "${op1.id}", "role": "user", "content": "Hello"}, "depends_on": ["op1"]},
            ],
        })
        assert resp.status_code == 200
        assert resp.json()["status"] == "completed"


class TestActivityEndpoints:
    def test_record_activity(self):
        resp = client.post("/v1/activity", json={
            "type": "request", "action": "create", "actor": "user_1",
            "target_type": "conversation", "detail": "Created a conversation",
        })
        assert resp.status_code == 201

    def test_list_activities(self):
        resp = client.get("/v1/activity")
        assert resp.status_code == 200

    def test_search_activities(self):
        resp = client.get("/v1/activity/search?q=created")
        assert resp.status_code == 200


class TestCustomFieldEndpoints:
    def test_create_field(self):
        resp = client.post("/v1/fields", json={
            "name": "priority", "entity_type": "conversation", "field_type": "enum",
            "enum_values": ["low", "medium", "high"], "required": False,
        })
        assert resp.status_code == 201

    def test_list_fields(self):
        resp = client.get("/v1/fields")
        assert resp.status_code == 200

    def test_validate_metadata(self):
        resp = client.post("/v1/fields", json={
            "name": "status", "entity_type": "file", "field_type": "enum",
            "enum_values": ["draft", "published", "archived"],
        })
        assert resp.status_code == 201
        resp = client.post("/v1/fields/validate?entity_type=file", json={"status": "draft"})
        assert resp.status_code == 200
        assert resp.json()["valid"] is True


# =============================================================================
# Config tests for v0.6.0
# =============================================================================

class TestV06Config:
    def test_feature_flags_settings(self):
        from aetheris.core.config import settings
        assert settings.feature_flags_enabled is True
        assert settings.feature_flags_max == 200

    def test_api_key_settings(self):
        from aetheris.core.config import settings
        assert settings.api_key_management_enabled is True
        assert settings.api_keys_max == 100

    def test_playground_settings(self):
        from aetheris.core.config import settings
        assert settings.playground_enabled is True
        assert settings.playground_max_entries == 10_000

    def test_batch_settings(self):
        from aetheris.core.config import settings
        assert settings.batch_enabled is True

    def test_activity_settings(self):
        from aetheris.core.config import settings
        assert settings.activity_log_enabled is True
        assert settings.activity_log_max_entries == 20_000

    def test_custom_fields_settings(self):
        from aetheris.core.config import settings
        assert settings.custom_fields_enabled is True
        assert settings.custom_fields_max == 500

    def test_capability_report_includes_v06(self):
        from aetheris.core.config import settings
        report = settings.capability_report()
        for key in ("feature_flags", "api_key_management", "playground", "batch_operations", "activity_log", "custom_fields"):
            assert key in report, f"Missing capability: {key}"
            assert report[key] is True, f"Capability {key} should be True"
