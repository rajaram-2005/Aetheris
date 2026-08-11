"""Tests for Aetheris extra features: conversations, prompts, caching, files, export/import, plugins."""

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
# Conversation store unit tests
# =============================================================================

class TestConversationStore:
    def test_create_and_get(self):
        from aetheris.core.conversations import ConversationStore, ConversationCreate
        store = ConversationStore()
        body = ConversationCreate(title="Test Chat", tags=["test"], mode="engineering")
        conv = store.create(body)
        assert conv.title == "Test Chat"
        assert conv.mode == "engineering"
        retrieved = store.get(conv.id)
        assert retrieved is not None
        assert retrieved.id == conv.id

    def test_append_messages(self):
        from aetheris.core.conversations import ConversationStore, ConversationCreate, MessageIn
        store = ConversationStore()
        conv = store.create(ConversationCreate(title="Chat"))
        msg = store.append(conv.id, MessageIn(role="user", content="Hello"))
        assert msg is not None
        assert msg.role == "user"
        msg2 = store.append(conv.id, MessageIn(role="assistant", content="Hi there!"))
        assert msg2 is not None
        assert conv.message_count == 2

    def test_auto_title(self):
        from aetheris.core.conversations import ConversationStore, ConversationCreate, MessageIn
        store = ConversationStore()
        conv = store.create(ConversationCreate(title=""))
        store.append(conv.id, MessageIn(role="user", content="What is the capital of France?"))
        assert conv.title  # Auto-generated

    def test_search(self):
        from aetheris.core.conversations import ConversationStore, ConversationCreate, MessageIn
        store = ConversationStore()
        conv = store.create(ConversationCreate(title="Python Discussion"))
        store.append(conv.id, MessageIn(role="user", content="How do decorators work in Python?"))
        results = store.search("decorators")
        assert len(results) == 1

    def test_export_markdown(self):
        from aetheris.core.conversations import ConversationStore, ConversationCreate, MessageIn
        store = ConversationStore()
        conv = store.create(ConversationCreate(title="Export Test"))
        store.append(conv.id, MessageIn(role="user", content="Hello"))
        store.append(conv.id, MessageIn(role="assistant", content="Hi!"))
        md = store.export_conversation(conv.id, fmt="markdown")
        assert "**You**" in md
        assert "**Aetheris**" in md

    def test_delete(self):
        from aetheris.core.conversations import ConversationStore, ConversationCreate
        store = ConversationStore()
        conv = store.create(ConversationCreate(title="Del"))
        assert store.delete(conv.id) is True
        assert store.get(conv.id) is None


# =============================================================================
# Prompt library unit tests
# =============================================================================

class TestPromptLibrary:
    def test_create_template(self):
        from aetheris.core.prompts_library import PromptLibrary, PromptTemplateCreate
        lib = PromptLibrary()
        body = PromptTemplateCreate(
            name="greet", category="general",
            template="Hello {{name}}, welcome to {{place}}!",
            variables=["name", "place"],
            description="Greeting template",
        )
        tpl = lib.create(body)
        assert tpl.name == "greet"
        assert tpl.category == "general"

    def test_render_template(self):
        from aetheris.core.prompts_library import PromptLibrary, PromptTemplateCreate
        lib = PromptLibrary()
        tpl = lib.create(PromptTemplateCreate(
            name="greet", category="general",
            template="Hello {{name}}, welcome to {{place}}!",
            variables=["name", "place"],
        ))
        rendered = tpl.render({"name": "Alice", "place": "Aetheris"})
        assert "Hello Alice" in rendered
        assert "welcome to Aetheris" in rendered

    def test_render_unfilled_vars(self):
        from aetheris.core.prompts_library import PromptLibrary, PromptTemplateCreate
        lib = PromptLibrary()
        tpl = lib.create(PromptTemplateCreate(
            name="partial", category="general",
            template="Hello {{name}} from {{city}}!",
            variables=["name", "city"],
        ))
        rendered = tpl.render({"name": "Bob"})
        assert "Bob" in rendered
        assert "[city]" in rendered  # Unfilled variable

    def test_load_defaults(self):
        from aetheris.core.prompts_library import PromptLibrary
        lib = PromptLibrary()
        count = lib.load_defaults()
        assert count >= 5  # At least 6 default templates
        tpls = lib.list_templates()
        names = {t.name for t in tpls}
        assert "code-review" in names
        assert "summarize" in names
        assert "bug-report" in names

    def test_search_templates(self):
        from aetheris.core.prompts_library import PromptLibrary
        lib = PromptLibrary()
        lib.load_defaults()
        results = lib.search("code review")
        assert len(results) >= 1

    def test_list_by_category(self):
        from aetheris.core.prompts_library import PromptLibrary
        lib = PromptLibrary()
        lib.load_defaults()
        coding = lib.list_templates(category="coding")
        assert len(coding) >= 1

    def test_delete_template(self):
        from aetheris.core.prompts_library import PromptLibrary, PromptTemplateCreate
        lib = PromptLibrary()
        tpl = lib.create(PromptTemplateCreate(name="del", category="general", template="test"))
        assert lib.delete(tpl.id) is True


