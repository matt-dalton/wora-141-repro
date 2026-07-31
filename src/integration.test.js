'use strict';

// morrys/wora#141 as a user story, with real components, a real `useQuery` and
// real relay-compiler artifacts.
//
// Ada uses the app on the build we shipped in June. In July we ship a release
// that removes a field from one screen's fragment — a routine cleanup, no
// behaviour intended. From that release onwards, that screen shows her the name
// it held before the upgrade. Not for five minutes: forever.
//
// The app has two screens that show her name. The upgrade only touched one of
// them. That detail matters: the untouched screen keeps the shared records
// resident, which is why cleaning up stale root entries at startup cannot
// resolve this — there is nothing left to collect.
//
// The second block records behaviours that are correct today, so a candidate fix
// can be judged on what it costs as well as on what it fixes.

const React = require('react');
const { act, create } = require('react-test-renderer');
const { RelayEnvironmentProvider } = require('relay-hooks');
const { Environment, Network, Observable, createOperationDescriptor, getRequest } = require('relay-runtime');
const { Store, RecordSource } = require('@wora/relay-store');

const { createMemoryStorage } = require('./storage');
const { ProfileScreen } = require('./ProfileScreen');
const { Sidebar } = require('./Sidebar');

global.IS_REACT_ACT_ENVIRONMENT = true;

// The two releases of the profile screen, as relay-compiler actually emitted
// them. `after` is what `src/ProfileScreen.js`'s own `graphql` tags compile to
// today; `before` is the same screen built when its fragment still selected
// `email`. Diff the two ProfileScreenQuery artifacts: `params.text` and
// `params.cacheID` move, and cacheID is what `operation.request.identifier` —
// the key wora files root entries under — is built from.
const JUNE_BUILD = {
    query: require('./__generated__/before/ProfileScreenQuery.graphql'),
    fragment: require('./__generated__/before/ProfileScreen_me.graphql'),
};
const JULY_BUILD = {
    query: require('./__generated__/after/ProfileScreenQuery.graphql'),
    fragment: require('./__generated__/after/ProfileScreen_me.graphql'),
};

// Untouched by the upgrade: byte-identical in before/ and after/.
const SIDEBAR_QUERY = require('./__generated__/after/SidebarQuery.graphql');

const FIVE_MINUTES = 5 * 60 * 1000;
const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

const NO_VARIABLES = {};

// The host app's main screens pass a 5-minute TTL as cacheConfig.ttl. Screens
// that pass none fall back to the store's 48-hour queryCacheExpirationTime.
const FIVE_MINUTE_TTL = { fetchPolicy: 'store-or-network', networkCacheConfig: { ttl: FIVE_MINUTES } };
const STORE_DEFAULT_TTL = { fetchPolicy: 'store-or-network' };

// One app launch: a store over the given storage, and a server that answers with
// `serverName`. Reusing the same storage object across launches is what makes the
// second launch a genuine app restart rather than a fresh install.
async function launchApp(storage, serverName) {
    let networkRequests = 0;

    const recordSource = new RecordSource({ storage });
    const store = new Store(recordSource, { storage }, { queryCacheExpirationTime: FORTY_EIGHT_HOURS });
    const network = Network.create(() => {
        networkRequests += 1;
        return Observable.from(
            Promise.resolve({ data: { me: { id: 'u1', name: serverName, email: 'ada@example.com' } } }),
        );
    });

    await store.hydrate();

    return {
        store,
        recordSource,
        environment: new Environment({ network, store }),
        getNetworkRequests: () => networkRequests,
    };
}

// Mounts a screen and lets any network round-trip settle before returning what
// it rendered. The screen stays mounted, as it would while the user looks at it.
async function mountScreen(app, element) {
    let renderer;

    await act(async () => {
        renderer = create(
            React.createElement(RelayEnvironmentProvider, { environment: app.environment }, element),
        );
    });

    return renderer.toJSON();
}

const openProfile = (app, build, options = FIVE_MINUTE_TTL) =>
    mountScreen(app, React.createElement(ProfileScreen, { build, options }));

const openSidebar = (app) =>
    mountScreen(app, React.createElement(Sidebar, { query: SIDEBAR_QUERY, options: STORE_DEFAULT_TTL }));

// ---------------------------------------------------------------------------
// The only two helpers that look inside wora. `store._cache` is its root-entry
// map — the thing `Store.check()` consults to answer "do I have this query, and
// how fresh is it?". `flush()` drains its 500ms write debounce, i.e. the app
// living long enough to save. No test below asserts on either. Everything else
// in this file is public API.
// ---------------------------------------------------------------------------
const saveToDisk = (app) => Promise.all([app.store._cache.flush(), app.recordSource._cache.flush()]);

const rootEntryKey = (query) => createOperationDescriptor(getRequest(query), NO_VARIABLES).request.identifier;

function logRootEntry(label, app, query) {
    const identifier = rootEntryKey(query);
    const rootEntry = app.store._cache.get(identifier);

    console.log(`[wora#141] ${label}`, {
        networkRequests: app.getNetworkRequests(),
        query: identifier,
        hasRootEntry: rootEntry != null,
        fetchTime: rootEntry ? rootEntry.fetchTime : undefined,
        epoch: rootEntry ? rootEntry.epoch : undefined,
    });
}

