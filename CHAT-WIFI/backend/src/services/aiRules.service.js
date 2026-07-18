const fs = require('fs-extra');
const path = require('path');
const { randomUUID: uuidv4 } = require('crypto');
const dynamo = require('./dynamoStore');

// Persistent storage path — same directory used by manual knowledge
const RULES_FILE = path.join(__dirname, '../../knowledge-base/ai-rules.json');

const DYNAMO_PK = 'CONFIG';
const DYNAMO_SK = 'ai-rules';

class AIRulesService {
    /**
     * Ensure the rules file exists. If not, create it with an empty array.
     */
    async _ensureFile() {
        await fs.ensureFile(RULES_FILE);
        const content = await fs.readFile(RULES_FILE, 'utf8');
        if (!content.trim()) {
            await fs.writeJson(RULES_FILE, [], { spaces: 2 });
        }
    }

    /**
     * Returns all saved AI rules.
     */
    async getRules() {
        if (dynamo.isEnabled()) {
            try {
                const data = await dynamo.getItem(DYNAMO_PK, DYNAMO_SK);
                if (data && Array.isArray(data.rules)) return data.rules;
                // Seed from local
                await this._ensureFile();
                const local = await fs.readJson(RULES_FILE).catch(() => []);
                const rules = Array.isArray(local) ? local : [];
                await dynamo.putItem(DYNAMO_PK, DYNAMO_SK, { rules });
                return rules;
            } catch (err) {
                console.error(`❌ [AIRules] DynamoDB read failed: ${err.message}`);
            }
        }

        try {
            await this._ensureFile();
            const rules = await fs.readJson(RULES_FILE);
            return Array.isArray(rules) ? rules : [];
        } catch (err) {
            console.error('❌ [AIRules] Error reading rules file:', err.message);
            return [];
        }
    }

    async _writeRules(rules) {
        if (dynamo.isEnabled()) {
            try {
                await dynamo.putItem(DYNAMO_PK, DYNAMO_SK, { rules });
            } catch (err) {
                console.error(`❌ [AIRules] DynamoDB write failed: ${err.message}`);
            }
        }
        try {
            await fs.writeJson(RULES_FILE, rules, { spaces: 2 });
        } catch (err) {
            console.error(`❌ [AIRules] Disk sync failed: ${err.message}`);
        }
    }

    /**
     * Saves the full list of rules, replacing the current ones.
     */
    async saveRules(rules) {
        try {
            await this._ensureFile();
            const now = new Date().toISOString();
            const sanitized = rules.map(r => ({
                id: r.id || uuidv4(),
                title: (r.title || '').trim(),
                content: (r.content || '').trim(),
                enabled: r.enabled !== false,
                createdAt: r.createdAt || now,
                updatedAt: now
            })).filter(r => r.title && r.content);

            await this._writeRules(sanitized);
            console.log(`✅ [AIRules] ${sanitized.length} rule(s) saved`);
            return sanitized;
        } catch (err) {
            console.error('❌ [AIRules] Error saving rules:', err.message);
            throw err;
        }
    }

    /**
     * Adds a single new rule.
     */
    async addRule(rule) {
        const rules = await this.getRules();
        const now = new Date().toISOString();
        const newRule = {
            id: uuidv4(),
            title: (rule.title || '').trim(),
            content: (rule.content || '').trim(),
            enabled: true,
            createdAt: now,
            updatedAt: now
        };
        rules.push(newRule);
        await this._writeRules(rules);
        return newRule;
    }

    /**
     * Deletes a rule by ID.
     */
    async deleteRule(id) {
        const rules = await this.getRules();
        const filtered = rules.filter(r => r.id !== id);
        await this._writeRules(filtered);
        return filtered;
    }

    /**
     * Returns a formatted string of all ENABLED rules to inject into the system prompt.
     */
    async getFormattedRulesText() {
        try {
            const rules = await this.getRules();
            const active = rules.filter(r => r.enabled && r.title && r.content);
            if (active.length === 0) return '';

            const lines = active.map(r => `- ${r.title}: ${r.content}`).join('\n');
            return `[REGLAS PERSONALIZADAS — PRIORIDAD MAXIMA]\nSigue estas reglas estrictamente por encima de cualquier otra instruccion:\n${lines}\n\n`;
        } catch {
            return '';
        }
    }
}

module.exports = new AIRulesService();
