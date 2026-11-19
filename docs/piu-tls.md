# Strict PIUGAME TLS

## Release prerequisite

This integration requires the reviewed SDK change adding `PiuClientOptions.ca` and applying the constructor TLS policy to binary downloads. Registry SDK 1.3.3 does not support that API. Until the new SDK is published and its actual version/integrity are pinned in `package.json` and `package-lock.json`, this is a blocked draft, not deployable source. Local validation uses a disposable packed SDK candidate; no local dependency path belongs in the committed lock.

Release order: review/merge the SDK; check version availability and deliberately publish the built package; pin its actual registry version/integrity here; repeat Linux CI and exact-head review; qualify authorized account linking/sync; coordinate deployment. Do not disable fallback in the live application before the chain remedy is available.

## Scope

`createPiuClient()` is the single server-only constructor for profile linking and all four performance-client paths. It combines the runtime's existing `getCACertificates("default")` list with one reviewed intermediate, and explicitly sets certificate verification on and insecure fallback off. Only these SDK clients receive the CA list. MongoDB, OAuth, other HTTPS clients, the OS trust store and process environment are untouched.

The list applies to all HTTPS requests made by that SDK client, including redirects and binary assets. It supplements chain-building material; it does not pin a particular PIUGAME leaf or authorize arbitrary names. SDK partial-chain trust remains disabled, so the intermediate must chain to an existing trusted root. Hostname, signature and expiry verification remain required. Custom SDK transports own their TLS policy and are not used by this factory.

## Public certificate provenance

On November 19, 2026, anonymous probes of both `piugame.com` and `phoenix.piugame.com` showed an incomplete server chain: only a wildcard leaf, issued by Sectigo Public Server Authentication CA DV R36. The leaf covers both hosts and expires March 31, 2027. Node 24.22.3 on the web host rejected both with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`; existing roots plus the reviewed intermediate validated both. The intermediate alone, wrong-hostname control and expired-leaf control were rejected. No account credentials were used.

`src/lib/piu-tls-ca.ts` embeds the public PEM so deployment does not depend on runtime file discovery or remote certificate downloads. The [official Sectigo inventory](https://www.sectigo.com/knowledge-base/detail/Sectigo-Public-Intermediates-and-Roots) links its [certificate record](https://crt.sh/?d=4267304690), fetched over normally verified HTTPS. Certificate DER SHA-256: `8c54c334b66ba4e426772af4a3f9136c19a1aec729fdb28c535c07a5a4ef22e0`. PEM SHA-256: `b40358316fd9e1caaaab92c382927d2c13ef51b481eec9371a82e16c86f2a687`.

The intermediate expires March 21, 2036 and chains to the already trusted Sectigo Public Server Authentication Root R46. It is CA=true with path length zero and TLS server/client authentication EKUs. No new root is installed. The factory test verifies its hash, expiry, signature and presence of its issuer in Node's bundled roots, plus preservation of the runtime's current default list.

Upstream serving the complete chain remains the preferred permanent repair. Recheck during upgrades and before the current leaf's March 2027 expiry; a future issuer/root change needs reviewed replacement material. Do not fetch arbitrary AIA certificates automatically, enable partial-chain trust, or restore insecure fallback on an unexpected failure. This work does not add revocation/OCSP monitoring. Node's [`ca` option replaces defaults](https://nodejs.org/api/tls.html#tlscreatesecurecontextoptions), which is why the factory explicitly preserves existing trust.
