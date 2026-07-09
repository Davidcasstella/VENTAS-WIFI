const fs = require('fs-extra');
const path = require('path');
const dynamo = require('./dynamoStore');

// ── Persistence paths ──────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, '../../data');
const UPLOADS_DIR = path.join(__dirname, '../../public/uploads');
const CONFIG_PATH = path.join(DATA_DIR, 'welcome-automation.json');
const STATES_PATH = path.join(DATA_DIR, 'welcome-user-states.json');

const DEFAULT_CONFIG = {
    isEnabled: false,
    messageText: '¡Hola! 👋 Gracias por contactarnos. ¿En qué podemos ayudarte hoy?',
    audioFilePath: null,   // absolute path to .ogg file on disk
    videoFilePath: null,   // absolute path to .mp4 file on disk
    videoEnabled: false,   // toggle video sending independently
    imageFilePath: null,   // absolute path to image file on disk
    imageEnabled: false,   // toggle image sending independently
    messageDelays: [],     // per-message delays in seconds (delay BEFORE message i+1)
    responseDelay: 1.0,    // multiplier for AI response speed (0.5 = fast, 1.0 = normal, 3.0 = slow)
    greetingByTimeEnabled: false, // replace Nth message with time-based greeting (Colombia TZ)
    greetingByTimeMessageIndex: 3, // 1-based: which message to replace (default: 3rd message)
    postVideoMessage: 'si tienes alguna duda me preguntas bro', // message sent after promo video
    postVideoDelays: [],   // per-message delays in seconds for post-video messages
    cooldownHours: 24,
    updatedAt: null
};

