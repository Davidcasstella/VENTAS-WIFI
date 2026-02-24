const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

const DATA_PATH = path.join(__dirname, '../data/ai-providers.json');
const ENCRYPTION_KEY_RAW = process.env.ENCRYPTION_KEY;
const IV_LENGTH = 16;

class AIProvidersService {
    constructor() {
        if (!ENCRYPTION_KEY_RAW || ENCRYPTION_KEY_RAW.length !== 64) {
            console.error('❌ ENCRYPTION_KEY no está configurada o es inválida en el .env');
        }
        this.encryptionKey = Buffer.from(ENCRYPTION_KEY_RAW || '0'.repeat(64), 'hex');
        this.ensureDataFile();
    }

    ensureDataFile() {
        const dir = path.dirname(DATA_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirpSync(dir);
        }
        if (!fs.existsSync(DATA_PATH)) {
            fs.writeJsonSync(DATA_PATH, []);
        }
    }

    encrypt(text) {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag().toString('hex');
        return `${iv.toString('hex')}:${authTag}:${encrypted}`;
    }

    decrypt(encryptedData) {
        const [ivHex, authTagHex, encryptedText] = encryptedData.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }

    maskKey(key) {
        if (!key) return '';
        if (key.length <= 8) return '********';
        return `${key.substring(0, 4)}****${key.substring(key.length - 4)}`;
    }

    async getProviders(includeRealKeys = false) {
        const providers = await fs.readJson(DATA_PATH);
        return providers.map(p => ({
            ...p,
            apiKey: includeRealKeys ? this.decrypt(p.apiKey) : this.maskKey(this.decrypt(p.apiKey))
        }));
    }

    async saveProvider({ id, name, apiKey, isActive }) {
        const providers = await fs.readJson(DATA_PATH);
        const encryptedKey = this.encrypt(apiKey);

        if (id) {
            const index = providers.findIndex(p => p.id === id);
            if (index !== -1) {
                providers[index] = { ...providers[index], name, apiKey: encryptedKey };
            }
        } else {
            const newProvider = {
                id: crypto.randomUUID(),
                name,
                apiKey: encryptedKey,
                isActive: providers.length === 0 // Active if first one
            };
            providers.push(newProvider);
        }

        await fs.writeJson(DATA_PATH, providers, { spaces: 2 });
        return this.getProviders();
    }

    async deleteProvider(id) {
        let providers = await fs.readJson(DATA_PATH);
        const providerToDelete = providers.find(p => p.id === id);
        providers = providers.filter(p => p.id !== id);

        // If active was deleted, and there are others, activate the first one
        if (providerToDelete?.isActive && providers.length > 0) {
            providers[0].isActive = true;
        }

        await fs.writeJson(DATA_PATH, providers, { spaces: 2 });
        return this.getProviders();
    }

    async setActive(id) {
        const providers = await fs.readJson(DATA_PATH);
        providers.forEach(p => {
            p.isActive = p.id === id;
        });
        await fs.writeJson(DATA_PATH, providers, { spaces: 2 });
        return this.getProviders();
    }

    async getActiveProvider() {
        const providers = await fs.readJson(DATA_PATH);
        const active = providers.find(p => p.isActive);
        if (!active) return null;

        return {
            ...active,
            apiKey: this.decrypt(active.apiKey)
        };
    }

    async testConnection(id) {
        const providers = await fs.readJson(DATA_PATH);
        const provider = providers.find(p => p.id === id);
        if (!provider) throw new Error('Proveedor no encontrado');

        const apiKey = this.decrypt(provider.apiKey);

        // Basic ping test per provider type
        try {
            if (provider.name.toLowerCase().includes('openai')) {
                // OpenAI Test
                const response = await fetch('https://api.openai.com/v1/models', {
                    headers: { 'Authorization': `Bearer ${apiKey}` }
                });
                return response.ok;
            }
            // Add other providers (Grok, etc) as needed or just dummy OK for now
            return true;
        } catch (e) {
            return false;
        }
    }
}

module.exports = new AIProvidersService();
