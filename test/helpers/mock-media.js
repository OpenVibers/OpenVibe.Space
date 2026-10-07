'use strict';
/**
 * A stand-in for OpenVibe.Media: the Object API v2 upload (POST /api/v2/space/objects →
 * PUT /:id/content → POST /:id/complete), with a Network service token for openvibe.media holding
 * media.object.upload. Keeps each finished upload's raw bytes (and its kind, visibility and owner)
 * so tests can check what left Space.
 */
const http = require('http');
const crypto = require('crypto');
const { serviceAuth, ids } = require('openvibe-contracts');

function start({ publicPem, issuer }) {
    const uploads = [];
    const pending = new Map();      // objects between init and complete
    let failNext = false;
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            const json = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
            if (req.method === 'GET' && req.url === '/healthz') return json(200, { ok: true, service: 'mock-media' });
            const v2 = req.url.match(/^\/api\/v2\/space\/objects(?:\/(med_[0-9A-Z]+)\/(content|complete))?$/);
            if (!v2) return json(404, { error: 'not found' });
            const v = serviceAuth.verifyServiceToken(String(req.headers.authorization || '').slice(7), { publicKey: publicPem, issuer, audience: 'openvibe.media' });
            if (!v.ok) return json(401, { code: v.code, error: v.reason });
            if (!(v.claims.cap || []).includes('media.object.upload')) return json(403, { code: 'capability.denied', error: 'not granted' });
            const body = Buffer.concat(chunks);
            if (v2) {
                if (req.method === 'POST' && !v2[1]) {
                    if (failNext) { failNext = false; return json(500, { error: 'disk full' }); }
                    const b = JSON.parse(body.toString() || '{}');
                    const id = ids.newId('media');
                    pending.set(id, { ...b, owner: req.headers['x-ov-subject'] || null });
                    return json(201, { id, object: { id } });
                }
                const o = pending.get(v2[1]);
                if (!o) return json(404, { code: 'media.object.not_found' });
                if (req.method === 'PUT' && v2[2] === 'content') { o.bytes = body; o.mime = String(req.headers['content-type'] || ''); return json(200, { id: v2[1], size_bytes: body.length }); }
                if (req.method === 'POST' && v2[2] === 'complete') {
                    const hash = crypto.createHash('sha256').update(o.bytes || Buffer.alloc(0)).digest('hex');
                    if (hash !== o.content_hash) return json(400, { code: 'media.object.hash_mismatch' });
                    pending.delete(v2[1]);
                    uploads.push({ key: v2[1], name: o.filename || 'upload.bin', mime: o.mime, bytes: o.bytes, claims: v.claims, kind: o.kind, visibility: o.visibility, owner: o.owner, v2: true });
                    return json(200, { id: v2[1], lifecycle_status: 'ready' });
                }
                return json(404, { error: 'not found' });
            }
            return json(404, { error: 'not found' });
        });
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        uploads,
        failNext: () => { failNext = true; },
        close: () => new Promise((r) => server.close(r)),
    })));
}

module.exports = { start };