# =============================================================================
# Response cache unit tests
# =============================================================================

class TestResponseCache:
    def test_set_and_get(self):
        from aetheris.core.caching import ResponseCache
        cache = ResponseCache(default_ttl=60.0)
        key = "test_key_123"
        cache.set(key, {"result": "hello"})
        result = cache.get(key)
        assert result == {"result": "hello"}

    def test_cache_miss(self):
        from aetheris.core.caching import ResponseCache
        cache = ResponseCache()
        assert cache.get("nonexistent") is None

    def test_cache_expiry(self):
        from aetheris.core.caching import ResponseCache
        cache = ResponseCache(default_ttl=0.01)  # 10ms TTL
        cache.set("short", "value")
        time.sleep(0.02)
        assert cache.get("short") is None

    def test_make_key_deterministic(self):
        from aetheris.core.caching import ResponseCache
        key1 = ResponseCache.make_key("pro", "general", [{"role": "user", "content": "hi"}])
        key2 = ResponseCache.make_key("pro", "general", [{"role": "user", "content": "hi"}])
        assert key1 == key2

    def test_make_key_diff_content(self):
        from aetheris.core.caching import ResponseCache
        key1 = ResponseCache.make_key("pro", "general", [{"role": "user", "content": "hi"}])
        key2 = ResponseCache.make_key("pro", "general", [{"role": "user", "content": "bye"}])
        assert key1 != key2

    def test_stats(self):
        from aetheris.core.caching import ResponseCache
        cache = ResponseCache()
        cache.set("k1", "v1")
        cache.get("k1")  # hit
        cache.get("k2")  # miss
        stats = cache.stats()
        assert stats["hits"] == 1
        assert stats["misses"] == 1
        assert stats["hit_rate"] == 0.5

    def test_clear(self):
        from aetheris.core.caching import ResponseCache
        cache = ResponseCache()
        cache.set("k1", "v1")
        assert cache.clear() == 1
        assert cache.get("k1") is None


# =============================================================================
# File store unit tests
# =============================================================================

class TestFileStore:
    def test_put_and_get(self):
        from aetheris.core.files import FileStore
        store = FileStore()
        f = store.put("test.txt", b"Hello world", content_type="text/plain")
        assert f.filename == "test.txt"
        assert f.size_bytes == 11
        assert f.checksum  # SHA-256 hash
        retrieved = store.get(f.id)
        assert retrieved is not None
        assert retrieved.data == b"Hello world"

    def test_list_files(self):
        from aetheris.core.files import FileStore
        store = FileStore()
        store.put("a.txt", b"aaa", content_type="text/plain", directory="/docs")
        store.put("b.py", b"bbb", content_type="text/x-python", directory="/code")
        assert len(store.list_files()) == 2
        assert len(store.list_files(directory="/docs")) == 1

    def test_search_files(self):
        from aetheris.core.files import FileStore
        store = FileStore()
        store.put("config.yaml", b"key: value", content_type="text/yaml")
        results = store.search("config")
        assert len(results) == 1

    def test_delete_file(self):
        from aetheris.core.files import FileStore
        store = FileStore()
        f = store.put("del.txt", b"x")
        assert store.delete(f.id) is True

    def test_max_files_limit(self):
        from aetheris.core.files import FileStore
        store = FileStore(max_files=1)
        store.put("a.txt", b"a")
        with pytest.raises(ValueError):
            store.put("b.txt", b"b")

    def test_stats(self):
        from aetheris.core.files import FileStore
        store = FileStore()
        store.put("test.txt", b"hello", content_type="text/plain")
        stats = store.stats()
        assert stats["total_files"] == 1
        assert stats["total_bytes"] == 5


