'use strict';

const {
    Environment,
    Network,
    Observable,
    createOperationDescriptor,
    fetchQuery,
    getRequest,
} = require('relay-runtime');
const { Store, RecordSource } = require('@wora/relay-store');
const DataChecker = require('relay-runtime/lib/store/DataChecker');

const QueryNode = require('./Q');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Records present in the source, but no _cache entry yet for our query.
// This mirrors the production state described in the issue: an operation
// retained under hash H2 whose records are reachable in the in-memory
// RecordSource (because they were rehydrated from persistence and/or are
// also referenced by other retained operations under different hashes).
const SEED_RECORDS = {
    'client:root': {
        __id: 'client:root',
        __typename: '__Root',
        me: { __ref: 'u1' },
    },
    u1: {
        __id: 'u1',
        __typename: 'User',
        id: 'u1',
        name: 'Ada',
    },
};

// Matches the host app's relay store TTL. The bug is independent of this value (the
// TTL branch in getAvailabilityStatus is gated on operationFetchTime != null,
// which never holds in the bug scenario), but pinning it to production's
// configured value pre-empts "your test isn't a realistic environment".
const TTL_48H = 48 * 60 * 60 * 1000;

function buildEnvironment(networkFn) {
    const source = new RecordSource();
    Object.entries(SEED_RECORDS).forEach(([id, record]) => source.set(id, record));

    // Mirrors the host app's relay environment factory: Store(source, persistOptions, options).
    // Empty persistOptions disables persistence (NoStorageProxy), so the cache
    // is "rehydrated" immediately and the test stays synchronous.
    const store = new Store(source, {}, { queryCacheExpirationTime: TTL_48H });
    const network = Network.create((req, vars) =>
        Observable.from(Promise.resolve(networkFn(req, vars))),
    );
    const environment = new Environment({ network, store });
    return { environment, store };
}

// ---------------------------------------------------------------------------
// Self-narrating spy
// ---------------------------------------------------------------------------
// Wraps Store.prototype.check on a single instance to log the exact scalar
// inputs that getAvailabilityStatus (lib/Store.js:160) receives, plus the
// value it returns. Lets `npm test` print the bug surface line-for-line so
// it can be compared against the production Sentry diagnostic without
// trusting our prose.
//
// getAvailabilityStatus is a module-private function so we can't wrap it
// directly. Instead we replicate the DataChecker.check call from
// lib/Store.js:140 (it's pure — no side effects — so re-running is safe)
// to obtain the same `operationAvailability` value Store.check passes in.

const INTERNAL_ACTOR_IDENTIFIER_DO_NOT_USE = 'INTERNAL_ACTOR_IDENTIFIER_DO_NOT_USE';

function recomputeOperationAvailability(store, operation) {
    const source = store._recordSource;
    const getActorSource = () => source;
    return DataChecker.check(
        getActorSource,
        getActorSource,
        INTERNAL_ACTOR_IDENTIFIER_DO_NOT_USE,
        operation.root,
        [],
        store._operationLoader,
        store._getDataID,
        store._shouldProcessClientComponents,
        store.__log,
        false,
    );
}

function instrumentStoreCheck(store) {
    const originalCheck = store.check.bind(store);
    store.check = function (operation, options) {
        const id = operation.request.identifier;
        const rootEntry = store._cache.get(id);
        const operationLastWrittenAt = rootEntry != null ? rootEntry.epoch : null;
        const operationFetchTime = rootEntry != null ? rootEntry.fetchTime : null;
        const queryCacheExpirationTime = store.getTTL(operation);
        const staleForExpiration = store.checkGC();
        const operationAvailability = recomputeOperationAvailability(store, operation);

        const result = originalCheck(operation, options);

        console.log('[wora#141] getAvailabilityStatus called with:');
        console.log('  operationAvailability    =', operationAvailability);
        console.log('  operationLastWrittenAt   =', operationLastWrittenAt);
        console.log('  operationFetchTime       =', operationFetchTime);
        console.log('  queryCacheExpirationTime =', queryCacheExpirationTime);
        console.log('  staleForExpiration       =', staleForExpiration);
        console.log('[wora#141] returned:', result);

        return result;
    };
}

// ===========================================================================
// Demonstration — what `check()` is doing today
// ===========================================================================
// These tests carry no assertions about behaviour. They exist to drive the
// self-narrating spy through the relevant code paths so `npm test` prints
// the exact scalar inputs and outputs of getAvailabilityStatus, line-for-
// line, for each entry point. Compare the print output against your own
// production diagnostic to verify we're describing the same state.
//
// After a fix, these tests will continue to "pass" (no assertions to
// break) but the spy output will naturally shift to reflect the new
// behaviour — which is itself useful evidence that the surface changed.
// ===========================================================================

