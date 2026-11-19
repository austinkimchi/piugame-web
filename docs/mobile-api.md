# MyPIU mobile API

The mobile API lets first-party native clients authenticate with MyPIU and upload normalized PIUGAME performance data collected on the user's device. PIUGAME passwords, cookies, and raw HTML are not accepted.

## Authentication

MyPIU uses an OAuth-style authorization-code flow with PKCE for the native apps:

1. Generate a PKCE verifier, its S256 challenge, and an unpredictable state value.
2. Open `GET /api/mobile/v1/authorize` in the system authentication session.
3. MyPIU completes the existing Google or Discord login and redirects to the allowlisted app URL with a short-lived, one-time code.
4. Exchange the code at `POST /api/mobile/v1/token`.
5. Store the returned access token in the platform keychain and send it as `Authorization: Bearer ...`.

Authorization parameters:

- `client_id`: `mypiu-ios` or `mypiu-android`.
- `redirect_uri`: exact match from `MOBILE_OAUTH_REDIRECT_URIS`.
- `code_challenge` and `code_challenge_method=S256`.
- `state`: 16 to 256 printable ASCII characters.
- `provider`: optional `google` or `discord`; defaults to Google.

Token requests use `application/x-www-form-urlencoded` or JSON with `grant_type=authorization_code`, `client_id`, `code`, `code_verifier`, `redirect_uri`, `installation_id`, and optional `app_version`.

On iOS, the native Sign in with Apple button uses a token-exchange request to the same endpoint. It sends `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`, `subject_token_type=urn:ietf:params:oauth:token-type:id_token`, the Apple identity token as `subject_token`, the original nonce, `client_id=mypiu-ios`, `installation_id`, and optional name and app-version fields. The server validates Apple's signature, issuer, app audience, expiration, and nonce before issuing a MyPIU access token.

Access tokens are random, stored only as SHA-256 hashes, expire after 90 days, and can be revoked with `DELETE /api/mobile/v1/token`. `GET /api/mobile/v1/me` returns the authenticated MyPIU account and linked PIUGAME identity.

## Performance import

`POST /api/mobile/v1/performance/import` accepts up to 256 KiB of normalized JSON. The payload includes:

- Schema version, source, app version, installation ID, generation time, and idempotency key.
- The linked PIUGAME username and normalized profile metrics.
- At most 100 normalized recent plays, including chart, score, grade, plate, judgments, and PIUGAME timestamp.

The endpoint enforces these boundaries:

- Native source and installation ID must match the access token.
- Browser-extension imports require an authenticated same-origin MyPIU session.
- The PIUGAME username must match the account already linked to the MyPIU user.
- Password, credential, cookie, and raw-HTML fields are rejected recursively.
- Idempotency receipts remain for 30 days. Reusing a key with different content is rejected.
- A durable per-user and installation limit allows 30 imports per minute.
- Expired processing leases can be reclaimed after five minutes; underlying play writes remain idempotent.

Successful new imports return HTTP 201. An exact replay returns the original receipt with HTTP 200 and `duplicateRequest: true`.

The browser extension can retrieve the signed-in user's linked PIUGAME username and selected release from `GET /api/mobile/v1/extension/context`. This endpoint accepts only the existing same-origin MyPIU session cookie and never returns PIUGAME credentials.
