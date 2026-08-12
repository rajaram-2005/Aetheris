"""Tests for Aetheris v0.7.0 features: tags, health probes, quotas, commands, sharing, changelog."""

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
# Tags unit tests
# =============================================================================

class TestTagManager:
    def test_assign_tags(self):
        from aetheris.core.tags import TagManager, TagAssignment
        mgr = TagManager()
        result = mgr.assign(TagAssignment(entity_type="conversation", entity_id="c1", tags=["python", "web", "API"]))
        assert len(result.tags) == 3
        assert "python" in result.tags

    def test_tag_normalisation(self):
        from aetheris.core.tags import TagManager, TagAssignment
        mgr = TagManager()
        result = mgr.assign(TagAssignment(entity_type="conversation", entity_id="c1", tags=["  Python  ", "WEB API"]))
        assert "python" in result.tags
        assert "web api" in result.tags

    def test_duplicate_tags_ignored(self):
        from aetheris.core.tags import TagManager, TagAssignment
        mgr = TagManager()
        mgr.assign(TagAssignment(entity_type="conversation", entity_id="c1", tags=["python"]))
        result = mgr.assign(TagAssignment(entity_type="conversation", entity_id="c1", tags=["python"]))
        assert len(result.tags) == 1

    def test_tag_cloud(self):
        from aetheris.core.tags import TagManager, TagAssignment
        mgr = TagManager()
        mgr.assign(TagAssignment(entity_type="conversation", entity_id="c1", tags=["python", "web"]))
        mgr.assign(TagAssignment(entity_type="conversation", entity_id="c2", tags=["python", "rust"]))
        cloud = mgr.tag_cloud()
        assert cloud.total_unique_tags >= 3
        assert cloud.total_assignments == 4
        # python should have count 2
        python_tag = next(t for t in cloud.tags if t.tag == "python")
        assert python_tag.entity_count == 2

    def test_autocomplete(self):
        from aetheris.core.tags import TagManager, TagAssignment
        mgr = TagManager()
        mgr.assign(TagAssignment(entity_type="conversation", entity_id="c1", tags=["python", "pydantic", "javascript"]))
        results = mgr.autocomplete("py")
        assert len(results) >= 2
        names = {t.tag for t in results}
        assert "python" in names
        assert "pydantic" in names

    def test_hierarchical_tags(self):
        from aetheris.core.tags import TagManager, TagAssignment
        mgr = TagManager()
        result = mgr.assign(TagAssignment(entity_type="conversation", entity_id="c1", tags=["python/web"]))
        cloud = mgr.tag_cloud()
        web_tag = next(t for t in cloud.tags if t.tag == "python/web")
        assert "python" in web_tag.categories

    def test_find_by_tag(self):
        from aetheris.core.tags import TagManager, TagAssignment
        mgr = TagManager()
        mgr.assign(TagAssignment(entity_type="conversation", entity_id="c1", tags=["python"]))
        mgr.assign(TagAssignment(entity_type="prompt", entity_id="p1", tags=["python"]))
        results = mgr.find_by_tag("python")
        assert len(results) == 2

    def test_remove_tags(self):
        from aetheris.core.tags import TagManager, TagAssignment
        mgr = TagManager()
        mgr.assign(TagAssignment(entity_type="conversation", entity_id="c1", tags=["python", "web"]))
        removed = mgr.remove_tags("conversation", "c1", ["python"])
        assert removed == 1
        tags = mgr.get_tags("conversation", "c1")
        assert "python" not in tags.tags
        assert "web" in tags.tags

    def test_replace_tags(self):
        from aetheris.core.tags import TagManager, TagAssignment
        mgr = TagManager()
        mgr.assign(TagAssignment(entity_type="conversation", entity_id="c1", tags=["old"]))
        result = mgr.assign(TagAssignment(entity_type="conversation", entity_id="c1", tags=["new"], replace=True))
        assert result.tags == ["new"]

    def test_tag_stats(self):
        from aetheris.core.tags import TagManager, TagAssignment
        mgr = TagManager()
        mgr.assign(TagAssignment(entity_type="conversation", entity_id="c1", tags=["t1"]))
        stats = mgr.stats()
        assert stats["total_assignments"] == 1


# =============================================================================
# Health probes unit tests
# =============================================================================