describe('Demonstration — what check() does today (spy output is the point)', () => {
    test('check() called directly on a retained operation', () => {
        const { environment, store } = buildEnvironment(() => {
            throw new Error('network must not be called in this test');
        });

        instrumentStoreCheck(store);

        const operation = createOperationDescriptor(getRequest(QueryNode), {});

        // Production path: the operation is retained (e.g. via QueryRenderer /
        // useLazyLoadQuery). retain() seeds a root entry with fetchTime: null
        // (see @wora/relay-store/lib/Store.js line ~97).
        environment.retain(operation);
        store.check(operation);
    });

    test('check() reached via fetchQuery with store-or-network', async () => {
        let networkCalls = 0;
        const { environment, store } = buildEnvironment(() => {
            networkCalls += 1;
            return { data: { me: { __typename: 'User', id: 'u1', name: 'Ada-from-network' } } };
        });

        instrumentStoreCheck(store);

        const operation = createOperationDescriptor(getRequest(QueryNode), {});
        environment.retain(operation);

        // Real user-visible path: fetchQuery delegates to environment.check().
        // Today, check() returns "available" → fetchQuery short-circuits to
        // the cached snapshot and never invokes the network function.
        const data = await fetchQuery(environment, QueryNode, {}, {
            fetchPolicy: 'store-or-network',
        }).toPromise();

        // Logged for visibility, no assertion: the print output narrates
        // exactly what happened.
        console.log('[wora#141] networkCalls after fetchQuery:', networkCalls);
        console.log('[wora#141] resolved data:', data);
    });
});

// ===========================================================================
// Block B — Required (post-fix) behaviour
// ===========================================================================
// Fails today on unpatched @wora/relay-store@8.0.0. The single assertion
// describes the user-visible contract that any valid fix must satisfy,
// without prescribing how the fix is implemented (whether
// getAvailabilityStatus changes its return value, whether retain() is
// reworked to never create null-fetchTime entries, whether mergeState is
// taught to skip them, or anything else). If this test passes, the user
// is no longer permanently stuck on cached data — by any mechanism.
// ===========================================================================

describe('Block B — required behaviour (fails today; must pass after any valid fix)', () => {
    test('B1: fetchQuery with store-or-network must fire the network at least once when no fetchTime has ever been recorded', async () => {
        let networkCalls = 0;
        const { environment, store } = buildEnvironment(() => {
            networkCalls += 1;
            return { data: { me: { __typename: 'User', id: 'u1', name: 'Ada-from-network' } } };
        });

        instrumentStoreCheck(store);

        const operation = createOperationDescriptor(getRequest(QueryNode), {});
        environment.retain(operation);

        await fetchQuery(environment, QueryNode, {}, {
            fetchPolicy: 'store-or-network',
        }).toPromise();

        // The contract: with no recorded fetchTime, the consumer cannot rely
        // on the cached records being current. The network must be consulted
        // at least once so notify() can land a real fetchTime and the state
        // can self-heal on subsequent calls.
        expect(networkCalls).toBeGreaterThanOrEqual(1);
    });
});

// ===========================================================================
// Reference — one local workaround we verified (not a prescription)
// ===========================================================================
// We applied the diff below to lib/Store.js locally via patch-package and
// confirmed it satisfies Block B. It is documented here as one example of
// a fix that works, NOT as a prescription. The maintainer is free to
// choose any approach (different return value, different layer entirely);
// only Block B's behavioural contract is the spec.
//
//     if (operationFetchTime != null && queryCacheExpirationTime != null) {
//         var isStale = operationFetchTime <= Date.now() - queryCacheExpirationTime;
//         if (isStale && staleForExpiration) {
//             return { status: 'stale' };
//         }
//     }
//   + if (operationFetchTime == null) {
//   +     return { status: 'stale' };
//   + }
//     return { status: 'available', fetchTime: operationFetchTime ?? null };
// ===========================================================================

function getAvailabilityStatusWithLocalPatch(
    operationAvailability,
    operationLastWrittenAt,
    operationFetchTime,
    queryCacheExpirationTime,
    staleForExpiration,
) {
    const { mostRecentlyInvalidatedAt, status } = operationAvailability;
    if (typeof mostRecentlyInvalidatedAt === 'number') {
        if (operationLastWrittenAt == null || mostRecentlyInvalidatedAt > operationLastWrittenAt) {
            return { status: 'stale' };
        }
    }
    if (status === 'missing') {
        return { status: 'missing' };
    }
    if (operationFetchTime != null && queryCacheExpirationTime != null) {
        const isStale = operationFetchTime <= Date.now() - queryCacheExpirationTime;
        if (isStale && staleForExpiration) {
            return { status: 'stale' };
        }
    }
    if (operationFetchTime == null) {
        return { status: 'stale' };
    }
    return { status: 'available', fetchTime: operationFetchTime ?? null };
}

describe('Reference — one verified local patch (illustrative, not prescriptive)', () => {
    test('the documented diff returns "stale" for the inputs that exhibit the bug', () => {
        const result = getAvailabilityStatusWithLocalPatch(
            { status: 'available', mostRecentlyInvalidatedAt: undefined },
            null,
            null,
            TTL_48H,
            true,
        );
        // 'stale' lets the consumer reuse cached records while a refresh
        // fires. 'missing' would also satisfy Block B (at the cost of
        // blanking the screen). A fix elsewhere (mergeState, retain, etc.)
        // would also satisfy Block B without changing this function at all.
        expect(result).toEqual({ status: 'stale' });
    });
});
