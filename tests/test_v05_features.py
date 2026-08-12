"""Tests for Aetheris v0.5.0 features: analytics, presets, bookmarks, notifications, global search, snapshots."""

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
# Analytics engine unit tests
# =============================================================================

class TestAnalyticsEngine:
    def test_record_and_overview(self):
        from aetheris.core.analytics import AnalyticsEngine
        engine = AnalyticsEngine()
        engine.record(model="pro", mode="general", prompt_tokens=100, completion_tokens=50, latency_ms=200.0)
        engine.record(model="quick", mode="general", prompt_tokens=50, completion_tokens=25, latency_ms=100.0)
        overview = engine.overview(window="all")
        assert overview.total_requests == 2
        assert overview.total_tokens == 225  # 100+50 + 50+25
        assert overview.total_prompt_tokens == 150
        assert overview.total_completion_tokens == 75
        assert overview.estimated_cost_usd > 0

    def test_error_rate(self):
        from aetheris.core.analytics import AnalyticsEngine
        engine = AnalyticsEngine()
        engine.record(model="pro", mode="general", is_error=False)
        engine.record(model="pro", mode="general", is_error=True)
        overview = engine.overview(window="all")
        assert overview.error_rate == 0.5

    def test_token_stats(self):
        from aetheris.core.analytics import AnalyticsEngine
        engine = AnalyticsEngine()
        engine.record(model="pro", mode="general", prompt_tokens=100, completion_tokens=50)
        stats = engine.token_stats(window="all")
        assert "by_model" in stats
        assert "pro" in stats["by_model"]

    def test_time_series(self):
        from aetheris.core.analytics import AnalyticsEngine
        engine = AnalyticsEngine()
        engine.record(model="pro", mode="general")
        engine.record(model="pro", mode="general")
        ts = engine.request_time_series(window="all", bucket="1m")
        assert "series" in ts
        assert ts["bucket_seconds"] == 60

    def test_cost_breakdown(self):
        from aetheris.core.analytics import AnalyticsEngine
        engine = AnalyticsEngine()
        engine.record(model="pro", mode="general", prompt_tokens=1000, completion_tokens=500)
        costs = engine.cost_breakdown(window="all")
        assert "by_model" in costs
        assert costs["total_cost_usd"] > 0

    def test_top_queries(self):
        from aetheris.core.analytics import AnalyticsEngine
        engine = AnalyticsEngine()
        engine.record(query="python decorators")
        engine.record(query="python decorators")
        engine.record(query="rust lifetimes")
        top = engine.top_queries(limit=10)
        assert len(top) >= 2
        assert top[0]["query"] == "python decorators"
        assert top[0]["count"] == 2

    def test_top_tools(self):
        from aetheris.core.analytics import AnalyticsEngine
        engine = AnalyticsEngine()
        engine.record(tool_name="calculator")
        engine.record(tool_name="calculator")
        engine.record(tool_name="web_search")
        top = engine.top_tools(limit=10)
        assert len(top) >= 2
        assert top[0]["tool"] == "calculator"

    def test_recent_errors(self):
        from aetheris.core.analytics import AnalyticsEngine
        engine = AnalyticsEngine()
        engine.record(is_error=True, error_detail="timeout")
        engine.record(is_error=True, error_detail="rate limit")
        errors = engine.recent_errors(limit=10)
        assert len(errors) == 2

    def test_analytics_stats(self):
        from aetheris.core.analytics import AnalyticsEngine
        engine = AnalyticsEngine()
        engine.record(model="pro", mode="general")
        stats = engine.stats()
        assert stats["total_records"] == 1


# =============================================================================
# Preset store unit tests
# =============================================================================

