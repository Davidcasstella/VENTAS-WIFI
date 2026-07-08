const fs = require('fs-extra');
const path = require('path');

// ── Persistence paths ──────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, '../../data');
const UPLOADS_DIR = path.join(__dirname, '../../public/uploads/follow-up');
const CONFIG_PATH = path.join(DATA_DIR, 'follow-up-config.json');
const STATES_PATH = path.join(DATA_DIR, 'follow-up-states.json');

const DEFAULT_CONFIG = {
    globalEnabled: false,
    stopOnReply: true,
    steps: [
        {
            id: 'step_1',
            label: 'Seguimiento 2 horas',
            delayMinutes: 120,
            enabled: true,
            text: '¡Hola! 👋 Vi que te interesó el curso. No dejes pasar la promo: tienes el combo de 7 mil y el combo de 10 mil (el más completo) 🔥 ¿Con cuál te animas?',
            audioPath: null,
            videoPath: null,
            imagePath: null
        },
        {
            id: 'step_2',
            label: 'Seguimiento 4 horas',
            delayMinutes: 240,
            enabled: true,
            text: 'Sigo aquí para ayudarte 🙌 Recuerda que por hoy mantienes la promo: combo de 7 mil o el de 10 mil con todo incluido. Es una inversión que se paga sola. ¿Te reservo tu cupo?',
            audioPath: null,
            videoPath: null,
            imagePath: null
        },
        {
            id: 'step_3',
            label: 'Seguimiento 2 días',
            delayMinutes: 2880,
            enabled: true,
            text: 'No quiero que pierdas esta oportunidad 😊 La promo de 7 mil y 10 mil sigue disponible por poco tiempo. Muchos ya empezaron su curso. ¿Aseguramos el tuyo hoy?',
            audioPath: null,
            videoPath: null,
            imagePath: null
        },
        {
            id: 'step_4',
            label: 'Seguimiento 4 días',
            delayMinutes: 5760,
            enabled: true,
            text: 'Última llamada 🚀 La promo de 7 mil / 10 mil está por cerrarse. Si te animas ahora aseguras el precio especial y el acceso completo. Escríbeme y lo dejamos listo 💪',
            audioPath: null,
            videoPath: null,
            imagePath: null
        }
    ],
    updatedAt: null
};

class FollowUpService {
    constructor() {
        this._ensureFiles();
        this._schedulerInterval = null;
        this._sock = null;
        this._chatHistoryService = null;
        this._io = null;
        this._welcomeAutomationService = null;
    }

    // ── Init ──────────────────────────────────────────────────────────────

    _ensureFiles() {
        fs.ensureDirSync(DATA_DIR);
        fs.ensureDirSync(UPLOADS_DIR);
        if (!fs.existsSync(CONFIG_PATH)) {
            fs.writeJsonSync(CONFIG_PATH, DEFAULT_CONFIG, { spaces: 2 });
        }
        if (!fs.existsSync(STATES_PATH)) {
            fs.writeJsonSync(STATES_PATH, {}, { spaces: 2 });
        }
    }

    // ── Config helpers ────────────────────────────────────────────────────

    async getConfig() {
        const config = await fs.readJson(CONFIG_PATH);
        // Ensure steps array exists (backward compatibility)
        if (!config.steps) config.steps = DEFAULT_CONFIG.steps;
        return config;
    }

    async saveConfig(updates) {
        const current = await this.getConfig();
        const next = { ...current, ...updates, updatedAt: new Date().toISOString() };
        await fs.writeJson(CONFIG_PATH, next, { spaces: 2 });
        return next;
    }

    // ── Step management ───────────────────────────────────────────────────

    async getStep(stepId) {
        const config = await this.getConfig();
        return config.steps.find(s => s.id === stepId) || null;
    }