# =============================================================================
# Plugin manager unit tests
# =============================================================================

class TestPluginManager:
    def test_register_plugin(self):
        from aetheris.core.plugins import PluginManager, PluginRegister
        mgr = PluginManager()
        body = PluginRegister(name="my-tool", type="tool", module_path="json", description="JSON module as test")
        plugin = mgr.register(body)
        assert plugin.name == "my-tool"
        assert plugin.type == "tool"
        assert not plugin.loaded

    def test_list_plugins(self):
        from aetheris.core.plugins import PluginManager, PluginRegister
        mgr = PluginManager()
        mgr.register(PluginRegister(name="p1", type="tool", module_path="json"))
        mgr.register(PluginRegister(name="p2", type="middleware", module_path="json"))
        assert len(mgr.list_plugins()) == 2
        assert len(mgr.list_plugins(type="tool")) == 1

    def test_load_plugin_stdlib(self):
        from aetheris.core.plugins import PluginManager, PluginRegister
        mgr = PluginManager()
        plugin = mgr.register(PluginRegister(name="json", type="tool", module_path="json"))
        result = mgr.load(plugin.id)
        assert result is not None
        assert result.loaded is True

    def test_load_nonexistent_module(self):
        from aetheris.core.plugins import PluginManager, PluginRegister
        mgr = PluginManager()
        plugin = mgr.register(PluginRegister(name="bad", type="tool", module_path="nonexistent_module_xyz"))
        result = mgr.load(plugin.id)
        assert result is not None
        assert result.loaded is False
        assert result.error is not None

    def test_delete_plugin(self):
        from aetheris.core.plugins import PluginManager, PluginRegister
        mgr = PluginManager()
        plugin = mgr.register(PluginRegister(name="del", type="tool", module_path="json"))
        assert mgr.delete(plugin.id) is True

    def test_plugin_stats(self):
        from aetheris.core.plugins import PluginManager, PluginRegister
        mgr = PluginManager()
        mgr.register(PluginRegister(name="p1", type="tool", module_path="json"))
        stats = mgr.stats()
        assert stats["total"] == 1


# =============================================================================
# Export/Import unit tests
# =============================================================================

class TestExportImport:
    def test_export_empty(self):
        from aetheris.core.export_import import ExportRequest, export_bundle
        result = export_bundle(ExportRequest())
        assert result.bundle is not None
        assert "_meta" in result.bundle

    def test_export_with_workflows(self):
        from aetheris.core.export_import import ExportRequest, export_bundle
        from aetheris.core.workflows import get_workflow_engine, WorkflowCreate, WorkflowStep, TriggerConfig
        engine = get_workflow_engine()
        engine.create(WorkflowCreate(
            name="Export Test",
            steps=[WorkflowStep(name="s1", type="tool", tool_name="calculator")],
            trigger=TriggerConfig(type="manual"),
        ))
        result = export_bundle(ExportRequest(include_workflows=True))
        assert result.components.get("workflows", 0) >= 1
        assert "workflows" in result.bundle

    def test_import_bundle(self):
        from aetheris.core.export_import import ImportRequest, import_bundle
        bundle = {
            "prompt_templates": [
                {"name": "imported", "category": "test", "template": "Hello {{name}}", "variables": ["name"]},
            ],
        }
        result = import_bundle(ImportRequest(bundle=bundle))
        assert result.imported.get("prompt_templates", 0) >= 1


# =============================================================================
# API endpoint tests
# =============================================================================

