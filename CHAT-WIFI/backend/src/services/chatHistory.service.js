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
                const localData = await this._readLocal();
                const localConv = localData[jid];

                // Si no hay mensajes en Dynamo pero sí existen en el archivo local, o si local tiene MÁS mensajes o es más reciente
                const dynamoMsgsLen = conv?.messages?.length || 0;
                const localMsgsLen = localConv?.messages?.length || 0;

                if (localConv && localMsgsLen > dynamoMsgsLen) {
                    console.log(`🔄 [ChatHistory] Migrando/actualizando ${localMsgsLen} mensajes de ${jid} desde archivo local a DynamoDB...`);
                    await this._writeConvDynamo(jid, localConv);
                    return localConv;
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
                
                // Verificación de sincronización con el archivo local (chat-history.json)
                const localData = await this._readLocal();
                const localChats = this._buildConversationList(localData);

                // Combinar conversaciones de DynamoDB y el archivo local independientemente
                const mergedMap = new Map();
                dynamoChats.forEach(c => mergedMap.set(c.jid, c));

                let needsSyncCount = 0;
                for (const localConv of localChats) {
                    const jid = localConv.jid;
                    if (!jid || jid.includes('@g.us')) continue;

                    const inDynamo = mergedMap.get(jid);
                    if (!inDynamo) {
                        mergedMap.set(jid, localConv);
                        needsSyncCount++;
                        // Subir a AWS en segundo plano
                        this._writeConvDynamo(jid, localData[jid]).catch(e => 
                            console.error(`⚠️ Error al migrar ${jid} a DynamoDB:`, e.message)
                        );
                    } else {
                        // Si ya está en ambos, elegir el que tenga el mensaje más reciente o más historial
                        const localTime = localConv.lastMessageTime ? new Date(localConv.lastMessageTime).getTime() : 0;
                        const dynamoTime = inDynamo.lastMessageTime ? new Date(inDynamo.lastMessageTime).getTime() : 0;
                        if (localTime > dynamoTime) {
                            mergedMap.set(jid, localConv);
                            this._writeConvDynamo(jid, localData[jid]).catch(e => 
                                console.error(`⚠️ Error al actualizar ${jid} en DynamoDB:`, e.message)
                            );
                        }
                    }
                }

                if (needsSyncCount > 0) {
                    console.log(`🔄 [ChatHistory] Detectados ${needsSyncCount} chats locales no existentes en DynamoDB. Sincronizando hacia AWS...`);
                }

                return Array.from(mergedMap.values()).sort((a, b) => {
                    const aTime = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0;
                    const bTime = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0;
                    return bTime - aTime;
                });
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