    async updateStep(stepId, updates) {
        const config = await this.getConfig();
        const idx = config.steps.findIndex(s => s.id === stepId);
        if (idx === -1) throw new Error(`Step ${stepId} not found`);

        // Merge updates (don't overwrite media paths unless explicitly set)
        config.steps[idx] = { ...config.steps[idx], ...updates };
        config.updatedAt = new Date().toISOString();
        await fs.writeJson(CONFIG_PATH, config, { spaces: 2 });
        return config.steps[idx];
    }

    async addStep(stepData) {
        const config = await this.getConfig();
        const newStep = {
            id: 'step_' + Date.now(),
            label: stepData.label || `Paso ${config.steps.length + 1}`,
            delayMinutes: stepData.delayMinutes || 60,
            enabled: true,
            text: stepData.text || '',
            audioPath: null,
            videoPath: null,
            imagePath: null
        };
        config.steps.push(newStep);
        config.updatedAt = new Date().toISOString();
        await fs.writeJson(CONFIG_PATH, config, { spaces: 2 });
        return newStep;
    }

    async deleteStep(stepId) {
        const config = await this.getConfig();
        const step = config.steps.find(s => s.id === stepId);
        if (!step) throw new Error(`Step ${stepId} not found`);

        // Delete associated media files
        if (step.audioPath && fs.existsSync(step.audioPath)) await fs.remove(step.audioPath);
        if (step.videoPath && fs.existsSync(step.videoPath)) await fs.remove(step.videoPath);
        if (step.imagePath && fs.existsSync(step.imagePath)) await fs.remove(step.imagePath);

        config.steps = config.steps.filter(s => s.id !== stepId);
        config.updatedAt = new Date().toISOString();
        await fs.writeJson(CONFIG_PATH, config, { spaces: 2 });
        return true;
    }

    // ── Media management per step ─────────────────────────────────────────

    getMediaPath(stepId, type, ext) {
        return path.join(UPLOADS_DIR, `${stepId}-${type}${ext}`);
    }

    async saveStepMedia(stepId, type, tempPath, originalName) {
        const ext = path.extname(originalName).toLowerCase() || (type === 'audio' ? '.ogg' : type === 'video' ? '.mp4' : '.jpg');
        const dest = this.getMediaPath(stepId, type, ext);

        // Delete existing media of this type for this step
        const step = await this.getStep(stepId);
        if (step) {
            const currentPath = step[`${type}Path`];
            if (currentPath && fs.existsSync(currentPath)) {
                await fs.remove(currentPath);
            }
        }

        await fs.move(tempPath, dest, { overwrite: true });
        await this.updateStep(stepId, { [`${type}Path`]: dest });
        console.log(`📎 Follow-up ${type} saved for ${stepId}: ${dest}`);
        return dest;
    }

    async deleteStepMedia(stepId, type) {
        const step = await this.getStep(stepId);
        if (!step) throw new Error(`Step ${stepId} not found`);

        const currentPath = step[`${type}Path`];
        if (currentPath && fs.existsSync(currentPath)) {
            await fs.remove(currentPath);
        }
        await this.updateStep(stepId, { [`${type}Path`]: null });
        console.log(`🗑️ Follow-up ${type} deleted for ${stepId}`);
    }

    // ── Follow-up state management ────────────────────────────────────────
    //
    // State model (per JID):
    //   status: 'active' | 'paused' | 'closed'
    //     - active : the business spoke last, the silence timer is running
    //     - paused : the client replied; will re-arm on the next outbound
    //     - closed : terminal (sale won or operator stopped it manually)
    //   anchorAt        : reference time for the CURRENT step's delay
    //                     (reset to "now" every time the business sends a message)
    //   currentStepIndex: which enabled step fires next
    //   history[]       : audit trail of steps actually sent
    //
    // Legacy fields (completed/cancelled) are still written for backward
    // compatibility with older data, but the logic is driven by `status`.

    async _readStates() {
        return fs.readJson(STATES_PATH);
    }

    async _writeStates(states) {
        await fs.writeJson(STATES_PATH, states, { spaces: 2 });
    }

