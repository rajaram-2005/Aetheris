"""Pre-built integration templates for popular services.

Each template is a factory that creates a ConnectionCreate and optionally
a WorkflowCreate, so connecting to common services is a single API call
instead of manually configuring auth, URLs, and steps.

Supported services:
* Slack (incoming webhooks, API)
* GitHub (REST API, webhooks)
* Discord (webhooks)
* Email (via SMTP relay HTTP API)
* Notion (API)
* Jira (REST API)
* PagerDuty (Events API)
* Custom (any REST API)
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from .connections import ConnectionCreate
from .workflows import WorkflowStep, WorkflowCreate, TriggerConfig


class IntegrationTemplate(BaseModel):
    """Metadata about an integration template."""

    service: str
    name: str
    description: str
    auth_type: str
    required_fields: list[str]
    optional_fields: list[str] = Field(default_factory=list)


# --- Template registry ---------------------------------------------------------

TEMPLATES: dict[str, dict[str, Any]] = {
    "slack": {
        "service": "slack",
        "name": "Slack",
        "description": "Send messages and interact with Slack workspaces via the Web API or incoming webhooks.",
        "auth_type": "bearer",
        "required_fields": ["bearer_token"],
        "optional_fields": ["base_url"],
        "default_base_url": "https://slack.com/api",
        "auth_header_prefix": "Bearer ",
    },
    "slack-webhook": {
        "service": "slack-webhook",
        "name": "Slack Incoming Webhook",
        "description": "Post messages to a Slack channel via an incoming webhook URL.",
        "auth_type": "custom",
        "required_fields": ["base_url"],
        "optional_fields": [],
        "default_base_url": "",
    },
    "github": {
        "service": "github",
        "name": "GitHub",
        "description": "Interact with the GitHub REST API (repos, issues, PRs, actions).",
        "auth_type": "bearer",
        "required_fields": ["bearer_token"],
        "optional_fields": [],
        "default_base_url": "https://api.github.com",
        "auth_header_prefix": "Bearer ",
        "extra_headers": {"Accept": "application/vnd.github+json"},
    },
    "discord": {
        "service": "discord",
        "name": "Discord",
        "description": "Send messages to Discord channels via webhooks.",
        "auth_type": "custom",
        "required_fields": ["base_url"],
        "optional_fields": [],
        "default_base_url": "",
    },
    "notion": {
        "service": "notion",
        "name": "Notion",
        "description": "Read and write Notion pages and databases via the API.",
        "auth_type": "bearer",
        "required_fields": ["bearer_token"],
        "optional_fields": [],
        "default_base_url": "https://api.notion.com/v1",
        "auth_header_prefix": "Bearer ",
        "extra_headers": {"Notion-Version": "2022-06-28"},
    },
    "jira": {
        "service": "jira",
        "name": "Jira",
        "description": "Interact with Jira issues, projects, and workflows.",
        "auth_type": "basic",
        "required_fields": ["username", "password", "base_url"],
        "optional_fields": [],
    },
    "pagerduty": {
        "service": "pagerduty",
        "name": "PagerDuty",
        "description": "Trigger and resolve incidents via the Events API.",
        "auth_type": "api_key",
        "required_fields": ["api_key_val"],
        "optional_fields": [],
        "default_base_url": "https://events.pagerduty.com/v2",
        "auth_header_name": "X-Routing-Key",
    },
    "stripe": {
        "service": "stripe",
        "name": "Stripe",
        "description": "Interact with the Stripe API for payments, customers, and subscriptions.",
        "auth_type": "bearer",
        "required_fields": ["bearer_token"],
        "optional_fields": [],
        "default_base_url": "https://api.stripe.com/v1",
    },
    "sendgrid": {
        "service": "sendgrid",
        "name": "SendGrid",
        "description": "Send emails via the SendGrid API.",
        "auth_type": "bearer",
        "required_fields": ["bearer_token"],
        "optional_fields": [],
        "default_base_url": "https://api.sendgrid.com/v3",
        "auth_header_prefix": "Bearer ",
    },
    "twilio": {
        "service": "twilio",
        "name": "Twilio",
        "description": "Send SMS and make calls via the Twilio API.",
        "auth_type": "basic",
        "required_fields": ["username", "password", "base_url"],
        "optional_fields": [],
    },
    "custom": {
        "service": "custom",
        "name": "Custom REST API",
        "description": "Connect to any REST API with custom configuration.",
        "auth_type": "api_key",
        "required_fields": ["base_url"],
        "optional_fields": ["api_key_val", "bearer_token", "username", "password", "auth_header_name", "auth_query_param"],
    },
    "gmail": {
        "service": "gmail",
        "name": "Gmail",
        "description": "Read, compose, and send email through the Gmail API (OAuth2).",
        "auth_type": "bearer",
        "required_fields": ["bearer_token"],
        "optional_fields": ["base_url"],
        "default_base_url": "https://gmail.googleapis.com/gmail/v1",
        "auth_header_prefix": "Bearer ",
    },
    "google-meet": {
        "service": "google-meet",
        "name": "Google Meet",
        "description": "Create and manage Google Meet video conferences via the Meet API.",
        "auth_type": "bearer",
        "required_fields": ["bearer_token"],
        "optional_fields": ["base_url"],
        "default_base_url": "https://meet.googleapis.com/v2",
        "auth_header_prefix": "Bearer ",
    },
    "google-calendar": {
        "service": "google-calendar",
        "name": "Google Calendar",
        "description": "Read and create calendar events via the Google Calendar API.",
        "auth_type": "bearer",
        "required_fields": ["bearer_token"],
        "optional_fields": ["base_url"],
        "default_base_url": "https://www.googleapis.com/calendar/v3",
        "auth_header_prefix": "Bearer ",
    },
    "google-drive": {
        "service": "google-drive",
        "name": "Google Drive",
        "description": "List, upload, and manage files in Google Drive.",
        "auth_type": "bearer",
        "required_fields": ["bearer_token"],
        "optional_fields": ["base_url"],
        "default_base_url": "https://www.googleapis.com/drive/v3",
        "auth_header_prefix": "Bearer ",
    },
    "google-sheets": {
        "service": "google-sheets",
        "name": "Google Sheets",
        "description": "Read and write spreadsheet cells and ranges.",
        "auth_type": "bearer",
        "required_fields": ["bearer_token"],
        "optional_fields": ["base_url"],
        "default_base_url": "https://sheets.googleapis.com/v4",
        "auth_header_prefix": "Bearer ",
    },
    "telegram": {
        "service": "telegram",
        "name": "Telegram",
        "description": "Send and receive messages via the Telegram Bot API.",
        "auth_type": "api_key",
        "required_fields": ["api_key_val"],
        "optional_fields": [],
        "default_base_url": "https://api.telegram.org/bot",
        "auth_query_param": "",
    },
    "whatsapp": {
        "service": "whatsapp",
        "name": "WhatsApp",
        "description": "Send messages through the WhatsApp Business Cloud API.",
        "auth_type": "bearer",
        "required_fields": ["bearer_token", "phone_number_id"],
        "optional_fields": ["base_url"],
        "default_base_url": "https://graph.facebook.com/v19.0",
        "auth_header_prefix": "Bearer ",
    },
    "linkedin": {
        "service": "linkedin",
        "name": "LinkedIn",
        "description": "Post updates and read profiles via the LinkedIn API.",
        "auth_type": "bearer",
        "required_fields": ["bearer_token"],
        "optional_fields": [],
        "default_base_url": "https://api.linkedin.com/v2",
        "auth_header_prefix": "Bearer ",
    },
    "instagram": {
        "service": "instagram",
        "name": "Instagram",
        "description": "Publish media and read insights via the Instagram Graph API.",
        "auth_type": "bearer",
        "required_fields": ["bearer_token", "instagram_business_id"],
        "optional_fields": ["base_url"],
        "default_base_url": "https://graph.facebook.com/v19.0",
        "auth_header_prefix": "Bearer ",
    },
    "youtube": {
        "service": "youtube",
        "name": "YouTube",
        "description": "Search videos and fetch metadata via the YouTube Data API.",
        "auth_type": "api_key",
        "required_fields": ["api_key_val"],
        "optional_fields": [],
        "default_base_url": "https://www.googleapis.com/youtube/v3",
    },
}


def list_templates() -> list[IntegrationTemplate]:
    """List all available integration templates."""
    return [
        IntegrationTemplate(
            service=t["service"], name=t["name"], description=t["description"],
            auth_type=t["auth_type"], required_fields=t["required_fields"],
            optional_fields=t.get("optional_fields", []),
        )
        for t in TEMPLATES.values()
    ]


def get_template(service: str) -> IntegrationTemplate | None:
    t = TEMPLATES.get(service)
    if t is None:
        return None
    return IntegrationTemplate(
        service=t["service"], name=t["name"], description=t["description"],
        auth_type=t["auth_type"], required_fields=t["required_fields"],
        optional_fields=t.get("optional_fields", []),
    )


def build_connection(service: str, **kwargs: Any) -> ConnectionCreate:
    """Build a ConnectionCreate from a template + user-provided credentials.

    The template fills in defaults (base_url, auth headers, etc.); the user
    provides the actual credentials.
    """
    template = TEMPLATES.get(service)
    if template is None:
        raise ValueError(f"Unknown integration template: '{service}'. Available: {', '.join(sorted(TEMPLATES))}")

    return ConnectionCreate(
        name=kwargs.get("name", template["name"]),
        service_type=template["service"],
        auth_type=template["auth_type"],
        base_url=kwargs.get("base_url", template.get("default_base_url", "")),
        api_key_val=kwargs.get("api_key_val", ""),
        bearer_token=kwargs.get("bearer_token", ""),
        username=kwargs.get("username", ""),
        password=kwargs.get("password", ""),
        auth_header_name=kwargs.get("auth_header_name", template.get("auth_header_name", "Authorization")),
        auth_header_prefix=kwargs.get("auth_header_prefix", template.get("auth_header_prefix", "")),
        auth_query_param=kwargs.get("auth_query_param", template.get("auth_query_param", "")),
        custom_headers=kwargs.get("custom_headers", template.get("extra_headers", {})),
        metadata=kwargs.get("metadata", {}),
    )


# --- Common workflow recipes ---------------------------------------------------

def slack_notify_workflow(connection_id: str, channel: str = "#general") -> WorkflowCreate:
    """Pre-built workflow: send a Slack message."""
    return WorkflowCreate(
        name="Slack Notify",
        description=f"Send a message to {channel} via Slack.",
        steps=[
            WorkflowStep(
                name="post_message", type="connection",
                connection_id=connection_id, method="POST",
                path="/chat.postMessage",
                body_template={"channel": channel, "text": "{{message}}"},
                output_key="slack_result",
            ),
        ],
        trigger=TriggerConfig(type="event", event_pattern="notification.slack"),
    )


def github_issue_workflow(connection_id: str, repo: str) -> WorkflowCreate:
    """Pre-built workflow: create a GitHub issue."""
    return WorkflowCreate(
        name="Create GitHub Issue",
        description=f"Create an issue in {repo}.",
        steps=[
            WorkflowStep(
                name="create_issue", type="connection",
                connection_id=connection_id, method="POST",
                path=f"/repos/{repo}/issues",
                body_template={"title": "{{title}}", "body": "{{body}}"},
                output_key="github_result",
            ),
        ],
        trigger=TriggerConfig(type="manual"),
    )


def api_poll_workflow(connection_id: str, path: str, interval_cron: str = "*/5 * * * *") -> WorkflowCreate:
    """Pre-built workflow: poll an API endpoint on a schedule."""
    return WorkflowCreate(
        name="API Poll",
        description=f"Poll {path} on schedule {interval_cron}.",
        steps=[
            WorkflowStep(
                name="fetch", type="connection",
                connection_id=connection_id, method="GET",
                path=path, output_key="poll_result",
            ),
            WorkflowStep(
                name="check_ok", type="condition",
                condition_expr="result.get('ok') == True",
                then_steps=[
                    WorkflowStep(
                        name="extract_data", type="transform",
                        transform_expr="result.body", output_key="data",
                    ),
                ],
            ),
        ],
        trigger=TriggerConfig(type="cron", cron_expression=interval_cron),
    )


__all__ = [
    "IntegrationTemplate", "TEMPLATES",
    "list_templates", "get_template", "build_connection",
    "slack_notify_workflow", "github_issue_workflow", "api_poll_workflow",
]
