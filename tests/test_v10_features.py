"""Tests for Aetheris v0.10.0 features.

Features covered:
* Cost tracking (cost_tracking.py)
* Autosave drafts with conflict detection (drafts.py)
* Keyboard shortcuts & binding profiles (shortcuts.py)
* Inline comments / annotation threads (comments.py)
* Recurring schedules / cron tasks (recurrence.py)
* Embeddings & vector search (embeddings.py)
"""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from aetheris.main import app
from aetheris.core.rate_limiter import get_limiter


@pytest.fixture(autouse=True)
def _reset():
    limiter = get_limiter()
    for cid in ("testclient", "127.0.0.1", "unknown"):
        limiter.reset(cid)
    # reset module singletons between tests to avoid cross-contamination
    import aetheris.core.cost_tracking as ct
    import aetheris.core.drafts as dr
    import aetheris.core.shortcuts as sc
    import aetheris.core.comments as cm
    import aetheris.core.recurrence as rc
    import aetheris.core.embeddings as em
    ct._tracker = ct.CostTracker()
    dr._manager = dr.DraftManager()
    sc._manager = sc.ShortcutManager()
    cm._manager = cm.CommentManager()
    rc._manager = rc.RecurrenceManager()
    em._mgr = em.EmbeddingManager()
    yield
    ct._tracker = ct.CostTracker()
    dr._manager = dr.DraftManager()
    sc._manager = sc.ShortcutManager()
    cm._manager = cm.CommentManager()
    rc._manager = rc.RecurrenceManager()
    em._mgr = em.EmbeddingManager()


client = TestClient(app)


# =============================================================================
# Unit tests — Cost tracking
# =============================================================================

class TestCostTrackingUnit:
    def test_rate_seeded(self):
        from aetheris.core.cost_tracking import get_cost_tracker, UsageRecord
        ct = get_cost_tracker()
        rates = ct.list_rates()
        models = {r["model"] for r in rates}
        assert "aetheris-pro" in models
        assert "aetheris-ultra" in models

    def test_record_computes_cost_from_rate(self):
        from aetheris.core.cost_tracking import get_cost_tracker, UsageRecord
        ct = get_cost_tracker()
        ct.record(UsageRecord(client_id="alice", model="aetheris-pro", prompt_tokens=1000, completion_tokens=2000))
        snap = ct.snapshot(client_id="alice")
        # pro: 0.003 / 1k prompt, 0.012 / 1k completion → 0.003 + 0.024 = 0.027
        assert snap.total_cost_usd == pytest.approx(0.003 + 0.024, abs=1e-6)

    def test_budget_alert(self):
        from aetheris.core.cost_tracking import get_cost_tracker, UsageRecord, Budget
        ct = get_cost_tracker()
        ct.set_budget(Budget(client_id="alice", daily_usd=1.0, alert_threshold=0.5))
        for _ in range(20):
            ct.record(UsageRecord(client_id="alice", model="aetheris-pro", prompt_tokens=10_000, completion_tokens=20_000))
        alerts = ct.list_alerts(client_id="alice")
        assert any(a["budget_period"] == "daily" for a in alerts)

    def test_custom_rate_overrides(self):
        from aetheris.core.cost_tracking import get_cost_tracker, CostRate, UsageRecord
        ct = get_cost_tracker()
        ct.set_rate(CostRate(model="custom-x", prompt_per_1k=1.0, completion_per_1k=2.0))
        ct.record(UsageRecord(client_id="bob", model="custom-x", prompt_tokens=1000, completion_tokens=500))
        snap = ct.snapshot(client_id="bob")
        assert snap.total_cost_usd == pytest.approx(2.0, abs=1e-6)


# =============================================================================
# Unit tests — Drafts
# =============================================================================

