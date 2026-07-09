/**
 * ChatHistoryService
 * 
 * Stores message history per JID for the admin chat interface.
 * Supports DynamoDB (primary) and local JSON file (fallback).
 * 
 * Each message: { text, fromMe, timestamp, id }
 * Max 100 messages per conversation (oldest auto-trimmed).
 * 
 * DynamoDB layout:
 *   PK = "CHAT#<jid>", SK = "DATA" → { pushName, messages[] }
 */

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const dynamo = require('./dynamoStore');

const DATA_DIR = path.join(__dirname, '../../data');
const HISTORY_PATH = path.join(DATA_DIR, 'chat-history.json');
const MAX_MESSAGES_PER_CHAT = 100;

class ChatHistoryService {
    constructor() {
        // Always ensure local files for fallback
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
        return jid.replace(/:\d+@/, '@');
    }

    // ── Local file I/O (fallback) ──

    async _readLocal() {
        if (!this._cache) {
            this._cache = await fs.readJson(HISTORY_PATH);
        }
        return this._cache;
    }

    async _writeLocal(data) {
        this._cache = data;
        await fs.writeJson(HISTORY_PATH, data, { spaces: 2 });
    }

    // ── DynamoDB I/O ──

    async _readConvDynamo(jid) {
        const data = await dynamo.getItem(`CHAT#${jid}`, 'DATA');
        return data || { pushName: jid.replace(/@.*$/, ''), messages: [] };
    }

    async _writeConvDynamo(jid, convData) {
        await dynamo.putItem(`CHAT#${jid}`, 'DATA', convData);
    }

    async _deleteConvDynamo(jid) {
        await dynamo.deleteItem(`CHAT#${jid}`, 'DATA');
    }

    // ── Public API ──

    /**
     * Add a message to a conversation.
     */
    async addMessage(rawJid, text, fromMe, pushName, sender, mediaInfo) {
        const jid = this._normalizeJid(rawJid);

        if (dynamo.isEnabled()) {
            try {
                const conv = await this._readConvDynamo(jid);

                if (pushName && !fromMe) {
                    conv.pushName = pushName;
                }

                const message = {
                    id: crypto.randomBytes(8).toString('hex'),
                    text: text || '',
                    fromMe,
                    sender: sender || (fromMe ? 'agent' : 'client'),
                    timestamp: new Date().toISOString(),
                };

                if (mediaInfo && mediaInfo.mediaId) {
                    message.mediaId = mediaInfo.mediaId;
                    message.mediaType = mediaInfo.mediaType || 'image';
                }

                conv.messages.push(message);

                if (conv.messages.length > MAX_MESSAGES_PER_CHAT) {
                    conv.messages = conv.messages.slice(-MAX_MESSAGES_PER_CHAT);
                }

                await this._writeConvDynamo(jid, conv);
                return message;
            } catch (err) {
                console.error(`❌ [ChatHistory] DynamoDB write failed, falling back to local: ${err.message}`);
            }
        }

        // Local fallback
        const data = await this._readLocal();

        if (!data[jid]) {
            data[jid] = {
                pushName: pushName || jid.replace(/@.*$/, ''),
                messages: []
            };
        }

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

        if (mediaInfo && mediaInfo.mediaId) {
            message.mediaId = mediaInfo.mediaId;
            message.mediaType = mediaInfo.mediaType || 'image';
        }

        data[jid].messages.push(message);

        if (data[jid].messages.length > MAX_MESSAGES_PER_CHAT) {
            data[jid].messages = data[jid].messages.slice(-MAX_MESSAGES_PER_CHAT);
        }

        await this._writeLocal(data);
        return message;
    }

    /**
     * Get all messages for a specific conversation.
     */
    async getMessages(rawJid) {
        const jid = this._normalizeJid(rawJid);

        if (dynamo.isEnabled()) {
            try {
                const conv = await this._readConvDynamo(jid);
                // Si no hay mensajes en Dynamo pero sí existen en el archivo local, migrar y retornarlos
                if (!conv.messages || conv.messages.length === 0) {
                    const localData = await this._readLocal();
                    if (localData[jid] && localData[jid].messages && localData[jid].messages.length > 0) {
                        console.log(`🔄 [ChatHistory] Migrando ${localData[jid].messages.length} mensajes de ${jid} desde local a DynamoDB...`);
                        await this._writeConvDynamo(jid, localData[jid]);
                        return localData[jid];
                    }
                }
                return conv;
            } catch (err) {
                console.error(`❌ [ChatHistory] DynamoDB read failed, falling back to local: ${err.message}`);
            }
        }

        const data = await this._readLocal();
        return data[jid] || { pushName: jid.replace(/@.*$/, ''), messages: [] };
    }

