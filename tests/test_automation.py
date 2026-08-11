"""Tests for Aetheris automation and integration features."""

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
# Connection registry unit tests
# =============================================================================

class TestConnectionRegistry:
    """Test the connection registry core logic."""

    def test_create_api_key_connection(self):
        from aetheris.core.connections import ConnectionRegistry, ConnectionCreate
        reg = ConnectionRegistry()
        body = ConnectionCreate(
            name="My API", service_type="custom", auth_type="api_key",
            base_url="https://api.example.com", api_key_val="sk-test-123",
            auth_header_prefix="Bearer ",
        )
        conn = reg.create(body)
        assert conn.name == "My API"
        assert conn.has_credentials is True
        assert "sk-test-123" not in str(conn._api_key)  # Obfuscated

    def test_create_bearer_connection(self):
        from aetheris.core.connections import ConnectionRegistry, ConnectionCreate
        reg = ConnectionRegistry()
        body = ConnectionCreate(
            name="GitHub", service_type="github", auth_type="bearer",
            base_url="https://api.github.com", bearer_token="ghp_test",
        )
        conn = reg.create(body)
        assert conn.auth_type == "bearer"
        assert conn.has_credentials is True

    def test_create_basic_auth_connection(self):
        from aetheris.core.connections import ConnectionRegistry, ConnectionCreate
        reg = ConnectionRegistry()
        body = ConnectionCreate(
            name="Jira", service_type="jira", auth_type="basic",
            base_url="https://jira.example.com", username="user", password="pass",
        )
        conn = reg.create(body)
        assert conn.auth_type == "basic"
        assert conn.has_credentials is True

    def test_create_oauth2_connection(self):
        from aetheris.core.connections import ConnectionRegistry, ConnectionCreate
        reg = ConnectionRegistry()
        body = ConnectionCreate(
            name="OAuth Service", service_type="custom", auth_type="oauth2",
            base_url="https://auth.example.com",
            oauth_client_id="client-123", oauth_client_secret="secret-456",
            oauth_token_url="https://auth.example.com/oauth/token",
        )
        conn = reg.create(body)
        assert conn.auth_type == "oauth2"
        assert conn.has_credentials is True

    def test_build_auth_headers_api_key(self):
        from aetheris.core.connections import ConnectionRegistry, ConnectionCreate
        reg = ConnectionRegistry()
        body = ConnectionCreate(
            name="Test", service_type="custom", auth_type="api_key",
            api_key_val="my-key", auth_header_prefix="Token ",
        )
        conn = reg.create(body)
        headers = conn.build_auth_headers()
        assert headers["Authorization"] == "Token my-key"

    def test_build_auth_headers_bearer(self):
        from aetheris.core.connections import ConnectionRegistry, ConnectionCreate
        reg = ConnectionRegistry()
        body = ConnectionCreate(
            name="Test", service_type="custom", auth_type="bearer",
            bearer_token="tok-123",
        )
        conn = reg.create(body)
        headers = conn.build_auth_headers()
        assert headers["Authorization"] == "Bearer tok-123"

    def test_build_auth_params_query(self):
        from aetheris.core.connections import ConnectionRegistry, ConnectionCreate
        reg = ConnectionRegistry()
        body = ConnectionCreate(
            name="Test", service_type="custom", auth_type="api_key",
            api_key_val="my-key", auth_query_param="api_key",
        )
        conn = reg.create(body)
        params = conn.build_auth_params()
        assert params == {"api_key": "my-key"}

    def test_connection_info_no_credential_leak(self):
        from aetheris.core.connections import ConnectionRegistry, ConnectionCreate
        reg = ConnectionRegistry()
        body = ConnectionCreate(
            name="Test", service_type="custom", auth_type="api_key",
            api_key_val="super-secret-key",
        )
        conn = reg.create(body)
        info = conn.to_info()
        serialized = info.model_dump()
        # Ensure no credential appears in serialized output
        assert "super-secret-key" not in str(serialized)

    def test_delete_connection(self):
        from aetheris.core.connections import ConnectionRegistry, ConnectionCreate
        reg = ConnectionRegistry()
        body = ConnectionCreate(name="Test", service_type="custom", auth_type="api_key", api_key_val="key")
        conn = reg.create(body)
        assert reg.delete(conn.id) is True
        assert reg.get(conn.id) is None

    def test_list_connections(self):
        from aetheris.core.connections import ConnectionRegistry, ConnectionCreate
        reg = ConnectionRegistry()
        reg.create(ConnectionCreate(name="A", service_type="slack", auth_type="bearer", bearer_token="t1"))
        reg.create(ConnectionCreate(name="B", service_type="github", auth_type="bearer", bearer_token="t2"))
        assert len(reg.list_connections()) == 2
        assert len(reg.list_connections(service_type="slack")) == 1

    def test_max_connections_limit(self):
        from aetheris.core.connections import ConnectionRegistry, ConnectionCreate
        reg = ConnectionRegistry(max_connections=1)
        reg.create(ConnectionCreate(name="A", service_type="custom", auth_type="api_key", api_key_val="k"))
        with pytest.raises(ValueError):
            reg.create(ConnectionCreate(name="B", service_type="custom", auth_type="api_key", api_key_val="k"))


