'use strict';

// An in-memory `ICacheStorage` (see @wora/cache-persist/lib/CacheTypes.d.ts).
// Stands in for the host app's SQLite storage. Only the four required methods
// are implemented; StorageProxy polyfills multiGet/multiSet/multiRemove when
// multiRemove is absent (StorageProxy.js:61-92).
//
// The point of this file is that ONE instance is shared by two Store instances
// in sequence, which is what makes "user closes and reopens the app" real
// rather than synthesised. Roots and records live in the same backing map and
// are separated only by key prefix (`relay-store.` / `relay-records.`), exactly
// as they are in the host app.
function createMemoryStorage() {
    const data = {};

    return {
        getAllKeys: () => Promise.resolve(Object.keys(data)),
        getItem: (key) => Promise.resolve(data[key]),
        // The write must take effect SYNCHRONOUSLY, before the returned promise
        // settles. StorageProxy.flush() early-returns when its queue is empty, so
        // it is not a barrier against an in-flight execute() — with a genuinely
        // async storage a session could be reopened before writes land.
        setItem: (key, value) => {
            data[key] = value;
            return Promise.resolve();
        },
        removeItem: (key) => {
            delete data[key];
            return Promise.resolve();
        },

        // Test-only helper, not part of ICacheStorage.
        keysWithPrefix: (prefix) => Object.keys(data).filter((k) => k.startsWith(prefix)),
    };
}

module.exports = { createMemoryStorage };
