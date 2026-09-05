# Authentication and local integrations

Aetheris is a **local-only, anonymous-first** application. The web app opens directly in Chat; it has no login page and does not ask for a display name. Browser-local data is associated with an anonymous owner cookie, so you can start immediately.

Google and GitHub OAuth endpoints remain available for optional integrations such as the Coding Factory. They are not an entry screen. Connecting an online integration sends requests to that provider; it does not require hosting Aetheris publicly.

## 1. Choose a stable local address

For the browser workflow in [LOCAL SETUP](LOCAL_SETUP.md), use:

```text
http://localhost:3000
```

OAuth callback URLs must exactly match the address you use, including scheme, hostname and port. `localhost` and `127.0.0.1` are different OAuth origins; do not mix them.

The embedded desktop server normally uses `http://127.0.0.1:17890`. If configuring OAuth for that mode, register callbacks for its actual loopback address and port. If the port changes because it is occupied, update the registered callback too. A connector whose provider does not support local callbacks may require a pasted token instead; do not expose Aetheris publicly to work around that restriction.

## 2. Generate a stable local secret

```bash
openssl rand -hex 32
```

Store the result as `AETHERIS_SECRET` in `.env.local` (desktop: `<dataDir>/.env.local`). Never commit it, upload it, or paste it into a chat. Changing it signs out existing OAuth sessions and invalidates sealed credentials.

`AETHERIS_REQUIRE_AUTH` and `AETHERIS_GUEST_ACCESS` are legacy switches. The current web entry is always anonymous-first, so keep both set to `0` or remove them.

## 3. Google OAuth integration (optional)

1. Open Google Cloud Console → **APIs & Services** → **OAuth consent screen** and configure the app.
2. Create an OAuth client of type **Web application**.
3. For local browser use, add this exact authorized redirect URI:

   ```text
   http://localhost:3000/api/auth/google/callback
   ```

4. Add these values to your local environment file:

   ```dotenv
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```

The application requests only `openid email profile`. Treat the downloaded Google client JSON as a secret file; do not commit or upload it. No Google client is needed for ordinary local chat.

## 4. GitHub OAuth integration (optional)

1. Open GitHub → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**.
2. Set **Homepage URL** to `http://localhost:3000`.
3. Set **Authorization callback URL** exactly to:

   ```text
   http://localhost:3000/api/auth/github/callback
   ```

4. Add the generated credentials to your local environment file:

   ```dotenv
   GITHUB_CLIENT_ID=...
   GITHUB_CLIENT_SECRET=...
   ```

This connection is used by Aetheris's GitHub Coding Factory, so it requests repository/workflow access in addition to profile and email access. GitHub features use the online GitHub API and require your authorization. The Factory also supports connecting with a token in the app when OAuth is not configured.

## 5. Anonymous browser data

The default web flow creates an owner ID on the first owner-scoped request and stores it in an HTTP-only browser cookie. No name, email, phone number, or provider account is required.

- Conversations, projects and settings are browser-local; owner-scoped server records live in your local data directory.
- Clearing the owner cookie or browser data loses access to that anonymous owner. Export and back up data first.
- OAuth is only for features that explicitly need a provider identity, such as GitHub repository access.
- Keep the anonymous workspace on loopback; it is not a public hosted service.

## 6. Local environment example

```dotenv
AETHERIS_SECRET=<generated-locally>
AETHERIS_REQUIRE_AUTH=0
AETHERIS_GUEST_ACCESS=0

# Only if you use these integrations:
GOOGLE_CLIENT_ID=<local-secret>
GOOGLE_CLIENT_SECRET=<local-secret>
GITHUB_CLIENT_ID=<local-secret>
GITHUB_CLIENT_SECRET=<local-secret>
```

Keep real values in the ignored environment file—not in Git, `.env.example`, screenshots, uploaded JSON files or chat messages.

## 7. Verify locally

Restart the local process after adding environment variables, then inspect:

```bash
curl -s http://localhost:3000/api/auth/session
```

With both OAuth clients configured, the response should report an anonymous-ready workspace:

```json
{
  "account": null,
  "authRequired": false,
  "methods": {
    "google": true,
    "github": true,
    "guest": false
  }
}
```

Without those optional credentials, `google` and `github` are `false`; local chat should still open normally.

Then test:

1. Opening `/` goes directly to Chat.
2. No login page or display-name prompt is shown.
3. A first chat request creates anonymous owner data.
4. Any configured OAuth integration returns to the same local origin after authorization.
