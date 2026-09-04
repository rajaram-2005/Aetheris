# Contributing to Aetheris

Thanks for helping build an open, free Intelligence OS. Aetheris is MIT-licensed and **free for everyone** — contributions must keep it that way (no paywalls, no metering by default, no vendor lock-in).

## Ground rules

1. **No fake integrations.** If a subsystem cannot run here, mark it `not_available`/`untestable_here` in the registry and docs. Never return synthetic data as if it were real.
2. **Provider-neutral.** Never hard-code one LLM vendor; go through the ModelRouter.
3. **Least privilege.** New actions declare a `security_level`; anything irreversible or physical requires confirmation. Stop/e-stop paths must never be gated by dialogs.
4. **Audit first, then change.** Preserve useful existing work; refactor rather than rewrite.
5. **Small, tested PRs.** `npm run typecheck && npm test && npm run eval && npm run build` must pass.

## Workflow

```bash
git checkout -b feat/<short-name>
# make changes; follow docs/DEVELOPMENT.md → "Adding a capability"
npm run typecheck && npm test && npm run eval
git commit -m "area: what and why"
gh pr create --fill
```

PR checklist:

- [ ] Capability registered with honest `status` + `verification_status`
- [ ] Route calls `authorize()` and `record()`; user URLs pass `ssrfCheck`
- [ ] Tests added (`tests/*.test.ts`), eval case if routing-relevant
- [ ] Docs updated (status table in the relevant `docs/*.md`)
- [ ] No secrets, no `data/` artefacts, no paid-only paths

## Good first contributions

* Real embedding provider adapters (see `docs/KNOWLEDGE.md`)
* Persistent audit/event store (`StorageProvider`)
* OPC-UA or CAN adapter behind `src/core/physical/interfaces.ts`
* Playwright engine hardening for the browser agent
* More intent/eval cases in `evals/cases.json`
* Translations of the UI strings

## Security issues

Do not open public issues for vulnerabilities; email the maintainer in `README.md`.

## Code of conduct

Be kind, be precise, assume good faith. Harassment of any kind is not tolerated.
