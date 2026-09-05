# Authentication setup

The Aetheris login page supports:

- **Google OAuth**
- **GitHub OAuth**
- **Named guest access** — a visitor enters a display name; no email or phone is requested

Email-code and SMS-code login are not exposed. Google and GitHub identities create verified, cross-device accounts. A guest receives a sealed browser session and a private owner ID, but the identity cannot be recovered on another device.

## 1. Use a stable HTTPS address

Choose the final origin before creating OAuth applications, for example:

```text
https://aetheris.example.com
```

OAuth callback URLs must exactly match this origin. Temporary preview URLs are useful for guest-flow testing but should not be registered as the production OAuth origin.

## 2. Generate the server secret

Generate the session-encryption secret locally or in the hosting provider's secret manager:

```bash
openssl rand -hex 32
```

Store it as `AETHERIS_SECRET`. Never commit it, upload it, or paste it into a chat. Changing it signs out existing sessions and invalidates sealed credentials.

Enable the login gate and named guests:

```dotenv
AETHERIS_REQUIRE_AUTH=1
AETHERIS_GUEST_ACCESS=1
```

Unauthenticated page requests redirect to `/login`; protected API requests return HTTP `401`. Login/OAuth callbacks, health checks, documentation, public share links, API-key endpoints, hooks, and the protected scheduler callback remain reachable. The embedded desktop server intentionally bypasses the gate so it can work offline.

## 3. Google OAuth

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

The application requests only `openid email profile`. Treat the downloaded Google client JSON as a secret file; do not commit or upload it. Copy only its client ID and client secret into the host's secret manager, then delete unsecured copies.

## 4. GitHub OAuth

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

A separate OAuth app is recommended for local development because callback configuration is tied to the OAuth app. This connection is also used by Aetheris's GitHub Coding Factory, so it requests repository/workflow access in addition to profile and email access.

## 5. Named guest behavior

When `AETHERIS_GUEST_ACCESS=1`, the login page asks only **“What should we call you?”**. Submitting a 2–50 character display name creates:

- a random private owner ID;
- a sealed HTTP-only session cookie;
- an account record marked as a guest;
- access to characters, chats, and other owner-scoped features.

Guest data remains available while that sealed browser session exists. Signing out ends access to that guest identity; the display name is not a password or recovery credential. Use Google or GitHub whenever cross-device access or account recovery is needed.

Set `AETHERIS_GUEST_ACCESS=0` if a deployment should allow OAuth accounts only.

## 6. Production configuration

```dotenv
AETHERIS_REQUIRE_AUTH=1
AETHERIS_GUEST_ACCESS=1
AETHERIS_SECRET=<generated-in-secret-manager>

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

Without exposing credentials, it reports readiness:

```json
{
  "account": null,
  "authRequired": true,
  "methods": {
    "google": true,
    "github": true,
    "guest": true
  }
}
```

Then test:

1. Opening `/` while signed out redirects to `/login`.
2. Google returns to the originally requested page.
3. GitHub returns to the originally requested page.
4. A guest can continue after entering only a name.
5. A guest sees only their owner-scoped custom characters.
6. Signing out makes protected APIs return `401`.