class TestExtraEndpoints:
    def test_create_conversation(self):
        resp = client.post("/v1/conversations", json={"title": "Test", "mode": "general", "tags": ["test"]})
        assert resp.status_code == 201
        data = resp.json()
        assert data["title"] == "Test"
        assert "id" in data

    def test_list_conversations(self):
        resp = client.get("/v1/conversations")
        assert resp.status_code == 200

    def test_append_message(self):
        create = client.post("/v1/conversations", json={"title": "Chat"})
        conv_id = create.json()["id"]
        resp = client.post(f"/v1/conversations/{conv_id}/messages", json={"role": "user", "content": "Hello!"})
        assert resp.status_code == 200

    def test_get_conversation(self):
        create = client.post("/v1/conversations", json={"title": "Detail"})
        conv_id = create.json()["id"]
        client.post(f"/v1/conversations/{conv_id}/messages", json={"role": "user", "content": "Hi"})
        resp = client.get(f"/v1/conversations/{conv_id}")
        assert resp.status_code == 200
        assert len(resp.json()["messages"]) == 1

    def test_export_conversation(self):
        create = client.post("/v1/conversations", json={"title": "Export"})
        conv_id = create.json()["id"]
        resp = client.get(f"/v1/conversations/{conv_id}/export?format=markdown")
        assert resp.status_code == 200

    def test_search_conversations(self):
        resp = client.get("/v1/conversations/search?q=test")
        assert resp.status_code == 200

    def test_create_prompt(self):
        resp = client.post("/v1/prompts", json={
            "name": "test-greet", "category": "test",
            "template": "Hello {{name}}!", "variables": ["name"],
        })
        assert resp.status_code == 201

    def test_list_prompts(self):
        resp = client.get("/v1/prompts")
        assert resp.status_code == 200

    def test_load_default_prompts(self):
        resp = client.post("/v1/prompts/defaults")
        assert resp.status_code == 200
        assert resp.json()["loaded"] >= 5

    def test_render_prompt(self):
        create = client.post("/v1/prompts", json={
            "name": "render-test", "category": "test",
            "template": "Hi {{who}} from {{where}}!", "variables": ["who", "where"],
        })
        tpl_id = create.json()["id"]
        resp = client.post(f"/v1/prompts/{tpl_id}/render", json={"variables": {"who": "Alice", "where": "Earth"}})
        assert resp.status_code == 200
        assert "Alice" in resp.json()["rendered"]
        assert "Earth" in resp.json()["rendered"]

    def test_cache_stats(self):
        resp = client.get("/v1/cache")
        assert resp.status_code == 200
        assert "total_entries" in resp.json()

    def test_clear_cache(self):
        resp = client.delete("/v1/cache")
        assert resp.status_code == 200

    def test_list_files(self):
        resp = client.get("/v1/files")
        assert resp.status_code == 200

    def test_export_bundle(self):
        resp = client.post("/v1/export", json={"include_workflows": True, "include_prompts": True})
        assert resp.status_code == 200
        data = resp.json()
        assert "bundle" in data

    def test_import_bundle(self):
        resp = client.post("/v1/import", json={"bundle": {"prompt_templates": []}})
        assert resp.status_code == 200

    def test_register_plugin(self):
        resp = client.post("/v1/plugins", json={"name": "test", "type": "tool", "module_path": "json"})
        assert resp.status_code == 201

    def test_list_plugins(self):
        resp = client.get("/v1/plugins")
        assert resp.status_code == 200

    def test_discover_plugins(self):
        resp = client.post("/v1/plugins/discover")
        assert resp.status_code == 200


# =============================================================================
# Config tests
# =============================================================================

class TestExtraConfig:
    def test_cache_settings(self):
        from aetheris.core.config import settings
        assert settings.cache_enabled is True
        assert settings.cache_default_ttl == 300.0
        assert settings.cache_max_entries == 1000

    def test_file_settings(self):
        from aetheris.core.config import settings
        assert settings.file_storage_enabled is True

    def test_plugin_settings(self):
        from aetheris.core.config import settings
        assert settings.plugins_enabled is True

    def test_capability_report_includes_extras(self):
        from aetheris.core.config import settings
        report = settings.capability_report()
        assert "response_cache" in report
        assert "file_storage" in report
        assert "plugins" in report
