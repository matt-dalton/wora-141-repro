'use strict';

// Hand-written ConcreteRequest equivalent to:
//
//   query Q { me { id name } }
//
// Kept minimal so morrys#141 can be reproduced without relay-compiler.
// `Store.check()` only consumes `operation.root` (NormalizationSelector built
// from `operation`) and `operation.request.identifier` (derived from
// `params.cacheID` + variables) — both are exercised below.

const meField = {
    alias: null,
    args: null,
    concreteType: 'User',
    kind: 'LinkedField',
    name: 'me',
    plural: false,
    storageKey: null,
    selections: [
        { alias: null, args: null, kind: 'ScalarField', name: 'id', storageKey: null },
        { alias: null, args: null, kind: 'ScalarField', name: 'name', storageKey: null },
    ],
};

const fragment = {
    argumentDefinitions: [],
    kind: 'Fragment',
    metadata: null,
    name: 'Q',
    selections: [meField],
    type: 'Query',
    abstractKey: null,
};

const operation = {
    argumentDefinitions: [],
    kind: 'Operation',
    name: 'Q',
    selections: [meField],
};

const params = {
    cacheID: 'wora141:Q',
    id: null,
    metadata: {},
    name: 'Q',
    operationKind: 'query',
    text: 'query Q { me { id name } }',
};

module.exports = {
    fragment,
    kind: 'Request',
    operation,
    params,
};