class TestDraftsUnit:
    def test_create_and_get(self):
        from aetheris.core.drafts import get_draft_manager, DraftCreate, _detail
        mgr = get_draft_manager()
        d = mgr.create(DraftCreate(entity_type="conversation", title="My draft", content="hello", client_id="u1"))
        got = mgr.get(d.id)
        assert got is not None and got.title == "My draft"
        assert got.revision == 1

    def test_revision_increments(self):
        from aetheris.core.drafts import get_draft_manager, DraftCreate, DraftUpdate
        mgr = get_draft_manager()
        d = mgr.create(DraftCreate(entity_type="document", title="t", content="v1"))
        mgr.update(d.id, DraftUpdate(content="v2", client_id="u2"))
        mgr.update(d.id, DraftUpdate(content="v3", client_id="u1"))
        assert mgr.get(d.id).revision == 3

    def test_conflict_detection(self):
        from aetheris.core.drafts import get_draft_manager, DraftCreate, DraftUpdate
        mgr = get_draft_manager()
        d = mgr.create(DraftCreate(entity_type="conversation", title="t", content="v1"))
        mgr.update(d.id, DraftUpdate(content="v2", client_id="a"))
        # stale expected_revision should conflict
        _, conflict = mgr.update(d.id, DraftUpdate(content="v3", expected_revision=1, client_id="b"))
        assert conflict is not None
        assert conflict["current_revision"] == 2

    def test_revert(self):
        from aetheris.core.drafts import get_draft_manager, DraftCreate, DraftUpdate
        mgr = get_draft_manager()
        d = mgr.create(DraftCreate(entity_type="document", title="t", content="v1"))
        mgr.update(d.id, DraftUpdate(content="v2"))
        mgr.revert(d.id, 1, client_id="system")
        assert mgr.get(d.id).current.content == "v1"


# =============================================================================
# Unit tests — Shortcuts
# =============================================================================

class TestShortcutsUnit:
    def test_builtin_profiles(self):
        from aetheris.core.shortcuts import get_shortcut_manager
        mgr = get_shortcut_manager()
        names = {p.name for p in mgr.list_profiles()}
        assert "default" in names and "vim" in names

    def test_resolve(self):
        from aetheris.core.shortcuts import get_shortcut_manager
        mgr = get_shortcut_manager()
        res = mgr.resolve("ctrl+k")
        assert res.found is True
        assert res.command == "command-palette"

    def test_create_profile_and_bind(self):
        from aetheris.core.shortcuts import get_shortcut_manager, ProfileCreate, ShortcutBinding
        mgr = get_shortcut_manager()
        p = mgr.create_profile(ProfileCreate(name="my", description="mine"))
        mgr.bind(p.id, ShortcutBinding(command="new-chat", keys="ctrl+alt+n"))
        res = mgr.resolve("ctrl+alt+n", profile=p.id)
        assert res.found and res.command == "new-chat"

    def test_clone_builtin(self):
        from aetheris.core.shortcuts import get_shortcut_manager
        mgr = get_shortcut_manager()
        cloned = mgr.clone("profile_default", "my-default")
        assert cloned.name == "my-default"
        assert len(cloned.bindings) > 5

    def test_active_profile_switch(self):
        from aetheris.core.shortcuts import get_shortcut_manager
        mgr = get_shortcut_manager()
        mgr.set_active("vim")
        assert mgr.stats()["active_profile"] != "profile_default"


# =============================================================================
# Unit tests — Comments
# =============================================================================

