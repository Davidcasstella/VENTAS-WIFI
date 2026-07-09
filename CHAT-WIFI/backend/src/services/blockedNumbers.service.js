const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const dynamo = require('./dynamoStore');

// Data directory — same pattern as knowledge-base
const DATA_DIR = path.join(__dirname, '../../data');
const BLOCKED_PATH = path.join(DATA_DIR, 'blocked-numbers.json');
const CONFIG_PATH = path.join(DATA_DIR, 'bot-config.json');

const DYNAMO_PK_BLOCKED = 'CONFIG';
const DYNAMO_SK_BLOCKED = 'blocked-numbers';
const DYNAMO_PK_BOTCFG = 'CONFIG';
const DYNAMO_SK_BOTCFG = 'bot-config';

class BlockedNumbersService {
    constructor() {
        this.ensureFiles();
    }

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
        if (dynamo.isEnabled()) {
            try {
                const data = await dynamo.getItem(DYNAMO_PK_BLOCKED, DYNAMO_SK_BLOCKED);
                if (data) return data.numbers || data;
                // Seed from local
                const local = await fs.readJson(BLOCKED_PATH).catch(() => []);
                await dynamo.putItem(DYNAMO_PK_BLOCKED, DYNAMO_SK_BLOCKED, { numbers: local });
                return local;
            } catch (err) {
                console.error(`❌ [BlockedNumbers] DynamoDB read failed: ${err.message}`);
            }
        }
        return fs.readJson(BLOCKED_PATH);
    }

    async write(data) {
        if (dynamo.isEnabled()) {
            try {
                await dynamo.putItem(DYNAMO_PK_BLOCKED, DYNAMO_SK_BLOCKED, { numbers: data });
                return;
            } catch (err) {
                console.error(`❌ [BlockedNumbers] DynamoDB write failed: ${err.message}`);
            }
        }
        await fs.writeJson(BLOCKED_PATH, data, { spaces: 2 });
    }

    // ==================== CRUD ====================

    async getAll() {
        return this.read();
    }

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

    async update(id, updates) {
        const list = await this.read();
        const idx = list.findIndex(e => e.id === id);
        if (idx === -1) return null;
        list[idx] = { ...list[idx], ...updates };
        await this.write(list);
        return list[idx];
    }

    async remove(id) {
        const list = await this.read();
        const filtered = list.filter(e => e.id !== id);
        if (filtered.length === list.length) return false;
        await this.write(filtered);
        console.log(`🗑️ Número bloqueado eliminado: ${id}`);
        return true;
    }

    // ==================== BOT CHECK ====================

    async isBlocked(jid) {
        const list = await this.read();
        const number = jid.split('@')[0];
        return list.some(e => e.isActive && (
            e.phoneNumber === jid ||
            e.phoneNumber === number ||
            jid.startsWith(e.phoneNumber)
        ));
    }

    // ==================== CONFIG ====================

    async getConfig() {
        if (dynamo.isEnabled()) {
            try {
                const data = await dynamo.getItem(DYNAMO_PK_BOTCFG, DYNAMO_SK_BOTCFG);
                if (data) return data;
                const local = await fs.readJson(CONFIG_PATH).catch(() => ({ blockGroups: false }));
                await dynamo.putItem(DYNAMO_PK_BOTCFG, DYNAMO_SK_BOTCFG, local);
                return local;
            } catch (err) {
                console.error(`❌ [BlockedNumbers] DynamoDB config read failed: ${err.message}`);
            }
        }
        return fs.readJson(CONFIG_PATH);
    }

    async updateConfig(updates) {
        const config = await this.getConfig();
        const newConfig = { ...config, ...updates };
        if (dynamo.isEnabled()) {
            try {
                await dynamo.putItem(DYNAMO_PK_BOTCFG, DYNAMO_SK_BOTCFG, newConfig);
                return newConfig;
            } catch (err) {
                console.error(`❌ [BlockedNumbers] DynamoDB config write failed: ${err.message}`);
            }
        }
        await fs.writeJson(CONFIG_PATH, newConfig, { spaces: 2 });
        return newConfig;
    }
}

module.exports = new BlockedNumbersService();
