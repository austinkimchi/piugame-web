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

## Private catalog overlay

Fetch public song metadata from the [public catalog API](public-catalog-api.md), then request account personalization separately:

```http
GET /api/mobile/v1/catalog/overlay?version=phoenix2
Authorization: Bearer <access-token>
```

The required `version` is exactly `phoenix` or `phoenix2`. This endpoint covers the supported catalog view; historical series, duplicate version parameters, and any `removed` parameter return HTTP 400. Browser session cookies and client-provided account IDs cannot select an account.

The response implements `MobileCatalogOverlay` from `src/lib/mobile-catalog-overlay-types.ts`:

```json
{
  "schemaVersion": 1,
  "version": "phoenix2",
  "favoriteSlugs": ["example-artist-phoenix"],
  "recommendations": {
    "example-artist-phoenix": {
      "all": "S18", "S": "S18", "SD": "S18", "SDC": "S18",
      "SC": "S18", "SCD": "S18", "D": "S18", "DS": "S18",
      "DSC": "S18", "DC": "S18", "DCS": "S18", "C": "S18",
      "CS": "S18", "CSD": "S18", "CD": "S18", "CDS": "S18"
    }
  }
}
```

Favorites use the selected public snapshot's slugs, including source-version Phoenix aliases for existing saved songs. Only favorites present in that snapshot are returned. Recommendations are keyed by public song slug, then ordered preferred chart modes: `all`, `S`, `D`, `C`, `SD`, `SC`, `DS`, `DC`, `CS`, `CD`, `SDC`, `SCD`, `DSC`, `DCS`, `CSD`, and `CDS`. Each value is a chart token or `null`; songs without recommendations are omitted. Mode keys express preference order, not a strict chart filter: recent play evidence can select a chart outside the preferred mode. The endpoint reuses the web recommendation helper and does not change ranked recommendation feeds. Raw scores, play evidence, account profiles, notes, and filesystem paths are never returned.

Successful requests read the public snapshot once, favorites once, and private recommendation evidence once through the shared helper. Every handled response uses `Cache-Control: private, no-store`, `Pragma: no-cache`, and `Vary: Authorization`. There is no private server cache, ETag, or 304 response. Invalid, expired, revoked, or deleted-account tokens return HTTP 401; unavailable dependencies return HTTP 503 with `catalog_overlay_unavailable`, never a successful empty fallback.

Keep the overlay separate from the public catalog cache. Scope in-memory client state by authenticated account and version, clear it on logout/account changes, and discard requests completed under an old account or version. After a successful favorite update, reconcile the returned legacy slug with the public alias and reject older overlay responses that would undo that update. Refresh recommendations after a performance import. These client rules are required even when a canceled request still delivers a response.
