'use strict';
/**
 * The watcher (plan 2026-10-22 §Z stage Z1): Space follows the task of the person's agent that builds a space.
 *
 * Every few seconds it asks OpenVibe.Actor how the task is doing, and it publishes the step into the network's
 * agent namespace (server/spaces/steps.js), so the person sees it in the one timeline behind the Dock. The space's
 * own page asks Actor the same question while it is open, and shows the space's live preview.
 *
 * The watcher is the safety net: when the person closes the page, the task keeps running and the Dock still shows
 * what it is doing.
 */

/** Actor's task states, and the ones Space keeps (running, waiting, done, failed). */
const { STATE } = require('./agent');

function createAgentWatcher({ config, spaces, agent, steps = null, log = console }) {
    const enabled = Boolean(agent && agent.enabled) && config.builder.mode === 'agent';
    const intervalMs = config.builder.pollMs;
    let timer = null;
    let busy = false;

    /** One round: every space whose agent task is still open, asked about its task. */
    async function tick() {
        if (busy) return;
        busy = true;
        try {
            const rows = await spaces.agentRunning();
            for (const space of rows) {
                const person = space.owner_subject;
                const taskId = space.agent_task_id;
                const t = await agent.task({ person, id: taskId });
                if (!t) {
                    await spaces.setAgentState(space, 'failed');
                    if (steps) await steps.ended({ space, person, taskId, ok: false, reason: 'the task is gone' });
                    continue;
                }
                const state = STATE[t.state] || 'running';
                if (state !== space.agent_task_state) {
                    await spaces.setAgentState(space, state);
                    if (state === 'running' && steps) await steps.working({ space, person, taskId });
                }
                if (state === 'done' || state === 'failed') {
                    if (steps) {
                        await steps.ended({
                            space, person, taskId, ok: state === 'done',
                            reason: state === 'done' ? null : (t.error && (t.error.detail || t.error.code)) || t.error || t.state || 'the task did not finish',
                        });
                    }
                }
            }
        } catch (err) {
            log.warn('[Spaces agent]', (err && err.message) || err);
        } finally {
            busy = false;
        }
    }

    return {
        enabled,
        tick,
        /** The watcher runs only when the agent is the builder; otherwise the old AI loop stays in charge. */
        start() {
            if (!enabled || timer) return;
            timer = setInterval(() => { tick().catch(() => {}); }, intervalMs);
            if (timer.unref) timer.unref();
        },
        stop() {
            if (timer) clearInterval(timer);
            timer = null;
        },
    };
}

module.exports = { createAgentWatcher, STATE };