// ---------------------------------------------------------------------------

// Every test below states how the app is supposed to behave. Two of them fail on
// unpatched @wora/relay-store@8.0.0 — those failures are the bug report. A fix
// should turn them green without turning anything else red.
describe('wora#141: a screen must not be stranded on pre-upgrade data', () => {
    afterEach(() => jest.restoreAllMocks());

    // June. Cold store, so both screens really fetch, and the answers are saved.
    // The sidebar passes no per-query TTL, so it uses the 48-hour store default
    // and is still considered fresh when Ada returns tomorrow.
    async function firstLaunchOnTheOldBuild(storage) {
        const app = await launchApp(storage, 'Ada Lovelace');

        expect(await openSidebar(app)).toBe('Ada Lovelace');
        expect(await openProfile(app, JUNE_BUILD)).toBe('Ada Lovelace');
        expect(app.getNetworkRequests()).toBe(2);

        logRootEntry('session 1 — old build, profile', app, JUNE_BUILD.query);
        await saveToDisk(app);
    }

    // July. Ada reopens the app a day later, so the 5-minute TTL on the profile
    // screen is long gone and nothing below has a freshness excuse. Meanwhile the
    // backend now says her name is Grace Hopper.
    async function reopenTheAppTomorrow(storage, build, label) {
        jest.spyOn(Date, 'now').mockReturnValue(Date.now() + ONE_DAY);

        const app = await launchApp(storage, 'Grace Hopper');

        // The sidebar opens first, as it would — and holds the shared records.
        await openSidebar(app);
        const name = await openProfile(app, build);

        logRootEntry(label, app, build.query);
        return { app, name, networkRequests: app.getNetworkRequests() };
    }

    // FAILS on unpatched wora: renders 'Ada Lovelace', 0 requests.
    it('shows the current name after an upgrade changes the query fragment', async () => {
        const storage = createMemoryStorage();
        await firstLaunchOnTheOldBuild(storage);

        // The upgrade: the profile screen now runs the July artifacts.
        const { name, networkRequests } = await reopenTheAppTomorrow(
            storage,
            JULY_BUILD,
            'session 2 — upgraded build, profile',
        );

        expect(name).toBe('Grace Hopper');
        expect(networkRequests).toBe(1);
    });

    it('control: shows the current name when the upgrade is skipped', async () => {
        const storage = createMemoryStorage();
        await firstLaunchOnTheOldBuild(storage);

        // Identical to the test above in every way except one: no upgrade, so
        // the profile screen still runs the June artifacts.
        const { name, networkRequests } = await reopenTheAppTomorrow(
            storage,
            JUNE_BUILD,
            'control — same build, profile',
        );

        expect(name).toBe('Grace Hopper');
        expect(networkRequests).toBe(1);
    });

    // Same requirement, but with the obvious remedy applied first: drop the root
    // entry for the operation the new build no longer runs, and collect. It does
    // not help — the sidebar is still open and still references those records, so
    // there is nothing to collect.
    //
    // FAILS on unpatched wora: renders 'Ada Lovelace', 0 requests.
    it('shows the current name even after clearing the orphaned root entry and collecting', async () => {
        const storage = createMemoryStorage();
        await firstLaunchOnTheOldBuild(storage);

        jest.spyOn(Date, 'now').mockReturnValue(Date.now() + ONE_DAY);
        const app = await launchApp(storage, 'Grace Hopper');
        await openSidebar(app);

        await act(async () => {
            app.store._cache.remove(rootEntryKey(JUNE_BUILD.query)); // the pre-upgrade query's root entry
            app.store.__gc();
        });

        expect(await openProfile(app, JULY_BUILD)).toBe('Grace Hopper');
        expect(app.getNetworkRequests()).toBeGreaterThan(0);
    });
});

// Ordinary caching behaviour, so a candidate fix can be checked against it as
// well as against the block above. Both are unaffected by the fixes discussed
// on the issue so far.
describe('behaviours a fix must not break', () => {
    afterEach(() => jest.restoreAllMocks());

    it('a warm restart inside the TTL serves from cache', async () => {
        const storage = createMemoryStorage();

        const first = await launchApp(storage, 'Ada Lovelace');
        await openProfile(first, JULY_BUILD);
        await saveToDisk(first);

        // Reopened immediately. The server has moved on, but the cached answer is
        // still inside its 5-minute TTL, so showing it is correct.
        const second = await launchApp(storage, 'Grace Hopper');

        expect(await openProfile(second, JULY_BUILD)).toBe('Ada Lovelace');
        expect(second.getNetworkRequests()).toBe(0);
    });

    it('a restart after the TTL refetches', async () => {
        const storage = createMemoryStorage();

        const first = await launchApp(storage, 'Ada Lovelace');
        await openProfile(first, JULY_BUILD);
        await saveToDisk(first);

        jest.spyOn(Date, 'now').mockReturnValue(Date.now() + ONE_DAY);
        const second = await launchApp(storage, 'Grace Hopper');

        expect(await openProfile(second, JULY_BUILD)).toBe('Grace Hopper');
        expect(second.getNetworkRequests()).toBe(1);
    });
});
