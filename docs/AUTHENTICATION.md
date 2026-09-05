# Authentication and integrations

Aetheris is anonymous-first. The web app opens directly in Chat; it has no login page and does not ask for a display name. Browser-local data is associated with an anonymous owner cookie, so a visitor can start immediately.

Google and GitHub OAuth endpoints remain available for integrations such as the Coding Factory. They are not used as an entry screen and no provider-choice controls are shown in the app shell.

## 1. Use a stable HTTPS address

Choose the final origin before creating OAuth applications, for example:

```text
https://aetheris.example.com
```

OAuth callback URLs must exactly match this origin.

## 2. Generate the server secret

Generate the session-encryption secret locally or in the hosting provider's secret manager:

```bash
openssl rand -hex 32
```

Store it as `AETHERIS_SECRET`. Never commit it, upload it, or paste it into a chat. Changing it signs out existing OAuth sessions and invalidates sealed credentials.

`AETHERIS_REQUIRE_AUTH` and `AETHERIS_GUEST_ACCESS` are legacy switches. The current web entry is always anonymous-first, so keep both set to `0` or remove them.

## 3. Google OAuth integration

1. Open Google Cloud Console → **APIs & Services** → **OAuth consent screen** and configure the app.
2. Create an OAuth client of type **Web application**.
3. Add this exact authorized redirect URI:

   ```text
   https://aetheris.example.com/api/auth/google/callback
   ```

4. Add these values to the deployment's server-side secret manager:

   ```dotenv
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```

The application requests only `openid email profile`. Treat the downloaded Google client JSON as a secret file; do not commit or upload it.

## 4. GitHub OAuth integration

1. Open GitHub → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**.
2. Set **Homepage URL** to `https://aetheris.example.com`.
3. Set **Authorization callback URL** exactly to:

   ```text
   https://aetheris.example.com/api/auth/github/callback
   ```

4. Add the generated credentials to the deployment secret manager:

   ```dotenv
   GITHUB_CLIENT_ID=...
   GITHUB_CLIENT_SECRET=...
   ```

This connection is used by Aetheris's GitHub Coding Factory, so it requests repository/workflow access in addition to profile and email access.

## 5. Anonymous browser data

The default web flow creates an owner ID on the first owner-scoped request and stores it in an HTTP-only browser cookie. No name, email, phone number, or provider account is required.

- Conversations, memory, projects, and settings remain local to that browser owner.
- Clearing the owner cookie or browser data loses access to that anonymous owner.
- OAuth is only for features that explicitly need a provider identity, such as GitHub repository access.

## 6. Production configuration

```dotenv
AETHERIS_SECRET=<generated-in-secret-manager>
AETHERIS_REQUIRE_AUTH=0
AETHERIS_GUEST_ACCESS=0

GOOGLE_CLIENT_ID=<server-secret>
GOOGLE_CLIENT_SECRET=<server-secret>
GITHUB_CLIENT_ID=<server-secret>
GITHUB_CLIENT_SECRET=<server-secret>
```

Keep values in the hosting provider's environment/secret manager—not in Git, `.env.example`, screenshots, uploaded JSON files, or chat messages.

## 7. Verify before launch

Restart the server after adding environment variables, then inspect:

```bash
curl -s https://aetheris.example.com/api/auth/session
```

The response should report an anonymous-ready workspace:

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

Then test:

1. Opening `/` goes directly to Chat.
2. No login page or display-name prompt is shown.
3. A first chat request creates browser-local owner data.
4. OAuth-only integrations work when their credentials are configured.
