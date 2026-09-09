# Merge plan: PR #17 (branch arena/01a07aff-aetheris) onto main (post-RAVANA)

## Context

- **Base branch:** `arena/01a07aff-aetheris` (this session's work, 32 commits, head `d789a42`).
- **Target:** `main` (post-PR #16 merge, head `3eb13a0`).
- **Conflict state:** `DIRTY` on GitHub. 36 files with add/add conflicts.
- **Untouched by this branch (45 files on main that don't exist on the branch):** the entire RAVANA system under `src/core/ravana/`, `src/app/api/v1/ravana/`, `src/app/api/providers/`, the `Brand.tsx` and `AddProviderBox.tsx` components, `lib/branding.ts`, `lib/router/{customProviders,runtimeKeys}.ts`, and `docs/RAVANA.md`.
- **Branch-only files (115 new on the branch):** all 58 modules built this session — the 9 deepening pieces, the 3 Section-3 pieces, the Section-2 #3 eval harness, the `/tasks` page and its composer, the eval harness, and the README Section-3 table.

## General rule

For every conflict in a shared file:

1. **Take main's version as the base** (because it has the actual function signatures the rest of main's code calls — `allProviders`, `resolvedEnv`, `runtimeKeyFor`).
2. **Re-apply the branch's additions on top**, carefully, by hand-merge (not auto-merge), so I can see exactly what lands.
3. **Never overwrite an RAVANA-only file.** They don't conflict, they are only on main; they go in as-is.

## Resolution per conflict file

| File | Resolution |
|---|---|
| `.env.example` | Take main, then append branch's additions. |
| `CHANGELOG.md` | Concatenate: main's Unreleased block (Settings keys, Aetheris One) followed by branch's Unreleased block (the deepening + Section-3 + tasks + eval additions). |
| `README.md` | Take main as base, then insert branch's "What Aetheris can say today" section. Add a "58 modules" badge near main's "55 modules" line. |
| `docs/API.md` | Take main. Branch never added API rows that aren't already implied. |
| `docs/MODELS.md` | Take main (the runtime-key paragraph from main is the right one). |
| `docs/OVERVIEW.md` | Take main. Re-add the branch's row if missing — actually main has the RAVANA row, branch had additional rows; just take main. |
| `package-lock.json` | Re-run `npm install` after the merge; regenerate. Don't hand-merge. |
| `src/app/api/arena/route.ts` | Take main. Branch's 2 lines are part of the arena refactor; need to check. |
| `src/app/api/debate/route.ts` | Same — check. |
| `src/app/globals.css` | Concatenate: main's CSS first, then branch's `.acc-*`, `.tasks-*`, `.cores-*`, `.ch-*` etc. CSS is mostly additive. |
| `src/app/layout.tsx` | Take main (has hydration fix script). |
| `src/components/Apps.tsx` | Take main (uses BrandTile). |
| `src/components/Chat.tsx` | Take main as base, then re-add `import CommandPalette` (branch's addition) and the CommandPalette reference in the component. |
| `src/components/HomeDashboard.tsx` | Take main (uses BrandTile). |
| `src/components/MeshPanel.tsx` | Take main (uses BrandTile and AddProviderBox). |
| `src/components/SettingsModal.tsx` | Take main (has the 320-line keys manager). |
| `src/components/Sidebar.tsx` | Take main (has RAVANA mode). |
| `src/core/automation/engine.ts` | Take main. |
| `src/core/capabilities/sources.ts` | Take main as base, then re-add branch's 6 added capability entries (`system:symbolic-verifier`, `device:edge`, `memory:pbnn`, `lab:run`, `domain:wind-turbine`, `diagnostics:fft`). |
| `src/core/knowledge/fabric.ts` | Take main. |
| `src/core/multimodal/perceive.ts` | Take main (uses `allProviders` and `resolvedEnv`). |
| `src/core/twins/twins.ts` | Take main as base, then re-apply the 2 additive changes (maintenance entry has `doneAt?` and `doneNote?`; overdue filter excludes `doneAt`). |
| `src/lib/auth/deliver.ts` | Take main (uses `resolvedEnv`). |
| `src/lib/billing/plans.ts` | Take main (aetheris-one is in the description). |
| `src/lib/docs/guides.ts` | Take main (aetheris-one paragraph). |
| `src/lib/docs/reference.ts` | Take main (uses `allProviders`). |
| `src/lib/i18n.ts` | Take main (has `mode.ravana` key). |
| `src/lib/media/router.ts` | Take main (uses `runtimeKeyFor`). |
| `src/lib/models/tiers.ts` | Take main (has `aetheris-one` tier entry). |
| `src/lib/router/providers.ts` | Take main. Branch's "Experiential Labs" entry (unverified model names) is **NOT** carried forward — the user requirement is "unverified model names must not be wired in," and that entry explicitly says "DO NOT match any model the upstream vendors have publicly shipped." It must stay out of the merge. |
| `src/lib/router/router.ts` | Take main. |
| `src/lib/router/types.ts` | Take main. |
| `src/lib/schedules/engine.ts` | Take main (uses `resolvedEnv`). |
| `src/lib/search/tavily.ts` | Take main (uses runtime keys). |
| `src/lib/store.ts` | Take main (has `dirChanged` cache fix that branch also has — same change). |
| `tests/plans.test.ts` | Take main (has Aetheris One assertion). |

## Files only on the branch (no conflict, copy verbatim)

All 58 modules' new files:

- `src/app/{accuracy,tasks,cores-health,arena-compare,maintenance-calendar,residual-thresholds,thresholds,trust,admin,core/*,…}/page.tsx`
- `src/app/api/maintenance/close/route.ts` (new in this slice)
- `src/app/api/agents/*`, `src/app/api/arena/*`, etc.
- `src/core/diagnostics/eval.ts`
- `src/core/maintenance/tasks.ts`
- `src/core/orchestration/health.ts`
- `src/core/learning/residual-thresholds.ts`
- `src/core/diagnostics/thresholds.ts`
- `src/core/autonomy/*`
- `src/core/trust/*`
- `src/core/credits/*`
- `src/core/recount/*` (recompute)
- `src/lib/session.ts`
- `src/components/TaskCloseButton.tsx`
- `src/components/CommandPalette.tsx` (modified — merge)
- `tests/*` (all new tests, no overlap with PR #16's tests)

## Files only on main (no conflict, copy verbatim)

RAVANA system + Settings keys manager + Providers by link + Aetheris One + hydration fix:
- `src/core/ravana/**` (20 files)
- `src/app/api/v1/ravana/**` (12 routes)
- `src/app/api/providers/{custom,keys}/**`
- `src/components/{Ravana,Brand,AddProviderBox}.tsx`
- `src/lib/{branding,router/customProviders,router/runtimeKeys}.ts`
- `docs/RAVANA.md`
- The keys manager additions to `SettingsModal.tsx`, `meshStatus` additions to `router.ts`, `aetheris-one` tier in `tiers.ts`, etc. (all in conflict files; resolution per above)

## What I will do

1. **Create a worktree at `3eb13a0`.** Working tree is `main`. Untouched branch lives at `arena/01a07aff-aetheris`.
2. **Manually apply each conflict resolution** from the table above. No auto-merge, no `git rerere`. Every resolution is read+write, then diffed against both sides.
3. **Copy branch-only files** into the worktree.
4. **Run `tsc --noEmit`.** Fix any compile errors introduced by the merge (likely 0 — branch-only files don't touch main's changed files except where the table above says so).
5. **Run `npm test`.** Compare against the 207-on-main / 12-new-on-branch baseline. The 2 pre-existing knowledge-graph failures stay; nothing new should break.
6. **Commit the merge** with message: `Merge arena/01a07aff-aetheris into main: 58 modules + RAVANA integration`. Then **stop and let you push**. I will not push the merge commit.
7. **Tell you what to do next** — `gh pr merge --merge` if the PR is re-evaluable, or open a fresh PR with the new head.

## What I will not do

- I will not skip any of the 36 resolutions. Each is small and tractable.
- I will not overwrite RAVANA.
- I will not include the "Experiential Labs" provider entry from branch (unverified model names).
- I will not push the merge commit.
- I will not run `gh pr merge --admin`.