class TestPresetStore:
    def test_create_preset(self):
        from aetheris.core.presets import PresetStore, PresetCreate
        store = PresetStore()
        body = PresetCreate(name="my-preset", description="Test preset", model="pro", temperature=0.8)
        preset = store.create(body)
        assert preset.name == "my-preset"
        assert preset.temperature == 0.8

    def test_get_preset(self):
        from aetheris.core.presets import PresetStore, PresetCreate
        store = PresetStore()
        preset = store.create(PresetCreate(name="test", model="pro"))
        retrieved = store.get(preset.id)
        assert retrieved is not None
        assert retrieved.id == preset.id

    def test_get_by_name(self):
        from aetheris.core.presets import PresetStore, PresetCreate
        store = PresetStore()
        store.create(PresetCreate(name="findme", model="pro"))
        found = store.get_by_name("findme")
        assert found is not None
        assert found.name == "findme"

    def test_load_defaults(self):
        from aetheris.core.presets import PresetStore
        store = PresetStore()
        count = store.load_defaults()
        assert count >= 5
        presets = store.list_presets()
        names = {p.name for p in presets}
        assert "quick" in names
        assert "code" in names
        assert "sovereign" in names

    def test_cannot_delete_builtin(self):
        from aetheris.core.presets import PresetStore
        store = PresetStore()
        store.load_defaults()
        quick = store.get_by_name("quick")
        assert quick is not None
        with pytest.raises(ValueError, match="built-in"):
            store.delete(quick.id)

    def test_delete_custom_preset(self):
        from aetheris.core.presets import PresetStore, PresetCreate
        store = PresetStore()
        preset = store.create(PresetCreate(name="del", model="pro"))
        assert store.delete(preset.id) is True
        assert store.get(preset.id) is None

    def test_list_by_tag(self):
        from aetheris.core.presets import PresetStore
        store = PresetStore()
        store.load_defaults()
        builtin = store.list_presets(tag="builtin")
        assert len(builtin) >= 5

    def test_preset_stats(self):
        from aetheris.core.presets import PresetStore
        store = PresetStore()
        store.load_defaults()
        stats = store.stats()
        assert stats["builtin"] >= 5
        assert stats["custom"] == 0


# =============================================================================
# Bookmark store unit tests
# =============================================================================

class TestBookmarkStore:
    def test_create_bookmark(self):
        from aetheris.core.bookmarks import BookmarkStore, BookmarkCreate
        store = BookmarkStore()
        bm = store.create(BookmarkCreate(entity_type="conversation", entity_id="conv_123", notes="Important chat"))
        assert bm.entity_type == "conversation"
        assert bm.entity_id == "conv_123"
        assert bm.collection == "default"

    def test_bookmark_with_collection(self):
        from aetheris.core.bookmarks import BookmarkStore, BookmarkCreate
        store = BookmarkStore()
        bm = store.create(BookmarkCreate(entity_type="prompt", entity_id="ptpl_456", collection="favorites"))
        assert bm.collection == "favorites"

    def test_duplicate_bookmark_rejected(self):
        from aetheris.core.bookmarks import BookmarkStore, BookmarkCreate
        store = BookmarkStore()
        store.create(BookmarkCreate(entity_type="conversation", entity_id="conv_123", collection="default"))
        with pytest.raises(ValueError, match="Already bookmarked"):
            store.create(BookmarkCreate(entity_type="conversation", entity_id="conv_123", collection="default"))

    def test_list_bookmarks(self):
        from aetheris.core.bookmarks import BookmarkStore, BookmarkCreate
        store = BookmarkStore()
        store.create(BookmarkCreate(entity_type="conversation", entity_id="c1", collection="work"))
        store.create(BookmarkCreate(entity_type="prompt", entity_id="p1", collection="work"))
        store.create(BookmarkCreate(entity_type="file", entity_id="f1", collection="personal"))
        assert len(store.list_bookmarks()) == 3
        assert len(store.list_bookmarks(collection="work")) == 2
        assert len(store.list_bookmarks(entity_type="prompt")) == 1

    def test_list_collections(self):
        from aetheris.core.bookmarks import BookmarkStore, BookmarkCreate
        store = BookmarkStore()
        store.create(BookmarkCreate(entity_type="conversation", entity_id="c1", collection="work"))
        store.create(BookmarkCreate(entity_type="prompt", entity_id="p1", collection="personal"))
        colls = store.list_collections()
        names = {c.name for c in colls}
        assert "work" in names
        assert "personal" in names

    def test_delete_collection(self):
        from aetheris.core.bookmarks import BookmarkStore, BookmarkCreate
        store = BookmarkStore()
        store.create(BookmarkCreate(entity_type="conversation", entity_id="c1", collection="delme"))
        store.create(BookmarkCreate(entity_type="prompt", entity_id="p1", collection="delme"))
        count = store.delete_collection("delme")
        assert count == 2

    def test_is_bookmarked(self):
        from aetheris.core.bookmarks import BookmarkStore, BookmarkCreate
        store = BookmarkStore()
        assert not store.is_bookmarked("conversation", "c1")
        store.create(BookmarkCreate(entity_type="conversation", entity_id="c1"))
        assert store.is_bookmarked("conversation", "c1")

    def test_bookmark_stats(self):
        from aetheris.core.bookmarks import BookmarkStore, BookmarkCreate
        store = BookmarkStore()
        store.create(BookmarkCreate(entity_type="conversation", entity_id="c1"))
        store.create(BookmarkCreate(entity_type="prompt", entity_id="p1"))
        stats = store.stats()
        assert stats["total_bookmarks"] == 2
        assert stats["by_entity_type"]["conversation"] == 1


