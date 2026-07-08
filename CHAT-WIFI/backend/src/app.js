const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const whatsapp = require('./core/WhatsApp');
const authRoutes = require('./routes/auth.routes');
const whatsappRoutes = require('./routes/whatsapp.routes');
const aiProvidersRoutes = require('./routes/aiProviders.routes');
const knowledgeBaseRoutes = require('./routes/knowledgeBase.routes');
const blockedNumbersRoutes = require('./routes/blockedNumbers.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const welcomeAutomationRoutes = require('./routes/welcomeAutomation.routes');
const aiFallbackRoutes = require('./routes/aiFallback.routes');
const aiAutomationsRoutes = require('./routes/aiAutomations.routes');
const chatRoutes = require('./routes/chat.routes');
const followUpRoutes = require('./routes/followUp.routes');
const aiRulesRoutes = require('./routes/aiRules.routes');
const courseAccessRoutes = require('./routes/courseAccess.routes');
const googleDriveRoutes = require('./routes/googleDrive.routes');
const blockedNumbersService = require('./services/blockedNumbers.service');
const analyticsService = require('./services/analyticsService');
const welcomeAutomationService = require('./services/welcomeAutomation.service');
const aiFallbackService = require('./services/aiFallback.service');
const { verifyToken } = require('./middleware/auth.middleware');

// ============================================================
// MASTER AI SWITCH — change at runtime via API or socket
// ============================================================
global.aiEnabled = true;

// Promo video deduplication: fast in-memory guard + persistent state via welcomeAutomationService
// Exposed globally so resetUserState can clear entries and allow re-sending
global.sentPromoJids = new Set();
const sentPromoJids = global.sentPromoJids;

// Track JIDs that are waiting for email input after payment
// Map<jid, { attempts: number, createdAt: number }>
const pendingEmailJids = new Map();

// ── Deduplication guard for reconnection message replays ──────────────────
// When WiFi drops and Baileys reconnects, WhatsApp re-delivers pending messages.
// This set tracks recently-processed message IDs to skip duplicates.
const PROCESSED_MSG_IDS = new Set();
const PROCESSED_MSG_MAX = 500;       // hard cap to prevent unbounded growth
const PROCESSED_MSG_TTL = 120_000;   // 2 minutes TTL per entry

// Active message debouncers map: remoteJid -> { timer, texts, audioMsgs, imageMsgs, mediaMsgs, latestMsg }
const activeDebouncers = new Map();

/**
 * Detect the customer's chosen plan based on conversation history.
 * Looks for keywords of combo-10 (basico) and combo-15 (full/avanzado).
 * @param {string} remoteJid
 * @returns {Promise<string>} 'combo-10', 'combo-15', or ''
 */
async function detectPlanFromHistory(remoteJid) {
    try {
        const chatData = await chatHistoryService.getMessages(remoteJid);
        const messages = chatData.messages || [];
        
        // Loop backwards starting from the latest message
        for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i];
            const text = (m.text || '').toLowerCase();
            
            // Check client messages
            if (!m.fromMe) {
                if (text.includes('15') || text.includes('full') || text.includes('avanzado') || text.includes('pentesting')) {
                    return 'combo-15';
                }
                if (text.includes('10') || text.includes('basico') || text.includes('básico')) {
                    return 'combo-10';
                }
            } else {
                // Check bot messages (offers/descriptions)
                if (text.includes('15.000') || text.includes('full') || text.includes('avanzado')) {
                    return 'combo-15';
                }
                if (text.includes('10.000') || text.includes('básico') || text.includes('basico')) {
                    return 'combo-10';
                }
            }
        }
    } catch (err) {
        console.error(`⚠️ [PlanDetection] Error parsing history for ${remoteJid}:`, err.message);
    }
    return '';
}

const app = express();
app.use(cors()); // Habilitar CORS para todas las rutas
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