class TestHealthProbes:
    def test_check_health(self):
        from aetheris.core.health import check_health, HealthStatus
        report = check_health()
        assert report.status in (HealthStatus.healthy, HealthStatus.degraded, HealthStatus.unhealthy)
        assert len(report.subsystems) >= 5
        assert report.version != ""
        assert report.uptime_seconds >= 0

    def test_subsystem_names(self):
        from aetheris.core.health import check_health
        report = check_health()
        names = {s.name for s in report.subsystems}
        assert "core" in names
        assert "cache" in names

    def test_healthy_subsystem(self):
        from aetheris.core.health import check_health, HealthStatus
        report = check_health()
        core = next(s for s in report.subsystems if s.name == "core")
        assert core.status == HealthStatus.healthy


# =============================================================================
# Usage quotas unit tests
# =============================================================================

class TestQuotas:
    def test_create_tier(self):
        from aetheris.core.quotas import QuotaManager, QuotaTierCreate
        mgr = QuotaManager()
        tier = mgr.create_tier(QuotaTierCreate(name="free", max_tokens=1000, max_requests=100, window="daily"))
        assert tier.name == "free"
        assert tier.max_tokens == 1000

    def test_assign_tier(self):
        from aetheris.core.quotas import QuotaManager, QuotaTierCreate, QuotaAssignmentCreate
        mgr = QuotaManager()
        mgr.create_tier(QuotaTierCreate(name="pro", max_tokens=100_000, max_requests=10_000))
        mgr.assign_tier(QuotaAssignmentCreate(identifier="user_1", tier_name="pro"))
        assert mgr.get_assignment("user_1") == "pro"

    def test_record_usage(self):
        from aetheris.core.quotas import QuotaManager, QuotaTierCreate, QuotaAssignmentCreate
        mgr = QuotaManager()
        mgr.create_tier(QuotaTierCreate(name="basic", max_tokens=100, max_requests=10))
        mgr.assign_tier(QuotaAssignmentCreate(identifier="u1", tier_name="basic"))
        usage = mgr.record_usage("u1", tokens=50, requests=1)
        assert usage.tokens_used == 50
        assert usage.requests_used == 1
        assert usage.is_over_quota is False

    def test_over_quota(self):
        from aetheris.core.quotas import QuotaManager, QuotaTierCreate, QuotaAssignmentCreate
        mgr = QuotaManager()
        mgr.create_tier(QuotaTierCreate(name="limited", max_tokens=100, max_requests=10))
        mgr.assign_tier(QuotaAssignmentCreate(identifier="u2", tier_name="limited"))
        mgr.record_usage("u2", tokens=50)
        usage = mgr.record_usage("u2", tokens=60)
        assert usage.is_over_quota is True

    def test_default_no_tier(self):
        from aetheris.core.quotas import QuotaManager
        mgr = QuotaManager()
        usage = mgr.check_quota("unknown_user")
        assert usage.is_over_quota is False
        assert usage.tier_name == "default"

    def test_check_quota(self):
        from aetheris.core.quotas import QuotaManager, QuotaTierCreate, QuotaAssignmentCreate
        mgr = QuotaManager()
        mgr.create_tier(QuotaTierCreate(name="check", max_tokens=1000))
        mgr.assign_tier(QuotaAssignmentCreate(identifier="u3", tier_name="check"))
        mgr.record_usage("u3", tokens=500)
        usage = mgr.check_quota("u3")
        assert usage.tokens_used == 500
        assert usage.tokens_remaining == 500

    def test_reset_usage(self):
        from aetheris.core.quotas import QuotaManager, QuotaTierCreate, QuotaAssignmentCreate
        mgr = QuotaManager()
        mgr.create_tier(QuotaTierCreate(name="reset", max_tokens=100))
        mgr.assign_tier(QuotaAssignmentCreate(identifier="u4", tier_name="reset"))
        mgr.record_usage("u4", tokens=50)
        assert mgr.reset_usage("u4") is True
        usage = mgr.check_quota("u4")
        assert usage.tokens_used == 0

    def test_duplicate_tier_rejected(self):
        from aetheris.core.quotas import QuotaManager, QuotaTierCreate
        mgr = QuotaManager()
        mgr.create_tier(QuotaTierCreate(name="dup"))
        with pytest.raises(ValueError, match="already exists"):
            mgr.create_tier(QuotaTierCreate(name="dup"))

    def test_quota_stats(self):
        from aetheris.core.quotas import QuotaManager
        mgr = QuotaManager()
        stats = mgr.stats()
        assert "tiers" in stats


