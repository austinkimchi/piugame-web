# Sign in with Apple setup

MyPIU verifies Apple identity tokens on the server and stores Apple's stable subject identifier as the linked identity. The iOS app uses `AuthenticationServices`; the website uses Apple's web authorization endpoint.

## Apple Developer configuration

1. Enable **Sign in with Apple** for the `com.austinkimchi.mypiu` App ID and make it the primary App ID for MyPIU.
2. Create a Services ID for the website and associate it with that primary App ID. Register the production domain and this return URL exactly:

   `https://mypiu.austin.kim/api/auth/apple/callback`

3. Create a Sign in with Apple key for the primary App ID and download its private key. Apple only allows this file to be downloaded once, so store it in the deployment secret manager.
4. Keep the Services ID and native App ID in the same Sign in with Apple group. This makes Apple's subject identifier consistent across iOS and the website.
5. Configure the deployment environment:

   - `APPLE_WEB_CLIENT_ID`: the Services ID
   - `APPLE_NATIVE_CLIENT_ID`: `com.austinkimchi.mypiu`
   - `APPLE_TEAM_ID`: the Apple Developer team identifier
   - `APPLE_KEY_ID`: the Sign in with Apple key identifier
   - `APPLE_PRIVATE_KEY`: the downloaded private key in PEM form; escaped `\n` line breaks are supported
   - `APPLE_OAUTH_STATE_SECRET`: a random value containing at least 32 characters
   - `APPLE_OAUTH_ORIGIN`: `https://mypiu.austin.kim`

The web callback uses `form_post`, so the registered return URL must use HTTPS. Apple supplies a name only on the first authorization; MyPIU stores it immediately and relies on the verified email and Apple subject on later sign-ins.

Existing signed-in users can link Apple from Account preferences. Signed-out users are matched to an existing MyPIU account only when Apple supplies the same verified email address; otherwise MyPIU creates a new account that the user can link explicitly while signed in.