class TestCommentsUnit:
    def test_thread_with_replies(self):
        from aetheris.core.comments import get_comment_manager, CommentCreate
        mgr = get_comment_manager()
        root = mgr.create(CommentCreate(entity_type="conversation", entity_id="c1", body="Looks good", author="alice"))
        reply = mgr.create(CommentCreate(entity_type="conversation", entity_id="c1", thread_id=root.id, body="Thanks!", author="bob"))
        thread = mgr.thread(root.thread_id)
        assert len(thread) == 2
        assert reply.parent_id == root.id

    def test_resolve_thread(self):
        from aetheris.core.comments import get_comment_manager, CommentCreate, CommentUpdate
        mgr = get_comment_manager()
        root = mgr.create(CommentCreate(entity_type="document", entity_id="d1", body="typo", author="rev"))
        mgr.create(CommentCreate(entity_type="document", entity_id="d1", thread_id=root.id, body="fixing", author="ed"))
        mgr.update(root.id, CommentUpdate(resolved=True), actor="ed")
        for c in mgr.thread(root.thread_id):
            assert c.resolved

    def test_reaction_toggle(self):
        from aetheris.core.comments import get_comment_manager, CommentCreate, ReactionCreate
        mgr = get_comment_manager()
        c = mgr.create(CommentCreate(entity_type="canvas", entity_id="x", body="hi", author="u"))
        mgr.react(c.id, ReactionCreate(emoji="👍", user="a"))
        mgr.react(c.id, ReactionCreate(emoji="👍", user="b"))
        mgr.react(c.id, ReactionCreate(emoji="👍", user="a"))  # toggle off
        assert mgr.get(c.id).reactions["👍"] == ["b"]

    def test_mentions_extracted(self):
        from aetheris.core.comments import get_comment_manager, CommentCreate, _info
        mgr = get_comment_manager()
        c = mgr.create(CommentCreate(entity_type="conversation", entity_id="c", body="Hey @alice, see this.", author="bob"))
        info = _info(c)
        assert "alice" in info.mentions

    def test_stats(self):
        from aetheris.core.comments import get_comment_manager, CommentCreate
        mgr = get_comment_manager()
        mgr.create(CommentCreate(entity_type="c", entity_id="1", body="a", author="u"))
        mgr.create(CommentCreate(entity_type="c", entity_id="2", body="b", author="u"))
        s = mgr.stats()
        assert s["total_comments"] == 2 and s["threads"] == 2


# =============================================================================
# Unit tests — Recurrence
# =============================================================================

class TestRecurrenceUnit:
    def test_interval_next(self):
        from aetheris.core.recurrence import _next_after, RecurrenceRule
        now = time.time()
        rule = RecurrenceRule(kind="interval", interval_seconds=60)
        nxt = _next_after(rule, now)
        assert nxt is not None
        assert 55 < (nxt - now) < 65

    def test_daily_next(self):
        from aetheris.core.recurrence import _next_after, RecurrenceRule
        from datetime import datetime, timezone
        now = datetime(2025, 1, 1, 12, 0, tzinfo=timezone.utc).timestamp()
        rule = RecurrenceRule(kind="daily", times=["09:00"])
        nxt = _next_after(rule, now)
        dt = datetime.fromtimestamp(nxt, tz=timezone.utc)
        assert dt.hour == 9 and dt.day == 2

    def test_business_days_skips_weekend(self):
        from aetheris.core.recurrence import _next_after, RecurrenceRule
        from datetime import datetime, timezone
        # 2025-01-04 is a Saturday
        sat = datetime(2025, 1, 4, 12, 0, tzinfo=timezone.utc).timestamp()
        rule = RecurrenceRule(kind="business_days", times=["10:00"])
        nxt = _next_after(rule, sat)
        dt = datetime.fromtimestamp(nxt, tz=timezone.utc)
        assert dt.weekday() < 5  # Mon-Fri

    def test_cron_parses(self):
        from aetheris.core.recurrence import _parse_cron
        cf = _parse_cron("0 9 * * 1-5")
        assert 0 in cf["minute"] and 9 in cf["hour"]
        assert all(d < 6 for d in cf["dow"])

    def test_create_mark_run(self):
        from aetheris.core.recurrence import get_recurrence_manager, RecurringTaskCreate, RecurrenceRule
        mgr = get_recurrence_manager()
        t = mgr.create(RecurringTaskCreate(
            name="ping", rule=RecurrenceRule(kind="interval", interval_seconds=60),
            action_type="command", action_ref="ping",
        ))
        assert t.next_run_at is not None
        mgr.mark_run(t.id)
        assert t.run_count == 1

    def test_once_kind(self):
        from aetheris.core.recurrence import _next_after, RecurrenceRule
        now = time.time()
        target = now + 3600
        rule = RecurrenceRule(kind="once", run_at=target)
        assert _next_after(rule, now) == pytest.approx(target, abs=1)
        assert _next_after(rule, target + 10) is None


