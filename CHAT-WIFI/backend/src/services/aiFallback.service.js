const fs = require('fs-extra');
const path = require('path');
const dynamo = require('./dynamoStore');

// ── Persistence ────────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, '../../data');
const FALLBACK_PATH = path.join(DATA_DIR, 'ai-fallback.json');

const DEFAULT_DATA = {
    config: {
        adminJid: '573028599105@s.whatsapp.net',
        fallbackPhrases: [
            'no tengo información',
            'no tengo información suficiente',
            'no estoy seguro',
            'no puedo ayudar',
            'desconozco',
            'no tengo datos',
            'no cuento con información',
            'no tengo la respuesta',
            'no dispongo de información',
            'no entiendo tu pregunta',
            'no entiendo tu mensaje',
            'no comprendo',
            'podrias proporcionar mas contexto',
            'podrias dar mas detalles',
            'no tengo suficiente contexto',
            'no se encuentra en el contexto',
            'no hay menciones',
            'no se menciona',
            'fuera de mi alcance',
            'no puedo responder',
            'no tengo capacidad',
            'no hay información disponible',
            'lamentablemente no',
            'lo siento, no'
        ]
    },
    pending: {}
};

const DYNAMO_PK = 'CONFIG';
const DYNAMO_SK = 'ai-fallback';

class AIFallbackService {
    constructor() {
        this._ensureFile();
    }

    _ensureFile() {
        fs.ensureDirSync(DATA_DIR);
        if (!fs.existsSync(FALLBACK_PATH)) {
            fs.writeJsonSync(FALLBACK_PATH, DEFAULT_DATA, { spaces: 2 });
        }
    }

    async _read() {
        if (dynamo.isEnabled()) {
            try {
                const data = await dynamo.getItem(DYNAMO_PK, DYNAMO_SK);
                if (data) return data;
                // Seed from local
                const local = await fs.readJson(FALLBACK_PATH).catch(() => DEFAULT_DATA);
                await dynamo.putItem(DYNAMO_PK, DYNAMO_SK, local);
                return local;
            } catch (err) {
                console.error(`❌ [AIFallback] DynamoDB read failed: ${err.message}`);
            }
        }
        return fs.readJson(FALLBACK_PATH);
    }

    async _write(data) {
        if (dynamo.isEnabled()) {
            try {
                await dynamo.putItem(DYNAMO_PK, DYNAMO_SK, data);
                return;
            } catch (err) {
                console.error(`❌ [AIFallback] DynamoDB write failed: ${err.message}`);
            }
        }
        await fs.writeJson(FALLBACK_PATH, data, { spaces: 2 });
    }

    // ── Config ────────────────────────────────────────────────────────────

    async getConfig() {
        const data = await this._read();
        return data.config;
    }

    async saveConfig(updates) {
        const data = await this._read();
        data.config = { ...data.config, ...updates };
        await this._write(data);
        return data.config;
    }

    // ── Fallback detection ────────────────────────────────────────────────

    async isFallbackResponse(aiResponse) {
        if (!aiResponse || !aiResponse.trim()) return true;

        const trimmed = aiResponse.trim();
        if (trimmed === 'FALLBACK_TRIGGER' || trimmed.includes('FALLBACK_TRIGGER')) {
            console.log('🎯 FALLBACK_TRIGGER detected in AI response');
            return true;
        }

        const config = await this.getConfig();
        const responseLower = trimmed.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        return config.fallbackPhrases.some(phrase => {
            const phraseLower = phrase.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            return responseLower.includes(phraseLower);
        });
    }

    // ── Pending management ────────────────────────────────────────────────

    async registerPending(jid, lastMessage) {
        const data = await this._read();
        data.pending[jid] = {
            lastMessage: lastMessage || '',
            disabledAt: new Date().toISOString(),
            reason: 'fallback_unanswered',
            attended: false
        };
        await this._write(data);
        console.log(`⚠️ Fallback registered for ${jid}: "${lastMessage}"`);
    }

    async getPendingList() {
        const data = await this._read();
        return Object.entries(data.pending)
            .map(([jid, info]) => ({
                jid,
                displayName: jid.replace('@s.whatsapp.net', '').replace('@g.us', ' (grupo)'),
                ...info
            }))
            .sort((a, b) => {
                if (a.attended !== b.attended) return a.attended ? 1 : -1;
                return new Date(b.disabledAt).getTime() - new Date(a.disabledAt).getTime();
            });
    }

    async getPendingCount() {
        const data = await this._read();
        return Object.values(data.pending).filter(p => !p.attended).length;
    }

    async markAttended(jid) {
        const data = await this._read();
        if (data.pending[jid]) {
            data.pending[jid].attended = true;
            data.pending[jid].attendedAt = new Date().toISOString();
            await this._write(data);
            console.log(`✅ Marked as attended: ${jid}`);
        }
    }

    async removePending(jid) {
        const data = await this._read();
        delete data.pending[jid];
        await this._write(data);
    }

    async reactivateAI(jid, welcomeAutomationService) {
        await this.removePending(jid);
        if (welcomeAutomationService) {
            await welcomeAutomationService.setUserAI(jid, true);
        }
        console.log(`🔄 AI reactivated for ${jid}`);
    }

    async sendAdminNotification(sock, clientJid, clientMessage, clientName) {
        if (!sock) return;

        const config = await this.getConfig();
        if (!config.adminJid) {
            console.warn('⚠️ No admin JID configured for fallback notifications');
            return;
        }

        const clientNumber = clientJid.replace('@s.whatsapp.net', '');
        const displayName = clientName || 'Sin nombre disponible';
        const notification = `🚨 NUEVO CLIENTE PENDIENTE\n\n👤 Nombre:\n${displayName}\n\n📱 Número:\n${clientNumber}\n\n💬 Último mensaje:\n"${clientMessage}"\n\n⚠️ La IA fue desactivada automáticamente para esta conversación.\n\nAcción requerida: Responder manualmente al cliente.`;

        try {
            await sock.sendMessage(config.adminJid, { text: notification });
            console.log(`📢 Admin notification sent to ${config.adminJid} about ${clientJid}`);
        } catch (err) {
            console.error(`❌ Failed to send admin notification: ${err.message}`);
        }
    }

    async sendExhaustionNotification(sock, clientJid, clientMessage, clientName) {
        if (!sock) return;

        const config = await this.getConfig();
        if (!config.adminJid) {
            console.warn('⚠️ No admin JID configured for exhaustion notifications');
            return;
        }

        const clientNumber = clientJid.replace('@s.whatsapp.net', '');
        const displayName = clientName || 'Sin nombre disponible';
        const now = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });

        const notification = `🚨 API KEYS AGOTADAS\n\n⚠️ Todas las API Keys de IA están agotadas o no disponibles.\nNingún proveedor pudo generar respuesta.\n\n📱 Cliente: ${displayName}\n📞 Número: ${clientNumber}\n💬 Último mensaje: "${clientMessage}"\n🕐 Hora: ${now}\n\n❗ Acción requerida: Recargar créditos o agregar nuevas API Keys desde el panel.`;

        try {
            await sock.sendMessage(config.adminJid, { text: notification });
            console.log(`📢 Exhaustion notification sent to ${config.adminJid} about ${clientJid}`);
        } catch (err) {
            console.error(`❌ Failed to send exhaustion notification: ${err.message}`);
        }
    }
}

module.exports = new AIFallbackService();