# =============================================================================
# Notification manager unit tests
# =============================================================================

class TestNotificationManager:
    def test_create_notification(self):
        from aetheris.core.notifications import NotificationManager, NotificationCreate
        mgr = NotificationManager()
        n = mgr.create(NotificationCreate(type="info", title="Test", message="Hello"))
        assert n.type == "info"
        assert n.title == "Test"
        assert not n.read

    def test_mark_read(self):
        from aetheris.core.notifications import NotificationManager, NotificationCreate
        mgr = NotificationManager()
        n = mgr.create(NotificationCreate(type="info", title="Unread"))
        assert not n.read
        marked = mgr.mark_read(n.id)
        assert marked.read is True
        assert marked.read_at is not None

    def test_mark_all_read(self):
        from aetheris.core.notifications import NotificationManager, NotificationCreate
        mgr = NotificationManager()
        mgr.create(NotificationCreate(type="info", title="A"))
        mgr.create(NotificationCreate(type="warning", title="B"))
        count = mgr.mark_all_read()
        assert count == 2
        assert mgr.unread_count() == 0

    def test_list_with_filters(self):
        from aetheris.core.notifications import NotificationManager, NotificationCreate
        mgr = NotificationManager()
        mgr.create(NotificationCreate(type="error", title="E1", priority=5))
        mgr.create(NotificationCreate(type="info", title="I1", priority=1))
        mgr.create(NotificationCreate(type="error", title="E2", priority=8))
        errors = mgr.list_notifications(type="error")
        assert len(errors) == 2
        high = mgr.list_notifications(priority_min=5)
        assert len(high) == 2

    def test_unread_count(self):
        from aetheris.core.notifications import NotificationManager, NotificationCreate
        mgr = NotificationManager()
        mgr.create(NotificationCreate(type="info", title="A"))
        mgr.create(NotificationCreate(type="info", title="B"))
        assert mgr.unread_count() == 2
        mgr.mark_read(mgr.list_notifications()[0].id)
        assert mgr.unread_count() == 1

    def test_delete_notification(self):
        from aetheris.core.notifications import NotificationManager, NotificationCreate
        mgr = NotificationManager()
        n = mgr.create(NotificationCreate(type="info", title="Del"))
        assert mgr.delete(n.id) is True
        assert mgr.get(n.id) is None

    def test_notification_stats(self):
        from aetheris.core.notifications import NotificationManager, NotificationCreate
        mgr = NotificationManager()
        mgr.create(NotificationCreate(type="info", title="A"))
        mgr.create(NotificationCreate(type="error", title="B"))
        stats = mgr.stats()
        assert stats["total"] == 2
        assert stats["unread"] == 2


# =============================================================================
# Global search unit tests
# =============================================================================

class TestGlobalSearch:
    def test_search_with_no_data(self):
        from aetheris.core.global_search import global_search, GlobalSearchQuery
        # Search for something very unlikely to exist
        result = global_search(GlobalSearchQuery(q="zzz_nonexistent_xyz_12345"))
        assert result.total == 0
        assert result.query == "zzz_nonexistent_xyz_12345"

    def test_search_conversations(self):
        from aetheris.core.global_search import global_search, GlobalSearchQuery
        # Create a conversation via the API so it's in the singleton store
        resp = client.post("/v1/conversations", json={"title": "Python Decorators Guide"})
        conv_id = resp.json()["id"]
        client.post(f"/v1/conversations/{conv_id}/messages", json={"role": "user", "content": "How do decorators work?"})
        result = global_search(GlobalSearchQuery(q="Python Decorators", types=["conversation"]))
        assert result.total >= 1
        assert any(item.entity_type == "conversation" for item in result.items)

    def test_search_with_type_filter(self):
        from aetheris.core.global_search import global_search, GlobalSearchQuery
        result = global_search(GlobalSearchQuery(q="test", types=["prompt"]))
        # Should only return prompt results
        for item in result.items:
            assert item.entity_type == "prompt"

    def test_simple_score(self):
        from aetheris.core.global_search import _simple_score
        assert _simple_score("python decorators", "python") > 0
        assert _simple_score("python decorators", "python") >= 0.8
        assert _simple_score("rust lifetimes", "python") == 0.0


