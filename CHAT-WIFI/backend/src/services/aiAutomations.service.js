const fs = require('fs-extra');
const path = require('path');

// ── Persistence  se hicieron algunos cambios──────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, '../../data');
const CONFIG_PATH = path.join(DATA_DIR, 'ai-automations.json');

const DEFAULT_CONFIG = {
    paymentDetectionEnabled: false,
    voiceProcessingEnabled: true,
    updatedAt: null
};

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
        return fs.readJson(CONFIG_PATH);
    }

    async saveConfig(updates) {
        const current = await this.getConfig();
        const next = { ...current, ...updates, updatedAt: new Date().toISOString() };
        await fs.writeJson(CONFIG_PATH, next, { spaces: 2 });
        return next;
    }
}

module.exports = new AIAutomationsService();