# =============================================================================
# Workflow engine unit tests
# =============================================================================

class TestWorkflowEngine:
    """Test the workflow engine."""

    def test_create_workflow(self):
        from aetheris.core.workflows import WorkflowEngine, WorkflowCreate, WorkflowStep, TriggerConfig
        engine = WorkflowEngine()
        body = WorkflowCreate(
            name="Test Flow", description="A test workflow",
            steps=[WorkflowStep(name="step1", type="tool", tool_name="calculator", tool_arguments={"expression": "2+2"})],
            trigger=TriggerConfig(type="manual"),
        )
        wf = engine.create(body)
        assert wf.name == "Test Flow"
        assert len(wf.steps) == 1

    def test_list_workflows(self):
        from aetheris.core.workflows import WorkflowEngine, WorkflowCreate, WorkflowStep, TriggerConfig
        engine = WorkflowEngine()
        engine.create(WorkflowCreate(name="WF1", steps=[WorkflowStep(name="s1", type="tool", tool_name="calculator")], trigger=TriggerConfig(type="manual")))
        engine.create(WorkflowCreate(name="WF2", steps=[WorkflowStep(name="s2", type="tool", tool_name="calculator")], trigger=TriggerConfig(type="event", event_pattern="test.*")))
        wfs = engine.list_workflows()
        assert len(wfs) == 2

    def test_delete_workflow(self):
        from aetheris.core.workflows import WorkflowEngine, WorkflowCreate, WorkflowStep, TriggerConfig
        engine = WorkflowEngine()
        wf = engine.create(WorkflowCreate(name="WF1", steps=[WorkflowStep(name="s1", type="tool", tool_name="calculator")], trigger=TriggerConfig(type="manual")))
        assert engine.delete(wf.id) is True
        assert engine.get(wf.id) is None

    def test_workflow_info(self):
        from aetheris.core.workflows import WorkflowEngine, WorkflowCreate, WorkflowStep, TriggerConfig
        engine = WorkflowEngine()
        wf = engine.create(WorkflowCreate(
            name="Info Test", description="desc",
            steps=[WorkflowStep(name="s1", type="tool", tool_name="calculator")],
            trigger=TriggerConfig(type="cron", cron_expression="0 * * * *"),
        ))
        info = wf.to_info()
        assert info.step_count == 1
        assert info.trigger.type == "cron"

    def test_template_rendering(self):
        from aetheris.core.workflows import _render_template
        template = {"channel": "#general", "text": "{{message}}"}
        result = _render_template(template, {"message": "Hello world"})
        assert result["text"] == "Hello world"

    def test_condition_evaluation(self):
        from aetheris.core.workflows import _evaluate_condition
        assert _evaluate_condition("x == 1", {"x": 1}) is True
        assert _evaluate_condition("x == 2", {"x": 1}) is False
        assert _evaluate_condition("ok == True", {"ok": True}) is True

    def test_data_transform(self):
        from aetheris.core.workflows import _apply_transform
        data = {"body": {"items": [1, 2, 3]}}
        assert _apply_transform("body.items", data) == [1, 2, 3]
        assert _apply_transform("body.items.0", data) == 1