# =============================================================================
# Snapshot manager unit tests
# =============================================================================

class TestSnapshotManager:
    def test_create_conversation_snapshot(self):
        from aetheris.core.conversations import ConversationStore, ConversationCreate, MessageIn
        from aetheris.core.snapshots import SnapshotManager, SnapshotCreate
        store = ConversationStore()
        conv = store.create(ConversationCreate(title="Snapshot Test"))
        store.append(conv.id, MessageIn(role="user", content="Hello"))
        # Monkey-patch the global store
        import aetheris.core.conversations as conv_mod
        original = conv_mod._store
        conv_mod._store = store
        try:
            mgr = SnapshotManager()
            snap = mgr.create(SnapshotCreate(target_type="conversation", target_id=conv.id, label="v1"))
            assert snap.target_type == "conversation"
            assert snap.target_id == conv.id
            assert snap.state is not None
            assert "messages" in snap.state
            assert len(snap.state["messages"]) == 1
        finally:
            conv_mod._store = original

    def test_create_prompt_snapshot(self):
        from aetheris.core.prompts_library import PromptLibrary, PromptTemplateCreate
        from aetheris.core.snapshots import SnapshotManager, SnapshotCreate
        lib = PromptLibrary()
        tpl = lib.create(PromptTemplateCreate(name="greet", category="general", template="Hello {{name}}!", variables=["name"]))
        # Monkey-patch the global library
        import aetheris.core.prompts_library as prompts_mod
        original = prompts_mod._library
        prompts_mod._library = lib
        try:
            mgr = SnapshotManager()
            snap = mgr.create(SnapshotCreate(target_type="prompt", target_id=tpl.id, label="v1"))
            assert snap.target_type == "prompt"
            assert snap.state["template"] == "Hello {{name}}!"
        finally:
            prompts_mod._library = original

    def test_diff_snapshots(self):
        from aetheris.core.conversations import ConversationStore, ConversationCreate, MessageIn
        from aetheris.core.snapshots import SnapshotManager, SnapshotCreate
        store = ConversationStore()
        conv = store.create(ConversationCreate(title="Diff Test"))
        import aetheris.core.conversations as conv_mod
        original = conv_mod._store
        conv_mod._store = store
        try:
            mgr = SnapshotManager()
            snap_a = mgr.create(SnapshotCreate(target_type="conversation", target_id=conv.id, label="before"))
            # Add a message
            store.append(conv.id, MessageIn(role="user", content="New message"))
            snap_b = mgr.create(SnapshotCreate(target_type="conversation", target_id=conv.id, label="after"))
            diff = mgr.diff(snap_a.id, snap_b.id)
            assert diff.target_id == conv.id
            assert len(diff.added) > 0 or len(diff.removed) > 0
        finally:
            conv_mod._store = original

    def test_list_snapshots(self):
        from aetheris.core.conversations import ConversationStore, ConversationCreate
        from aetheris.core.snapshots import SnapshotManager, SnapshotCreate
        store = ConversationStore()
        conv = store.create(ConversationCreate(title="List Test"))
        import aetheris.core.conversations as conv_mod
        original = conv_mod._store
        conv_mod._store = store
        try:
            mgr = SnapshotManager()
            mgr.create(SnapshotCreate(target_type="conversation", target_id=conv.id, label="s1"))
            mgr.create(SnapshotCreate(target_type="conversation", target_id=conv.id, label="s2"))
            snaps = mgr.list_snapshots(target_id=conv.id)
            assert len(snaps) == 2
        finally:
            conv_mod._store = original

    def test_delete_snapshot(self):
        from aetheris.core.conversations import ConversationStore, ConversationCreate
        from aetheris.core.snapshots import SnapshotManager, SnapshotCreate
        store = ConversationStore()
        conv = store.create(ConversationCreate(title="Del Test"))
        import aetheris.core.conversations as conv_mod
        original = conv_mod._store
        conv_mod._store = store
        try:
            mgr = SnapshotManager()
            snap = mgr.create(SnapshotCreate(target_type="conversation", target_id=conv.id))
            assert mgr.delete(snap.id) is True
        finally:
            conv_mod._store = original

    def test_snapshot_stats(self):
        from aetheris.core.snapshots import SnapshotManager
        mgr = SnapshotManager()
        stats = mgr.stats()
        assert stats["total"] == 0


