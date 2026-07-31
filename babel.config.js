'use strict';

// Jest needs two things babel provides: `babel-plugin-relay` to turn the
// `graphql` tags in src/*.js into requires of the compiled artifacts, and
// preset-env to turn the artifacts' `export default` into CommonJS.
module.exports = {
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
    plugins: [['relay', { artifactDirectory: './src/__generated__/after' }]],
};