# =============================================================================
# Event bus unit tests
# =============================================================================

class TestEventBus:
    """Test the internal event bus."""

    def test_publish_event(self):
        from aetheris.core.events import EventBus
        bus = EventBus()
        received = []

        async def handler(event):
            received.append(event)

        bus.subscribe("test", handler)

        async def _run():
            await bus.publish("test", {"key": "value"}, source="unit")

        import asyncio
        asyncio.run(_run())
        assert len(received) == 1
        assert received[0].name == "test"
        assert received[0].data["key"] == "value"

    def test_wildcard_handler(self):
        from aetheris.core.events import EventBus
        bus = EventBus()
        received = []

        async def handler(event):
            received.append(event)

        bus.subscribe("*", handler)

        async def _run():
            await bus.publish("anything", {}, source="test")

        import asyncio
        asyncio.run(_run())
        assert len(received) == 1

    def test_event_history(self):
        from aetheris.core.events import EventBus
        bus = EventBus()

        async def _run():
            await bus.publish("evt1", {}, source="test")
            await bus.publish("evt2", {}, source="test")

        import asyncio
        asyncio.run(_run())
        history = bus.history()
        assert len(history) == 2

    def test_event_stats(self):
        from aetheris.core.events import EventBus
        bus = EventBus()

        async def _run():
            await bus.publish("test", {}, source="test")

        import asyncio
        asyncio.run(_run())
        stats = bus.stats()
        assert stats["published"] >= 1


# =============================================================================
# Scheduler unit tests
# =============================================================================

class TestScheduler:
    """Test the cron scheduler."""

    def test_should_fire_every_minute(self):
        from aetheris.core.scheduler import should_fire
        assert should_fire("* * * * *") is True

    def test_should_fire_specific_minute(self):
        from aetheris.core.scheduler import should_fire
        now = time.time()
        lt = time.localtime(now)
        # Construct expression that matches current minute
        expr = f"{lt.tm_min} * * * *"
        assert should_fire(expr, now) is True
        # Non-matching minute
        wrong_min = (lt.tm_min + 1) % 60
        wrong_expr = f"{wrong_min} * * * *"
        # It should not match the current time's minute (unless wrap)
        if wrong_min != lt.tm_min:
            assert should_fire(wrong_expr, now) is False

    def test_should_fire_step(self):
        from aetheris.core.scheduler import should_fire
        # */5 should match minutes divisible by 5
        for minute in range(60):
            t = time.mktime(time.strptime(f"2024-01-01 00:{minute:02d}", "%Y-%m-%d %H:%M"))
            result = should_fire("*/5 * * * *", t)
            expected = minute % 5 == 0
            assert result == expected

    def test_create_schedule(self):
        from aetheris.core.scheduler import Scheduler, ScheduleCreate
        sched = Scheduler()
        body = ScheduleCreate(workflow_id="wf_test", cron_expression="0 * * * *")
        s = sched.add(body)
        assert s.workflow_id == "wf_test"
        assert s.cron_expression == "0 * * * *"
        assert s.enabled is True

    def test_list_schedules(self):
        from aetheris.core.scheduler import Scheduler, ScheduleCreate
        sched = Scheduler()
        sched.add(ScheduleCreate(workflow_id="wf1", cron_expression="* * * * *"))
        sched.add(ScheduleCreate(workflow_id="wf2", cron_expression="0 * * * *"))
        assert len(sched.list_schedules()) == 2

    def test_delete_schedule(self):
        from aetheris.core.scheduler import Scheduler, ScheduleCreate
        sched = Scheduler()
        s = sched.add(ScheduleCreate(workflow_id="wf1", cron_expression="* * * * *"))
        assert sched.remove(s.id) is True


# =============================================================================
# Integration templates unit tests
# =============================================================================