# =============================================================================
# API endpoint tests
# =============================================================================

class TestAnalyticsEndpoints:
    def test_overview(self):
        resp = client.get("/v1/analytics/overview?window=all")
        assert resp.status_code == 200
        data = resp.json()
        assert "total_requests" in data

    def test_token_stats(self):
        resp = client.get("/v1/analytics/tokens?window=all")
        assert resp.status_code == 200

    def test_request_time_series(self):
        resp = client.get("/v1/analytics/requests?window=all&bucket=1m")
        assert resp.status_code == 200

    def test_cost_breakdown(self):
        resp = client.get("/v1/analytics/costs?window=all")
        assert resp.status_code == 200

    def test_top_queries(self):
        resp = client.get("/v1/analytics/top-queries")
        assert resp.status_code == 200

    def test_top_tools(self):
        resp = client.get("/v1/analytics/top-tools")
        assert resp.status_code == 200

    def test_errors(self):
        resp = client.get("/v1/analytics/errors")
        assert resp.status_code == 200

    def test_analytics_stats(self):
        resp = client.get("/v1/analytics/stats")
        assert resp.status_code == 200


class TestPresetEndpoints:
    def test_create_preset(self):
        resp = client.post("/v1/presets", json={
            "name": "test-preset", "description": "A test", "model": "pro", "temperature": 0.9,
        })
        assert resp.status_code == 201
        assert resp.json()["name"] == "test-preset"

    def test_list_presets(self):
        resp = client.get("/v1/presets")
        assert resp.status_code == 200

    def test_search_presets(self):
        resp = client.get("/v1/presets/search?q=test")
        assert resp.status_code == 200

    def test_load_defaults(self):
        resp = client.post("/v1/presets/defaults")
        assert resp.status_code == 200
        assert resp.json()["loaded"] >= 5

    def test_get_preset(self):
        create = client.post("/v1/presets", json={"name": "getme", "model": "quick"})
        assert create.status_code == 201
        preset_id = create.json()["id"]
        resp = client.get(f"/v1/presets/{preset_id}")
        assert resp.status_code == 200

    def test_delete_preset(self):
        create = client.post("/v1/presets", json={"name": "deleteme", "model": "pro"})
        preset_id = create.json()["id"]
        resp = client.delete(f"/v1/presets/{preset_id}")
        assert resp.status_code == 200


class TestBookmarkEndpoints:
    def test_create_bookmark(self):
        resp = client.post("/v1/bookmarks", json={
            "entity_type": "conversation", "entity_id": "conv_test", "notes": "Important",
        })
        assert resp.status_code == 201

    def test_list_bookmarks(self):
        resp = client.get("/v1/bookmarks")
        assert resp.status_code == 200

    def test_list_collections(self):
        resp = client.get("/v1/bookmarks/collections")
        assert resp.status_code == 200

    def test_delete_bookmark(self):
        create = client.post("/v1/bookmarks", json={"entity_type": "prompt", "entity_id": "del_bm"})
        bm_id = create.json()["id"]
        resp = client.delete(f"/v1/bookmarks/{bm_id}")
        assert resp.status_code == 200

    def test_delete_collection(self):
        client.post("/v1/bookmarks", json={"entity_type": "file", "entity_id": "f1", "collection": "delcoll"})
        resp = client.delete("/v1/bookmarks/collections/delcoll")
        assert resp.status_code == 200


class TestNotificationEndpoints:
    def test_create_notification(self):
        resp = client.post("/v1/notifications", json={
            "type": "info", "title": "Test Notification", "message": "Something happened",
        })
        assert resp.status_code == 201

    def test_list_notifications(self):
        resp = client.get("/v1/notifications")
        assert resp.status_code == 200
        data = resp.json()
        assert "data" in data
        assert "unread_count" in data

    def test_mark_read(self):
        create = client.post("/v1/notifications", json={"type": "warning", "title": "Read me"})
        notif_id = create.json()["id"]
        resp = client.post(f"/v1/notifications/{notif_id}/read")
        assert resp.status_code == 200
        assert resp.json()["read"] is True

    def test_mark_all_read(self):
        client.post("/v1/notifications", json={"type": "info", "title": "A"})
        client.post("/v1/notifications", json={"type": "info", "title": "B"})
        resp = client.post("/v1/notifications/read-all")
        assert resp.status_code == 200
        assert resp.json()["marked_read"] >= 0

    def test_delete_notification(self):
        create = client.post("/v1/notifications", json={"type": "info", "title": "Del"})
        notif_id = create.json()["id"]
        resp = client.delete(f"/v1/notifications/{notif_id}")
        assert resp.status_code == 200


