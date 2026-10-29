'use strict';
// The agent manifest of OpenVibe.Space: what the site is, where its API is, and how it is reached.
// openvibe-shared/agent-layer turns this into /.well-known/agent.json.
module.exports = {
    id: 'space', name: 'OpenVibe.Space',
    purpose: 'Static hosting for the OpenVibe network: a space is an app on your OpenVibe account, published at its own address.',
    home: 'https://openvibe.space', api: '/api/v1',
    docs: 'https://openvibe.services/docs/api',
    policy: {
        auth: ['none', 'bearer', 'Network OIDC'],
        rateLimit: 'The hosting API is rate limited per caller; the owner\'s plan sets the numbers.',
    },
};
