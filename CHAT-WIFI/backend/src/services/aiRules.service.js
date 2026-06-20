const fs = require('fs-extra');
const path = require('path');
const { randomUUID: uuidv4 } = require('crypto');

// Persistent storage path — same directory used by manual knowledge
const RULES_FILE = path.join(__dirname, '../../knowledge-base/ai-rules.json');

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
     * @returns {Promise<Array>}
     */
    async getRules() {
        try {
            await this._ensureFile();
            const rules = await fs.readJson(RULES_FILE);
            return Array.isArray(rules) ? rules : [];
        } catch (err) {
            console.error('❌ [AIRules] Error reading rules file:', err.message);
            return [];
        }
    }

    /**
     * Saves the full list of rules, replacing the current ones.
     * @param {Array} rules
     * @returns {Promise<Array>} - The saved rules
     */
    async saveRules(rules) {
        try {
            await this._ensureFile();
            // Ensure every rule has an id and timestamps
            const now = new Date().toISOString();
            const sanitized = rules.map(r => ({
                id: r.id || uuidv4(),
                title: (r.title || '').trim(),
                content: (r.content || '').trim(),
                enabled: r.enabled !== false, // default true
                createdAt: r.createdAt || now,
                updatedAt: now
            })).filter(r => r.title && r.content); // remove empty rules

            await fs.writeJson(RULES_FILE, sanitized, { spaces: 2 });
            console.log(`✅ [AIRules] ${sanitized.length} rule(s) saved`);
            return sanitized;
        } catch (err) {
            console.error('❌ [AIRules] Error saving rules:', err.message);
            throw err;
        }
    }

    /**
     * Adds a single new rule.
     * @param {{ title: string, content: string }} rule
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
        await fs.writeJson(RULES_FILE, rules, { spaces: 2 });
        return newRule;
    }

    /**
     * Deletes a rule by ID.
     * @param {string} id
     */
    async deleteRule(id) {
        const rules = await this.getRules();
        const filtered = rules.filter(r => r.id !== id);
        await fs.writeJson(RULES_FILE, filtered, { spaces: 2 });
        return filtered;
    }

    /**
     * Returns a formatted string of all ENABLED rules to inject into the system prompt.
     * Returns empty string if no rules are active.
     * @returns {Promise<string>}
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
