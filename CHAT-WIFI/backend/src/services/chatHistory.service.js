/**
 * ChatHistoryService
 * 
 * Stores message history per JID for the admin chat interface.
 * Persists to a JSON file and provides conversation listing + message retrieval.
 * 
 * Each message: { text, fromMe, timestamp, id }
 * Max 100 messages per conversation (oldest auto-trimmed).
 */

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '../../data');
const HISTORY_PATH = path.join(DATA_DIR, 'chat-history.json');
const MAX_MESSAGES_PER_CHAT = 100;

class ChatHistoryService {
    constructor() {
        fs.ensureDirSync(DATA_DIR);
        if (!fs.existsSync(HISTORY_PATH)) {
            fs.writeJsonSync(HISTORY_PATH, {}, { spaces: 2 });
        }
        // In-memory cache for performance
        this._cache = null;
    }

    // ── Private helpers ──

    _normalizeJid(jid) {
        if (!jid) return jid;
        // Convert "123456:15@s.whatsapp.net" -> "123456@s.whatsapp.net"
        return jid.replace(/:\d+@/, '@');
    }

    async _read() {
        if (!this._cache) {
            this._cache = await fs.readJson(HISTORY_PATH);
        }
        return this._cache;
    }

    async _write(data) {
        this._cache = data;
        await fs.writeJson(HISTORY_PATH, data, { spaces: 2 });
    }

    // ── Public API ──

    /**
     * Add a message to a conversation.
     * @param {string} jid - WhatsApp JID
     * @param {string} text - Message text
     * @param {boolean} fromMe - true if sent by bot/admin, false if from client
     * @param {string} [pushName] - Client display name (only for incoming)
     * @param {string} [sender] - 'client' | 'agent' | 'bot' (defaults based on fromMe)
     * @param {object} [mediaInfo] - Optional: { mediaId, mediaType } for media messages
     * @returns {object} The saved message object
     */
    async addMessage(rawJid, text, fromMe, pushName, sender, mediaInfo) {
        const jid = this._normalizeJid(rawJid);
        const data = await this._read();

        if (!data[jid]) {
            data[jid] = {
                pushName: pushName || jid.replace(/@.*$/, ''),
                messages: []
            };
        }

        // Update pushName if provided (client names can change)
        if (pushName && !fromMe) {
            data[jid].pushName = pushName;
        }

        const message = {
            id: crypto.randomBytes(8).toString('hex'),
            text: text || '',
            fromMe,
            sender: sender || (fromMe ? 'agent' : 'client'),
            timestamp: new Date().toISOString()
        };

        // Attach media info if present
        if (mediaInfo && mediaInfo.mediaId) {
            message.mediaId = mediaInfo.mediaId;
            message.mediaType = mediaInfo.mediaType || 'image';
        }

        data[jid].messages.push(message);

        // Trim to max messages
        if (data[jid].messages.length > MAX_MESSAGES_PER_CHAT) {
            data[jid].messages = data[jid].messages.slice(-MAX_MESSAGES_PER_CHAT);
        }

        await this._write(data);
        return message;
    }

    /**
     * Get all messages for a specific conversation.
     * @param {string} jid
     * @returns {object} { pushName, messages: [...] }
     */
    async getMessages(rawJid) {
        const jid = this._normalizeJid(rawJid);
        const data = await this._read();
        return data[jid] || { pushName: jid.replace(/@.*$/, ''), messages: [] };
    }

    /**
     * Get all conversations sorted by most recent message.
     * Returns a summary list (pushName, lastMessage, unread count placeholder).
     * @returns {Array}
     */
    async getConversations() {
        const data = await this._read();

        return Object.entries(data)
            .filter(([jid]) => !jid.includes('@g.us')) // Exclude groups
            .map(([jid, conv]) => {
                const lastMsg = conv.messages.length > 0
                    ? conv.messages[conv.messages.length - 1]
                    : null;

                // Count unread (incoming messages not yet "seen" — simplified: last N incoming)
                const unreadCount = conv.messages.filter(m => !m.fromMe && !m.read).length;

                return {
                    jid,
                    pushName: conv.pushName || jid.replace(/@.*$/, ''),
                    lastMessage: lastMsg ? lastMsg.text : '',
                    lastMessageTime: lastMsg ? lastMsg.timestamp : null,
                    lastMessageFromMe: lastMsg ? lastMsg.fromMe : false,
                    messageCount: conv.messages.length,
                    unreadCount
                };
            })
            .sort((a, b) => {
                const aTime = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0;
                const bTime = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0;
                return bTime - aTime;
            });
    }

    /**
     * Mark all messages in a conversation as read.
     * @param {string} jid
     */
    async markAsRead(rawJid) {
        const jid = this._normalizeJid(rawJid);
        const data = await this._read();
        if (data[jid]) {
            data[jid].messages.forEach(m => {
                if (!m.fromMe) m.read = true;
            });
            await this._write(data);
        }
    }

    /**
     * Delete a conversation entirely.
     * @param {string} rawJid
     */
    async deleteConversation(rawJid) {
        const jid = this._normalizeJid(rawJid);
        const data = await this._read();
        if (data[jid]) {
            delete data[jid];
            await this._write(data);
            return true;
        }
        return false;
    }
}

module.exports = new ChatHistoryService();
