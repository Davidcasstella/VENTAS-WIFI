const fs = require('fs-extra');
const path = require('path');

// ── Persistence paths ──────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, '../../data');
const UPLOADS_DIR = path.join(__dirname, '../../public/uploads');
const CONFIG_PATH = path.join(DATA_DIR, 'welcome-automation.json');
const STATES_PATH = path.join(DATA_DIR, 'welcome-user-states.json');

const DEFAULT_CONFIG = {
    isEnabled: false,
    messageText: '¡Hola! 👋 Gracias por contactarnos. ¿En qué podemos ayudarte hoy?',
    audioFilePath: null,   // absolute path to .ogg file on disk
    cooldownHours: 24,
    updatedAt: null
};

class WelcomeAutomationService {
    constructor() {
        this._ensureFiles();
        // Track JIDs where the bot has sent messages (to distinguish bot vs manual)
        this._botSentJids = new Set();
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
        return fs.readJson(CONFIG_PATH);
    }

    async saveConfig(updates) {
        const current = await this.getConfig();
        const next = { ...current, ...updates, updatedAt: new Date().toISOString() };
        await fs.writeJson(CONFIG_PATH, next, { spaces: 2 });
        return next;
    }

    async resetConfig() {
        const reset = { ...DEFAULT_CONFIG, updatedAt: new Date().toISOString() };
        await fs.writeJson(CONFIG_PATH, reset, { spaces: 2 });
        // Also delete the audio file if it exists
        const audioDest = this.getAudioDestPath();
        if (fs.existsSync(audioDest)) {
            await fs.remove(audioDest);
        }
        console.log('🔄 Welcome config reset to defaults');
        return reset;
    }

    // ── User state helpers ────────────────────────────────────────────────

    async _readStates() {
        return fs.readJson(STATES_PATH);
    }

    async _writeStates(states) {
        await fs.writeJson(STATES_PATH, states, { spaces: 2 });
    }

    async getUserState(jid) {
        const states = await this._readStates();
        return states[jid] || null;
    }

    async updateUserState(jid) {
        const states = await this._readStates();
        const existing = states[jid] || {};
        states[jid] = {
            ...existing,
            lastWelcomeSentAt: new Date().toISOString()
        };
        await this._writeStates(states);
    }

    async resetUserState(jid) {
        const states = await this._readStates();
        if (states[jid]) {
            // Keep the user entry but clear welcome timestamp
            delete states[jid].lastWelcomeSentAt;
        }
        await this._writeStates(states);
    }

    async deleteUserState(jid) {
        const states = await this._readStates();
        delete states[jid];
        await this._writeStates(states);
    }

    async getAllUserStates() {
        return this._readStates();
    }

    // ── Per-user message tracking ─────────────────────────────────────────

    async updateUserMessage(jid, text) {
        const states = await this._readStates();
        const existing = states[jid] || {};
        states[jid] = {
            ...existing,
            lastMessageText: text || '',
            lastMessageAt: new Date().toISOString(),
            // Initialize defaults if new user
            aiEnabled: existing.aiEnabled !== undefined ? existing.aiEnabled : true,
            cooldownEnabled: existing.cooldownEnabled !== undefined ? existing.cooldownEnabled : true
        };
        await this._writeStates(states);
    }

    // ── Per-user AI toggle ────────────────────────────────────────────────

    async setUserAI(jid, enabled) {
        const states = await this._readStates();
        const existing = states[jid] || {};
        states[jid] = { ...existing, aiEnabled: Boolean(enabled) };
        await this._writeStates(states);
        console.log(`🤖 AI ${enabled ? 'enabled' : 'disabled'} for ${jid}`);
        return states[jid];
    }

    async disableUserAI(jid) {
        return this.setUserAI(jid, false);
    }

    // ── Per-user cooldown toggle ─────────────────────────────────────────

    async setUserCooldown(jid, enabled) {
        const states = await this._readStates();
        const existing = states[jid] || {};
        states[jid] = { ...existing, cooldownEnabled: Boolean(enabled) };
        await this._writeStates(states);
        console.log(`⏱️ Cooldown ${enabled ? 'enabled' : 'disabled'} for ${jid}`);
        return states[jid];
    }

    // ── Bot message tracking (to detect manual intervention) ──────────────

    markBotSent(jid) {
        this._botSentJids.add(jid);
        // Auto-clear after 5 seconds to avoid memory leaks
        setTimeout(() => this._botSentJids.delete(jid), 5000);
    }

    wasBotSent(jid) {
        if (this._botSentJids.has(jid)) {
            this._botSentJids.delete(jid);
            return true;
        }
        return false;
    }

    // ── Core logic ────────────────────────────────────────────────────────

    /**
     * Determine if this JID should receive the welcome sequence now.
     * Returns true if:  never received it, OR cooldown has expired.
     */
    async _shouldSend(jid, cooldownHours) {
        const state = await this.getUserState(jid);

        // Check per-user cooldown toggle — if disabled, never send welcome
        if (state && state.cooldownEnabled === false) return false;

        if (!state || !state.lastWelcomeSentAt) return true;
        const elapsed = (Date.now() - new Date(state.lastWelcomeSentAt).getTime()) / 3600000;
        return elapsed >= cooldownHours;
    }

