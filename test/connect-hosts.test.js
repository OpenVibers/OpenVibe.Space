'use strict';
/**
 * openvibe.website is shared with OpenVibe Connect (ADR-057, 2026-11-02): <label>--<user>.openvibe.website is a
 * Connect share and connect.openvibe.website is Connect's own host. A site's name can never contain "--", Connect's
 * names are reserved here, and this repo's vhost leaves every "--" host to Connect.
 *
 *   node test/connect-hosts.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { NAME_RE, RESERVED } = require('../server/domain/sites');

['agents--alex', 'a--b', 'x---y'].forEach((n) => assert.ok(!NAME_RE.test(n), `${n} is never a site's name`));
['my-site', 'abc'].forEach((n) => assert.ok(NAME_RE.test(n), `${n} still is`));
['connect', 'hooks', 'share', 'shares', 'tunnel'].forEach((n) => assert.ok(RESERVED.has(n), `${n} is reserved`));

const conf = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'nginx', 'openvibe.website.conf'), 'utf8');
const names = [...conf.matchAll(/server_name\s+([^;]+);/g)].map((m) => m[1].trim());
assert.ok(!names.includes('*.openvibe.website'), 'no wildcard that would take Connect\'s share hosts');
const pattern = names.find((n) => n.startsWith('~'));
assert.ok(pattern, 'the tenant blocks use a pattern');
const re = new RegExp(pattern.slice(1));
assert.ok(re.test('my-site.openvibe.website'));
assert.ok(re.test('preview.my-site.openvibe.website'));
assert.ok(!re.test('agents--alex.openvibe.website'), 'a share host is Connect\'s');
assert.ok(!re.test('openvibe.website'));
console.log('connect hosts: "--" hosts are Connect\'s; Connect\'s names are reserved');
