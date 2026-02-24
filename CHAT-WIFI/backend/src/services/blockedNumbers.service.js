const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

// Data directory — same pattern as knowledge-base
const DATA_DIR = path.join(__dirname, '../../data');
const BLOCKED_PATH = path.join(DATA_DIR, 'blocked-numbers.json');
const CONFIG_PATH = path.join(DATA_DIR, 'bot-config.json');

class BlockedNumbersService {
    constructor() {
        this.ensureFiles();
    }

    /**
     * Ensure data directory and JSON files exist on startup.
     */
    ensureFiles() {
        fs.ensureDirSync(DATA_DIR);
        if (!fs.existsSync(BLOCKED_PATH)) {
            fs.writeJsonSync(BLOCKED_PATH, [], { spaces: 2 });
        }
        if (!fs.existsSync(CONFIG_PATH)) {
            fs.writeJsonSync(CONFIG_PATH, { blockGroups: false }, { spaces: 2 });
        }
    }

    // ==================== HELPERS ====================

    async read() {
        return fs.readJson(BLOCKED_PATH);
    }

    async write(data) {
        await fs.writeJson(BLOCKED_PATH, data, { spaces: 2 });
    }

    // ==================== CRUD ====================

    /**
     * Get all blocked numbers.
     */
    async getAll() {
        return this.read();
    }

    /**
     * Add a new blocked number.
     * @param {Object} entry - { phoneNumber, name, reason, isActive }
     */
    async add(entry) {
        const list = await this.read();
        const newEntry = {
            id: `blk_${crypto.randomUUID().replace(/-/g, '').substring(0, 10)}`,
            phoneNumber: entry.phoneNumber.trim(),
            name: entry.name || '',
            reason: entry.reason || '',
            isActive: entry.isActive !== undefined ? entry.isActive : true,
            createdAt: new Date().toISOString()
        };
        list.push(newEntry);
        await this.write(list);
        console.log(`🚫 Número bloqueado agregado: ${newEntry.phoneNumber}`);
        return newEntry;
    }

    /**
     * Update an existing blocked number by ID.
     */
    async update(id, updates) {
        const list = await this.read();
        const idx = list.findIndex(e => e.id === id);
        if (idx === -1) return null;
        list[idx] = { ...list[idx], ...updates };
        await this.write(list);
        return list[idx];
    }

    /**
     * Remove a blocked number by ID.
     */
    async remove(id) {
        const list = await this.read();
        const filtered = list.filter(e => e.id !== id);
        if (filtered.length === list.length) return false;
        await this.write(filtered);
        console.log(`🗑️ Número bloqueado eliminado: ${id}`);
        return true;
    }

    // ==================== BOT CHECK ====================

    /**
     * Check if a phone number (JID) is actively blocked.
     * Supports both formats: "5491234@s.whatsapp.net" or plain "5491234"
     * @param {string} jid - WhatsApp JID
     * @returns {Promise<boolean>}
     */
    async isBlocked(jid) {
        const list = await this.read();
        // Normalize: extract just the number part before the '@'
        const number = jid.split('@')[0];
        return list.some(e => e.isActive && (
            e.phoneNumber === jid ||
            e.phoneNumber === number ||
            jid.startsWith(e.phoneNumber)
        ));
    }

    // ==================== CONFIG ====================

    /**
     * Get global bot configuration.
     * @returns {Promise<{ blockGroups: boolean }>}
     */
    async getConfig() {
        return fs.readJson(CONFIG_PATH);
    }

    /**
     * Update global bot configuration.
     */
    async updateConfig(updates) {
        const config = await this.getConfig();
        const newConfig = { ...config, ...updates };
        await fs.writeJson(CONFIG_PATH, newConfig, { spaces: 2 });
        return newConfig;
    }
}

module.exports = new BlockedNumbersService();