# =============================================================================
# Command palette unit tests
# =============================================================================

class TestCommands:
    def test_create_command(self):
        from aetheris.core.commands import CommandManager, CommandCreate
        mgr = CommandManager()
        cmd = mgr.create(CommandCreate(name="test-cmd", description="A test", category="test"))
        assert cmd.name == "test-cmd"

    def test_load_defaults(self):
        from aetheris.core.commands import CommandManager
        mgr = CommandManager()
        count = mgr.load_defaults()
        assert count >= 4
        cmds = mgr.list_commands()
        names = {c.name for c in cmds}
        assert "new-chat" in names
        assert "clear-cache" in names

    def test_invoke_new_chat(self):
        from aetheris.core.commands import CommandManager
        mgr = CommandManager()
        mgr.load_defaults()
        cmd = mgr.get_by_name("new-chat")
        assert cmd is not None
        result = mgr.invoke(cmd.id, {"mode": "general", "title": "Cmd Test"})
        assert result.status == "success"
        assert "id" in result.result

    def test_list_by_category(self):
        from aetheris.core.commands import CommandManager
        mgr = CommandManager()
        mgr.load_defaults()
        chat_cmds = mgr.list_commands(category="chat")
        assert len(chat_cmds) >= 1

    def test_delete_custom_command(self):
        from aetheris.core.commands import CommandManager, CommandCreate
        mgr = CommandManager()
        cmd = mgr.create(CommandCreate(name="del-cmd", category="test"))
        assert mgr.delete(cmd.id) is True

    def test_cannot_delete_builtin(self):
        from aetheris.core.commands import CommandManager
        mgr = CommandManager()
        mgr.load_defaults()
        cmd = mgr.get_by_name("new-chat")
        with pytest.raises(ValueError, match="built-in"):
            mgr.delete(cmd.id)

    def test_command_stats(self):
        from aetheris.core.commands import CommandManager
        mgr = CommandManager()
        mgr.load_defaults()
        stats = mgr.stats()
        assert stats["builtin"] >= 4


# =============================================================================
# Sharing unit tests
# =============================================================================

class TestSharing:
    def test_share_with_user(self):
        from aetheris.core.sharing import ShareManager, ShareCreate
        mgr = ShareManager()
        share = mgr.create(ShareCreate(entity_type="conversation", entity_id="c1", permission="editor", shared_with="user_1"))
        assert share.permission == "editor"
        assert not share.is_public

    def test_public_share(self):
        from aetheris.core.sharing import ShareManager, ShareCreate
        mgr = ShareManager()
        share = mgr.create(ShareCreate(entity_type="prompt", entity_id="p1", permission="viewer"))
        assert share.is_public
        assert share.link_token is not None

    def test_check_permission_allowed(self):
        from aetheris.core.sharing import ShareManager, ShareCreate
        mgr = ShareManager()
        mgr.create(ShareCreate(entity_type="conversation", entity_id="c1", permission="editor", shared_with="user_1"))
        check = mgr.check_permission("conversation", "c1", "user_1", "viewer")
        assert check.allowed is True
        check_edit = mgr.check_permission("conversation", "c1", "user_1", "editor")
        assert check_edit.allowed is True

    def test_check_permission_denied(self):
        from aetheris.core.sharing import ShareManager, ShareCreate
        mgr = ShareManager()
        mgr.create(ShareCreate(entity_type="conversation", entity_id="c1", permission="viewer", shared_with="user_1"))
        check = mgr.check_permission("conversation", "c1", "user_1", "admin")
        assert check.allowed is False

    def test_public_share_grants_viewer(self):
        from aetheris.core.sharing import ShareManager, ShareCreate
        mgr = ShareManager()
        mgr.create(ShareCreate(entity_type="file", entity_id="f1", permission="viewer"))
        check = mgr.check_permission("file", "f1", "anyone", "viewer")
        assert check.allowed is True

    def test_revoke_share(self):
        from aetheris.core.sharing import ShareManager, ShareCreate
        mgr = ShareManager()
        share = mgr.create(ShareCreate(entity_type="conversation", entity_id="c1", permission="viewer", shared_with="u1"))
        assert mgr.revoke(share.id) is True
        check = mgr.check_permission("conversation", "c1", "u1", "viewer")
        assert check.allowed is False

    def test_share_stats(self):
        from aetheris.core.sharing import ShareManager, ShareCreate
        mgr = ShareManager()
        mgr.create(ShareCreate(entity_type="conversation", entity_id="c1", permission="viewer"))
        stats = mgr.stats()
        assert stats["total"] == 1
        assert stats["public"] == 1