class TestGlobalSearchEndpoint:
    def test_search(self):
        resp = client.post("/v1/search", json={"q": "test", "types": ["conversation", "prompt"], "limit": 10})
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert "by_type" in data


class TestSnapshotEndpoints:
    def test_create_snapshot(self):
        # First create a conversation to snapshot
        conv = client.post("/v1/conversations", json={"title": "Snap Test"})
        conv_id = conv.json()["id"]
        resp = client.post("/v1/snapshots", json={"target_type": "conversation", "target_id": conv_id, "label": "v1"})
        assert resp.status_code == 201
        assert resp.json()["target_type"] == "conversation"

    def test_list_snapshots(self):
        resp = client.get("/v1/snapshots")
        assert resp.status_code == 200

    def test_get_snapshot(self):
        conv = client.post("/v1/conversations", json={"title": "Get Snap"})
        conv_id = conv.json()["id"]
        create = client.post("/v1/snapshots", json={"target_type": "conversation", "target_id": conv_id, "label": "v1"})
        snap_id = create.json()["id"]
        resp = client.get(f"/v1/snapshots/{snap_id}")
        assert resp.status_code == 200

    def test_diff_snapshots(self):
        conv = client.post("/v1/conversations", json={"title": "Diff Snap"})
        conv_id = conv.json()["id"]
        snap_a = client.post("/v1/snapshots", json={"target_type": "conversation", "target_id": conv_id, "label": "before"})
        snap_a_id = snap_a.json()["id"]
        # Add a message to change state
        client.post(f"/v1/conversations/{conv_id}/messages", json={"role": "user", "content": "Changed"})
        snap_b = client.post("/v1/snapshots", json={"target_type": "conversation", "target_id": conv_id, "label": "after"})
        snap_b_id = snap_b.json()["id"]
        resp = client.get(f"/v1/snapshots/{snap_a_id}/diff/{snap_b_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert "summary" in data

    def test_rollback_snapshot(self):
        conv = client.post("/v1/conversations", json={"title": "Rollback Snap"})
        conv_id = conv.json()["id"]
        create = client.post("/v1/snapshots", json={"target_type": "conversation", "target_id": conv_id, "label": "v1"})
        snap_id = create.json()["id"]
        resp = client.post(f"/v1/snapshots/{snap_id}/rollback")
        assert resp.status_code == 200

    def test_delete_snapshot(self):
        conv = client.post("/v1/conversations", json={"title": "Del Snap"})
        conv_id = conv.json()["id"]
        create = client.post("/v1/snapshots", json={"target_type": "conversation", "target_id": conv_id})
        snap_id = create.json()["id"]
        resp = client.delete(f"/v1/snapshots/{snap_id}")
        assert resp.status_code == 200


# =============================================================================
# Config tests for v0.5.0
# =============================================================================

class TestV05Config:
    def test_analytics_settings(self):
        from aetheris.core.config import settings
        assert settings.analytics_enabled is True
        assert settings.analytics_max_records == 50_000

    def test_preset_settings(self):
        from aetheris.core.config import settings
        assert settings.presets_enabled is True
        assert settings.presets_max == 100

    def test_bookmark_settings(self):
        from aetheris.core.config import settings
        assert settings.bookmarks_enabled is True
        assert settings.bookmarks_max == 1000

    def test_notification_settings(self):
        from aetheris.core.config import settings
        assert settings.notifications_enabled is True
        assert settings.notifications_max == 5000

    def test_snapshot_settings(self):
        from aetheris.core.config import settings
        assert settings.snapshots_enabled is True
        assert settings.snapshots_max == 500

    def test_capability_report_includes_v05(self):
        from aetheris.core.config import settings
        report = settings.capability_report()
        assert "analytics" in report
        assert "presets" in report
        assert "bookmarks" in report
        assert "notifications" in report
        assert "snapshots" in report
        assert report["analytics"] is True
        assert report["presets"] is True
        assert report["bookmarks"] is True
        assert report["notifications"] is True
        assert report["snapshots"] is True
