# wora-141-repro

Minimal reproduction for [morrys/wora#141](https://github.com/morrys/wora/issues/141).

`@wora/relay-store@8.0.0`'s `Store.check()` returns `{ status: 'available', fetchTime: null }` for an operation whose root entry has `fetchTime: null` and whose records happen to be present in the source. With `store-or-network`, `fetchQuery` short-circuits and never invokes the network — and because no network response ever lands, `Store.notify()` never assigns a `fetchTime`, so the state persists forever.

## Run

```sh
npm install
npm test
```

**On unpatched `@wora/relay-store@8.0.0`, expect 7 passing tests and 3 failing tests.** The failures are the spec — see "What the suite proves" below and `src/integration.test.js`.

## What the suite proves

The tests are split into a demonstration block, a single spec test, and a reference example.

### Demonstration — what `check()` does today _(passes today; spy output is the point)_

Two tests with no behavioural assertions. They exist to drive a self-narrating spy through the relevant code paths so `npm test` prints the exact scalar inputs and outputs of `getAvailabilityStatus`, line-for-line, for each entry point. Concretely:

```
[wora#141] getAvailabilityStatus called with:
  operationAvailability    = { status: 'available', mostRecentlyInvalidatedAt: null }
  operationLastWrittenAt   = null
  operationFetchTime       = null
  queryCacheExpirationTime = 172800000
  staleForExpiration       = true
[wora#141] returned: { status: 'available', fetchTime: null }
```

Compare against your own production diagnostic to verify we're describing the same state. After a fix, these tests will continue to pass (no assertions to break) but the spy output will naturally shift to reflect the new behaviour — itself useful evidence that the surface changed.

**The spy does not modify wora.** `node_modules/@wora/relay-store/` is byte-for-byte unmodified. The instrumentation is per-store-instance, lives in `src/repro.test.js`, and reads the same fields `Store.prototype.check` reads (`rootEntry.epoch`, `rootEntry.fetchTime`, `getTTL`, `checkGC`) plus a re-run of `DataChecker.check` to obtain `operationAvailability`. Each logged value is the literal value flowing into wora's own `getAvailabilityStatus`.

### Spec — required behaviour _(fails today; must pass after any valid fix)_

A single test asserting the user-visible contract:

> Given a `Store` with records in the source but no `fetchTime` for an operation, `fetchQuery(..., { fetchPolicy: 'store-or-network' })` must fire the network at least once.

This is deliberately fix-agnostic. It does **not** prescribe what `getAvailabilityStatus` should return, what layer the fix should live in, or whether a different mechanism (e.g. teaching `mergeState` to skip null-`fetchTime` entries; reworking `retain()` to never create them; changing the contract elsewhere) is preferable. **If this test passes, the user is no longer permanently stuck on cached data — by any mechanism.**

### Reference — one verified local patch _(illustrative, not prescriptive)_

We applied this diff to `lib/Store.js` locally via `patch-package` and confirmed it satisfies the spec. It is documented in the test file as one example of a fix that works, **NOT as a prescription**.

```diff
   if (operationFetchTime != null && queryCacheExpirationTime != null) {
       var isStale = operationFetchTime <= Date.now() - queryCacheExpirationTime;
       if (isStale && staleForExpiration) {
           return { status: 'stale' };
       }
   }
+  if (operationFetchTime == null) {
+      return { status: 'stale' };
+  }
   return { status: 'available', fetchTime: operationFetchTime ?? null };
```

The maintainer is free to choose any approach (different return value, different layer entirely); only the spec test's behavioural contract is the bar to clear.

## The real-world flow — `src/integration.test.js`

Added to answer the request for the actual query lifecycle. Two app launches over shared persistent storage, with a field removed from a fragment between them, driven through real screens and `useQuery`/`useFragment`. The artifacts are `relay-compiler`'s own output from either side of that edit, committed as `src/__generated__/{before,after}` — diff the two `ProfileScreenQuery.graphql.js` to see `params.text` and `params.cacheID` move.

Two of its tests fail today: after the upgrade the screen renders pre-upgrade data and makes no request, and still does after clearing the orphaned root entry and running `__gc()` (a second screen the upgrade didn't touch still references the records, so there is nothing to collect). A second block records behaviours that are correct today — the `fetchTime == null => stale` patch turns the two failures green and costs one of them an extra request.

To rebuild the artifacts: put `email` back in the `ProfileScreen_me` fragment, `npm run relay`, copy `after/` to `before/`, remove `email` again, `npm run relay`.

## Versions

Pinned to the exact resolved versions in the host React Native app's lockfile, where the bug was first observed:

- `@wora/relay-store@8.0.0`
- `@wora/relay-offline@8.0.0`
- `@wora/cache-persist@2.2.1`
- `relay-runtime@20.1.1`
