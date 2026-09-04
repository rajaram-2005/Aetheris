# CI

`github-actions-ci.yml` is the GitHub Actions workflow (typecheck → tests → evals → build).

It lives here instead of `.github/workflows/` because the Arena GitHub App that pushes this branch
lacks the `workflows` permission. To enable CI, move it:

```bash
mkdir -p .github/workflows && git mv ci/github-actions-ci.yml .github/workflows/ci.yml && git commit -m "ci" && git push
```

The same checks run locally with `npm run typecheck && npm test && npm run eval && npm run build`.