    /**
     * Serialize every read-modify-write on the states file so the scheduler and
     * the message handlers can't clobber each other (a lost cancellation would
     * mean sending a follow-up to someone who already replied).
     */
    async _mutate(fn) {
        this._writeChain = (this._writeChain || Promise.resolve()).then(async () => {
            const states = await this._readStates();
            const result = await fn(states);
            await this._writeStates(states);
            return result;
        });
        return this._writeChain;
    }

    async getState(jid) {
        const states = await this._readStates();
        return states[jid] || null;
    }

    async getAllStates() {
        return this._readStates();
    }

    /**
     * States the dashboard shows as "in follow-up": active + paused.
     * Closed ones are excluded here (audit them via getAllStates / the API).
     */
    async getActiveStates() {
        const states = await this._readStates();
        return Object.entries(states)
            .filter(([, s]) => (s.status ? s.status !== 'closed' : (!s.completed && !s.cancelled)))
            .map(([jid, s]) => ({
                jid,
                displayName: jid.replace('@s.whatsapp.net', ''),
                status: s.status || 'active',
                ...s
            }))
            .sort((a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime());
    }

    /**
     * Arm (or re-arm) the follow-up silence timer for a lead.
     *
     * Called every time the BUSINESS sends a message (welcome, AI reply, agent
     * manual reply, dashboard send). Resets the clock to now and restarts the
     * sequence from the first step — the lead just heard from us, so the whole
     * "no reply" countdown begins again. Refuses only when the follow-up was
     * permanently closed (sale won or stopped manually).
     *
     * @param {string} jid - WhatsApp JID
     */
    async startFollowUp(jid, opts = {}) {
        const config = await this.getConfig();
        const isManual = opts.isManual || false;
        const forceImmediate = opts.forceImmediate || false;

        if (!config.globalEnabled && !isManual) return false;
        if (!jid || jid.includes('@g.us')) return false;

        return this._mutate((states) => {
            const prev = states[jid];

            // Never revive a follow-up that was closed by a sale or a manual stop, unless manually forced.
            if (prev && prev.status === 'closed' && !isManual) {
                return false;
            }

            const now = new Date().toISOString();
            let anchorAt = now;
            if (forceImmediate) {
                // Backdate anchorAt so the first step triggers immediately
                const enabledSteps = config.steps.filter(s => s.enabled);
                if (enabledSteps.length > 0) {
                    const delayMs = enabledSteps[0].delayMinutes * 60000;
                    anchorAt = new Date(Date.now() - delayMs).toISOString();
                }
            }

            states[jid] = {
                startedAt: prev?.startedAt || now, // first time we ever engaged this lead
                anchorAt: anchorAt,                // clock for the next step
                currentStepIndex: 0,               // restart the sequence from step 1
                lastStepSentAt: null,
                status: 'active',
                pauseReason: null,
                closedReason: null,
                history: prev?.history || [],
                // legacy compatibility
                completed: false,
                cancelled: false,
                cancelReason: null,
                updatedAt: now
            };
            const verb = prev ? 're-armed' : 'started';
            console.log(`📋 Follow-up ${verb} for ${jid}`);

            if (forceImmediate) {
                // Trigger the queue processing immediately so the user doesn't have to wait up to 60s
                setTimeout(() => this._processQueue(), 500);
            }

            return true;
        });
    }

    /**
     * Pause a follow-up (temporary). It will re-arm on the next outbound message.
     * Used when the client replies.
     */
    async pauseFollowUp(jid, reason = 'client_replied') {
        return this._mutate((states) => {
            const s = states[jid];
            if (!s || s.status === 'closed' || s.status === 'paused') return false;
            s.status = 'paused';
            s.pauseReason = reason;
            s.pausedAt = new Date().toISOString();
            s.updatedAt = s.pausedAt;
            console.log(`⏸️ Follow-up paused for ${jid}: ${reason}`);
            return true;
        });
    }

    /**
     * Close a follow-up permanently. Used when the sale is won ('sale') or the
     * operator stops it from the dashboard ('manual'). A closed follow-up is
     * never re-armed by subsequent outbound messages.
     */
    async closeFollowUp(jid, reason = 'manual') {
        return this._mutate((states) => {
            const s = states[jid];
            if (!s) {
                // Record the closure anyway so a later outbound can't start it.
                states[jid] = {
                    startedAt: new Date().toISOString(),
                    status: 'closed',
                    closedReason: reason,
                    closedAt: new Date().toISOString(),
                    currentStepIndex: 0,
                    history: [],
                    completed: false,
                    cancelled: true,
                    cancelReason: reason
                };
                console.log(`🚫 Follow-up closed for ${jid}: ${reason}`);
                return true;
            }
            s.status = 'closed';
            s.closedReason = reason;
            s.closedAt = new Date().toISOString();
            s.updatedAt = s.closedAt;
            // legacy
            s.cancelled = true;
            s.cancelReason = reason;
            console.log(`🚫 Follow-up closed for ${jid}: ${reason}`);
            return true;
        });
    }

    /**
     * Back-compat alias. Older callers (dashboard "Cancel", payment flow) used
     * cancelFollowUp. Manual/sale cancellations are permanent closures.
     */
    async cancelFollowUp(jid, reason = 'manual') {
        return this.closeFollowUp(jid, reason);
    }

    /**
     * Pause the follow-up when the client replies (called from app.js).
     * Temporary: the next business message re-arms it via startFollowUp.
     */
    async cancelIfClientReplied(jid) {
        const config = await this.getConfig();
        if (!config.stopOnReply) return false;
        return this.pauseFollowUp(jid, 'client_replied');
    }

    // ── Scheduler ─────────────────────────────────────────────────────────

    /**
     * Set external dependencies needed for sending messages.
     */
    setDependencies(sock, chatHistoryService, io, welcomeAutomationService) {
        this._sock = sock;
        this._chatHistoryService = chatHistoryService;
        this._io = io;
        this._welcomeAutomationService = welcomeAutomationService;
    }

    /**
     * Update the socket reference (needed after reconnections).
     */
    setSock(sock) {
        this._sock = sock;
    }

    /**
     * Start the scheduler that checks every 60 seconds for pending follow-ups.
     */
    startScheduler() {
        if (this._schedulerInterval) {
            clearInterval(this._schedulerInterval);
        }

        console.log('⏰ Follow-up scheduler started (checking every 60s)');
        this._schedulerInterval = setInterval(() => this._processQueue(), 60000);

        // Run once immediately
        setTimeout(() => this._processQueue(), 5000);
    }

    stopScheduler() {
        if (this._schedulerInterval) {
            clearInterval(this._schedulerInterval);
            this._schedulerInterval = null;
            console.log('⏰ Follow-up scheduler stopped');
        }
    }

    /**
     * Process the follow-up queue — check all active states and send pending steps.
     */
    async _processQueue() {
        try {
            const config = await this.getConfig();
            if (!this._sock) return;

            const enabledSteps = config.steps.filter(s => s.enabled);
            if (enabledSteps.length === 0) return;

            const states = await this._readStates();
            const now = Date.now();

            // Snapshot: decide which JIDs are due WITHOUT mutating shared state
            // here. All state changes happen inside _mutate() so we never race
            // with startFollowUp / pauseFollowUp / closeFollowUp.
            const dueJids = [];
            for (const [jid, state] of Object.entries(states)) {
                const status = state.status || (state.cancelled || state.completed ? 'closed' : 'active');
                if (status !== 'active') continue;

                const stepIdx = state.currentStepIndex || 0;
                if (stepIdx >= enabledSteps.length) continue; // sequence exhausted

                const step = enabledSteps[stepIdx];
                const referenceTime = state.lastStepSentAt
                    ? new Date(state.lastStepSentAt).getTime()
                    : new Date(state.anchorAt || state.startedAt).getTime();
                const targetTime = referenceTime + (step.delayMinutes * 60000);

                if (now >= targetTime) dueJids.push(jid);
            }

            if (dueJids.length === 0) return;

            for (const jid of dueJids) {
                // Re-read fresh state under the lock, re-validate, send, then commit.
                // The safety re-check (client replied / status changed) closes the
                // window between "decided due" and "actually sending".
                const step = await this._mutate(async (s) => {
                    const state = s[jid];
                    if (!state || (state.status || 'active') !== 'active') return null;
                    const stepIdx = state.currentStepIndex || 0;
                    if (stepIdx >= enabledSteps.length) return null;

                    // Guard: if the client sent something AFTER our last outbound,
                    // they replied — pause instead of sending. Belt-and-suspenders
                    // on top of cancelIfClientReplied.
                    if (await this._clientRepliedSince(jid, state)) {
                        state.status = 'paused';
                        state.pauseReason = 'client_replied';
                        state.pausedAt = new Date().toISOString();
                        console.log(`⏸️ Follow-up paused for ${jid}: client replied (pre-send check)`);
                        return null;
                    }
                    return enabledSteps[stepIdx];
                });

                if (!step) continue;

                let sendOk = true;
                try {
                    await this._sendStep(jid, step);
                } catch (err) {
                    sendOk = false;
                    console.error(`❌ Follow-up step failed for ${jid}: ${err.message}`);
                }

                await this._mutate((s) => {
                    const state = s[jid];
                    if (!state) return;
                    const nowIso = new Date().toISOString();
                    if (sendOk) {
                        state.history = state.history || [];
                        state.history.push({ stepId: step.id, label: step.label, sentAt: nowIso, ok: true });
                        state.lastStepSentAt = nowIso;
                        state.currentStepIndex = (state.currentStepIndex || 0) + 1;
                        state.updatedAt = nowIso;
                        if (state.currentStepIndex >= enabledSteps.length) {
                            // Sequence exhausted — mark done but keep it re-armable
                            // by a future outbound (status stays non-closed).
                            state.completed = true;
                            state.completedAt = nowIso;
                            console.log(`✅ Follow-up sequence exhausted for ${jid}`);
                        }
                    } else {
                        // Failed send: record it but DON'T advance the index, so the
                        // next tick retries the same step.
                        state.history = state.history || [];
                        state.history.push({ stepId: step.id, label: step.label, sentAt: nowIso, ok: false });
                        state.updatedAt = nowIso;
                    }
                });
            }
        } catch (err) {
            console.error(`❌ Follow-up scheduler error: ${err.message}`);
        }
    }

    /**
     * Returns true if the lead has an incoming message more recent than the last
     * outbound follow-up anchor — i.e. they replied and we shouldn't keep sending.
     * Uses chat history when available; falls back to false (don't block) if not.
     */
    async _clientRepliedSince(jid, state) {
        try {
            if (!this._chatHistoryService || typeof this._chatHistoryService.getMessages !== 'function') {
                return false;
            }
            const conv = await this._chatHistoryService.getMessages(jid);
            if (!conv || !Array.isArray(conv.messages)) return false;
            const anchor = new Date(state.lastStepSentAt || state.anchorAt || state.startedAt || 0).getTime();
            return conv.messages.some(m => !m.fromMe && new Date(m.timestamp).getTime() > anchor);
        } catch (_) {
            return false;
        }
    }

    /**
     * Send a single follow-up step (text + media) to a JID.
     */
    async _sendStep(jid, step) {
        if (!this._sock) throw new Error('No WhatsApp socket available');

        const DELAY = parseInt(process.env.RESPONSE_DELAY, 10) || 2000;
        console.log(`📋 Sending follow-up step "${step.label}" to ${jid}`);

        // Mark as bot-sent to avoid manual intervention detection
        if (this._welcomeAutomationService) {
            this._welcomeAutomationService.markBotSent(jid);
        }

        // 1. Send audio first (if exists)
        if (step.audioPath && fs.existsSync(step.audioPath)) {
            try {
                if (this._welcomeAutomationService) this._welcomeAutomationService.markBotSent(jid);
                await this._sock.sendMessage(jid, {
                    audio: { url: step.audioPath },
                    mimetype: 'audio/ogg; codecs=opus',
                    ptt: true
                });
                console.log(`🔊 Follow-up audio sent to ${jid}`);
                if (this._chatHistoryService && this._io) {
                    try {
                        const savedMsg = await this._chatHistoryService.addMessage(jid, `[Follow-up Audio: ${step.label}]`, true, 'System', 'system');
                        this._io.emit('chat:message', { jid, message: savedMsg });
                    } catch (_) { }
                }
                await new Promise(r => setTimeout(r, DELAY));
            } catch (err) {
                console.error(`⚠️ Follow-up audio failed for ${jid}: ${err.message}`);
            }
        }

        // 2. Send text message(s) — supports multi-message with ---MSG--- separator
        if (step.text && step.text.trim()) {
            const messageParts = step.text.split('---MSG---').map(p => p.trim()).filter(p => p.length > 0);

            for (let i = 0; i < messageParts.length; i++) {
                try {
                    // Delay between messages (skip for the first one)
                    if (i > 0) {
                        await new Promise(r => setTimeout(r, DELAY));
                    }

                    if (this._welcomeAutomationService) this._welcomeAutomationService.markBotSent(jid);
                    await this._sock.sendMessage(jid, { text: messageParts[i] });
                    console.log(`📝 Follow-up text ${i + 1}/${messageParts.length} sent to ${jid}`);
                    if (this._chatHistoryService && this._io) {
                        try {
                            const savedMsg = await this._chatHistoryService.addMessage(jid, messageParts[i], true, 'System', 'system');
                            this._io.emit('chat:message', { jid, message: savedMsg });
                        } catch (_) { }
                    }
                } catch (err) {
                    console.error(`⚠️ Follow-up text part ${i + 1} failed for ${jid}: ${err.message}`);
                }
            }
            await new Promise(r => setTimeout(r, Math.floor(DELAY * 0.5)));
        }

        // 3. Send image (if exists)
        if (step.imagePath && fs.existsSync(step.imagePath)) {
            try {
                if (this._welcomeAutomationService) this._welcomeAutomationService.markBotSent(jid);
                await this._sock.sendMessage(jid, {
                    image: { url: step.imagePath },
                    caption: ''
                });
                console.log(`🖼️ Follow-up image sent to ${jid}`);
                if (this._chatHistoryService && this._io) {
                    try {
                        const savedMsg = await this._chatHistoryService.addMessage(jid, `[Follow-up Image: ${step.label}]`, true, 'System', 'system');
                        this._io.emit('chat:message', { jid, message: savedMsg });
                    } catch (_) { }
                }
                await new Promise(r => setTimeout(r, Math.floor(DELAY * 0.5)));
            } catch (err) {
                console.error(`⚠️ Follow-up image failed for ${jid}: ${err.message}`);
            }
        }

        // 4. Send video (if exists)
        if (step.videoPath && fs.existsSync(step.videoPath)) {
            try {
                if (this._welcomeAutomationService) this._welcomeAutomationService.markBotSent(jid);
                await this._sock.sendMessage(jid, {
                    video: { url: step.videoPath },
                    mimetype: 'video/mp4'
                });
                console.log(`🎬 Follow-up video sent to ${jid}`);
                if (this._chatHistoryService && this._io) {
                    try {
                        const savedMsg = await this._chatHistoryService.addMessage(jid, `[Follow-up Video: ${step.label}]`, true, 'System', 'system');
                        this._io.emit('chat:message', { jid, message: savedMsg });
                    } catch (_) { }
                }
            } catch (err) {
                console.error(`⚠️ Follow-up video failed for ${jid}: ${err.message}`);
            }
        }

        console.log(`✅ Follow-up step "${step.label}" completed for ${jid}`);
    }
}

module.exports = new FollowUpService();
