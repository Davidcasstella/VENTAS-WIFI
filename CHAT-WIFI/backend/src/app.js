const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
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
const blockedNumbersService = require('./services/blockedNumbers.service');
const analyticsService = require('./services/analyticsService');
const welcomeAutomationService = require('./services/welcomeAutomation.service');
const aiFallbackService = require('./services/aiFallback.service');
const { verifyToken } = require('./middleware/auth.middleware');

// ============================================================
// MASTER AI SWITCH — change at runtime via API or socket
// ============================================================
global.aiEnabled = true;

const app = express();
app.use(cors()); // Habilitar CORS para todas las rutas
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

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

// Escuchar eventos de WhatsApp y emitir vía Socket.io
whatsapp.on('status-update', (data) => {
    io.emit('whatsapp-update', data);
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

        const remoteJid = msg.key?.remoteJid || '';

        // === DETECT MANUAL INTERVENTION (fromMe = true, not sent by bot) ===
        if (msg.key.fromMe && m.type === 'notify') {
            // Check if this was sent by the bot (tracked via markBotSent)
            const wasBot = welcomeAutomationService.wasBotSent(remoteJid);
            if (!wasBot && remoteJid && !remoteJid.includes('@g.us')) {
                console.log(`✋ Manual intervention detected for ${remoteJid} — disabling AI for this chat`);
                try {
                    await welcomeAutomationService.disableUserAI(remoteJid);
                } catch (_) { }
            }
            return; // Don't process own messages further
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

        // === WELCOME 24H AUTOMATION (runs before AI, non-blocking) ===
        try { await welcomeAutomationService.runIfNeeded(whatsapp.sock, remoteJid); } catch (_) { }

        // === MASTER AI SWITCH CHECK ===
        if (!global.aiEnabled) {
            console.log('🔴 IA apagada — mensaje ignorado');
            // Still track the message even if AI is off
            if (!msg.key.fromMe && m.type === 'notify') {
                const text = msg.message?.conversation ||
                    msg.message?.extendedTextMessage?.text ||
                    msg.message?.imageMessage?.caption || '';
                try { await welcomeAutomationService.updateUserMessage(remoteJid, text); } catch (_) { }
            }
            return;
        }

        // Ignorar mensajes propios y mensajes que no sean notificaciones directas
        if (!msg.key.fromMe && m.type === 'notify') {
            // Extraer texto del mensaje
            const text = msg.message?.conversation ||
                msg.message?.extendedTextMessage?.text ||
                msg.message?.imageMessage?.caption;

            if (text && !remoteJid.includes('@g.us')) { // Evitar grupos por ahora para no spam
                console.log(`📩 Mensaje recibido de ${remoteJid}: ${text}`);

                // === TRACK USER MESSAGE (for dashboard display) ===
                try { await welcomeAutomationService.updateUserMessage(remoteJid, text); } catch (_) { }

                // === ANALYTICS TRACKING (secondary, non-blocking) ===
                try { analyticsService.trackIncoming(remoteJid); } catch (_) { }

                // === PAYMENT ACCOUNT INTERCEPTOR (before AI) ===
                // Detects when user asks for specific account/number to pay
                const textLower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const PAYMENT_ACCOUNT_PATTERNS = [
                    /a\s*que\s*numero\s*(consigno|pago|transfiero)/,
                    /cual\s*es\s*(la|el)\s*(cuenta|numero)/,
                    /me\s*pasas?\s*(el|tu|un)\s*numero/,
                    /donde\s*(consigno|pago|transfiero)/,
                    /numero\s*(para|de)\s*(pagar|pago|consignar|transferir)/,
                    /cual\s*es\s*(el\s*)?nequi/,
                    /cual\s*es\s*(el\s*|la\s*)?daviplata/,
                    /cuenta\s*(de\s*)?(nequi|daviplata)/,
                    /numero\s*(de\s*)?(nequi|daviplata)/,
                    /pasame\s*(el|la|tu)\s*(nequi|daviplata|cuenta|numero)/,
                    /datos?\s*(de|para)\s*(pago|consignar|transferir|transferencia)/,
                    /a\s*donde\s*(le\s*)?(consigno|pago)/,
                ];
                const isPaymentAccountQuery = PAYMENT_ACCOUNT_PATTERNS.some(p => p.test(textLower));
                if (isPaymentAccountQuery) {
                    const PAYMENT_FIXED_RESPONSE = `Métodos de pago\nNequi o Daviplata\n\n\nCuenta:\n3028599105`;
                    if (whatsapp.sock) {
                        welcomeAutomationService.markBotSent(remoteJid);
                        await whatsapp.sock.sendMessage(remoteJid, { text: PAYMENT_FIXED_RESPONSE });
                        console.log(`💳 Payment account info sent to ${remoteJid}`);
                        try { analyticsService.trackOutgoing(); } catch (_) { }
                    }
                    return;
                }

                // === PER-USER AI CHECK ===
                const userAIEnabled = await welcomeAutomationService.isAIEnabledForUser(remoteJid);
                if (!userAIEnabled) {
                    console.log(`🔇 AI disabled for user ${remoteJid} — skipping AI response`);
                    return;
                }

                // === FORCED FALLBACK TEST TRIGGER ===
                if (text.trim().toLowerCase() === 'prueba_fallback') {
                    console.log(`🧪 FORCED FALLBACK TEST triggered by ${remoteJid}`);
                    if (whatsapp.sock) {
                        welcomeAutomationService.markBotSent(remoteJid);
                        await whatsapp.sock.sendMessage(remoteJid, { text: 'ok' });
                        console.log(`📤 "ok" sent to ${remoteJid}`);
                    }
                    await welcomeAutomationService.disableUserAI(remoteJid);
                    console.log(`🔒 AI disabled for ${remoteJid}`);
                    await aiFallbackService.registerPending(remoteJid, text);
                    try {
                        await aiFallbackService.sendAdminNotification(whatsapp.sock, remoteJid, text, msg.pushName);
                        console.log(`📢 Admin notified about ${remoteJid}`);
                    } catch (_) { }
                    try { analyticsService.trackOutgoing(); } catch (_) { }
                    return;
                }

                // Generar respuesta con el proveedor activo
                const response = await aiResponseService.generateResponse(text);
                console.log(`✅ AI response received: "${response}"`);

                // === AI FALLBACK CHECK ===
                // If AI doesn't know the answer, send "ok", disable AI, notify admin
                const isFallback = await aiFallbackService.isFallbackResponse(response);
                if (isFallback) {
                    console.log(`⚠️ AI FALLBACK TRIGGERED for ${remoteJid}: "${response}"`);
                    if (whatsapp.sock) {
                        welcomeAutomationService.markBotSent(remoteJid);
                        await whatsapp.sock.sendMessage(remoteJid, { text: 'ok' });
                        console.log(`📤 "ok" sent to ${remoteJid}`);
                    }
                    // Disable AI for this chat
                    await welcomeAutomationService.disableUserAI(remoteJid);
                    console.log(`🔒 AI disabled for ${remoteJid}`);
                    // Register as pending
                    await aiFallbackService.registerPending(remoteJid, text);
                    // Notify admin via WhatsApp
                    try {
                        await aiFallbackService.sendAdminNotification(whatsapp.sock, remoteJid, text, msg.pushName);
                        console.log(`📢 Admin notified about ${remoteJid}`);
                    } catch (_) { }
                    try { analyticsService.trackOutgoing(); } catch (_) { }
                    return;
                }

                // Enviar respuesta
                if (whatsapp.sock) {
                    welcomeAutomationService.markBotSent(remoteJid);
                    await whatsapp.sock.sendMessage(remoteJid, { text: response });
                    console.log(`🤖 Respuesta enviada con IA: ${response}`);
                    // Track outgoing response for analytics
                    try { analyticsService.trackOutgoing(); } catch (_) { }
                }
            }
        }
    } catch (error) {
        console.error('❌ Error manejando mensaje entrante para IA:', error.message);
    }
});

module.exports = { app, server, io };
