'use strict';
/**
 * A space from a page (plan §AD.15: "Space from a page: point at any OpenVibe page (a stream, a Rundown episode, a Compare
 * table) and get a space that tracks it"). openvibe.space/spaces/new?page=<address> writes the new space's description
 * from what the page is, with the events its functions should react to (events.json, plan §AD.15 triggers), so the
 * builder makes a space that keeps up with it. Only OpenVibe's own sites: any other address writes nothing.
 *
 *   describe(url) → { prompt, kind, title } | null
 */
const OPENVIBE_HOST = /(^|\.)openvibe\.(live|network|space|website|chat|media|video|community|actor|codes|tools|compare|wiki|games|link|computer|exchange|report|design|today|news)$/i;

const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const words = (s) => { let t = String(s || ''); try { t = decodeURIComponent(t); } catch { /* a stray % stays as it is */ } return clip(t.replace(/[-_]+/g, ' ').replace(/[<>"`]/g, ''), 80); };

function describe(raw) {
    let u;
    try { u = new URL(String(raw || '').trim()); } catch { return null; }
    if (u.protocol !== 'https:' || u.username || u.password || !OPENVIBE_HOST.test(u.hostname)) return null;
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const parts = u.pathname.split('/').filter(Boolean);
    const at = u.href.slice(0, 300);
    // A channel on OpenVibe.Live: openvibe.live/@name or openvibe.live/name.
    if (host === 'openvibe.live' && parts.length === 1 && /^@?[A-Za-z0-9_.-]{2,40}$/.test(parts[0]) && !/^(rundown|chat|clips|vods|browse|search|docs|settings|dashboard)$/i.test(parts[0])) {
        const name = parts[0].replace(/^@/, '').replace(/[^A-Za-z0-9_.-]/g, '');
        return {
            kind: 'channel', title: `${name} on OpenVibe.Live`,
            prompt: `A space that keeps up with ${name}'s channel on OpenVibe.Live (${at}): it says when ${name} goes live and when the stream ends (events.json: live.stream.started and live.stream.ended, kept only when the event is ${name}'s), shows their latest clips and recordings, and has a place for fans to leave a note. Clean, phone-first, in ${name}'s colours.`,
        };
    }
    // A Rundown episode or topic.
    if (host === 'openvibe.live' && /^rundown$/i.test(parts[0] || '')) {
        const what = parts.length > 1 ? words(parts[parts.length - 1]) : 'the Rundown';
        return {
            kind: 'rundown', title: `${what} (the Rundown)`,
            prompt: `A space that follows ${what} from OpenVibe.Live's Rundown (${at}): the topics and takes so far, a running list of new episodes as they come (events.json: live.stream.ended), and a short summary at the top that its function keeps up to date with ov.ai.`,
        };
    }
    // A comparison on OpenVibe.Compare.
    if (host === 'openvibe.compare') {
        const what = parts.length ? words(parts[parts.length - 1]) : 'a comparison';
        return {
            kind: 'compare', title: `${what} (Compare)`,
            prompt: `A space that tracks the comparison "${what}" on OpenVibe.Compare (${at}): the options side by side, what changed since last time (a function on a daily schedule keeps the last numbers in ov.store and shows the difference), and a pick of the best one with why.`,
        };
    }
    const where = host.split('.').map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join('.').replace(/^Openvibe/, 'OpenVibe');
    const what = parts.length ? words(parts[parts.length - 1]) : where;
    return {
        kind: 'page', title: `${what} (${where})`,
        prompt: `A space that keeps up with this OpenVibe page: ${at} (${what} on ${where}). It shows what the page is about, what is new on it, and a place to keep notes; a function on a daily schedule keeps a short summary in ov.store.`,
    };
}

module.exports = { describe, OPENVIBE_HOST };