class TestIntegrationTemplates:
    """Test pre-built integration templates."""

    def test_list_templates(self):
        from aetheris.core.integrations import list_templates
        templates = list_templates()
        assert len(templates) >= 5
        services = {t.service for t in templates}
        assert "slack" in services
        assert "github" in services
        assert "discord" in services

    def test_get_template(self):
        from aetheris.core.integrations import get_template
        t = get_template("slack")
        assert t is not None
        assert t.name == "Slack"
        assert t.auth_type == "bearer"

    def test_get_template_unknown(self):
        from aetheris.core.integrations import get_template
        assert get_template("nonexistent") is None

    def test_build_connection_slack(self):
        from aetheris.core.integrations import build_connection
        conn = build_connection("slack", bearer_token="xoxb-test-123")
        assert conn.service_type == "slack"
        assert conn.auth_type == "bearer"
        assert conn.base_url == "https://slack.com/api"
        assert conn.bearer_token == "xoxb-test-123"

    def test_build_connection_github(self):
        from aetheris.core.integrations import build_connection
        conn = build_connection("github", bearer_token="ghp-test")
        assert conn.service_type == "github"
        assert conn.base_url == "https://api.github.com"
        assert "Accept" in conn.custom_headers

    def test_build_connection_custom(self):
        from aetheris.core.integrations import build_connection
        conn = build_connection("custom", base_url="https://my-api.com/v1", api_key_val="key123")
        assert conn.service_type == "custom"
        assert conn.base_url == "https://my-api.com/v1"

    def test_build_connection_unknown_raises(self):
        from aetheris.core.integrations import build_connection
        with pytest.raises(ValueError, match="Unknown integration"):
            build_connection("nonexistent")

    def test_pagerduty_template(self):
        from aetheris.core.integrations import build_connection
        conn = build_connection("pagerduty", api_key_val="pd-key")
        assert conn.auth_type == "api_key"
        assert conn.auth_header_name == "X-Routing-Key"

    def test_slack_notify_workflow(self):
        from aetheris.core.integrations import slack_notify_workflow
        wf = slack_notify_workflow("conn_123", channel="#alerts")
        assert wf.name == "Slack Notify"
        assert len(wf.steps) == 1
        assert wf.steps[0].type == "connection"

    def test_github_issue_workflow(self):
        from aetheris.core.integrations import github_issue_workflow
        wf = github_issue_workflow("conn_123", repo="user/repo")
        assert wf.name == "Create GitHub Issue"
        assert len(wf.steps) == 1

    def test_api_poll_workflow(self):
        from aetheris.core.integrations import api_poll_workflow
        wf = api_poll_workflow("conn_123", path="/health", interval_cron="*/5 * * * *")
        assert wf.name == "API Poll"
        assert len(wf.steps) == 2  # fetch + condition
        assert wf.trigger.type == "cron"


# =============================================================================
# API endpoint tests
# =============================================================================