    /**
     * Check if AI is enabled for a specific user.
     * Returns true by default if no state exists.
     */
    async isAIEnabledForUser(jid) {
        const state = await this.getUserState(jid);
        if (!state || state.aiEnabled === undefined) return true;
        return state.aiEnabled;
    }

    /**
     * Main interceptor — called from app.js before the AI handler.
     * Sends audio first (if available), then text message, then updates state.
     * @param {object} sock   - Baileys socket
     * @param {string} jid    - WhatsApp JID of the sender
     */
    async runIfNeeded(sock, jid) {
        if (!sock) return;

        const config = await this.getConfig();
        if (!config.isEnabled) return;
        if (!await this._shouldSend(jid, config.cooldownHours)) return;

        console.log(`🔔 Welcome 24H: sending welcome sequence to ${jid}`);

        // 1. Send audio FIRST (if file exists on disk)
        if (config.audioFilePath && fs.existsSync(config.audioFilePath)) {
            try {
                this.markBotSent(jid);
                await sock.sendMessage(jid, {
                    audio: { url: config.audioFilePath },
                    mimetype: 'audio/ogg; codecs=opus',
                    ptt: true   // voice note
                });
                console.log(`🔊 Welcome audio sent to ${jid}`);
            } catch (audioErr) {
                console.error(`⚠️ Welcome audio failed (continuing): ${audioErr.message}`);
            }
        }

        // 2. Send text message
        if (config.messageText && config.messageText.trim()) {
            try {
                this.markBotSent(jid);
                await sock.sendMessage(jid, { text: config.messageText });
                console.log(`📝 Welcome message sent to ${jid}`);
            } catch (textErr) {
                console.error(`⚠️ Welcome text failed: ${textErr.message}`);
            }
        }

        // 3. Persist timestamp — only after successful completion
        await this.updateUserState(jid);
    }

    // ── Audio management ──────────────────────────────────────────────────

    /** Returns the absolute destination path for the welcome audio file. */
    getAudioDestPath() {
        return path.join(UPLOADS_DIR, 'welcome-audio.ogg');
    }

    /** Moves an uploaded temp file to the permanent location and updates config. */
    async saveAudioFile(tempPath) {
        const dest = this.getAudioDestPath();
        await fs.move(tempPath, dest, { overwrite: true });
        await this.saveConfig({ audioFilePath: dest });
        console.log(`🎙️ Welcome audio saved: ${dest}`);
        return dest;
    }

    /** Deletes the audio file and clears config.audioFilePath. */
    async deleteAudio() {
        const dest = this.getAudioDestPath();
        if (fs.existsSync(dest)) {
            await fs.remove(dest);
        }
        await this.saveConfig({ audioFilePath: null });
        console.log('🗑️ Welcome audio deleted');
    }

    // ── Stats ─────────────────────────────────────────────────────────────

    /** Returns how many unique users received a welcome message in the last N hours. */
    async getStats() {
        const states = await this._readStates();
        const now = Date.now();
        const entriesLast24h = Object.values(states).filter(s => {
            if (!s.lastWelcomeSentAt) return false;
            return (now - new Date(s.lastWelcomeSentAt).getTime()) <= 86400000;
        });
        return {
            totalUsers: Object.keys(states).length,
            sentLast24h: entriesLast24h.length
        };
    }

    // ── Enriched user list for dashboard ──────────────────────────────────

    /** Returns all users with computed cooldown status for the dashboard. */
    async getUsersForDashboard() {
        const states = await this._readStates();
        const config = await this.getConfig();
        const now = Date.now();
        const cooldownMs = (config.cooldownHours || 24) * 3600000;

        return Object.entries(states).map(([jid, state]) => {
            const lastWelcome = state.lastWelcomeSentAt
                ? new Date(state.lastWelcomeSentAt).getTime()
                : null;
            const cooldownExpired = lastWelcome
                ? (now - lastWelcome) >= cooldownMs
                : true;

            return {
                jid,
                displayName: jid.replace('@s.whatsapp.net', '').replace('@g.us', ' (grupo)'),
                lastMessageText: state.lastMessageText || null,
                lastMessageAt: state.lastMessageAt || null,
                lastWelcomeSentAt: state.lastWelcomeSentAt || null,
                cooldownStatus: cooldownExpired ? 'expired' : 'active',
                cooldownExpiresAt: lastWelcome
                    ? new Date(lastWelcome + cooldownMs).toISOString()
                    : null,
                aiEnabled: state.aiEnabled !== undefined ? state.aiEnabled : true,
                cooldownEnabled: state.cooldownEnabled !== undefined ? state.cooldownEnabled : true
            };
        }).sort((a, b) => {
            // Sort by most recent message first
            const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
            const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
            return bTime - aTime;
        });
    }
}

module.exports = new WelcomeAutomationService();