// Expose io to routes via app.set
app.set('io', io);

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/ai-providers', aiProvidersRoutes);
app.use('/api/knowledge-base', knowledgeBaseRoutes);
app.use('/api/blocked-numbers', blockedNumbersRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/welcome-automation', welcomeAutomationRoutes);
app.use('/api/ai-fallback', aiFallbackRoutes);
app.use('/api/ai-automations', aiAutomationsRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/follow-up', followUpRoutes);
app.use('/api/ai-rules', aiRulesRoutes);
app.use('/api/course-access', courseAccessRoutes);
app.use('/api/google-drive', googleDriveRoutes);

// API Status (Pública)
app.get('/api/status', (req, res) => {
    res.json(whatsapp.getStatus());
});

// ============================================================
// AI TOGGLE ROUTES — Protected
// ============================================================
// GET current AI state
app.get('/api/ai/status', verifyToken, (req, res) => {
    res.json({ enabled: global.aiEnabled });
});

// POST toggle AI on/off
app.post('/api/ai/toggle', verifyToken, (req, res) => {
    global.aiEnabled = !global.aiEnabled;
    console.log(`🤖 IA ${global.aiEnabled ? '✅ ENCENDIDA' : '🔴 APAGADA'} por el usuario`);
    // Broadcast new state to all connected dashboards
    io.emit('ai-status', { enabled: global.aiEnabled });
    res.json({ enabled: global.aiEnabled });
});

// Ruta Privada de Prueba
app.get('/api/private/test', verifyToken, (req, res) => {
    res.json({
        success: true,
        message: 'Has accedido a una ruta protegida',
        user: req.user
    });
});

// Socket.io for Real-time QR and Status
io.on('connection', (socket) => {
    console.log('Cliente conectado al dashboard');

    // Send initial states
    socket.emit('whatsapp-status', whatsapp.getStatus());
    socket.emit('ai-status', { enabled: global.aiEnabled });
});

const aiResponseService = require('./services/aiResponse.service');
const apiKeyRotation = require('./services/apiKeyRotation.service');
const audioTranscription = require('./services/audioTranscription.service');
const aiAutomationsService = require('./services/aiAutomations.service');
const paymentDetection = require('./services/paymentDetection.service');
const humanResponse = require('./services/humanResponse.service');
const chatHistoryService = require('./services/chatHistory.service');
const mediaStorageService = require('./services/mediaStorage.service');
const followUpService = require('./services/followUp.service');
const courseAccessService = require('./services/courseAccess.service');
const googleDriveService = require('./services/googleDrive.service');
const accessManagerService = require('./services/accessManager.service');
const cronRevokeService = require('./services/cronRevoke.service');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const sentTracker = require('./utils/sentTracker');
apiKeyRotation.setIo(io);
humanResponse.setDependencies(io, chatHistoryService);
courseAccessService.setIo(io);
googleDriveService.setIo(io);
accessManagerService.setIo(io);
accessManagerService.setSock(whatsapp.sock);

// Start cron scheduler for expired Drive access revocation
cronRevokeService.startScheduler();

// Wire Socket.io to AI Providers for real-time status events (pool system)
const aiProvidersService = require('./services/aiProviders.service');
aiProvidersService.setIo(io);

// Escuchar eventos de WhatsApp y emitir vía Socket.io
whatsapp.on('status-update', (data) => {
    io.emit('whatsapp-update', data);
    // Keep the key rotation service aware of the current WhatsApp socket
    if (data.status === 'connected' && whatsapp.sock) {
        apiKeyRotation.setSock(whatsapp.sock);
        accessManagerService.setSock(whatsapp.sock);
        // Wire follow-up service dependencies and start scheduler
        followUpService.setDependencies(whatsapp.sock, chatHistoryService, io, welcomeAutomationService);
        followUpService.startScheduler();
    }
});

// ── KEY ROTATION STATUS ENDPOINT ──
app.get('/api/key-rotation/status', verifyToken, (req, res) => {
    const status = apiKeyRotation.getStatus();
    res.json({ success: true, rotation: status });
});

// ============================================================
// MANUAL INTERVENTION DETECTION
// Detect outgoing messages from the owner (not sent by the bot)
// and auto-disable AI for that specific chat.
// ============================================================
whatsapp.on('message', async (m) => {
    try {
        const msg = m.messages[0];
        if (!msg) return;

        // ── DEDUPLICATION: skip messages already processed (reconnection replays) ──
        const msgId = msg.key?.id;
        if (msgId && PROCESSED_MSG_IDS.has(msgId)) {
            return; // Already processed before disconnection
        }
        if (msgId) {
            PROCESSED_MSG_IDS.add(msgId);
            // Auto-cleanup to prevent memory leak
            setTimeout(() => PROCESSED_MSG_IDS.delete(msgId), PROCESSED_MSG_TTL);
            // Hard cap safety — evict oldest entry if too many
            if (PROCESSED_MSG_IDS.size > PROCESSED_MSG_MAX) {
                const first = PROCESSED_MSG_IDS.values().next().value;
                PROCESSED_MSG_IDS.delete(first);
            }
        }

        const rawJid = msg.key?.remoteJid || '';

        // ── SKIP STATUS BROADCASTS (WhatsApp Stories/Status updates) ──
        // When contacts post status updates, Baileys delivers them as
        // messages.upsert with remoteJid = 'status@broadcast'. These
        // must be completely ignored to avoid phantom messages and
        // unwanted bot replies.
        if (rawJid === 'status@broadcast') return;

        // Normalize JID: strip device suffix (e.g. "573028599105:42@s.whatsapp.net" → "573028599105@s.whatsapp.net")
        let remoteJid = rawJid.replace(/:\d+@/, '@');

        // MAP KNOWN LIDs TO REAL NUMBER TO MERGE CHATS
        // As requested: the client's PC shows 254468541157383@lid instead of their root 573028599105
        const LID_MAPPINGS = {
            '254468541157383@lid': '573028599105@s.whatsapp.net'
        };
        if (LID_MAPPINGS[remoteJid]) {
            remoteJid = LID_MAPPINGS[remoteJid];
        }

        // === EARLY TEXT EXTRACTION (needed by outgoing handler below) ===
        const text = msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption ||
            msg.message?.templateMessage?.hydratedTemplate?.hydratedContentText ||
            msg.message?.templateMessage?.hydratedTemplate?.hydratedTitleText ||
            msg.message?.buttonsResponseMessage?.selectedDisplayText ||
            msg.message?.listResponseMessage?.title ||
            msg.message?.viewOnceMessage?.message?.imageMessage?.caption ||
            msg.message?.viewOnceMessage?.message?.videoMessage?.caption ||
            msg.message?.documentWithCaptionMessage?.message?.documentMessage?.caption ||
            msg.message?.interactiveResponseMessage?.body?.text ||
            '';

        // ── SKIP PROTOCOL & NON-CHAT MESSAGES ──
        // Protocol messages (read receipts, message edits/deletes, etc.),
        // reaction messages, and ephemeral setting changes are not real
        // chat messages and must be ignored.
        const earlyContent = msg.message || {};
        if (earlyContent.protocolMessage || earlyContent.reactionMessage ||
            earlyContent.ephemeralMessage?.message?.protocolMessage ||
            earlyContent.senderKeyDistributionMessage) {
            return;
        }

        // === OUTGOING MESSAGE HANDLER (fromMe = true) ===
        // Handles: bot messages (skip), dashboard messages (skip, already saved),
        //          and native phone/web messages (save + detect manual intervention)
        if (msg.key.fromMe && m.type === 'notify') {
            if (remoteJid.includes('@g.us')) return;

            // 1. Bot-sent messages: already saved by humanResponse or direct send — skip
            const wasBot = welcomeAutomationService.wasBotSent(remoteJid);
            if (wasBot) return;

            // 2. Dashboard-sent messages: already saved by chat.routes — skip
            if (sentTracker.wasSentRecently(remoteJid)) return;

            // 3. Native phone/web message (true manual intervention)
            // Save to chat history for dashboard sync — also capture outgoing media
            try {
                let outMediaInfo = null;
                const outContent = msg.message || {};
                const outHasImage = outContent.imageMessage;
                const outHasVideo = outContent.videoMessage;
                const outHasAudio = outContent.audioMessage || outContent.ptvMessage;
                if (outHasImage || outHasVideo || outHasAudio) {
                    try {
                        const outBuffer = await downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: undefined });
                        const outType = outHasImage ? 'image' : outHasAudio ? 'audio' : 'video';
                        const outMime = (outHasImage?.mimetype || outHasVideo?.mimetype || outHasAudio?.mimetype) || `${outType}/unknown`;
                        const saved = mediaStorageService.saveMedia(remoteJid, outBuffer, outType, outMime);
                        outMediaInfo = { mediaId: saved.id, mediaType: outType };
                    } catch (_) { }
                }
                const savedMsg = await chatHistoryService.addMessage(remoteJid, text || '[media]', true, msg.pushName, 'agent', outMediaInfo);
                io.emit('chat:message', { jid: remoteJid, message: savedMsg });
            } catch (_) { }

            // Disable AI for this chat (agent took over manually)
            if (remoteJid && !remoteJid.includes('@g.us')) {
                console.log(`✋ Manual intervention detected for ${remoteJid} — disabling AI for this chat`);
                try {
                    await welcomeAutomationService.disableUserAI(remoteJid);
                } catch (_) { }
                // The business just spoke (agent replied manually) → re-arm the
                // follow-up silence timer so an unanswered manual chat still gets
                // chased. Won't revive a closed (sold/stopped) follow-up.
                try {
                    await followUpService.startFollowUp(remoteJid);
                } catch (_) { }
            }
            return;
        }

        // === BLOCKED NUMBERS GUARD (runs before AI) ===
        const isBlockedNumber = await blockedNumbersService.isBlocked(remoteJid);
        const botConfig = await blockedNumbersService.getConfig();
        const isGroupMsg = remoteJid.includes('@g.us');
        if (isBlockedNumber) {
            console.log(`🚫 Número bloqueado, ignorando: ${remoteJid}`);
            return;
        }
        if (botConfig.blockGroups && isGroupMsg) {
            console.log(`👥 Grupo ignorado (blockGroups activo): ${remoteJid}`);
            return;
        }

        // === DETECT MESSAGE CONTENT TYPES ===
        const msgContent = msg.message || {};
        const isAudioMessage = !text && (msgContent.audioMessage || msgContent.ptvMessage);
        const isImageMessage = !text && (msgContent.imageMessage);
        const isMediaOnly = !text && !isAudioMessage && !isImageMessage && (
            msgContent.videoMessage ||
            msgContent.stickerMessage ||
            msgContent.documentMessage ||
            msgContent.viewOnceMessage ||
            msgContent.contactMessage ||
            msgContent.locationMessage
        );

        // Ignorar mensajes propios y notificaciones que no sean directas del cliente
        if (!msg.key.fromMe && m.type === 'notify') {
            if (remoteJid.includes('@g.us')) return;

            // === FOLLOW-UP: cancel if client replied ===
            try { await followUpService.cancelIfClientReplied(remoteJid); } catch (_) { }

            // === INTERRUPTION: cancel any pending bot responses for this sender ===
            try { humanResponse.cancelSending(remoteJid); } catch (_) { }

            // ── Record incoming message in chat history immediately ──
            let incomingMediaInfo = null;
            try {
                const inContent = msg.message || {};
                const inHasImage = inContent.imageMessage;
                const inHasVideo = inContent.videoMessage;
                const inHasAudio = inContent.audioMessage || inContent.ptvMessage;
                const inHasSticker = inContent.stickerMessage;
                if (inHasImage || inHasVideo || inHasAudio || inHasSticker) {
                    try {
                        const inBuffer = await downloadMediaMessage(
                            msg,
                            'buffer',
                            {},
                            { reuploadRequest: whatsapp.sock.updateMediaMessage }
                        );
                        const inType = inHasImage ? 'image' : inHasAudio ? 'audio' : inHasVideo ? 'video' : 'image';
                        let inMime = (inHasImage?.mimetype || inHasVideo?.mimetype || inHasAudio?.mimetype || inHasSticker?.mimetype) || `${inType}/ogg`;
                        if (inType === 'audio') {
                            inMime = 'audio/ogg';
                        }
                        const saved = mediaStorageService.saveMedia(remoteJid, inBuffer, inType, inMime);
                        incomingMediaInfo = { mediaId: saved.id, mediaType: inType };
                    } catch (dlErr) {
                        console.error(`⚠️ Failed to download incoming media from ${remoteJid}: ${dlErr.message}`);
                    }
                }
            } catch (_) { }
            try {
                const savedMsg = await chatHistoryService.addMessage(remoteJid, text || '[media]', false, msg.pushName, 'client', incomingMediaInfo);
                io.emit('chat:message', { jid: remoteJid, message: savedMsg });
            } catch (_) { }

            // === QUEUE AND DEBOUNCE AI RESPONSE FLOW ===
            // Progressive debounce: 5s initial wait, 3.5s on subsequent messages,
            // 15s max cap. This groups rapid-fire WhatsApp messages into one AI call.
            let debouncer = activeDebouncers.get(remoteJid);
            if (debouncer) {
                clearTimeout(debouncer.timer);
                debouncer.msgCount++;
            } else {
                debouncer = {
                    texts: [],
                    audioMsgs: [],
                    imageMsgs: [],
                    mediaMsgs: [],
                    latestMsg: null,
                    msgCount: 1,
                    startedAt: Date.now()
                };
                activeDebouncers.set(remoteJid, debouncer);
            }

            if (text) debouncer.texts.push(text);
            if (isAudioMessage) debouncer.audioMsgs.push(msg);
            if (isImageMessage) debouncer.imageMsgs.push(msg);
            if (isMediaOnly) debouncer.mediaMsgs.push(msg);
            debouncer.latestMsg = msg;

            // Progressive delay: 5s for first message, 3.5s for subsequent (burst mode)
            // Max wait cap of 15s from the first message to avoid infinite extension
            const INITIAL_DEBOUNCE_MS = 5000;
            const BURST_DEBOUNCE_MS = 3500;
            const MAX_WAIT_MS = 15000;

            let debounceDelay = debouncer.msgCount === 1 ? INITIAL_DEBOUNCE_MS : BURST_DEBOUNCE_MS;

            // Cap: if we've been waiting too long, fire immediately
            const elapsed = Date.now() - debouncer.startedAt;
            if (elapsed >= MAX_WAIT_MS) {
                debounceDelay = 500; // fire almost immediately
            } else if (elapsed + debounceDelay > MAX_WAIT_MS) {
                debounceDelay = MAX_WAIT_MS - elapsed; // cap to remaining time
            }

            if (debouncer.msgCount > 1) {
                console.log(`📨 [Debouncer] Message ${debouncer.msgCount} from ${remoteJid} grouped (wait: ${debounceDelay}ms, elapsed: ${elapsed}ms)`);
            }

            debouncer.timer = setTimeout(async () => {
                activeDebouncers.delete(remoteJid);
                try {
                    await processGroupedMessages(remoteJid, debouncer);
                } catch (debErr) {
                    console.error(`❌ [Debouncer] Error processing messages for ${remoteJid}:`, debErr.message);
                }
            }, debounceDelay);
        }
    } catch (error) {
        console.error('❌ Error manejando mensaje entrante:', error.message);
    }
});