class TestAutomationEndpoints:
    """Test the automation API endpoints."""

    def test_create_connection(self):
        resp = client.post("/v1/connections", json={
            "name": "Test API", "service_type": "custom", "auth_type": "bearer",
            "base_url": "https://api.example.com", "bearer_token": "test-token",
        })
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Test API"
        assert data["has_credentials"] is True
        # Ensure no credential leak
        assert "test-token" not in str(data)

    def test_list_connections(self):
        resp = client.get("/v1/connections")
        assert resp.status_code == 200
        data = resp.json()
        assert "data" in data
        assert "stats" in data

    def test_connection_stats(self):
        resp = client.get("/v1/connections/stats")
        assert resp.status_code == 200

    def test_create_workflow(self):
        resp = client.post("/v1/workflows", json={
            "name": "Test Workflow", "description": "A test",
            "steps": [{"name": "calc", "type": "tool", "tool_name": "calculator", "tool_arguments": {"expression": "2+2"}}],
            "trigger": {"type": "manual"},
        })
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Test Workflow"
        assert data["step_count"] == 1

    def test_list_workflows(self):
        resp = client.get("/v1/workflows")
        assert resp.status_code == 200
        data = resp.json()
        assert "data" in data
        assert "stats" in data

    def test_run_workflow(self):
        # Create a workflow first
        create_resp = client.post("/v1/workflows", json={
            "name": "Runnable Flow", "description": "test",
            "steps": [{"name": "calc", "type": "tool", "tool_name": "calculator", "tool_arguments": {"expression": "1+1"}}],
            "trigger": {"type": "manual"},
        })
        wf_id = create_resp.json()["id"]

        # Run it
        resp = client.post(f"/v1/workflows/{wf_id}/run", json={})
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert len(data["steps"]) == 1
        assert data["duration_ms"] >= 0

    def test_workflow_run_history(self):
        resp = client.get("/v1/workflows/runs")
        assert resp.status_code == 200

    def test_list_schedules(self):
        resp = client.get("/v1/schedules")
        assert resp.status_code == 200

    def test_create_schedule(self):
        # Create a workflow first
        wf_resp = client.post("/v1/workflows", json={
            "name": "Scheduled Flow", "description": "test",
            "steps": [{"name": "s1", "type": "tool", "tool_name": "calculator", "tool_arguments": {"expression": "1"}}],
            "trigger": {"type": "cron", "cron_expression": "0 * * * *"},
        })
        wf_id = wf_resp.json()["id"]

        resp = client.post("/v1/schedules", json={
            "workflow_id": wf_id, "cron_expression": "0 * * * *",
        })
        assert resp.status_code == 201
        data = resp.json()
        assert data["workflow_id"] == wf_id

    def test_publish_event(self):
        resp = client.post("/v1/events/publish", json={
            "name": "test.event", "data": {"key": "value"}, "source": "test",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "test.event"

    def test_list_events(self):
        resp = client.get("/v1/events")
        assert resp.status_code == 200
        data = resp.json()
        assert "data" in data
        assert "stats" in data

    def test_list_integrations(self):
        resp = client.get("/v1/integrations")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["data"]) >= 5

    def test_get_integration(self):
        resp = client.get("/v1/integrations/slack")
        assert resp.status_code == 200
        data = resp.json()
        assert data["service"] == "slack"

    def test_get_integration_unknown(self):
        resp = client.get("/v1/integrations/nonexistent")
        assert resp.status_code == 404

    def test_connect_integration(self):
        resp = client.post("/v1/integrations/github/connect", json={
            "bearer_token": "ghp_test_token",
        })
        assert resp.status_code == 201
        data = resp.json()
        assert data["service_type"] == "github"
        assert data["has_credentials"] is True
        assert "ghp_test_token" not in str(data)

    def test_delete_connection(self):
        create_resp = client.post("/v1/connections", json={
            "name": "ToDelete", "service_type": "custom", "auth_type": "bearer",
            "bearer_token": "tok",
        })
        conn_id = create_resp.json()["id"]
        resp = client.delete(f"/v1/connections/{conn_id}")
        assert resp.status_code == 200

    def test_delete_workflow(self):
        create_resp = client.post("/v1/workflows", json={
            "name": "ToDelete", "description": "test",
            "steps": [{"name": "s1", "type": "tool", "tool_name": "calculator"}],
            "trigger": {"type": "manual"},
        })
        wf_id = create_resp.json()["id"]
        resp = client.delete(f"/v1/workflows/{wf_id}")
        assert resp.status_code == 200

    def test_scheduler_start_stop(self):
        resp = client.post("/v1/scheduler/start")
        assert resp.status_code == 200
        resp = client.post("/v1/scheduler/stop")
        assert resp.status_code == 200


# =============================================================================
# Config tests
# =============================================================================

class TestAutomationConfig:
    """Test automation configuration settings."""

    def test_automation_settings(self):
        from aetheris.core.config import settings
        assert settings.automations_enabled is True
        assert settings.workflow_max_steps == 50
        assert settings.max_connections == 100
        assert settings.max_workflows == 200

    def test_scheduler_settings(self):
        from aetheris.core.config import settings
        assert settings.scheduler_enabled is False
        assert settings.scheduler_tick_seconds == 30.0

    def test_capability_report_includes_automation(self):
        from aetheris.core.config import settings
        report = settings.capability_report()
        assert "automations" in report
        assert "scheduler" in report