# =============================================================================
# Changelog unit tests
# =============================================================================

class TestChangelog:
    def test_create_entry(self):
        from aetheris.core.changelog import ChangelogManager, ChangeEntryCreate
        mgr = ChangelogManager()
        entry = mgr.create(ChangeEntryCreate(version="0.7.0", category="feature", title="New tags system"))
        assert entry.version == "0.7.0"
        assert entry.category == "feature"

    def test_list_by_version(self):
        from aetheris.core.changelog import ChangelogManager, ChangeEntryCreate
        mgr = ChangelogManager()
        mgr.create(ChangeEntryCreate(version="0.7.0", category="feature", title="A"))
        mgr.create(ChangeEntryCreate(version="0.7.0", category="fix", title="B"))
        mgr.create(ChangeEntryCreate(version="0.6.0", category="feature", title="C"))
        entries = mgr.list_entries(version="0.7.0")
        assert len(entries) == 2

    def test_list_versions(self):
        from aetheris.core.changelog import ChangelogManager, ChangeEntryCreate
        mgr = ChangelogManager()
        mgr.create(ChangeEntryCreate(version="0.6.0", category="feature", title="A"))
        mgr.create(ChangeEntryCreate(version="0.7.0", category="feature", title="B"))
        versions = mgr.list_versions()
        assert versions[0] == "0.7.0"  # Newest first

    def test_get_version_summary(self):
        from aetheris.core.changelog import ChangelogManager, ChangeEntryCreate
        mgr = ChangelogManager()
        mgr.create(ChangeEntryCreate(version="0.7.0", category="feature", title="New thing"))
        mgr.create(ChangeEntryCreate(version="0.7.0", category="breaking", title="API change", migration_guide="Update your calls."))
        summary = mgr.get_version("0.7.0")
        assert len(summary.entries) == 2
        assert summary.has_breaking is True

    def test_breaking_changes(self):
        from aetheris.core.changelog import ChangelogManager, ChangeEntryCreate
        mgr = ChangelogManager()
        mgr.create(ChangeEntryCreate(version="0.6.0", category="breaking", title="Old break"))
        mgr.create(ChangeEntryCreate(version="0.7.0", category="breaking", title="New break"))
        breaking = mgr.breaking_changes(since_version="0.6.1")
        assert len(breaking) >= 1

    def test_search_changelog(self):
        from aetheris.core.changelog import ChangelogManager, ChangeEntryCreate
        mgr = ChangelogManager()
        mgr.create(ChangeEntryCreate(version="0.7.0", category="feature", title="Tag system for categorization"))
        results = mgr.search("tag")
        assert len(results) >= 1

    def test_deprecation_entry(self):
        from aetheris.core.changelog import ChangelogManager, ChangeEntryCreate
        mgr = ChangelogManager()
        mgr.create(ChangeEntryCreate(version="0.7.0", category="feature", title="A"))
        mgr.create(ChangeEntryCreate(version="0.7.0", category="deprecation", title="Dep A"))
        summary = mgr.get_version("0.7.0")
        assert summary.has_deprecations is True

    def test_changelog_stats(self):
        from aetheris.core.changelog import ChangelogManager, ChangeEntryCreate
        mgr = ChangelogManager()
        mgr.create(ChangeEntryCreate(version="0.7.0", category="feature", title="X"))
        stats = mgr.stats()
        assert stats["total"] == 1


# =============================================================================
# API endpoint tests
# =============================================================================

class TestTagEndpoints:
    def test_assign_tags(self):
        resp = client.post("/v1/tags/assign", json={"entity_type": "conversation", "entity_id": "c1", "tags": ["python", "web"]})
        assert resp.status_code == 200

    def test_tag_cloud(self):
        resp = client.get("/v1/tags")
        assert resp.status_code == 200

    def test_autocomplete(self):
        resp = client.get("/v1/tags/autocomplete?prefix=py")
        assert resp.status_code == 200

    def test_entity_tags(self):
        client.post("/v1/tags/assign", json={"entity_type": "conversation", "entity_id": "ep1", "tags": ["test"]})
        resp = client.get("/v1/tags/conversation/ep1")
        assert resp.status_code == 200


