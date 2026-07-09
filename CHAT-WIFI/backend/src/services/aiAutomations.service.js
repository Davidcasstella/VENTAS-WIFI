const fs = require('fs-extra');
const path = require('path');
const dynamo = require('./dynamoStore');

// ── Persistence ──────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, '../../data');
const CONFIG_PATH = path.join(DATA_DIR, 'ai-automations.json');

const DEFAULT_CONFIG = {
    paymentDetectionEnabled: false,
    voiceProcessingEnabled: true,
    updatedAt: null
};

const DYNAMO_PK = 'CONFIG';
const DYNAMO_SK = 'ai-automations';

class AIAutomationsService {
    constructor() {
        this._ensureFiles();
    }

    _ensureFiles() {
        fs.ensureDirSync(DATA_DIR);
        if (!fs.existsSync(CONFIG_PATH)) {
            fs.writeJsonSync(CONFIG_PATH, DEFAULT_CONFIG, { spaces: 2 });
        }
    }

    async getConfig() {
        if (dynamo.isEnabled()) {
            try {
                const data = await dynamo.getItem(DYNAMO_PK, DYNAMO_SK);
                if (data) return data;
                // Not in DynamoDB yet — seed from local file or defaults
                const local = await fs.readJson(CONFIG_PATH).catch(() => DEFAULT_CONFIG);
                await dynamo.putItem(DYNAMO_PK, DYNAMO_SK, local);
                return local;
            } catch (err) {
                console.error(`❌ [AIAutomations] DynamoDB read failed: ${err.message}`);
            }
        }
        return fs.readJson(CONFIG_PATH);
    }

    async saveConfig(updates) {
        const current = await this.getConfig();
        const next = { ...current, ...updates, updatedAt: new Date().toISOString() };

        if (dynamo.isEnabled()) {
            try {
                await dynamo.putItem(DYNAMO_PK, DYNAMO_SK, next);
                return next;
            } catch (err) {
                console.error(`❌ [AIAutomations] DynamoDB write failed: ${err.message}`);
            }
        }
        await fs.writeJson(CONFIG_PATH, next, { spaces: 2 });
        return next;
    }
}

module.exports = new AIAutomationsService();
