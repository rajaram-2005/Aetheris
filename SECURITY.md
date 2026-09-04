# Security Policy

The full security architecture (permission levels, physical grant, SSRF guard, rate limits, sandbox, audit, honest limits) is documented in [docs/SECURITY.md](docs/SECURITY.md).

## Supported versions
The `main` branch. Deployments should track the latest release.

## Reporting a vulnerability
Please **do not** open a public issue. Email **ramkpraja175@gmail.com** with details and reproduction steps.
You will get an acknowledgement within 72 hours and a fix or mitigation plan within 14 days for confirmed issues.

## Scope notes
- Provider API keys are stored server-side sealed with `AETHERIS_SECRET`; never commit `.env*` or `data/`.
- Session, admin and OTP flows live in `src/lib/auth/` and `src/lib/billing/admin.ts`.
- The `/api/v1` OpenAI-compatible endpoint and MCP hub authenticate with `sk-aeth-` keys.