class WelcomeAutomationService {
    constructor() {
        this._ensureFiles();
        // Track JIDs where the bot has sent messages (to distinguish bot vs manual)
        this._botSentJids = new Set();
        // In-flight lock: prevents concurrent welcome sequences for the same JID
        // (e.g. user sends 2 rapid messages before first welcome finishes)
        this._sendingWelcome = new Set();
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

    // ── Colombia timezone greeting ───────────────────────────────────────
    // Returns "Buenos días", "Buenas tardes", or "Buenas noches"
    // based on current hour in America/Bogota (UTC-5). Uses native Intl API
    // so it works correctly regardless of where the server is hosted.
    _getColombiaGreeting() {
        const now = new Date();
        // Get current hour in Colombia timezone (always UTC-5)
        const colombiaHour = parseInt(
            new Intl.DateTimeFormat('es-CO', {
                timeZone: 'America/Bogota',
                hour: 'numeric',
                hour12: false
            }).format(now)
        );

        if (colombiaHour >= 5 && colombiaHour < 12) {
            return 'Buenos días';
        } else if (colombiaHour >= 12 && colombiaHour < 18) {
            return 'Buenas tardes';
        } else {
            return 'Buenas noches';
        }
    }

    // ── Config helpers ────────────────────────────────────────────────────

    async getConfig() {
        if (dynamo.isEnabled()) {
            try {
                const data = await dynamo.getItem('CONFIG', 'welcome-automation');
                if (data) return data;
                const local = await fs.readJson(CONFIG_PATH).catch(() => DEFAULT_CONFIG);
                await dynamo.putItem('CONFIG', 'welcome-automation', local);
                return local;
            } catch (err) {
                console.error(`❌ [Welcome] DynamoDB read failed: ${err.message}`);
            }
        }
        return fs.readJson(CONFIG_PATH).catch(() => DEFAULT_CONFIG);
    }

    async saveConfig(updates) {
        const current = await this.getConfig();
        const next = { ...current, ...updates, updatedAt: new Date().toISOString() };
        if (dynamo.isEnabled()) {
            try {
                await dynamo.putItem('CONFIG', 'welcome-automation', next);
            } catch (err) {
                console.error(`❌ [Welcome] DynamoDB write failed: ${err.message}`);
            }
        }
        await fs.writeJson(CONFIG_PATH, next, { spaces: 2 });
        return next;
    }

    async resetConfig() {
        const reset = { ...DEFAULT_CONFIG, updatedAt: new Date().toISOString() };
        if (dynamo.isEnabled()) {
            try {
                await dynamo.putItem('CONFIG', 'welcome-automation', reset);
            } catch (err) { console.error(err); }
        }
        await fs.writeJson(CONFIG_PATH, reset, { spaces: 2 });
        // Also delete the audio file if it exists
        const audioDest = this.getAudioDestPath();
        if (fs.existsSync(audioDest)) {
            await fs.remove(audioDest);
        }
        // Also delete the video file if it exists
        const videoDest = this.getVideoDestPath();
        if (fs.existsSync(videoDest)) {
            await fs.remove(videoDest);
        }
        // Also delete the image file if it exists
        const config = await this.getConfig(); // To get current imageFilePath before reset
        if (config && config.imageFilePath && fs.existsSync(config.imageFilePath)) {
            await fs.remove(config.imageFilePath);
        }
        console.log('🔄 Welcome config reset to defaults');
        return reset;
    }

    // ── User state helpers ────────────────────────────────────────────────

    async _readStates() {
        if (dynamo.isEnabled()) {
            try {
                const items = await dynamo.queryItems('WELCOME_STATE');
                const map = {};
                items.forEach(item => { map[item.sk] = item.data; });
                return map;
            } catch (err) {
                console.error(`❌ [Welcome] DynamoDB query failed: ${err.message}`);
            }
        }
        return fs.readJson(STATES_PATH).catch(() => ({}));
    }

    async _saveUserState(jid, state) {
        if (dynamo.isEnabled()) {
            try {
                await dynamo.putItem('WELCOME_STATE', jid, state);
            } catch (err) {
                console.error(`❌ [Welcome] DynamoDB write failed: ${err.message}`);
            }
        }
        const states = await fs.readJson(STATES_PATH).catch(() => ({}));
        states[jid] = state;
        await fs.writeJson(STATES_PATH, states, { spaces: 2 });
    }

    async getUserState(jid) {
        if (dynamo.isEnabled()) {
            try {
                const data = await dynamo.getItem('WELCOME_STATE', jid);
                if (data) return data;
                // Migrate from local
                const states = await fs.readJson(STATES_PATH).catch(() => ({}));
                if (states[jid]) {
                    await dynamo.putItem('WELCOME_STATE', jid, states[jid]);
                    return states[jid];
                }
                return null;
            } catch (err) {
                console.error(`❌ [Welcome] DynamoDB read failed: ${err.message}`);
            }
        }
        const states = await fs.readJson(STATES_PATH).catch(() => ({}));
        return states[jid] || null;
    }

    async updateUserState(jid) {
        const existing = await this.getUserState(jid) || {};
        const next = { ...existing, lastWelcomeSentAt: new Date().toISOString() };
        await this._saveUserState(jid, next);
    }

    async resetUserState(jid) {
        const existing = await this.getUserState(jid);
        if (existing) {
            delete existing.lastWelcomeSentAt;
            existing.aiEnabled = true;
            delete existing.promoVideoSent;
            await this._saveUserState(jid, existing);
        }
        // Also clear the in-memory guard in app.js so it doesn't block re-sending
        if (global.sentPromoJids) {
            global.sentPromoJids.delete(jid);
        }
        console.log(`🔄 User state reset for ${jid} (AI re-enabled, promo video unlocked)`);
    }

    async deleteUserState(jid) {
        if (dynamo.isEnabled()) {
            try {
                await dynamo.deleteItem('WELCOME_STATE', jid);
            } catch (err) { console.error(err); }
        }
        const states = await fs.readJson(STATES_PATH).catch(() => ({}));
        delete states[jid];
        await fs.writeJson(STATES_PATH, states, { spaces: 2 });
    }

    async getAllUserStates() {
        return this._readStates();
    }

    // ── Per-user message tracking ─────────────────────────────────────────

    async updateUserMessage(jid, text) {
        const existing = await this.getUserState(jid) || {};
        const next = {
            ...existing,
            lastMessageText: text || '',
            lastMessageAt: new Date().toISOString(),
            // Initialize defaults if new user
            aiEnabled: existing.aiEnabled !== undefined ? existing.aiEnabled : true,
            cooldownEnabled: existing.cooldownEnabled !== undefined ? existing.cooldownEnabled : true
        };
        await this._saveUserState(jid, next);
    }

    // ── Per-user AI toggle ────────────────────────────────────────────────

    async setUserAI(jid, enabled) {
        const existing = await this.getUserState(jid) || {};
        const next = { ...existing, aiEnabled: Boolean(enabled) };
        await this._saveUserState(jid, next);
        console.log(`🤖 AI ${enabled ? 'enabled' : 'disabled'} for ${jid}`);
        return next;
    }

    async disableUserAI(jid) {
        return this.setUserAI(jid, false);
    }

    // ── Promo video dedup (persisted across restarts) ─────────────────────
    async markPromoSent(jid) {
        const existing = await this.getUserState(jid) || {};
        const next = { ...existing, promoVideoSent: true };
        await this._saveUserState(jid, next);
        console.log(`🎥 Promo video marked as sent for ${jid}`);
    }

    async setUserCooldown(jid, enabled) {
        const existing = await this.getUserState(jid) || {};
        const next = { ...existing, cooldownEnabled: Boolean(enabled) };
        await this._saveUserState(jid, next);
        console.log(`⏱️ Cooldown ${enabled ? 'enabled' : 'disabled'} for ${jid}`);
        return next;
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

        // If AI was manually disabled for this user (payment flow, manual intervention,
        // or admin took over), don't re-send the welcome sequence
        if (state && state.aiEnabled === false) return false;

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
     * @param {object} chatHistoryService - Service to log messages
     * @param {object} io - Socket.io instance to emit to dashboard
     * @returns {Promise<boolean>} true if the welcome was actually sent, false otherwise
     */
    async runIfNeeded(sock, jid, chatHistoryService, io) {
        if (!sock) return false;

        const config = await this.getConfig();
        if (!config.isEnabled) return false;
        if (!await this._shouldSend(jid, config.cooldownHours)) return false;

        // Prevent concurrent welcome sequences for the same JID (race condition guard)
        if (this._sendingWelcome.has(jid)) {
            console.log(`⏳ Welcome already in progress for ${jid} — skipping duplicate`);
            return false;
        }
        this._sendingWelcome.add(jid);

        // Persist timestamp BEFORE sending to prevent re-sends on reconnection.
        // If the connection drops mid-sequence, the cooldown is already active.
        await this.updateUserState(jid);

        console.log(`🔔 Welcome 24H: sending welcome sequence to ${jid}`);

        try {
        // 1. Send video FIRST (if enabled and file exists on disk)
        if (config.videoEnabled && config.videoFilePath && fs.existsSync(config.videoFilePath)) {
            try {
                this.markBotSent(jid);
                await sock.sendMessage(jid, {
                    video: { url: config.videoFilePath },
                    mimetype: 'video/mp4'
                });
                console.log(`🎬 Welcome video sent to ${jid}`);
                if (chatHistoryService && io) {
                    try {
                        const savedMsg = await chatHistoryService.addMessage(jid, '[Welcome Video]', true, 'System', 'system');
                        io.emit('chat:message', { jid, message: savedMsg });
                    } catch (e) { console.error('Error saving welcome video to history:', e.message); }
                }
            } catch (videoErr) {
                console.error(`⚠️ Welcome video failed (continuing): ${videoErr.message}`);
            }
        }

        // 2. Send audio (if file exists on disk)
        if (config.audioFilePath) {
            if (fs.existsSync(config.audioFilePath)) {
                try {
                    this.markBotSent(jid);
                    await sock.sendMessage(jid, {
                        audio: { url: config.audioFilePath },
                        mimetype: 'audio/ogg; codecs=opus',
                        ptt: true   // voice note
                    });
                    console.log(`🔊 Welcome audio sent to ${jid}`);
                    if (chatHistoryService && io) {
                        try {
                            const savedMsg = await chatHistoryService.addMessage(jid, '[Welcome Audio]', true, 'System', 'system');
                            io.emit('chat:message', { jid, message: savedMsg });
                        } catch (e) { console.error('Error saving welcome audio to history:', e.message); }
                    }
                } catch (audioErr) {
                    console.error(`⚠️ Welcome audio failed (continuing): ${audioErr.message}`);
                }
            } else {
                console.error(`❌ Welcome audio file NOT FOUND on disk: ${config.audioFilePath}`);
                console.error(`   Re-upload the audio from the dashboard to fix this.`);
            }
        }

        // 3. Send text message(s)
        // Supports multi-message: split on "---MSG---" separator
        if (config.messageText && config.messageText.trim()) {
            const DEFAULT_DELAY_MS = 2000; // fallback delay in ms when no custom delay is configured
            const delays = Array.isArray(config.messageDelays) ? config.messageDelays : [];
            const messageParts = config.messageText.split('---MSG---').map(p => p.trim()).filter(p => p.length > 0);

            // If greeting-by-time is enabled, replace the Nth message with a time-based greeting
            if (config.greetingByTimeEnabled) {
                const msgIndex = Math.max(0, (config.greetingByTimeMessageIndex || 3) - 1); // convert 1-based to 0-based
                if (messageParts.length > msgIndex) {
                    messageParts[msgIndex] = this._getColombiaGreeting();
                    console.log(`🕐 Greeting by time enabled — message ${msgIndex + 1} replaced with: "${messageParts[msgIndex]}"`);
                }
            }

            for (let i = 0; i < messageParts.length; i++) {
                try {
                    // Delay between messages: use custom per-message delay or fallback
                    if (i > 0) {
                        // delays[i-1] is the configured delay (in seconds) BEFORE message i
                        const delaySec = (delays[i - 1] !== undefined && delays[i - 1] !== null)
                            ? Number(delays[i - 1])
                            : (DEFAULT_DELAY_MS / 1000);
                        const delayMs = Math.max(0, Math.round(delaySec * 1000));
                        if (delayMs > 0) {
                            await new Promise(resolve => setTimeout(resolve, delayMs));
                        }
                        console.log(`⏱️ Delay before message ${i + 1}: ${delaySec}s`);
                    } else {
                        // Short pause before the first message (1 second)
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }

                    this.markBotSent(jid);
                    await sock.sendMessage(jid, { text: messageParts[i] });
                    console.log(`📝 Welcome message ${i + 1}/${messageParts.length} sent to ${jid}`);
                    if (chatHistoryService && io) {
                        try {
                            const savedMsg = await chatHistoryService.addMessage(jid, messageParts[i], true, 'System', 'system');
                            io.emit('chat:message', { jid, message: savedMsg });
                        } catch (e) { console.error('Error saving welcome text to history:', e.message); }
                    }

                    // Send image after the first text part
                    if (i === 0 && config.imageEnabled && config.imageFilePath && fs.existsSync(config.imageFilePath)) {
                        try {
                            // Short pause before the image (1 second)
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            this.markBotSent(jid);
                            await sock.sendMessage(jid, {
                                image: { url: config.imageFilePath },
                                caption: ''
                            });
                            console.log(`🖼️ Welcome image sent to ${jid}`);
                            if (chatHistoryService && io) {
                                try {
                                    const savedMsg = await chatHistoryService.addMessage(jid, '[Welcome Image]', true, 'System', 'system');
                                    io.emit('chat:message', { jid, message: savedMsg });
                                } catch (e) { console.error('Error saving welcome image to history:', e.message); }
                            }
                        } catch (imageErr) {
                            console.error(`⚠️ Welcome image failed: ${imageErr.message}`);
                        }
                    }

                } catch (textErr) {
                    console.error(`⚠️ Welcome text part ${i + 1} failed: ${textErr.message}`);
                }
            }

        }

        } finally {
            // Always release the lock, even if sending fails
            this._sendingWelcome.delete(jid);
        }

        return true;
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

    // ── Video management ─────────────────────────────────────────────────

    /** Returns the absolute destination path for the welcome video file. */
    getVideoDestPath() {
        return path.join(UPLOADS_DIR, 'welcome-video.mp4');
    }

    /** Moves an uploaded temp file to the permanent location and updates config. */
    async saveVideoFile(tempPath) {
        const dest = this.getVideoDestPath();
        await fs.move(tempPath, dest, { overwrite: true });
        await this.saveConfig({ videoFilePath: dest, videoEnabled: true });
        console.log(`🎬 Welcome video saved: ${dest}`);
        return dest;
    }

    /** Deletes the video file and clears config.videoFilePath. */
    async deleteVideo() {
        const dest = this.getVideoDestPath();
        if (fs.existsSync(dest)) {
            await fs.remove(dest);
        }
        await this.saveConfig({ videoFilePath: null, videoEnabled: false });
        console.log('🗑️ Welcome video deleted');
    }

    // ── Image management ──────────────────────────────────────────────────

    /** Returns the absolute destination path for the welcome image file. */
    getImageDestPath(ext = '.jpg') {
        return path.join(UPLOADS_DIR, `welcome-image${ext}`);
    }

    /** Moves an uploaded temp file to the permanent location and updates config. */
    async saveImageFile(tempPath, originalName) {
        const ext = path.extname(originalName).toLowerCase() || '.jpg';
        const dest = this.getImageDestPath(ext);

        // Delete existing image if there's one with a different extension
        const config = await this.getConfig();
        if (config.imageFilePath && fs.existsSync(config.imageFilePath)) {
            await fs.remove(config.imageFilePath);
        }

        await fs.move(tempPath, dest, { overwrite: true });
        await this.saveConfig({ imageFilePath: dest, imageEnabled: true });
        console.log(`🖼️ Welcome image saved: ${dest}`);
        return dest;
    }

    /** Deletes the welcome image file and updates config. */
    async deleteImage() {
        const config = await this.getConfig();
        if (config.imageFilePath && fs.existsSync(config.imageFilePath)) {
            await fs.remove(config.imageFilePath);
        }
        await this.saveConfig({ imageFilePath: null, imageEnabled: false });
        console.log('🗑️ Welcome image deleted');
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