/**
 * Processes grouped/debounced messages from a client JID.
 * Handles welcome automation, AI response generation, audio transcription, image payment detection, and fallback routes.
 */
async function processGroupedMessages(remoteJid, debouncer) {
    try {
        const msg = debouncer.latestMsg;
        if (!msg) return;

    // === MASTER AI SWITCH CHECK ===
    if (!global.aiEnabled) {
        console.log('🔴 IA apagada — mensaje ignorado');
        // Even with AI off, the client wrote — start/maintain follow-up so the team can chase them
        try { await followUpService.startFollowUp(remoteJid); } catch (_) { }
        return;
    }

    // === WELCOME 24H AUTOMATION (runs before AI, non-blocking) ===
    let welcomeWasSent = false;
    try {
        welcomeWasSent = await welcomeAutomationService.runIfNeeded(whatsapp.sock, remoteJid, chatHistoryService, io);
    } catch (welcomeErr) {
        console.error(`⚠️ Welcome automation error: ${welcomeErr.message}`);
    }

    // If the welcome flow was just sent, skip AI response entirely.
    if (welcomeWasSent) {
        console.log(`🔔 Welcome flow sent to ${remoteJid} — skipping AI response to avoid duplicate greeting`);
        // Auto-start follow-up sequence for contacts that received the welcome.
        // Use isManual:true because a welcome flow means the user state was reset
        // (new sales cycle) — a previous payment_received closure must not block it.
        try {
            await followUpService.startFollowUp(remoteJid, { isManual: true });
        } catch (fuErr) {
            console.error(`⚠️ Follow-up auto-start error: ${fuErr.message}`);
        }
        return;
    }

    // Check per-user AI status before processing
    const userAIEnabled = await welcomeAutomationService.isAIEnabledForUser(remoteJid);
    if (!userAIEnabled) {
        console.log(`🔇 AI disabled for user ${remoteJid} — skipping AI response`);
        // Client wrote but AI won't reply — keep follow-up active so the lead isn't lost
        try { await followUpService.startFollowUp(remoteJid); } catch (_) { }
        return;
    }

    // === IMAGE PAYMENT DETECTION HANDLER ===
    if (debouncer.imageMsgs.length > 0) {
        const imageMsg = debouncer.imageMsgs[0];
        const automationsConfig = await aiAutomationsService.getConfig();
        if (automationsConfig.paymentDetectionEnabled) {
            console.log(`📸 Image received from ${remoteJid} — analyzing for payment receipt...`);
            try { await welcomeAutomationService.updateUserMessage(remoteJid, '[image]'); } catch (_) { }
            try { analyticsService.trackIncoming(remoteJid); } catch (_) { }

            try {
                const detection = await paymentDetection.analyzeMessage(imageMsg);

                if (detection.isPayment) {
                    console.log(`💳 Payment receipt DETECTED from ${remoteJid} with amount ${detection.amount}`);
                    if (whatsapp.sock) {
                        // Send payment confirmation
                        welcomeAutomationService.markBotSent(remoteJid);
                        await whatsapp.sock.sendMessage(remoteJid, {
                            text: 'Gracias 🙏\nVoy a verificar tu pago.'
                        });
                        try {
                            await chatHistoryService.addMessage(remoteJid, 'Gracias 🙏\nVoy a verificar tu pago.', true, undefined, 'bot');
                        } catch (_) { }
                        console.log(`📤 Payment confirmation sent to ${remoteJid}`);
                        try { analyticsService.trackOutgoing(); } catch (_) { }

                        // Ask for email after a short delay
                        await new Promise(r => setTimeout(r, 3000));
                        welcomeAutomationService.markBotSent(remoteJid);
                        await whatsapp.sock.sendMessage(remoteJid, {
                            text: 'Para darte el acceso al curso, envíame tu correo electrónico por favor 📧'
                        });
                        try {
                            const savedEmailReq = await chatHistoryService.addMessage(remoteJid, 'Para darte el acceso al curso, envíame tu correo electrónico por favor 📧', true, undefined, 'bot');
                            io.emit('chat:message', { jid: remoteJid, message: savedEmailReq });
                        } catch (_) { }
                        console.log(`📧 Email request sent to ${remoteJid}`);
                    }

                    // Determine plan from vision detection or fallback to history
                    let plan = '';
                    if (detection.amount >= 15000) {
                        plan = 'combo-15';
                    } else if (detection.amount >= 10000) {
                        plan = 'combo-10';
                    } else {
                        plan = await detectPlanFromHistory(remoteJid);
                    }

                    // Create pending access record and track for email capture
                    try {
                        const record = await courseAccessService.createPendingAccess(remoteJid, msg.pushName, plan);
                        // If record already exists but the newly detected plan is different (e.g. upgraded), update it
                        if (record && plan && record.plan !== plan) {
                            console.log(`📋 [CourseAccess] Updating plan for existing record to "${plan}" based on receipt amount`);
                            await courseAccessService.updatePlan(record.id, plan);
                        }
                    } catch (caErr) {
                        console.error(`⚠️ [CourseAccess] Failed to create or update record: ${caErr.message}`);
                    }
                    pendingEmailJids.set(remoteJid, { attempts: 0, createdAt: Date.now() });
                    // DO NOT disable AI yet — keep it listening for the email
                    console.log(`📧 Waiting for email from ${remoteJid}`);
                    // Cancel any active follow-up sequence (customer already paid)
                    try { await followUpService.cancelFollowUp(remoteJid, 'payment_received'); } catch (_) { }
                    // Register as pending and notify admin
                    await aiFallbackService.registerPending(remoteJid, '[Comprobante de pago]');
                    try {
                        await aiFallbackService.sendAdminNotification(whatsapp.sock, remoteJid, '[Envió comprobante de pago — esperando correo]', msg.pushName);
                    } catch (_) { }
                } else {
                    console.log(`📸 Image from ${remoteJid} is NOT a payment receipt — media-only flow`);
                    // Fall through to media-only handler behavior
                    if (whatsapp.sock) {
                        welcomeAutomationService.markBotSent(remoteJid);
                        await whatsapp.sock.sendMessage(remoteJid, { text: 'ok' });
                    }
                    await welcomeAutomationService.disableUserAI(remoteJid);
                    await aiFallbackService.registerPending(remoteJid, '[imageMessage]');
                    try { await aiFallbackService.sendAdminNotification(whatsapp.sock, remoteJid, '[Envió imagen]', msg.pushName); } catch (_) { }
                    try { analyticsService.trackOutgoing(); } catch (_) { }
                    // Image wasn't a payment — lead is still active, arm follow-up
                    try { await followUpService.startFollowUp(remoteJid); } catch (_) { }
                }
            } catch (imgErr) {
                console.error(`❌ Payment detection failed for ${remoteJid}: ${imgErr.message}`);
                // On error, fall through to media-only behavior
                if (whatsapp.sock) {
                    welcomeAutomationService.markBotSent(remoteJid);
                    await whatsapp.sock.sendMessage(remoteJid, { text: 'ok' });
                }
                await welcomeAutomationService.disableUserAI(remoteJid);
                await aiFallbackService.registerPending(remoteJid, '[imageMessage]');
                try { await aiFallbackService.sendAdminNotification(whatsapp.sock, remoteJid, '[Envió imagen]', msg.pushName); } catch (_) { }
                try { analyticsService.trackOutgoing(); } catch (_) { }
                // Payment detection failed — lead is still active, arm follow-up
                try { await followUpService.startFollowUp(remoteJid); } catch (_) { }
            }
            return;
        }
    }

    // === MEDIA-ONLY HANDLER (video, sticker, document without text) ===
    if (debouncer.texts.length === 0 && debouncer.audioMsgs.length === 0 && debouncer.mediaMsgs.length > 0) {
        const mediaMsg = debouncer.mediaMsgs[0];
        const msgContent = mediaMsg.message || {};
        const mediaType = Object.keys(msgContent).find(k => k !== 'messageContextInfo') || 'unknown';
        console.log(`📎 Media-only message received from ${remoteJid} (type: ${mediaType})`);

        // Track the media message
        try { await welcomeAutomationService.updateUserMessage(remoteJid, `[${mediaType}]`); } catch (_) { }
        try { analyticsService.trackIncoming(remoteJid); } catch (_) { }

        // Send "ok" and switch to manual mode
        if (whatsapp.sock) {
            welcomeAutomationService.markBotSent(remoteJid);
            await whatsapp.sock.sendMessage(remoteJid, { text: 'ok' });
            console.log(`📤 "ok" sent to ${remoteJid} (media → manual mode)`);
        }
        await welcomeAutomationService.disableUserAI(remoteJid);
        console.log(`🔒 AI disabled for ${remoteJid} (media message)`);
        await aiFallbackService.registerPending(remoteJid, `[${mediaType}]`);
        try {
            await aiFallbackService.sendAdminNotification(whatsapp.sock, remoteJid, `[Envió ${mediaType}]`, msg.pushName);
            console.log(`📢 Admin notified about media from ${remoteJid}`);
        } catch (_) { }
        try { analyticsService.trackOutgoing(); } catch (_) { }
        // Media-only (video/sticker/doc) — no sale, arm follow-up
        try { await followUpService.startFollowUp(remoteJid); } catch (_) { }
        return;
    }

    // === AUDIO TRANSCRIPTION & CONCATENATION ===
    let combinedText = debouncer.texts.join('\n').trim();
    if (debouncer.audioMsgs.length > 0) {
        const audioMsg = debouncer.audioMsgs[0];
        const automationsConfig = await aiAutomationsService.getConfig();
        if (automationsConfig.voiceProcessingEnabled) {
            console.log(`🎤 Audio message received from ${remoteJid} — transcribing...`);
            try { await welcomeAutomationService.updateUserMessage(remoteJid, '[audio]'); } catch (_) { }
            try { analyticsService.trackIncoming(remoteJid); } catch (_) { }

            try {
                const transcribedText = await audioTranscription.processAudioMessage(audioMsg);
                console.log(`🎤→📝 Audio transcribed from ${remoteJid}: "${transcribedText}"`);
                combinedText = (combinedText + '\n' + transcribedText).trim();
            } catch (audioErr) {
                console.error(`❌ Audio transcription failed for ${remoteJid}: ${audioErr.message}`);
                // If there's no other text, send error message
                if (whatsapp.sock && combinedText.length === 0) {
                    welcomeAutomationService.markBotSent(remoteJid);
                    await whatsapp.sock.sendMessage(remoteJid, {
                        text: 'No pude entender el audio, ¿podrías enviarlo nuevamente o escribir tu mensaje?'
                    });
                    try { analyticsService.trackOutgoing(); } catch (_) { }
                    return;
                }
            }
        } else {
            console.log(`🔇 Voice processing disabled — ignoring audio from ${remoteJid}`);
            return;
        }
    }

    // If we ended up with no text, skip AI processing
    if (!combinedText) {
        console.log(`⚠️ Grouped messages from ${remoteJid} have no extractable text`);
        return;
    }

    console.log(`📩 Processing grouped messages for ${remoteJid}: "${combinedText}"`);

    // Track the final concatenated text
    try { await welcomeAutomationService.updateUserMessage(remoteJid, combinedText); } catch (_) { }
    try { analyticsService.trackIncoming(remoteJid); } catch (_) { }

    // === EMAIL CAPTURE INTERCEPTOR ===
    // If this JID is waiting for an email after payment, intercept the message
    if (pendingEmailJids.has(remoteJid)) {
        const emailState = pendingEmailJids.get(remoteJid);
        const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
        const emailMatch = combinedText.match(emailRegex);

        if (emailMatch) {
            const email = emailMatch[0].toLowerCase();
            console.log(`📧 Email captured from ${remoteJid}: ${email}`);

            // Save email in course access service
            let record = null;
            try {
                record = await courseAccessService.saveEmail(remoteJid, email);
            } catch (emailErr) {
                console.error(`⚠️ [CourseAccess] Failed to save email: ${emailErr.message}`);
            }

            // Confirm to client
            if (whatsapp.sock) {
                welcomeAutomationService.markBotSent(remoteJid);
                await whatsapp.sock.sendMessage(remoteJid, {
                    text: `Listo, tu correo es ${email} 📧`
                });
                try {
                    const s1 = await chatHistoryService.addMessage(remoteJid, `Listo, tu correo es ${email} 📧`, true, undefined, 'bot');
                    io.emit('chat:message', { jid: remoteJid, message: s1 });
                } catch (_) { }

                await new Promise(r => setTimeout(r, 2000));

                let autoGranted = false;
                if (record) {
                    const plan = record.plan || await detectPlanFromHistory(remoteJid);
                    if (plan && !record.plan) {
                        await courseAccessService.updatePlan(record.id, plan);
                        record.plan = plan;
                    }
                }

                if (process.env.GOOGLE_DRIVE_AUTO_GRANT === 'true' && record && record.plan) {
                    try {
                        console.log(`🚀 [AutoGrant] Triggering auto-grant for record ${record.id} with plan "${record.plan}"`);
                        await accessManagerService.autoGrantAccess(record.id);
                        autoGranted = true;
                    } catch (grantErr) {
                        console.error(`❌ [AutoGrant] Auto-grant failed: ${grantErr.message}`);
                    }
                } else if (record && !record.plan) {
                    console.log(`⚠️ [AutoGrant] Skipping auto-grant for record ${record.id} because plan is not set.`);
                }

                if (!autoGranted) {
                    welcomeAutomationService.markBotSent(remoteJid);
                    await whatsapp.sock.sendMessage(remoteJid, {
                        text: 'En unos momentos te confirmo el acceso al curso 🙏'
                    });
                    try {
                        const s2 = await chatHistoryService.addMessage(remoteJid, 'En unos momentos te confirmo el acceso al curso 🙏', true, undefined, 'bot');
                        io.emit('chat:message', { jid: remoteJid, message: s2 });
                    } catch (_) { }
                }
            }

            // Clean up: remove from pending, disable AI
            pendingEmailJids.delete(remoteJid);
            await welcomeAutomationService.disableUserAI(remoteJid);
            console.log(`🔒 AI disabled for ${remoteJid} after email captured`);
            try { analyticsService.trackOutgoing(); } catch (_) { }
            return;
        } else {
            // Not an email — ask again (up to 3 attempts)
            emailState.attempts++;
            if (emailState.attempts >= 3) {
                console.log(`⚠️ [EmailCapture] Max attempts reached for ${remoteJid} — escalating to admin`);
                pendingEmailJids.delete(remoteJid);
                await welcomeAutomationService.disableUserAI(remoteJid);
                if (whatsapp.sock) {
                    welcomeAutomationService.markBotSent(remoteJid);
                    await whatsapp.sock.sendMessage(remoteJid, {
                        text: 'No te preocupes, un asesor te va a ayudar con el acceso en un momento'
                    });
                    try {
                        const s3 = await chatHistoryService.addMessage(remoteJid, 'No te preocupes, un asesor te va a ayudar con el acceso en un momento', true, undefined, 'bot');
                        io.emit('chat:message', { jid: remoteJid, message: s3 });
                    } catch (_) { }
                }
                try { analyticsService.trackOutgoing(); } catch (_) { }
                return;
            }

            // Ask for email again
            if (whatsapp.sock) {
                welcomeAutomationService.markBotSent(remoteJid);
                await whatsapp.sock.sendMessage(remoteJid, {
                    text: 'Necesito tu correo electrónico para darte acceso al curso, envíamelo por favor 📧'
                });
                try {
                    const s4 = await chatHistoryService.addMessage(remoteJid, 'Necesito tu correo electrónico para darte acceso al curso, envíamelo por favor 📧', true, undefined, 'bot');
                    io.emit('chat:message', { jid: remoteJid, message: s4 });
                } catch (_) { }
            }
            try { analyticsService.trackOutgoing(); } catch (_) { }
            return;
        }
    }

    // === FORCED FALLBACK TEST TRIGGER ===
    if (combinedText.trim().toLowerCase() === 'prueba_fallback') {
        console.log(`🧪 FORCED FALLBACK TEST triggered by ${remoteJid}`);
        await welcomeAutomationService.disableUserAI(remoteJid);
        console.log(`🔒 AI disabled for ${remoteJid}`);
        await aiFallbackService.registerPending(remoteJid, combinedText);
        try {
            await aiFallbackService.sendAdminNotification(whatsapp.sock, remoteJid, combinedText, msg.pushName);
            console.log(`📢 Admin notified about ${remoteJid}`);
        } catch (_) { }
        try { analyticsService.trackOutgoing(); } catch (_) { }
        return;
    }

    // === FETCH RECENT HISTORY ===
    let recentConvHistory = [];
    const preCheckState = await welcomeAutomationService.getUserState(remoteJid);
    const promoAlreadySent = !!(preCheckState?.promoVideoSent) || sentPromoJids.has(remoteJid);

    try {
        const conv = await chatHistoryService.getMessages(remoteJid);
        recentConvHistory = conv.messages.slice(-30);
    } catch (_) { }

    // Check if this client is in follow-up (active or paused) to offer discount pricing
    let isInFollowUp = false;
    try {
        const fuState = await followUpService.getState(remoteJid);
        if (fuState && fuState.status && fuState.status !== 'closed') {
            isInFollowUp = true;
            console.log(`🏷️ Client ${remoteJid} is in follow-up — discount pricing active`);
        }
    } catch (_) { }

    // Generate AI response
    const response = await aiResponseService.generateResponse(combinedText, recentConvHistory, { promoVideoAlreadySent: promoAlreadySent, isInFollowUp });
    console.log(`✅ AI response received: "${response}"`);

    // === ALL PROVIDERS EXHAUSTED CHECK ===
    if (response === '__ALL_PROVIDERS_EXHAUSTED__') {
        console.log(`🚨 All AI providers exhausted. Setting fallback state for ${remoteJid}`);
        try {
            await aiFallbackService.sendExhaustionNotification(
                whatsapp.sock, remoteJid, combinedText, msg.pushName
            );
            console.log(`📢 Admin notified about provider exhaustion for ${remoteJid}`);
        } catch (_) { }
        try { analyticsService.trackOutgoing(); } catch (_) { }
        // All providers exhausted — client still unattended, arm follow-up
        try { await followUpService.startFollowUp(remoteJid); } catch (_) { }
        return;
    }

    // === AI FALLBACK CHECK ===
    const isFallback = await aiFallbackService.isFallbackResponse(response);
    if (isFallback) {
        console.log(`⚠️ AI FALLBACK TRIGGERED for ${remoteJid}: "${response}"`);
        await welcomeAutomationService.disableUserAI(remoteJid);
        console.log(`🔒 AI disabled for ${remoteJid}`);
        await welcomeAutomationService.updateUserState(remoteJid);
        console.log(`⏱️ 24h cooldown activated for ${remoteJid}`);
        await aiFallbackService.registerPending(remoteJid, combinedText);
        try {
            await aiFallbackService.sendAdminNotification(whatsapp.sock, remoteJid, combinedText, msg.pushName);
            console.log(`📢 Admin notified about ${remoteJid}`);
        } catch (_) { }
        try { analyticsService.trackOutgoing(); } catch (_) { }
        // AI couldn't handle the question — lead is still active, arm follow-up
        try { await followUpService.startFollowUp(remoteJid); } catch (_) { }
        return;
    }

    // Send AI response in human-like format
    if (whatsapp.sock) {
        let finalResponse = response;
        let sendPromoVideo = false;
        if (finalResponse.includes('[VIDEO_PROMO]')) {
            const userState = await welcomeAutomationService.getUserState(remoteJid);
            if (!sentPromoJids.has(remoteJid) && !userState?.promoVideoSent) {
                sendPromoVideo = true;
                sentPromoJids.add(remoteJid);
            }
            finalResponse = finalResponse.replaceAll('[VIDEO_PROMO]', '').trim();
            if (sendPromoVideo && finalResponse.includes('|||')) {
                finalResponse = finalResponse.split('|||')[0].trim();
            }
        }

        const welcomeConfig = await welcomeAutomationService.getConfig();
        const delayMultiplier = welcomeConfig.responseDelay || 1.0;

        let enableTypingIndicator = true;
        try {
            const conv = await chatHistoryService.getMessages(remoteJid);
            const clientMsgCount = conv.messages.filter(m => !m.fromMe).length;
            if (clientMsgCount <= 2) {
                enableTypingIndicator = false;
                console.log(`🔔 [TypingIndicator] Disabled for ${remoteJid} (message ${clientMsgCount}/2 — owner will be notified)`);
            } else {
                console.log(`⌨️  [TypingIndicator] Enabled for ${remoteJid} (message ${clientMsgCount})`);
            }
        } catch (_) { }

        await humanResponse.sendHumanLike(
            whatsapp.sock,
            remoteJid,
            finalResponse,
            (jid) => welcomeAutomationService.markBotSent(jid),
            { isPostWelcomeFlow: welcomeWasSent, delayMultiplier, enableTypingIndicator }
        );
        try { analyticsService.trackOutgoing(); } catch (_) { }

        // === FOLLOW-UP: arm/re-arm after the bot replies ===
        // The business just spoke and the client hasn't answered this turn, so
        // (re)start the "no reply" silence timer from now. This is what makes
        // EVERY unanswered lead enter follow-up — not only the ones that got the
        // welcome. Won't revive a follow-up that was closed by a sale.
        try {
            await followUpService.startFollowUp(remoteJid);
        } catch (fuErr) {
            console.error(`⚠️ Follow-up re-arm error: ${fuErr.message}`);
        }

        // Send the promotional video if tagged
        if (sendPromoVideo) {
            console.log(`🎥 Sending promo video to ${remoteJid}...`);
            try {
                await new Promise(r => setTimeout(r, 3000));
                const promoPath = path.join(__dirname, '../public/uploads/promo.mp4');
                if (fs.existsSync(promoPath)) {
                    welcomeAutomationService.markBotSent(remoteJid);
                    await whatsapp.sock.sendMessage(remoteJid, {
                        video: fs.readFileSync(promoPath),
                        caption: "Mira bro un resumen de todo lo que trae este super pack 🔥👇",
                        mimetype: 'video/mp4'
                    });
                    try { await welcomeAutomationService.markPromoSent(remoteJid); } catch (_) { }
                    console.log(`✅ Promo video delivered to ${remoteJid}`);

                    // Follow-up: post-video messages
                    try {
                        const postVideoText = welcomeConfig.postVideoMessage || 'si tienes alguna duda me preguntas bro';
                        if (postVideoText.trim()) {
                            const pvParts = postVideoText.split('---MSG---').map(p => p.trim()).filter(p => p.length > 0);
                            const pvDelays = Array.isArray(welcomeConfig.postVideoDelays) ? welcomeConfig.postVideoDelays : [];
                            const DEFAULT_PV_DELAY = 3;

                            for (let pvi = 0; pvi < pvParts.length; pvi++) {
                                const delaySec = pvi === 0
                                    ? (pvDelays[0] !== undefined && pvDelays[0] !== null ? Number(pvDelays[0]) : DEFAULT_PV_DELAY)
                                    : (pvDelays[pvi] !== undefined && pvDelays[pvi] !== null ? Number(pvDelays[pvi]) : 2);
                                const delayMs = Math.max(0, Math.round(delaySec * 1000));
                                if (delayMs > 0) {
                                    await new Promise(r => setTimeout(r, delayMs));
                                }

                                welcomeAutomationService.markBotSent(remoteJid);
                                await whatsapp.sock.sendMessage(remoteJid, { text: pvParts[pvi] });
                                console.log(`💬 Post-video message ${pvi + 1}/${pvParts.length} sent to ${remoteJid} (delay: ${delaySec}s)`);
                                if (chatHistoryService && io) {
                                    try {
                                        const savedMsg = await chatHistoryService.addMessage(remoteJid, pvParts[pvi], true, 'System', 'bot');
                                        io.emit('chat:message', { jid: remoteJid, message: savedMsg });
                                    } catch (_) { }
                                }
                            }
                        }
                    } catch (followUpErr) {
                        console.error(`⚠️ Post-video follow-up failed: ${followUpErr.message}`);
                    }
                } else {
                    console.log(`⚠️ Promo video not found at ${promoPath}`);
                }
            } catch (err) {
                console.error(`❌ Error sending promo video to ${remoteJid}:`, err.message);
            }
        }
    }
    } catch (error) {
        console.error('❌ Error manejando mensaje entrante para IA:', error.message);
    }
}

// Catch-all: serve React app for any non-API route (enables React Router on refresh)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

module.exports = { app, server, io };
