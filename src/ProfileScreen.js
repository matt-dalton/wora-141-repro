'use strict';

// The screen the July release touched: its query spreads a fragment, and the
// release removed `email` from that fragment. Nothing else about the screen
// changed — it rendered the name before and it renders the name now.
//
// Written in CommonJS + createElement to keep the babel setup to a minimum: no
// JSX transform, no module interop beyond what the generated artifacts need.

const React = require('react');
const { graphql } = require('relay-runtime');
const { useFragment, useQuery } = require('relay-hooks');

// Hoisted so every render passes the same object — relay-hooks rebuilds the
// operation whenever the variables change identity.
const NO_VARIABLES = {};

// The artifacts compiled from the tags below, i.e. the build currently shipped.
// Exported as a pair so a test can mount the *previous* release's compiled
// artifacts (src/__generated__/before) through this same component instead of
// keeping a second copy of it around.
const SHIPPED_BUILD = {
    query: graphql`
        query ProfileScreenQuery {
            me {
                ...ProfileScreen_me
            }
        }
    `,
    fragment: graphql`
        fragment ProfileScreen_me on User {
            id
            name
        }
    `,
};

function ProfileName({ fragmentNode, user }) {
    const data = useFragment(fragmentNode, user);
    return data.name;
}

function ProfileScreen({ build = SHIPPED_BUILD, options }) {
    const { data } = useQuery(build.query, NO_VARIABLES, options);

    if (!data) {
        return 'loading…';
    }

    return React.createElement(ProfileName, { fragmentNode: build.fragment, user: data.me });
}

module.exports = { ProfileScreen, SHIPPED_BUILD };
