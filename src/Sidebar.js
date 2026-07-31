'use strict';

// A second screen that also shows the user's name, and which the July release
// did not touch. Its compiled artifact is byte-identical in both builds.
//
// It is what keeps the shared `me` record resident after the upgrade, which is
// why clearing the pre-upgrade root entry and collecting frees nothing.

const { graphql } = require('relay-runtime');
const { useQuery } = require('relay-hooks');

const NO_VARIABLES = {};

const SIDEBAR_QUERY = graphql`
    query SidebarQuery {
        me {
            id
            name
        }
    }
`;

function Sidebar({ query = SIDEBAR_QUERY, options }) {
    const { data } = useQuery(query, NO_VARIABLES, options);
    return data ? data.me.name : 'loading…';
}

module.exports = { Sidebar, SIDEBAR_QUERY };
