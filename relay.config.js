'use strict';

// The compiler owns `src/__generated__/after` — the artifacts of the build
// currently shipped. `src/__generated__/before` is a plain sibling it never
// touches, holding the artifacts the June release shipped. See "Regenerating
// the artifacts" in the README.
module.exports = {
    src: './src',
    schema: './schema.graphql',
    language: 'javascript',
    artifactDirectory: './src/__generated__/after',
};