# =============================================================================
# Unit tests — Embeddings
# =============================================================================

class TestEmbeddingsUnit:
    def test_deterministic(self):
        from aetheris.core.embeddings import signature_embed
        a = signature_embed("hello world")
        b = signature_embed("hello world")
        assert a == b

    def test_normalized(self):
        from aetheris.core.embeddings import signature_embed
        import math
        v = signature_embed("the quick brown fox", normalize=True)
        n = math.sqrt(sum(x * x for x in v))
        assert abs(n - 1.0) < 1e-6

    def test_similarity_ordering(self):
        from aetheris.core.embeddings import EmbeddingManager, IndexedDocument, cosine
        mgr = EmbeddingManager()
        d1 = mgr.index_document(IndexedDocument(text="Python is a programming language"))
        d2 = mgr.index_document(IndexedDocument(text="Java is another programming language"))
        d3 = mgr.index_document(IndexedDocument(text="The weather in Mumbai is warm today"))
        qv = mgr.embed("coding in Python")
        scores = [(cosine(qv, d.vec), d.id) for d in [mgr.get(d1.id), mgr.get(d2.id), mgr.get(d3.id)]]
        scores.sort(reverse=True)
        assert scores[0][1] in (d1.id, d2.id)  # programming docs, not weather

    def test_search_returns_hits(self):
        from aetheris.core.embeddings import EmbeddingManager, IndexedDocument, VectorSearchQuery
        mgr = EmbeddingManager()
        mgr.index_document(IndexedDocument(text="machine learning models"))
        mgr.index_document(IndexedDocument(text="data science pipelines"))
        mgr.index_document(IndexedDocument(text="recipes for pasta carbonara"))
        res = mgr.search(VectorSearchQuery(query="machine learning", top_k=2))
        assert res.count >= 1
        assert all("pasta" not in h.text_preview for h in res.hits)

    def test_dimension(self):
        from aetheris.core.embeddings import signature_embed
        v = signature_embed("x", dim=128)
        assert len(v) == 128


# =============================================================================
# Config tests
# =============================================================================

class TestConfig:
    def test_version(self):
        from aetheris import __version__
        assert __version__ == "0.11.0"

    def test_capabilities_include_v10(self):
        r = client.get("/v1/capabilities")
        assert r.status_code == 200
        caps = r.json()["capabilities"]
        for k in ("cost_tracking", "drafts", "shortcuts", "comments", "recurrence", "embeddings"):
            assert caps[k] is True, f"missing capability: {k}"

    def test_config_defaults(self):
        from aetheris.core.config import settings
        assert settings.cost_tracking_enabled is True
        assert settings.drafts_enabled is True
        assert settings.shortcuts_enabled is True
        assert settings.comments_enabled is True
        assert settings.recurrence_enabled is True
        assert settings.embeddings_enabled is True
        assert settings.embeddings_dimension == 384


# =============================================================================
# API endpoint tests
# =============================================================================

