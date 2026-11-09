# wora-141-repro

Minimal reproduction for [morrys/wora#141](https://github.com/morrys/wora/issues/141).

`@wora/relay-store@8.0.0`'s `Store.check()` returns `{ status: 'available', fetchTime: null }` for an operation whose root entry has `fetchTime: null` and whose records happen to be present in the source. With `store-or-network`, `fetchQuery` short-circuits and never invokes the network — and because no network response ever lands, `Store.notify()` never assigns a `fetchTime`, so the state persists forever.

## Run

```sh
npm install
npm test
```

`npm install` applies the candidate fix in `patches/@wora+relay-store+8.0.0.patch`, so `npm test` is green (9 passing). To see the bug, take the patch off and run again — expect 3 failing tests:

```sh
npx patch-package --reverse
npm test
```

## The contract

> An operation whose records are in the store but which has no `fetchTime` may be served from the store, but for at most one TTL. After that, `store-or-network` must fetch.

This keeps the reuse that `store-or-network` exists for: a new query resolved from records another query wrote makes no request. It only stops the state from lasting forever.

## The candidate fix — `patches/@wora+relay-store+8.0.0.patch`

Two lines in `Store.ts`:

```diff
     // check(): fall back to retainTime when the operation was never fetched
-    rootEntry?.fetchTime,
+    rootEntry?.fetchTime ?? rootEntry?.retainTime,

     // retain() dispose sweep: keep never-fetched roots
-    if (dispose && expired) {
+    if (dispose && expired && fetchTime != null) {
```

Both are needed:

- **The fallback alone is not enough.** When Ada leaves her profile, its root entry is disposed. Once its `retainTime` is past the TTL, the next screen that closes removes it in the dispose sweep. Her next visit creates a new root entry with `retainTime = now`, so it is `available` again with no request. This repeats on every visit.
- **With the sweep change,** the never-fetched root entry stays. Her next visit after the TTL finds it stale and fetches. After that it has a `fetchTime` and the sweep treats it as normal.

Cost: a root entry that is never fetched and never retained again is not swept.

## Tests

### Demonstration — `src/repro.test.js` _(no assertions; the spy output is the point)_

Prints the inputs and output of `getAvailabilityStatus` for the bug state:

```
[wora#141] getAvailabilityStatus called with:
  operationAvailability    = { status: 'available', mostRecentlyInvalidatedAt: null }
  operationLastWrittenAt   = null
  operationFetchTime       = null
  queryCacheExpirationTime = 172800000
  staleForExpiration       = true
[wora#141] returned: { status: 'available', fetchTime: null }
```

The spy does not modify wora. It reads the same fields `Store.prototype.check` reads.

### Spec — B1 in `src/repro.test.js`

The contract above, with `fetchQuery` directly: records in the source, no `fetchTime`. The first call may come from the store; a call after the TTL must reach the network.

### The real-world flow — `src/integration.test.js`

Two app launches over shared persistent storage, with a field removed from a fragment between them, through real screens and `useQuery`/`useFragment`. The artifacts are `relay-compiler`'s own output from either side of that edit, committed as `src/__generated__/{before,after}`. Diff the two `ProfileScreenQuery.graphql.js` to see `params.text` and `params.cacheID` move.

After the upgrade, Ada opens her profile (cached name is acceptable), leaves it, uses the app for six minutes, and comes back. Unpatched, she still sees the pre-upgrade name with no request, on every visit. This also holds after clearing the orphaned root entry and running `__gc()`: a second screen the upgrade didn't touch still references the records, so there is nothing to collect.

A second block covers ordinary caching, which the fix must not break: warm restart inside the TTL, restart after the TTL, and a new query served from another query's records with no request.

To rebuild the artifacts: put `email` back in the `ProfileScreen_me` fragment, `npm run relay`, copy `after/` to `before/`, remove `email` again, `npm run relay`.

## Versions

Pinned to the exact resolved versions in the host React Native app's lockfile, where the bug was first observed:

- `@wora/relay-store@8.0.0`
- `@wora/relay-offline@8.0.0`
- `@wora/cache-persist@2.2.1`
- `relay-runtime@20.1.1`
