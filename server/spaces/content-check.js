'use strict';
/**
 * The abuse screen for what a space may say and do (openvibe.website, plan 5.9: "publishing to a preview
 * address after an automatic abuse screen"). Today it is the first half, on the guest drafts:
 *
 *   1. Obvious phishing: a brand name next to credential words ("Sign in to your Google account", "verify your
 *      PayPal password"), or one of the sentences a fake login page uses. A brand is required, so a page that
 *      merely talks about passwords ("how to choose a password") is not caught.
 *   2. Off-site form actions: a <form action="..."> that posts to another origin. A guest draft is static and
 *      is published nowhere, so a form that leaves the site can only be collecting someone's details for
 *      someone else. A form without an action, or with one on the site's own address, is fine.
 *
 * The same checks run on what the guest asks the AI and on what the AI answers, so a phishing page cannot be
 * laundered through the builder. The denylist runs for a signed-in maker too; the off-site form rule is a
 * guest rule (an owner may post to their own payment provider).
 */
const { ApiError } = require('../http/errors');

/** The names a fake login page borrows. */
const BRANDS = [
    'google', 'apple', 'microsoft', 'amazon', 'paypal', 'netflix', 'facebook', 'instagram', 'whatsapp',
    'telegram', 'discord', 'steam', 'roblox', 'binance', 'coinbase', 'metamask', 'ledger', 'twitter',
    'linkedin', 'dropbox', 'spotify', 'dhl', 'fedex', 'ups', 'usps', 'chase', 'wells fargo', 'barclays',
    'santander', 'revolut', 'wise', 'coinbase', 'postepayte', 'free mobile', 'orange',
];

/** The words that ask for a secret. */
const CREDENTIALS = [
    'log in', 'login', 'log-in', 'sign in', 'signin', 'sign-in', 'password', 'passcode', 'credential',
    'username', 'user name', 'one-time code', 'otp', '2fa', 'two-factor', 'verify your', 'verification code',
    'recover your', 'reset your', 'security code', 'card number', 'cvv', 'seed phrase', 'recovery phrase',
    'private key', 'wallet',
];

/** The sentences a fake page writes. */
const PHRASES = [
    'your account has been suspended', 'your account is suspended', 'account has been suspended',
    'verify your identity', 'unusual activity on your account', 'security alert',
    'you have won', 'claim your prize', 'claim your reward', 'double your', 'urgent action required',
    'wire transfer', 'bitcoin giveaway', 'limited time offer', 'your package could not be delivered',
    'your account will be closed', 'suspended pending verification',
];

/** How close a credential word has to be to a brand name to count (characters). */
const NEAR = 120;

/**
 * Why the text reads like a scam, or null when it does not.
 * A brand and a credential word near each other, or one of the scam sentences.
 */
function phishingReason(text) {
    const s = String(text || '').toLowerCase();
    if (!s) return null;
    for (const phrase of PHRASES) if (s.includes(phrase)) return `it reads like a scam ("${phrase}")`;
    for (const brand of BRANDS) {
        let at = s.indexOf(brand);
        while (at !== -1) {
            const near = s.slice(Math.max(0, at - NEAR), at + brand.length + NEAR);
            for (const word of CREDENTIALS) {
                if (near.includes(word)) return `it asks for a password next to the name "${brand}"`;
            }
            at = s.indexOf(brand, at + brand.length);
        }
    }
    return null;
}

/** The <form> tags of a file. */
const FORM_RE = /<form\b[^>]*>/gi;
const ACTION_RE = /\baction\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;

/**
 * Why a file's form posts to another origin, or null when it does not.
 * sitesDomain: the domain the space's own address is on (<slug>.openvibe.website).
 */
function offsiteFormReason(content, { sitesDomain = '' } = {}) {
    const text = String(content || '');
    for (const m of text.matchAll(FORM_RE)) {
        const tag = m[0];
        const a = ACTION_RE.exec(tag);
        if (!a) continue;                                    // no action: the form posts to its own address
        const raw = String(a[1] !== undefined ? a[1] : a[2] !== undefined ? a[2] : a[3] || '').trim();
        if (!raw || raw.startsWith('#')) continue;           // empty or a fragment: the same page
        if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:/i.test(raw)) return `the form posts to "${raw}", which is not an address a site can post to`;
        if (raw.startsWith('//')) return `the form posts to "${raw}", another origin`;
        if (!/^https?:/i.test(raw)) continue;                // relative: the site's own address
        let host = '';
        try { host = new URL(raw).hostname.toLowerCase(); } catch { return `the form action "${raw}" is not an address`; }
        if (!host) continue;
        const own = String(sitesDomain || '').toLowerCase();
        if (own && (host === own || host.endsWith(`.${own}`))) continue;   // the site's own address
        return `the form posts to ${host}, another origin`;
    }
    return null;
}

/**
 * The reason a set of files is refused, or null.
 * forms: true checks the off-site form rule too — that one is a guest rule (an owner may post to their own
 * payment provider; a guest draft is published nowhere and may only post to its own address).
 */
function filesReason(files, { sitesDomain = '', forms = false } = {}) {
    for (const f of Array.isArray(files) ? files : []) {
        const content = String((f && f.content) || '');
        const scam = phishingReason(content);
        if (scam) return { code: 'space.guest_abuse', message: `“${f.path}” ${scam}; a space may not ask for someone's password` };
        if (!forms) continue;
        const form = offsiteFormReason(content, { sitesDomain });
        if (form) return { code: 'space.guest_offsite_form', message: `“${f.path}”: ${form}; a guest draft's forms may only post to its own address` };
    }
    return null;
}

/** The reason a prompt is refused, or null. */
function promptReason(prompt) {
    const scam = phishingReason(prompt);
    return scam ? { code: 'space.guest_abuse', message: `this request ${scam}; a space may not ask for someone's password` } : null;
}

/** Refuse with the reason (an ApiError), or return quietly. */
function refuse(reason) {
    if (reason) throw new ApiError(422, reason.code, reason.message);
}

module.exports = { phishingReason, offsiteFormReason, filesReason, promptReason, refuse, BRANDS, CREDENTIALS, PHRASES };