class TestCostsAPI:
    def test_stats_empty(self):
        r = client.get("/v1/costs/stats")
        assert r.status_code == 200
        assert r.json()["entries"] == 0

    def test_record_and_snapshot(self):
        r = client.post("/v1/costs/record", json={
            "client_id": "acme", "model": "aetheris-pro",
            "prompt_tokens": 2000, "completion_tokens": 1000,
        })
        assert r.status_code == 200
        r2 = client.get("/v1/costs?client_id=acme")
        assert r2.status_code == 200
        assert r2.json()["total_cost_usd"] > 0

    def test_budget_put_delete(self):
        r = client.put("/v1/costs/budgets/acme", json={"daily_usd": 5.0})
        assert r.status_code == 200
        r = client.delete("/v1/costs/budgets/acme")
        assert r.status_code == 200 and r.json()["deleted"] is True

    def test_rates_seeded(self):
        r = client.get("/v1/costs/rates")
        assert r.status_code == 200
        assert any(x["model"] == "aetheris-ultra" for x in r.json()["rates"])

    def test_disabled(self):
        from aetheris.core.config import settings
        prev = settings.cost_tracking_enabled
        settings.cost_tracking_enabled = False
        try:
            r = client.get("/v1/costs/stats")
            assert r.status_code == 403
        finally:
            settings.cost_tracking_enabled = prev


class TestDraftsAPI:
    def test_crud(self):
        r = client.post("/v1/drafts", json={"entity_type": "conversation", "title": "T", "content": "hi"})
        assert r.status_code == 201
        did = r.json()["id"]
        r = client.get(f"/v1/drafts/{did}")
        assert r.status_code == 200 and r.json()["revision"] == 1
        r = client.patch(f"/v1/drafts/{did}", json={"content": "hi2", "expected_revision": 1})
        assert r.status_code == 200 and r.json()["revision"] == 2
        r = client.patch(f"/v1/drafts/{did}", json={"content": "conflict", "expected_revision": 1})
        assert r.status_code == 409
        r = client.delete(f"/v1/drafts/{did}")
        assert r.status_code == 200

    def test_autosave_endpoint(self):
        r = client.post("/v1/drafts", json={"entity_type": "document", "title": "doc", "content": "a"})
        did = r.json()["id"]
        r = client.post(f"/v1/drafts/{did}/autosave", json={"content": "b"})
        assert r.status_code == 200
        assert any(v["is_auto_saved"] for v in r.json()["history"])

    def test_revert_and_publish(self):
        r = client.post("/v1/drafts", json={"entity_type": "conversation", "title": "x", "content": "v1"})
        did = r.json()["id"]
        client.patch(f"/v1/drafts/{did}", json={"content": "v2"})
        r = client.post(f"/v1/drafts/{did}/revert", params={"version": 1})
        assert r.status_code == 200 and r.json()["content"] == "v1"
        r = client.post(f"/v1/drafts/{did}/publish")
        assert r.status_code == 200 and r.json()["draft_id"] == did


class TestShortcutsAPI:
    def test_profiles_list(self):
        r = client.get("/v1/shortcuts")
        assert r.status_code == 200
        names = [p["name"] for p in r.json()["data"]]
        assert "default" in names

    def test_resolve(self):
        r = client.post("/v1/shortcuts/resolve", json={"keys": "ctrl+n"})
        assert r.status_code == 200 and r.json()["found"] is True

    def test_create_and_activate(self):
        r = client.post("/v1/shortcuts/profiles", json={"name": "mine", "bindings": []})
        assert r.status_code == 201
        pid = r.json()["id"]
        r = client.put(f"/v1/shortcuts/profiles/{pid}/bindings", json={"command": "new-chat", "keys": "ctrl+shift+x"})
        assert r.status_code == 200
        r = client.post("/v1/shortcuts/activate", json={"id": pid})
        assert r.status_code == 200
        r = client.post("/v1/shortcuts/resolve", json={"keys": "ctrl+shift+x"})
        assert r.json()["found"] is True

    def test_clone_and_delete(self):
        r = client.post("/v1/shortcuts/profiles/default/clone", json={"name": "my-default"})
        assert r.status_code == 200
        pid = r.json()["id"]
        r = client.delete(f"/v1/shortcuts/profiles/{pid}")
        assert r.status_code == 200


