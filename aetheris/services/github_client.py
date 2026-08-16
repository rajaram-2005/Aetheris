"""GitHub integration — push generated code straight to GitHub.

Two transports, picked automatically:

* **REST API** — when ``AETHERIS_GITHUB_TOKEN`` is configured, files are
  committed through the Git Data API (blob → tree → commit → ref → pull
  request) without ever touching a local checkout.
* **``gh`` CLI** — when no token is set, Aetheris shells out to GitHub's
  authenticated CLI (``gh auth login``) and a local ``git``, which covers
  developers who already have the toolchain.

Both paths support creating the repository if it does not exist, pushing to
a branch, and opening a pull request. Tokens are never logged or echoed;
errors carry the operation that failed, not the credential.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import os
import tempfile
from pathlib import Path
from typing import Any

import httpx

from ..core.config import settings

logger = logging.getLogger("aetheris")

_MAX_BLOB_BYTES = 8 * 1024 * 1024  # GitHub blobs cap at 100 MB; stay conservative.


class GitHubError(RuntimeError):
    """A GitHub operation failed with an actionable message."""


def _safe_repo(repo: str) -> str:
    repo = (repo or "").strip().strip("/")
    parts = repo.split("/")
    if len(parts) != 2 or not all(parts):
        raise GitHubError(f"'{repo}' is not a repository like owner/name.")
    return f"{parts[0].strip()}/{parts[1].strip()}"


async def _run(*args: str, cwd: str | None = None, timeout: float = 600.0) -> str:
    """Run a subprocess command and return trimmed stdout (raises on failure)."""
    env = dict(os.environ)
    env["GIT_TERMINAL_PROMPT"] = "0"
    process = await asyncio.create_subprocess_exec(
        *args,
        cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
    except asyncio.TimeoutError as exc:
        process.kill()
        raise GitHubError(f"'{' '.join(args)}' timed out after {timeout:g}s.") from exc
    if process.returncode != 0:
        tail = (stderr or stdout).decode(errors="replace").strip()[-400:]
        raise GitHubError(f"'{' '.join(args)}' failed: {tail}")
    return stdout.decode(errors="replace").strip()


async def gh_available() -> bool:
    """Whether the ``gh`` CLI exists and holds an authenticated session."""
    try:
        await _run("gh", "auth", "status", timeout=20.0)
        return True
    except (GitHubError, FileNotFoundError):
        return False


class GitHubClient:
    """Push code to GitHub over the REST API (token) or the gh CLI."""

    def __init__(
        self,
        *,
        token: str | None = None,
        base_url: str | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._token = token if token is not None else settings.github_token
        self._base_url = (base_url or settings.github_api_base_url).rstrip("/")
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        self._client = httpx.AsyncClient(
            base_url=self._base_url, headers=headers, timeout=120.0, transport=transport
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    @property
    def transport_name(self) -> str:
        return "rest-token" if self._token else "gh-cli"

    # --- transport detection ---------------------------------------------------

    async def status(self) -> dict[str, Any]:
        """Report connectivity: which transport is live and who is authenticated."""
        if self._token:
            try:
                response = await self._client.get("/user")
                if response.status_code == 200:
                    return {
                        "connected": True,
                        "transport": "rest-token",
                        "user": (response.json().get("login") or ""),
                    }
                return {
                    "connected": False,
                    "transport": "rest-token",
                    "detail": f"GET /user returned {response.status_code}.",
                }
            except httpx.HTTPError as exc:
                return {"connected": False, "transport": "rest-token", "detail": str(exc)}
        if await gh_available():
            try:
                who = await _run("gh", "api", "user", "--jq", ".login", timeout=20.0)
            except GitHubError:
                who = ""
            return {"connected": True, "transport": "gh-cli", "user": who}
        return {
            "connected": False,
            "transport": "none",
            "detail": (
                "No GitHub token configured (AETHERIS_GITHUB_TOKEN) and the "
                "'gh' CLI is not authenticated. Run 'gh auth login' or set the token."
            ),
        }

    # --- REST transport ----------------------------------------------------------

    async def _rest_request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        try:
            response = await self._client.request(method, url, **kwargs)
        except httpx.HTTPError as exc:
            raise GitHubError(f"GitHub {method} {url} failed: {exc}") from exc
        return response

    async def _rest_ensure_repo(self, repo: str, *, description: str = "", private: bool = False) -> str:
        owner, name = repo.split("/")
        response = await self._rest_request("GET", f"/repos/{repo}")
        if response.status_code == 200:
            return str(response.json().get("default_branch") or "main")
        if response.status_code not in (404, 401):
            raise GitHubError(
                f"Checking repository {repo} returned {response.status_code}: {response.text[:300]}"
            )
        create = await self._rest_request(
            "POST",
            "/user/repos",
            json={
                "name": name,
                "description": description or "Created by Aetheris",
                "private": private,
                "auto_init": True,
            },
        )
        if create.status_code >= 400:
            raise GitHubError(
                f"Creating repository {repo} returned {create.status_code}: {create.text[:300]}"
            )
        return str(create.json().get("default_branch") or "main")

    @staticmethod
    def _split_files(files: dict[str, Any]) -> dict[str, bytes]:
        """Normalise {path: str|bytes} to {path: bytes}; reject binaries > cap."""
        out: dict[str, bytes] = {}
        for path, content in files.items():
            path = (path or "").strip().lstrip("/")
            if not path or path.endswith("/"):
                continue
            if isinstance(content, str):
                payload = content.encode("utf-8")
            elif isinstance(content, (bytes, bytearray)):
                payload = bytes(content)
            else:
                raise GitHubError(f"File '{path}' must be text or bytes.")
            if len(payload) > _MAX_BLOB_BYTES:
                raise GitHubError(
                    f"File '{path}' is {len(payload)} bytes; the GitHub blob limit "
                    f"for this integration is {_MAX_BLOB_BYTES // (1024 * 1024)} MB."
                )
            out[path] = payload
        if not out:
            raise GitHubError("No files to push.")
        return out

    async def _rest_push(
        self,
        repo: str,
        files: dict[str, Any],
        *,
        branch: str,
        commit_message: str,
        base_branch: str,
        create_pr: bool,
    ) -> dict[str, Any]:
        base = await self._rest_ensure_repo(repo)
        base_branch = base_branch or base
        ref = await self._rest_request("GET", f"/repos/{repo}/git/ref/heads/{base_branch}")
        if ref.status_code != 200:
            raise GitHubError(
                f"Base branch '{base_branch}' of {repo} not found "
                f"({ref.status_code}). The repository may be empty."
            )
        base_sha = str(ref.json().get("object", {}).get("sha") or "")
        if not base_sha:
            raise GitHubError(f"Could not resolve the base branch '{base_branch}' of {repo}.")

        payloads = self._split_files(files)
        tree_entries: list[dict[str, Any]] = []
        for path, payload in payloads.items():
            blob = await self._rest_request(
                "POST",
                f"/repos/{repo}/git/blobs",
                json={"content": base64.b64encode(payload).decode(), "encoding": "base64"},
            )
            if blob.status_code >= 400:
                raise GitHubError(
                    f"Uploading '{path}' returned {blob.status_code}: {blob.text[:300]}"
                )
            tree_entries.append({
                "path": path,
                "mode": "100644",
                "type": "blob",
                "sha": blob.json().get("sha"),
            })

        tree = await self._rest_request(
            "POST", f"/repos/{repo}/git/trees",
            json={"base_tree": base_sha, "tree": tree_entries},
        )
        if tree.status_code >= 400:
            raise GitHubError(f"Creating tree returned {tree.status_code}: {tree.text[:300]}")

        commit = await self._rest_request(
            "POST",
            f"/repos/{repo}/git/commits",
            json={
                "message": commit_message or "Generated by Aetheris",
                "tree": tree.json().get("sha"),
                "parents": [base_sha],
            },
        )
        if commit.status_code >= 400:
            raise GitHubError(f"Creating commit returned {commit.status_code}: {commit.text[:300]}")
        commit_sha = commit.json().get("sha")

        update = await self._rest_request(
            "PATCH",
            f"/repos/{repo}/git/refs/heads/{branch}",
            json={"sha": commit_sha, "force": False},
        )
        if update.status_code not in (200, 201):
            # Branch does not exist yet: create it.
            create_ref = await self._rest_request(
                "POST",
                f"/repos/{repo}/git/refs",
                json={"ref": f"refs/heads/{branch}", "sha": commit_sha},
            )
            if create_ref.status_code >= 400:
                raise GitHubError(
                    f"Updating branch '{branch}' returned {update.status_code} "
                    f"and creating it returned {create_ref.status_code}."
                )

        result: dict[str, Any] = {
            "repo": repo,
            "branch": branch,
            "files": len(tree_entries),
            "commit": commit_sha,
            "html_url": f"https://github.com/{repo}",
            "pr_url": None,
        }
        if create_pr:
            pr = await self._rest_request(
                "POST",
                f"/repos/{repo}/pulls",
                json={
                    "title": commit_message or "Generated by Aetheris",
                    "head": branch,
                    "base": base_branch,
                    "body": (
                        f"Code generated by Aetheris ({len(tree_entries)} files).\n\n"
                        f"Commit: {commit_sha}"
                    ),
                },
            )
            if pr.status_code >= 400:
                result["pr_note"] = f"PR creation returned {pr.status_code}: {pr.text[:200]}"
            else:
                result["pr_url"] = pr.json().get("html_url")
        return result

    # --- gh CLI transport ---------------------------------------------------------

    async def _cli_push(
        self,
        repo: str,
        files: dict[str, Any],
        *,
        branch: str,
        commit_message: str,
        base_branch: str,
        create_pr: bool,
        description: str,
        private: bool,
    ) -> dict[str, Any]:
        payloads = self._split_files(files)
        owner, name = repo.split("/")
        # Ensure the repository exists (create under the authenticated user).
        try:
            await _run("gh", "repo", "view", repo, timeout=30.0)
        except GitHubError:
            await _run(
                "gh", "repo", "create", repo,
                *(["--private"] if private else ["--public"]),
                "--description", description or "Created by Aetheris",
                timeout=120.0,
            )
        with tempfile.TemporaryDirectory(prefix="aetheris-gh-") as tmp:
            root = Path(tmp) / name
            root.mkdir(parents=True)
            for path, payload in payloads.items():
                destination = root / path
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(payload)
            await _run("git", "init", "-b", branch, cwd=str(root), timeout=60.0)
            await _run("git", "add", "-A", cwd=str(root), timeout=120.0)
            await _run(
                "git", "-c", "user.name=Aetheris", "-c", "user.email=aetheris@users.noreply.github.com",
                "commit", "-m", commit_message or "Generated by Aetheris",
                cwd=str(root), timeout=120.0,
            )
            await _run("git", "remote", "add", "origin", f"https://github.com/{repo}.git",
                       cwd=str(root), timeout=60.0)
            await _run("git", "push", "-u", "origin", branch, cwd=str(root), timeout=600.0)
            sha = await _run("git", "rev-parse", "HEAD", cwd=str(root), timeout=30.0)

        result: dict[str, Any] = {
            "repo": repo,
            "branch": branch,
            "files": len(payloads),
            "commit": sha[:12],
            "html_url": f"https://github.com/{repo}",
            "pr_url": None,
        }
        if create_pr:
            try:
                pr_url = await _run(
                    "gh", "pr", "create", "--repo", repo,
                    "--base", base_branch or settings.github_default_branch,
                    "--head", branch,
                    "--title", commit_message or "Generated by Aetheris",
                    "--body", f"Code generated by Aetheris ({len(payloads)} files).",
                    timeout=120.0,
                )
                result["pr_url"] = pr_url
            except GitHubError as exc:
                result["pr_note"] = str(exc)[:200]
        return result

    # --- public API ---------------------------------------------------------------

    async def create_repo(
        self, repo: str, *, description: str = "", private: bool = False, auto_init: bool = True
    ) -> dict[str, Any]:
        repo = _safe_repo(repo)
        owner, name = repo.split("/")
        if self._token:
            response = await self._rest_request(
                "POST",
                "/user/repos",
                json={"name": name, "description": description or "Created by Aetheris",
                      "private": private, "auto_init": auto_init},
            )
            if response.status_code >= 400:
                raise GitHubError(
                    f"Creating repository {repo} returned {response.status_code}: {response.text[:300]}"
                )
            return {"repo": repo, "html_url": response.json().get("html_url"),
                    "created": response.status_code == 201}
        try:
            await _run("gh", "repo", "view", repo, timeout=30.0)
            return {"repo": repo, "html_url": f"https://github.com/{repo}", "created": False}
        except GitHubError:
            url = await _run(
                "gh", "repo", "create", repo,
                *(["--private"] if private else ["--public"]),
                "--description", description or "Created by Aetheris",
                timeout=120.0,
            )
            return {"repo": repo, "html_url": url, "created": True}

    async def push(
        self,
        repo: str,
        files: dict[str, Any],
        *,
        branch: str | None = None,
        commit_message: str = "Generated by Aetheris",
        base_branch: str | None = None,
        create_pr: bool | None = None,
        description: str = "",
        private: bool = False,
    ) -> dict[str, Any]:
        repo = _safe_repo(repo)
        branch = branch or f"aetheris/{_slug(commit_message)}"
        create_pr = settings.github_open_pr if create_pr is None else create_pr
        base_branch = base_branch or settings.github_default_branch
        if self._token:
            return await self._rest_push(
                repo, files, branch=branch, commit_message=commit_message,
                base_branch=base_branch, create_pr=create_pr,
            )
        return await self._cli_push(
            repo, files, branch=branch, commit_message=commit_message,
            base_branch=base_branch, create_pr=create_pr,
            description=description, private=private,
        )


def _slug(text: str, length: int = 40) -> str:
    import re

    value = re.sub(r"[^A-Za-z0-9_-]+", "-", (text or "generated").lower()).strip("-")
    return value[:length] or "generated"


def get_github_client() -> GitHubClient:
    """Build the process-wide client from settings."""
    global _client
    if _client is None:
        _client = GitHubClient()
    return _client


async def close_github_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


_client: GitHubClient | None = None


__all__ = [
    "GitHubError",
    "GitHubClient",
    "get_github_client",
    "close_github_client",
    "gh_available",
]
