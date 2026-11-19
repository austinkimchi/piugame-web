# Continuous integration and deployment

## Web checks

The `Web checks` workflow runs for pull requests and pushes to `main` that change source, tests, scripts, dependencies, build configuration, or workflows. Documentation-only and media-only changes skip automatic execution; `workflow_dispatch` allows an explicit run on any selected ref.

One standard Ubuntu job installs locked dependencies, runs tests, lint and TypeScript checks, and builds without a production database or credentials. It has a 15-minute timeout, retains no artifacts or Actions caches, and cancels an earlier check for the same ref when replaced. The ephemeral GitHub token has read-only repository contents and packages permissions. Only the install step receives it to download the private SDK from GitHub Packages; no stored personal access token is needed. The SDK package must grant this repository Actions read access.

Account billing was checked in the authenticated browser on November 19, 2026 before enabling automatic triggers: included compute remained available, and the existing zero-dollar Actions budget blocked paid overage. Preserve that spending control. The workflow itself cannot enforce an account budget or guarantee future allowance; check GitHub Billing again before expanding execution. Do not enable paid usage without the owner's authorization.

For validation without GitHub-hosted runner consumption, use the same checks locally:

```sh
npm ci --no-audit --no-fund
npm test
npm run lint
npx --no-install next typegen
npx --no-install tsc --noEmit --incremental false
npm run build
```

Use a disposable Linux checkout with `flock` and Python 3 for the complete test suite. The [catalog writer lock tests](catalog-release-writer.md) require Linux `flock`; the [deployment process tests](deployment-recovery.md#test-prerequisites) use Python's standard-library `fcntl` for real kernel-lock checks. On Linux, the suite explicitly fails if Python 3 or `fcntl` is unavailable. The Linux-prerequisite assertion skips on macOS by platform; that is not full Linux recovery validation. Keep production environment files out of local validation. A build without MongoDB tests compilation and fallback rendering, not live database or OAuth behavior.

Before making this a required merge check, account for path-filtered runs: GitHub can leave a required check pending when its workflow is skipped. Either remove the path filter or introduce an always-running gate before requiring it. A successful run alone does not establish branch protection.

### Optional fresh-database check

This test requires a separate disposable MongoDB 5.0.8 standalone server. It never
starts a server or reads `MONGODB_URI`. Set `MONGO_BOOTSTRAP_RUN_INTEGRATION=1` and
`MONGO_BOOTSTRAP_TEST_URI` to `mongodb://127.0.0.1:<ephemeral-port>` (not port 27017,
with no credentials or database path), then run:

```sh
node --experimental-strip-types --test test/mongo-bootstrap.integration.test.ts
```

The test creates a nonce database, exercises the actual auth and performance index
initialization plus legacy-index cleanup, and verifies removal of its owned
database. Normal CI skips this opt-in test; unit tests still check that only
MongoDB error 26 is treated as an empty index list.

### Local package access

The private `@austinkimchi/piugame-sdk` dependency is hosted on GitHub Packages. Local `npm ci` requires an account with package access and a `GITHUB_PACKAGES_TOKEN` environment variable, which the checked-in `.npmrc` references. Follow [GitHub's npm authentication instructions](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry#authenticating-to-github-packages) for a token with `read:packages` access. Keep its value outside the repository. CI maps its ephemeral `GITHUB_TOKEN` to the same variable during installation.

## Existing deployment

The origin's systemd timer already deploys GitHub `main`; no second GitHub Actions deployment job is needed. This CI workflow neither deploys nor invokes catalog migrations. Do not put production database credentials, SSH credentials, or migration commands into it.

The [host recovery implementation](deployment-recovery.md) requires a separately reviewed installation. Passing its tests or merging its source does not replace the origin's installed deploy command.

A successful CI run applies only to its tested commit. The current origin watcher does not wait for that result, so review and test the intended revision before merging. Catalog data updates need their own backup, dry run, guarded application, idempotence check, and HTTP/browser verification as described in [maintenance.md](maintenance.md). Code rollback alone does not roll back data or media.

## Mobile workflow audit

As observed on November 19, 2026, `piugame-mobile` already has automatic Android, browser-extension, iOS, and Safari workflows for pull requests and pushes to `main`, plus manual Android beta/iOS signed releases and a tag-triggered extension release. Its last observed four automatic runs succeeded on September 23; that historical result does not establish today's available allowance.

The automatic iOS and Safari workflows both use macOS runners and build archives. Prioritize platform-specific path filters, cancellation of superseded checks, job timeouts, and moving archive/artifact production to explicit release workflows. Keep portable metadata/extension tests on Linux and use the owner's Mac for iOS validation while hosted usage is uncertain. These are recommendations, not changes made by the web workflow.

The November 19 CLI billing lookup returned HTTP 404 and an explicit missing `user` scope notice. The authorized browser supplied the billing check instead; no token permissions were expanded. Zero retained repository artifacts or old workflow outcomes cannot establish the remaining allowance.

Current [GitHub Actions billing guidance](https://docs.github.com/en/billing/concepts/product-billing/github-actions) explains that private-repository runner usage draws from included compute and can incur charges after it is consumed. macOS costs more per minute than standard Linux. [Billing API documentation](https://docs.github.com/en/rest/billing/usage) describes the permissions required to retrieve account usage. Prices, allowances, and billing controls should be rechecked before enabling automatic execution.