class TestCommentsAPI:
    def test_thread_lifecycle(self):
        r = client.post("/v1/comments", json={"entity_type": "conversation", "entity_id": "c1", "body": "nice", "author": "alice"})
        assert r.status_code == 201
        tid = r.json()["thread_id"]
        root_id = r.json()["comments"][0]["id"]
        # reply
        r = client.post("/v1/comments", json={"entity_type": "conversation", "entity_id": "c1", "thread_id": root_id, "body": "+1", "author": "bob"})
        assert r.status_code == 201
        assert len(r.json()["comments"]) == 2
        # react
        r = client.post(f"/v1/comments/{root_id}/react", json={"emoji": "👍", "user": "bob"})
        assert r.status_code == 200 and "👍" in r.json()["reactions"]
        # resolve
        r = client.post(f"/v1/comments/{root_id}/resolve", params={"actor": "alice"})
        assert r.status_code == 200 and r.json()["resolved"] is True
        # list
        r = client.get("/v1/comments", params={"entity_type": "conversation", "entity_id": "c1"})
        assert r.status_code == 200 and len(r.json()["threads"]) == 1
        # search
        r = client.get("/v1/comments/search", params={"q": "nice"})
        assert r.status_code == 200 and len(r.json()["results"]) >= 1

    def test_delete(self):
        r = client.post("/v1/comments", json={"entity_type": "c", "entity_id": "x", "body": "del"})
        cid = r.json()["comments"][0]["id"]
        r = client.delete(f"/v1/comments/{cid}")
        assert r.status_code == 200


class TestRecurrenceAPI:
    def test_create_list_toggle(self):
        r = client.post("/v1/recurring", json={
            "name": "daily ping",
            "rule": {"kind": "interval", "interval_seconds": 300},
            "action_type": "command", "action_ref": "ping",
        })
        assert r.status_code == 201
        tid = r.json()["id"]
        r = client.get("/v1/recurring")
        assert r.status_code == 200 and len(r.json()["data"]) >= 1
        r = client.get(f"/v1/recurring/{tid}")
        assert r.status_code == 200
        r = client.get(f"/v1/recurring/{tid}/occurrences", params={"count": 3})
        assert r.status_code == 200 and len(r.json()["occurrences"]) == 3
        r = client.post(f"/v1/recurring/{tid}/run")
        assert r.status_code == 200 and r.json()["run_count"] >= 1
        r = client.post(f"/v1/recurring/{tid}/toggle", params={"enabled": False})
        assert r.status_code == 200 and r.json()["enabled"] is False
        r = client.delete(f"/v1/recurring/{tid}")
        assert r.status_code == 200

    def test_upcoming(self):
        r = client.get("/v1/recurring/upcoming")
        assert r.status_code == 200


class TestEmbeddingsAPI:
    def test_embed_single(self):
        r = client.post("/v1/embeddings", json={"input": "hello world"})
        assert r.status_code == 200
        assert len(r.json()["data"]) == 1
        assert isinstance(r.json()["data"][0]["embedding"][0], float)

    def test_index_and_search(self):
        client.post("/v1/embeddings/index", json={"id": "d1", "text": "Python is a programming language"})
        client.post("/v1/embeddings/index", json={"id": "d2", "text": "Chocolate cake recipe"})
        r = client.post("/v1/embeddings/search", json={"query": "coding language", "top_k": 2})
        assert r.status_code == 200
        hits = r.json()["hits"]
        assert hits and hits[0]["id"] == "d1"

    def test_stats(self):
        r = client.get("/v1/embeddings/stats")
        assert r.status_code == 200 and r.json()["dimension"] == 384

    def test_clear(self):
        client.post("/v1/embeddings/index", json={"id": "tmp", "text": "x"})
        r = client.delete("/v1/embeddings/index")
        assert r.status_code == 200 and r.json()["deleted"] >= 1
