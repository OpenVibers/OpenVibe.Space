'use strict';
/**
 * Space → the agent's one timeline (plan 2026-10-22 §Z stage Z1).
 *
 * Every step of the person's agent that builds a space is published into the network's agent namespace
 * (agent.step.started | updated | ended, contracts common.agent-step@1), with the person as its subject: OpenVibe.Actor
 * keeps the one timeline behind the Dock, and the person's Dock shows the step while Space shows the space's live
 * preview. A step carries a title, an outcome and a link: never a prompt, a diff or a page.
 *
 * The publish the agent asks for is a step of its own, waiting for the person ("Needs you" in the Dock): the person
 * answers it there, and the answer lands in Space.
 */
const contracts = require('openvibe-contracts');

const MODE = 'act';   // the agent acts on the person's space
const PRODUCT = 'space';

function createSpaceSteps({ outbox, config = {}, log = console }) {
    const enabled = Boolean(outbox && typeof outbox.emit === 'function');

    /** One step into the timeline. Nothing is published when the payload does not fit the contract. */
    async function emit(type, { space, person, stepId, status, title, link, reason, approval, endedAt, startedAt }) {
        if (!enabled) return null;
        const payload = {
            step_id: String(stepId || '').slice(0, 80),
            mode: MODE,
            product: PRODUCT,
            ref: String(stepId || '').slice(0, 120),
            title: String(title || 'A step of the agent').slice(0, 160),
            status,
            started_at: startedAt || new Date().toISOString(),
            ended_at: endedAt || null,
            link: link || null,
            reason: reason ? String(reason).slice(0, 240) : null,
            approval: approval || null,
        };
        const v = contracts.validate('common.agent-step@1', payload);
        if (!v.valid) {
            log.warn('[Spaces steps] the step does not fit the contract:', (v.errors || []).map((e) => e.message).join('; '));
            return null;
        }
        try {
            await outbox.emit({
                event_type: `agent.step.${type}`,
                actor: { type: 'user', id: person },
                subject: { type: 'user', id: person },
                visibility: 'internal',
                payload,
            });
            outbox.kick();
        } catch (err) {
            log.warn('[Spaces steps] the step could not be published:', (err && err.message) || err);
        }
        return payload;
    }

    const editorOf = (space) => `${config.baseUrl || 'https://openvibe.space'}/spaces/${encodeURIComponent(space.slug)}/edit`;

    return {
        enabled,
        /** The agent started building this space. */
        async started({ space, person, taskId, startedAt }) {
            return await emit('started', {
                space, person, stepId: taskId, status: 'running',
                title: `Building ${space.name}`,
                link: editorOf(space), startedAt,
            });
        },
        /** The agent wrote the space's files: the same step, brought forward. */
        async working({ space, person, taskId }) {
            return await emit('updated', {
                space, person, stepId: taskId, status: 'running',
                title: `Building ${space.name}`,
                link: editorOf(space),
            });
        },
        /** The task ended. */
        async ended({ space, person, taskId, ok, reason, endedAt }) {
            return await emit('ended', {
                space, person, stepId: taskId, status: ok ? 'done' : 'failed',
                title: ok ? `Built ${space.name}` : `Could not build ${space.name}`,
                link: editorOf(space), reason: ok ? null : reason, endedAt,
            });
        },
        /** The agent asks to publish: a step of its own that waits for the person. */
        async publishAsked({ space, person, request }) {
            return await emit('started', {
                space, person, stepId: request.id, status: 'needs_you',
                title: `Publish ${space.name}?`,
                link: editorOf(space),
                reason: 'Your agent wants to publish this space. Nothing goes live until you say yes.',
                approval: { product: PRODUCT, id: request.id, kind: 'space.publish' },
            });
        },
        /** The person answered the publish request. */
        async publishAnswered({ space, person, request, approved, reason }) {
            return await emit('ended', {
                space, person, stepId: request.id, status: approved ? 'done' : 'failed',
                title: approved ? `Published ${space.name}` : `Did not publish ${space.name}`,
                link: editorOf(space), reason: approved ? null : reason, endedAt: new Date().toISOString(),
            });
        },
    };
}

module.exports = { createSpaceSteps, MODE, PRODUCT };