    /**
     * Get all conversations sorted by most recent message.
     */
    async getConversations() {
        if (dynamo.isEnabled()) {
            try {
                // Scan all CHAT# prefixed items directly — no secondary index needed
                const dynamoChats = await this._scanAllChatsDynamo();
                
                // Verificación de sincronización con el archivo local
                const localData = await this._readLocal();
                const localChats = this._buildConversationList(localData);

                // Si hay conversaciones en local que no están aún en DynamoDB, migrarlas/combinarlas
                if (localChats.length > 0 && dynamoChats.length < localChats.length) {
                    console.log(`🔄 [ChatHistory] Detectados ${localChats.length} chats locales vs ${dynamoChats.length} en DynamoDB. Sincronizando hacia AWS...`);
                    // Sincronizar hacia DynamoDB las que faltan
                    const dynamoJids = new Set(dynamoChats.map(c => c.jid));
                    for (const [jid, convData] of Object.entries(localData)) {
                        if (!jid.includes('@g.us') && !dynamoJids.has(jid)) {
                            try {
                                await this._writeConvDynamo(jid, convData);
                            } catch (e) {
                                console.error(`⚠️ Error al migrar ${jid} a DynamoDB:`, e.message);
                            }
                        }
                    }
                    // Combinar las conversaciones para mostrar al usuario sin demoras
                    const mergedMap = new Map();
                    localChats.forEach(c => mergedMap.set(c.jid, c));
                    dynamoChats.forEach(c => mergedMap.set(c.jid, c));
                    return Array.from(mergedMap.values()).sort((a, b) => {
                        const aTime = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0;
                        const bTime = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0;
                        return bTime - aTime;
                    });
                }

                return dynamoChats;
            } catch (err) {
                console.error(`❌ [ChatHistory] DynamoDB getConversations failed, falling back to local: ${err.message}`);
            }
        }

        const data = await this._readLocal();
        return this._buildConversationList(data);
    }

    /**
     * Scan all chat conversations from DynamoDB.
     * Uses a full table scan with PK filter — acceptable for small datasets.
     */
    async _scanAllChatsDynamo() {
        // Reuse the already-initialized dynamo module client
        await dynamo.ensureTable();
        const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');
        const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');

        const rawClient = new DynamoDBClient({
            region: process.env.AWS_REGION || 'us-east-1',
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            },
        });
        const docClient = DynamoDBDocumentClient.from(rawClient, {
            marshallOptions: { removeUndefinedValues: true, convertEmptyValues: true },
        });

        const tableName = dynamo.TABLE_NAME;

        // FilterExpression: select items whose PK starts with 'CHAT#' and SK is 'DATA'
        // begins_with() is valid in FilterExpression for Scan operations
        const params = {
            TableName: tableName,
            FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
            ExpressionAttributeValues: { ':prefix': 'CHAT#', ':sk': 'DATA' },
        };

        const conversations = [];
        let lastKey = undefined;

        do {
            if (lastKey) params.ExclusiveStartKey = lastKey;
            const result = await docClient.send(new ScanCommand(params));
            for (const item of (result.Items || [])) {
                const jid = item.PK.replace('CHAT#', '');
                if (jid.includes('@g.us')) continue; // Exclude groups
                const conv = item.data || {};
                const messages = conv.messages || [];
                const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
                const unreadCount = messages.filter(m => !m.fromMe && !m.read).length;

                conversations.push({
                    jid,
                    pushName: conv.pushName || jid.replace(/@.*$/, ''),
                    lastMessage: lastMsg ? lastMsg.text : '',
                    lastMessageTime: lastMsg ? lastMsg.timestamp : null,
                    lastMessageFromMe: lastMsg ? lastMsg.fromMe : false,
                    messageCount: messages.length,
                    unreadCount,
                });
            }
            lastKey = result.LastEvaluatedKey;
        } while (lastKey);

        return conversations.sort((a, b) => {
            const aTime = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0;
            const bTime = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0;
            return bTime - aTime;
        });
    }

    _buildConversationList(data) {
        return Object.entries(data)
            .filter(([jid]) => !jid.includes('@g.us'))
            .map(([jid, conv]) => {
                const lastMsg = conv.messages.length > 0
                    ? conv.messages[conv.messages.length - 1]
                    : null;
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
     */
    async markAsRead(rawJid) {
        const jid = this._normalizeJid(rawJid);

        if (dynamo.isEnabled()) {
            try {
                const conv = await this._readConvDynamo(jid);
                conv.messages.forEach(m => {
                    if (!m.fromMe) m.read = true;
                });
                await this._writeConvDynamo(jid, conv);
                return;
            } catch (err) {
                console.error(`❌ [ChatHistory] DynamoDB markAsRead failed, falling back to local: ${err.message}`);
            }
        }

        const data = await this._readLocal();
        if (data[jid]) {
            data[jid].messages.forEach(m => {
                if (!m.fromMe) m.read = true;
            });
            await this._writeLocal(data);
        }
    }

    /**
     * Delete a conversation entirely.
     */
    async deleteConversation(rawJid) {
        const jid = this._normalizeJid(rawJid);

        if (dynamo.isEnabled()) {
            try {
                await this._deleteConvDynamo(jid);
                return true;
            } catch (err) {
                console.error(`❌ [ChatHistory] DynamoDB delete failed, falling back to local: ${err.message}`);
            }
        }

        const data = await this._readLocal();
        if (data[jid]) {
            delete data[jid];
            await this._writeLocal(data);
            return true;
        }
        return false;
    }
}

module.exports = new ChatHistoryService();
