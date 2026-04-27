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
            text: '',
            audioPath: null,
            videoPath: null,
            imagePath: null
        },
        {
            id: 'step_2',
            label: 'Seguimiento 4 horas',
            delayMinutes: 240,
            enabled: true,
            text: '',
            audioPath: null,
            videoPath: null,
            imagePath: null
        },
        {
            id: 'step_3',
            label: 'Seguimiento 2 días',
            delayMinutes: 2880,
            enabled: true,
            text: '',
            audioPath: null,
            videoPath: null,
            imagePath: null
        },
        {
            id: 'step_4',
            label: 'Seguimiento 4 días',
            delayMinutes: 5760,
            enabled: true,
            text: '',
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

    async _readStates() {
        return fs.readJson(STATES_PATH);
    }

    async _writeStates(states) {
        await fs.writeJson(STATES_PATH, states, { spaces: 2 });
    }

    async getState(jid) {
        const states = await this._readStates();
        return states[jid] || null;
    }

    async getAllStates() {
        return this._readStates();
    }

    async getActiveStates() {
        const states = await this._readStates();
        return Object.entries(states)
            .filter(([, s]) => !s.completed && !s.cancelled)
            .map(([jid, s]) => ({
                jid,
                displayName: jid.replace('@s.whatsapp.net', ''),
                ...s
            }))
            .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    }

    /**
     * Start a follow-up sequence for a lead.
     * @param {string} jid - WhatsApp JID
     */
    async startFollowUp(jid) {
        const config = await this.getConfig();
        if (!config.globalEnabled) {
            console.log(`📋 Follow-up not started for ${jid}: globally disabled`);
            return false;
        }

        const states = await this._readStates();

        // Don't restart if already active
        if (states[jid] && !states[jid].completed && !states[jid].cancelled) {
            console.log(`📋 Follow-up already active for ${jid}`);
            return false;
        }

        states[jid] = {
            startedAt: new Date().toISOString(),
            currentStepIndex: 0,
            lastStepSentAt: null,
            completed: false,
            cancelled: false,
            cancelReason: null
        };
        await this._writeStates(states);
        console.log(`📋 Follow-up started for ${jid}`);
        return true;
    }

    /**
     * Cancel a follow-up sequence.
     * @param {string} jid - WhatsApp JID
     * @param {string} reason - Reason for cancellation
     */
    async cancelFollowUp(jid, reason = 'manual') {
        const states = await this._readStates();
        if (!states[jid]) return false;

        states[jid].cancelled = true;
        states[jid].cancelReason = reason;
        states[jid].cancelledAt = new Date().toISOString();
        await this._writeStates(states);
        console.log(`🚫 Follow-up cancelled for ${jid}: ${reason}`);
        return true;
    }

    /**
     * Cancel follow-up if client replies (called from app.js message handler).
     */
    async cancelIfClientReplied(jid) {
        const config = await this.getConfig();
        if (!config.stopOnReply) return false;

        const state = await this.getState(jid);
        if (!state || state.completed || state.cancelled) return false;

        return this.cancelFollowUp(jid, 'client_replied');
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
            if (!config.globalEnabled) return;
            if (!this._sock) return;

            const enabledSteps = config.steps.filter(s => s.enabled);
            if (enabledSteps.length === 0) return;

            const states = await this._readStates();
            const now = Date.now();
            let statesChanged = false;

            for (const [jid, state] of Object.entries(states)) {
                if (state.completed || state.cancelled) continue;

                // Determine which step to send next
                const stepIdx = state.currentStepIndex;
                if (stepIdx >= enabledSteps.length) {
                    // All steps completed
                    state.completed = true;
                    state.completedAt = new Date().toISOString();
                    statesChanged = true;
                    console.log(`✅ Follow-up completed for ${jid}`);
                    continue;
                }

                const step = enabledSteps[stepIdx];

                // Calculate when this step should fire
                const referenceTime = state.lastStepSentAt
                    ? new Date(state.lastStepSentAt).getTime()
                    : new Date(state.startedAt).getTime();

                const targetTime = referenceTime + (step.delayMinutes * 60000);

                if (now >= targetTime) {
                    // Time to send this step
                    try {
                        await this._sendStep(jid, step);
                        state.lastStepSentAt = new Date().toISOString();
                        state.currentStepIndex = stepIdx + 1;
                        statesChanged = true;

                        // Check if this was the last step
                        if (state.currentStepIndex >= enabledSteps.length) {
                            state.completed = true;
                            state.completedAt = new Date().toISOString();
                            console.log(`✅ Follow-up completed for ${jid}`);
                        }
                    } catch (err) {
                        console.error(`❌ Follow-up step failed for ${jid}: ${err.message}`);
                    }
                }
            }

            if (statesChanged) {
                await this._writeStates(states);
            }
        } catch (err) {
            console.error(`❌ Follow-up scheduler error: ${err.message}`);
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
