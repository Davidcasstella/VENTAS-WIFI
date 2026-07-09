const fs = require('fs-extra');
const path = require('path');
const dynamo = require('./dynamoStore');

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
        if (dynamo.isEnabled()) {
            try {
                const data = await dynamo.getItem('CONFIG', 'follow-up-config');
                if (data) {
                    if (!data.steps) data.steps = DEFAULT_CONFIG.steps;
                    return data;
                }
                const local = await fs.readJson(CONFIG_PATH).catch(() => DEFAULT_CONFIG);
                await dynamo.putItem('CONFIG', 'follow-up-config', local);
                if (!local.steps) local.steps = DEFAULT_CONFIG.steps;
                return local;
            } catch (err) {
                console.error(`❌ [FollowUp] DynamoDB read failed: ${err.message}`);
            }
        }
        const config = await fs.readJson(CONFIG_PATH).catch(() => DEFAULT_CONFIG);
        if (!config.steps) config.steps = DEFAULT_CONFIG.steps;
        return config;
    }

    async saveConfig(updates) {
        const current = await this.getConfig();
        const next = { ...current, ...updates, updatedAt: new Date().toISOString() };
        if (dynamo.isEnabled()) {
            try {
                await dynamo.putItem('CONFIG', 'follow-up-config', next);
            } catch (err) {
                console.error(`❌ [FollowUp] DynamoDB write failed: ${err.message}`);
            }
        }
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
        if (dynamo.isEnabled()) {
            try {
                const items = await dynamo.queryItems('FOLLOWUP_STATE');
                const map = {};
                items.forEach(item => { map[item.sk] = item.data; });
                return map;
            } catch (err) {
                console.error(`❌ [FollowUp] DynamoDB query failed: ${err.message}`);
            }
        }
        return fs.readJson(STATES_PATH).catch(() => ({}));
    }

    async _writeStates(states) {
        // Fallback or full sync
        await fs.writeJson(STATES_PATH, states, { spaces: 2 });
    }

    async _saveState(jid, state) {
        if (dynamo.isEnabled()) {
            try {
                await dynamo.putItem('FOLLOWUP_STATE', jid, state);
            } catch (err) {
                console.error(`❌ [FollowUp] DynamoDB write failed: ${err.message}`);
            }
        }
        const states = await fs.readJson(STATES_PATH).catch(() => ({}));
        states[jid] = state;
        await fs.writeJson(STATES_PATH, states, { spaces: 2 });
    }

    async _mutate(fn) {
        this._writeChain = (this._writeChain || Promise.resolve()).then(async () => {
            const states = await this._readStates();
            const result = await fn(states);
            if (!dynamo.isEnabled()) await this._writeStates(states);
            return result;
        });
        return this._writeChain;
    }

    async _mutateJid(jid, fn) {
        this._writeChain = (this._writeChain || Promise.resolve()).then(async () => {
            const state = await this.getState(jid) || {};
            const result = await fn(state);
            await this._saveState(jid, state);
            return result;
        });
        return this._writeChain;
    }

    async getState(jid) {
        if (dynamo.isEnabled()) {
            try {
                const data = await dynamo.getItem('FOLLOWUP_STATE', jid);
                if (data) return data;
                // Migrate from local
                const states = await fs.readJson(STATES_PATH).catch(() => ({}));
                if (states[jid]) {
                    await dynamo.putItem('FOLLOWUP_STATE', jid, states[jid]);
                    return states[jid];
                }
                return null;
            } catch (err) {
                console.error(`❌ [FollowUp] DynamoDB read failed: ${err.message}`);
            }
        }
        const states = await fs.readJson(STATES_PATH).catch(() => ({}));
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
     */
    async startFollowUp(jid, opts = {}) {
        const config = await this.getConfig();
        const isManual = opts.isManual || false;
        const forceImmediate = opts.forceImmediate || false;

        if (!config.globalEnabled && !isManual) return false;
        if (!jid || jid.includes('@g.us')) return false;

        return this._mutateJid(jid, (state) => {
            // Never revive a follow-up that was closed by a sale or a manual stop, unless manually forced.
            if (state.status === 'closed' && !isManual) {
                return false;
            }

            const now = new Date().toISOString();
            let anchorAt = now;
            if (forceImmediate) {
                const enabledSteps = config.steps.filter(s => s.enabled);
                if (enabledSteps.length > 0) {
                    const delayMs = enabledSteps[0].delayMinutes * 60000;
                    anchorAt = new Date(Date.now() - delayMs).toISOString();
                }
            }

            state.startedAt = state.startedAt || now;
            state.anchorAt = anchorAt;
            state.currentStepIndex = 0;
            state.lastStepSentAt = null;
            state.status = 'active';
            state.pauseReason = null;
            state.closedReason = null;
            state.history = state.history || [];
            state.completed = false;
            state.cancelled = false;
            state.cancelReason = null;
            state.updatedAt = now;

            console.log(`📋 Follow-up ${state.startedAt === now ? 'started' : 're-armed'} for ${jid}`);

            if (forceImmediate) {
                setTimeout(() => this._processQueue(), 500);
            }

            return true;
        });
    }

    /**
     * Pause a follow-up (temporary). It will re-arm on the next outbound message.
     */
    async pauseFollowUp(jid, reason = 'client_replied') {
        return this._mutateJid(jid, (state) => {
            if (!state.status || state.status === 'closed' || state.status === 'paused') return false;
            state.status = 'paused';
            state.pauseReason = reason;
            state.pausedAt = new Date().toISOString();
            state.updatedAt = state.pausedAt;
            console.log(`⏸️ Follow-up paused for ${jid}: ${reason}`);
            return true;
        });
    }

    /**
     * Close a follow-up permanently.
     */
    async closeFollowUp(jid, reason = 'manual') {
        return this._mutateJid(jid, (state) => {
            if (!state.status) {
                state.startedAt = new Date().toISOString();
                state.status = 'closed';
                state.closedReason = reason;
                state.closedAt = new Date().toISOString();
                state.currentStepIndex = 0;
                state.history = [];
                state.completed = false;
                state.cancelled = true;
                state.cancelReason = reason;
                console.log(`🚫 Follow-up closed for ${jid}: ${reason}`);
                return true;
            }
            state.status = 'closed';
            state.closedReason = reason;
            state.closedAt = new Date().toISOString();
            state.updatedAt = state.closedAt;
            state.cancelled = true;
            state.cancelReason = reason;
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
                const step = await this._mutateJid(jid, async (state) => {
                    if ((state.status || 'active') !== 'active') return null;
                    const stepIdx = state.currentStepIndex || 0;
                    if (stepIdx >= enabledSteps.length) return null;

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

                await this._mutateJid(jid, (state) => {
                    const nowIso = new Date().toISOString();
                    if (sendOk) {
                        state.history = state.history || [];
                        state.history.push({ stepId: step.id, label: step.label, sentAt: nowIso, ok: true });
                        state.lastStepSentAt = nowIso;
                        state.currentStepIndex = (state.currentStepIndex || 0) + 1;
                        state.updatedAt = nowIso;
                        if (state.currentStepIndex >= enabledSteps.length) {
                            state.completed = true;
                            state.completedAt = nowIso;
                            console.log(`✅ Follow-up sequence exhausted for ${jid}`);
                        }
                    } else {
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