class TestHealthEndpoint:
    def test_detailed_health(self):
        resp = client.get("/v1/health/detailed")
        assert resp.status_code == 200
        data = resp.json()
        assert "subsystems" in data
        assert data["status"] in ("healthy", "degraded", "unhealthy")


class TestQuotaEndpoints:
    def test_create_tier(self):
        resp = client.post("/v1/quotas/tiers", json={"name": "free-tier", "max_tokens": 1000, "max_requests": 100, "window": "daily"})
        assert resp.status_code == 201

    def test_list_tiers(self):
        resp = client.get("/v1/quotas/tiers")
        assert resp.status_code == 200

    def test_assign_and_check(self):
        client.post("/v1/quotas/tiers", json={"name": "check-tier", "max_tokens": 5000, "max_requests": 500})
        client.post("/v1/quotas/assign", json={"identifier": "test_user", "tier_name": "check-tier"})
        resp = client.get("/v1/quotas/check?identifier=test_user")
        assert resp.status_code == 200


class TestCommandEndpoints:
    def test_create_command(self):
        resp = client.post("/v1/commands", json={"name": "test-cmd", "description": "Test", "category": "test"})
        assert resp.status_code == 201

    def test_list_commands(self):
        resp = client.get("/v1/commands")
        assert resp.status_code == 200

    def test_load_defaults(self):
        resp = client.post("/v1/commands/defaults")
        assert resp.status_code == 200
        assert resp.json()["loaded"] >= 4


class TestShareEndpoints:
    def test_create_share(self):
        resp = client.post("/v1/shares", json={"entity_type": "conversation", "entity_id": "c1", "permission": "viewer", "shared_with": "user_1"})
        assert resp.status_code == 201

    def test_public_share(self):
        resp = client.post("/v1/shares", json={"entity_type": "prompt", "entity_id": "p1", "permission": "viewer"})
        assert resp.status_code == 201
        assert resp.json()["link_token"] is not None

    def test_check_permission(self):
        resp = client.get("/v1/shares/check?entity_type=conversation&entity_id=c1&user=user_1&permission=viewer")
        assert resp.status_code == 200

    def test_list_shares(self):
        resp = client.get("/v1/shares")
        assert resp.status_code == 200


class TestChangelogEndpoints:
    def test_create_entry(self):
        resp = client.post("/v1/changelog", json={"version": "0.7.0", "category": "feature", "title": "New tags system"})
        assert resp.status_code == 201

    def test_list_changelog(self):
        resp = client.get("/v1/changelog")
        assert resp.status_code == 200

    def test_breaking_changes(self):
        resp = client.get("/v1/changelog/breaking")
        assert resp.status_code == 200

    def test_search_changelog(self):
        resp = client.get("/v1/changelog/search?q=tags")
        assert resp.status_code == 200


# =============================================================================
# Config tests for v0.7.0
# =============================================================================

class TestV07Config:
    def test_tags_settings(self):
        from aetheris.core.config import settings
        assert settings.tags_enabled is True
        assert settings.tags_max_assignments == 50_000

    def test_health_settings(self):
        from aetheris.core.config import settings
        assert settings.health_probes_enabled is True

    def test_quota_settings(self):
        from aetheris.core.config import settings
        assert settings.quotas_enabled is True

    def test_command_settings(self):
        from aetheris.core.config import settings
        assert settings.commands_enabled is True
        assert settings.commands_max == 200

    def test_sharing_settings(self):
        from aetheris.core.config import settings
        assert settings.sharing_enabled is True
        assert settings.sharing_max == 1000

    def test_changelog_settings(self):
        from aetheris.core.config import settings
        assert settings.changelog_enabled is True
        assert settings.changelog_max_entries == 5000

    def test_capability_report_includes_v07(self):
        from aetheris.core.config import settings
        report = settings.capability_report()
        for key in ("tags", "health_probes", "quotas", "commands", "sharing", "changelog"):
            assert key in report, f"Missing capability: {key}"
            assert report[key] is True
