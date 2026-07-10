const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const os = require('os');
const crypto = require('crypto');
const { verifyToken } = require('../middleware/auth.middleware');
const chatHistoryService = require('../services/chatHistory.service');
const mediaStorageService = require('../services/mediaStorage.service');
const whatsapp = require('../core/WhatsApp');
const welcomeAutomationService = require('../services/welcomeAutomation.service');
const followUpService = require('../services/followUp.service');
const sentTracker = require('../utils/sentTracker');

/**
 * Convert audio buffer (e.g. WebM/Opus) to OGG/Opus using ffmpeg.
 * WhatsApp voice notes require OGG container with Opus codec.
 * @param {Buffer} inputBuffer - Input audio data
 * @param {string} inputExt - Input file extension (e.g. 'webm')
 * @returns {Buffer} - Converted OGG/Opus audio
 */
function convertToOggOpus(inputBuffer, inputExt = 'webm') {
    const tmpId = crypto.randomBytes(6).toString('hex');
    const tmpDir = os.tmpdir();
    const inputFile = path.join(tmpDir, `audio_in_${tmpId}.${inputExt}`);
    const outputFile = path.join(tmpDir, `audio_out_${tmpId}.ogg`);

    try {
        // Write input to temp file
        fs.writeFileSync(inputFile, inputBuffer);

        // Convert: re-mux opus from webm to ogg container (no re-encoding needed)
        execFileSync(ffmpegPath, [
            '-y',                    // Overwrite output
            '-i', inputFile,         // Input
            '-c:a', 'libopus',       // Use opus codec
            '-b:a', '64k',           // Bitrate
            '-vn',                   // No video
            '-ar', '48000',          // Sample rate (opus standard)
            '-ac', '1',              // Mono (WhatsApp voice notes are mono)
            '-application', 'voip',  // Optimize for voice
            outputFile
        ], { timeout: 15000 });       // 15s timeout

        // Read the converted output
        const outputBuffer = fs.readFileSync(outputFile);
        console.log(`🔄 Audio converted: ${inputExt} (${(inputBuffer.length/1024).toFixed(1)}KB) → ogg (${(outputBuffer.length/1024).toFixed(1)}KB)`);
        return outputBuffer;
    } finally {
        // Cleanup temp files
        try { fs.unlinkSync(inputFile); } catch (_) {}
        try { fs.unlinkSync(outputFile); } catch (_) {}
    }
}

// Multer config: store in memory for processing before saving to mediaStorage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 64 * 1024 * 1024 }, // 64 MB max
    fileFilter: (req, file, cb) => {
        const allowed = /^(image|audio|video)\//;
        if (allowed.test(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only image, audio, and video files are allowed'));
        }
    }
});

/**
 * GET /api/chat/media/:id
 * Serves a stored media file by its ID.
 * Public route — browser <img>, <audio>, <video> tags cannot send JWT headers.
 */
router.get('/media/:id', async (req, res) => {
    try {
        const media = mediaStorageService.getMedia(req.params.id);
        const filePath = media ? mediaStorageService.getFilePath(req.params.id) : null;

        if (!media || !filePath) {
            // Return placeholder SVG with status 200 so browser console doesn't show 404 Not Found
            const svgPlaceholder = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120" fill="none">
                <rect width="160" height="120" rx="8" fill="#1f2937"/>
                <path d="M80 44C75.58 44 72 47.58 72 52V60C72 64.42 75.58 68 80 68C84.42 68 88 64.42 88 60V52C88 47.58 84.42 44 80 44Z" fill="#6b7280"/>
                <text x="80" y="88" fill="#9ca3af" font-family="system-ui, sans-serif" font-size="11" text-anchor="middle">Media caducada</text>
            </svg>`;
            res.set('Content-Type', 'image/svg+xml');
            res.set('Cache-Control', 'public, max-age=3600');
            return res.status(200).send(svgPlaceholder);
        }

        // Normalize audio MIME — strip codec suffix so browser can play OGG files
        let contentType = media.mimetype || 'application/octet-stream';
        if (media.type === 'audio') {
            // WhatsApp may store 'audio/ogg; codecs=opus' — browsers prefer plain 'audio/ogg'
            contentType = 'audio/ogg';
        }

        res.set('Content-Type', contentType);
        res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24h
        res.set('Accept-Ranges', 'bytes');                 // Allow seeking in audio/video
        res.set('Access-Control-Allow-Origin', '*');        // Allow cross-origin audio load
        res.sendFile(filePath);
    } catch (error) {
        console.error('Error serving media:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});


/**
 * GET /api/chat/profile-pic/:jid
 * Returns the WhatsApp profile picture URL for a given JID.
 * Public route — browser <img> tags cannot send JWT headers.
 * Uses an in-memory cache (5 min TTL) to avoid spamming the WA API.
 */
const profilePicCache = new Map(); // jid -> { url, fetchedAt }
const PROFILE_PIC_TTL = 5 * 60 * 1000; // 5 minutes

router.get('/profile-pic/:jid', async (req, res) => {
    try {
        const jid = decodeURIComponent(req.params.jid);

        // Check cache first
        const cached = profilePicCache.get(jid);
        if (cached && (Date.now() - cached.fetchedAt) < PROFILE_PIC_TTL) {
            return res.json({ success: true, url: cached.url });
        }

        if (!whatsapp.sock) {
            return res.json({ success: true, url: null });
        }

        let url = null;
        try {
            // 'image' = full resolution, 'preview' = thumbnail
            url = await whatsapp.sock.profilePictureUrl(jid, 'image');
        } catch (err) {
            // User has no profile picture or privacy settings prevent access
            // Error code 401 or 404 means "no picture" — this is normal
            url = null;
        }

        // Cache the result (even null, to avoid re-fetching)
        profilePicCache.set(jid, { url, fetchedAt: Date.now() });

        res.json({ success: true, url });
    } catch (error) {
        console.error('Error fetching profile pic:', error);
        res.json({ success: true, url: null }); // Graceful fallback
    }
});


// All routes below require authentication
router.use(verifyToken);

/**
 * GET /api/chat/conversations
 * Returns all conversations sorted by most recent message.
 */
router.get('/conversations', async (req, res) => {
    try {
        const conversations = await chatHistoryService.getConversations();
        res.json({ success: true, data: conversations });
    } catch (error) {
        console.error('Error fetching conversations:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/chat/messages/:jid
 * Returns message history for a specific conversation.
 */
router.get('/messages/:jid', async (req, res) => {
    try {
        const jid = decodeURIComponent(req.params.jid);
        const conversation = await chatHistoryService.getMessages(jid);
        // Mark as read when admin views the conversation
        await chatHistoryService.markAsRead(jid);
        res.json({ success: true, data: conversation });
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/chat/send
 * Sends a manual reply from the admin to a client via WhatsApp.
 * Body: { jid: string, text: string }
 */
router.post('/send', async (req, res) => {
    try {
        const { jid: inputJid, text } = req.body;
        if (!inputJid || !text) {
            return res.status(400).json({ success: false, message: 'jid and text are required' });
        }

        // Normalize JID: strip device suffix (e.g. "573028599105:42@s.whatsapp.net" → "573028599105@s.whatsapp.net")
        const jid = inputJid.replace(/:\d+@/, '@');

        if (!whatsapp.sock) {
            return res.status(503).json({ success: false, message: 'WhatsApp not connected' });
        }

        // Disable AI for this chat since an agent took over manually via the dashboard
        await welcomeAutomationService.disableUserAI(jid);

        // Send via WhatsApp
        await whatsapp.sock.sendMessage(jid, { text });

        // Store in chat history with sender='agent'
        const message = await chatHistoryService.addMessage(jid, text, true, undefined, 'agent');
        sentTracker.markSent(jid);

        // The business just spoke from the dashboard → re-arm the follow-up
        // silence timer (unless the follow-up was closed by a sale).
        try { await followUpService.startFollowUp(jid); } catch (_) { }

        // Emit Socket.io event for real-time update
        const io = req.app.get('io');
        if (io) {
            io.emit('chat:message', { jid, message });
        }

        console.log(`💬 Admin sent manual reply to ${jid}: "${text.substring(0, 50)}..."`);
        res.json({ success: true, data: message });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/chat/send-media
 * Sends a media file (image, audio, video) from the admin dashboard to a client via WhatsApp.
 * Form data: jid (string), file (multipart), caption (optional string)
 */
router.post('/send-media', upload.single('file'), async (req, res) => {
    try {
        const { jid: inputJid, caption } = req.body;
        const file = req.file;

        if (!inputJid || !file) {
            return res.status(400).json({ success: false, message: 'jid and file are required' });
        }

        const jid = inputJid.replace(/:\d+@/, '@');

        if (!whatsapp.sock) {
            return res.status(503).json({ success: false, message: 'WhatsApp not connected' });
        }

        // Disable AI for this chat
        await welcomeAutomationService.disableUserAI(jid);

        // Determine media type from mimetype
        let mediaType = 'image';
        if (file.mimetype.startsWith('audio/')) mediaType = 'audio';
        else if (file.mimetype.startsWith('video/')) mediaType = 'video';

        // Save to local storage
        const saved = mediaStorageService.saveMedia(jid, file.buffer, mediaType, file.mimetype, null, file.originalname);

        // Build WhatsApp message payload
        let waPayload = {};
        if (mediaType === 'image') {
            waPayload = { image: file.buffer, caption: caption || undefined, mimetype: file.mimetype };
        } else if (mediaType === 'audio') {
            // WhatsApp voice notes require OGG container with Opus codec.
            // Browser recordings arrive as audio/webm — convert to OGG using ffmpeg.
            let audioBuffer = file.buffer;
            if (!file.mimetype.includes('ogg')) {
                try {
                    const ext = file.mimetype.includes('webm') ? 'webm' : 'mp3';
                    audioBuffer = convertToOggOpus(file.buffer, ext);
                } catch (convErr) {
                    console.error('⚠️ FFmpeg conversion failed:', convErr.message);
                    // Fall back to sending raw buffer — may not play on WhatsApp
                }
            }
            waPayload = {
                audio: audioBuffer,
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true
            };
        } else if (mediaType === 'video') {
            waPayload = { video: file.buffer, caption: caption || undefined, mimetype: file.mimetype };
        }



        // Send via WhatsApp
        console.log(`📤 Sending ${mediaType} to ${jid} | mime: ${waPayload.mimetype || file.mimetype} | size: ${file.buffer.length} bytes | ptt: ${waPayload.ptt || false}`);
        const sendResult = await whatsapp.sock.sendMessage(jid, waPayload);
        console.log(`✅ sendMessage result:`, sendResult?.key ? `msgId=${sendResult.key.id}` : 'no key returned');


        // Save to chat history with media reference
        const displayText = caption || `[${mediaType}]`;
        const message = await chatHistoryService.addMessage(jid, displayText, true, undefined, 'agent', {
            mediaId: saved.id,
            mediaType
        });
        sentTracker.markSent(jid);

        // Business spoke from the dashboard (media) → re-arm follow-up timer.
        try { await followUpService.startFollowUp(jid); } catch (_) { }

        // Emit real-time update
        const io = req.app.get('io');
        if (io) {
            io.emit('chat:message', { jid, message });
        }

        console.log(`📤 Admin sent ${mediaType} to ${jid} (${(file.size / 1024).toFixed(1)} KB)`);
        res.json({ success: true, data: message });
    } catch (error) {
        console.error('Error sending media:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});


/**
 * POST /api/chat/mark-read/:jid
 * Marks all messages in a conversation as read.
 */

router.post('/mark-read/:jid', async (req, res) => {
    try {
        const jid = decodeURIComponent(req.params.jid);
        await chatHistoryService.markAsRead(jid);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * DELETE /api/chat/:jid
 * Deletes a conversation from the history.
 */
router.delete('/:jid', async (req, res) => {
    try {
        const jid = decodeURIComponent(req.params.jid);
        const deleted = await chatHistoryService.deleteConversation(jid);
        if (deleted) {
            res.json({ success: true, message: 'Conversación eliminada' });
        } else {
            res.status(404).json({ success: false, message: 'Conversación no encontrada' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Manual Access Panel endpoints
// These allow the admin to manually trigger the same flow that runs automatically
// after payment detection. The key shared point is accessManagerService.autoGrantAccess()
// ─────────────────────────────────────────────────────────────────────────────

const courseAccessService = require('../services/courseAccess.service');
const accessManagerService = require('../services/accessManager.service');

/**
 * GET /api/chat/access-info/:jid
 * Returns the latest course access record for a JID.
 * Used by the chat panel to show the saved email and access status.
 */
router.get('/access-info/:jid', verifyToken, async (req, res) => {
    try {
        const jid = decodeURIComponent(req.params.jid);
        const record = await courseAccessService.getLatestByJid(jid);
        const driveConfig = await accessManagerService.getPlanFolderConfig();
        const planFolders = driveConfig.planFolders || {};
        res.json({ success: true, record: record || null, planFolders });
    } catch (error) {
        console.error('❌ [ManualAccess] GET /access-info error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/chat/grant-access
 * Manually grant Drive access and send welcome messages to a client.
 * Reutilizes the SAME accessManagerService.autoGrantAccess() that runs automatically.
 *
 * Body: { jid, email, plan?, force? }
 *   - jid:   WhatsApp JID of the contact
 *   - email: Client email to share Drive with
 *   - plan:  Optional plan (combo-10 or combo-15). Defaults to env default folder.
 *   - force: If true, replaces the existing email on the record
 */
router.post('/grant-access', verifyToken, async (req, res) => {
    try {
        const { jid, email, plan, force } = req.body;
        console.log(`➡️ [ManualAccess] POST /grant-access requested for ${jid} | email: "${email}" | force: ${force}`);

        // Validate inputs
        if (!jid) return res.status(400).json({ success: false, error: 'El JID es requerido' });
        if (!email) return res.status(400).json({ success: false, error: 'El correo es requerido' });

        const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
        if (!emailRegex.test(email.trim())) {
            return res.status(400).json({ success: false, error: 'El formato del correo no es válido' });
        }

        const cleanEmail = email.trim().toLowerCase();

        // Check for existing record
        let record = await courseAccessService.getLatestByJid(jid);

        if (record) {
            // Record exists — check for email conflict
            if (record.email && record.email !== cleanEmail && !force) {
                return res.status(409).json({
                    success: false,
                    conflict: true,
                    existingEmail: record.email,
                    error: `Este contacto ya tiene el correo ${record.email} registrado. Usa force=true para reemplazarlo.`
                });
            }

            // Update email if it changed or was empty
            if (record.email !== cleanEmail) {
                record = await courseAccessService.updateEmail(record.id, cleanEmail);
            }

            // Update plan if provided and different
            if (plan && plan !== record.plan) {
                record = await courseAccessService.updatePlan(record.id, plan);
            }
        } else {
            // No existing record — create one
            const pushName = jid.replace(/@.*$/, '');
            record = await courseAccessService.createManualAccess({
                phone: jid.replace(/@s\.whatsapp\.net$/, ''),
                pushName,
                email: cleanEmail,
                plan: plan || '',
                status: 'pending_access'
            });
        }

        if (!record) {
            return res.status(500).json({ success: false, error: 'No se pudo crear o encontrar el registro de acceso' });
        }

        // ── CORE: call the SAME autoGrantAccess used by the automatic flow ──
        // This shares Drive folders + sends WhatsApp confirmation messages
        try {
            const updatedRecord = await accessManagerService.autoGrantAccess(record.id);
            console.log(`✅ [ManualAccess] Access granted for ${jid} (${cleanEmail}) via chat panel`);
            return res.json({ success: true, record: updatedRecord });
        } catch (grantErr) {
            // Provide meaningful error messages for common Drive errors
            let userMessage = 'No fue posible compartir la carpeta en Google Drive';
            if (grantErr.message?.includes('No folders configured') || grantErr.message?.includes('no default folder')) {
                userMessage = 'No hay carpeta de Drive configurada para este plan. Configúrala en Ajustes → Google Drive.';
            } else if (grantErr.message?.includes('not found') || grantErr.message?.includes('404')) {
                userMessage = 'La carpeta de Google Drive no fue encontrada. Verifica el ID en la configuración.';
            } else if (grantErr.message?.includes('invalid') || grantErr.message?.includes('400')) {
                userMessage = 'El correo electrónico fue rechazado por Google Drive. Verifica que sea una cuenta de Google válida.';
            } else if (grantErr.message?.includes('not initialized') || grantErr.message?.includes('credentials')) {
                userMessage = 'Google Drive no está configurado. Verifica las credenciales del servidor.';
            }

            console.error(`❌ [ManualAccess] autoGrantAccess failed for ${jid}: ${grantErr.message}`);
            return res.status(502).json({ success: false, error: userMessage, detail: grantErr.message });
        }

    } catch (error) {
        console.error('❌ [ManualAccess] POST /grant-access error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/chat/resend-access
 * Resend only the WhatsApp welcome messages WITHOUT re-sharing the Drive folder.
 * For clients who say "I didn't receive it" or "I deleted the message".
 *
 * Body: { jid }
 */
router.post('/resend-access', verifyToken, async (req, res) => {
    try {
        const { jid } = req.body;
        if (!jid) return res.status(400).json({ success: false, error: 'El JID es requerido' });

        const record = await courseAccessService.getLatestByJid(jid);
        if (!record || !record.email) {
            return res.status(404).json({
                success: false,
                error: 'Este contacto no tiene un correo de acceso registrado'
            });
        }

        // Get the WhatsApp socket from the whatsapp core module
        const whatsapp = require('../core/WhatsApp');
        if (!whatsapp.sock) {
            return res.status(503).json({ success: false, error: 'WhatsApp no está conectado' });
        }

        // Build the confirmation message with stored Drive links (same as autoGrantAccess)
        const chatHistoryService = require('../services/chatHistory.service');
        const welcomeAutomationService = require('../services/welcomeAutomation.service');
        const io = req.app.get('io');

        const drivePerms = (record.drivePermissions || []).filter(p => !p.revokedAt);
        let linksText = '';
        if (drivePerms.length > 0) {
            linksText = '\n\n📂 Enlaces de acceso directo:\n' +
                drivePerms.map(p => `• *${p.folderName}*:\n${p.webViewLink || 'https://drive.google.com'}`).join('\n\n');
        }

        const msgText = `🎉 ¡Listo! Ya te he dado acceso a las carpetas del curso en tu Google Drive. Revisa tu correo (bandeja de entrada o spam) para acceder al material. ¡Que lo disfrutes! 🚀${linksText}`;

        welcomeAutomationService.markBotSent(jid);
        await whatsapp.sock.sendMessage(jid, { text: msgText });

        try {
            const savedMsg = await chatHistoryService.addMessage(jid, msgText, true, undefined, 'bot');
            if (io) io.emit('chat:message', { jid, message: savedMsg });
        } catch (_) { /* non-critical */ }

        console.log(`🔄 [ManualAccess] Access messages resent to ${jid} (${record.email})`);
        res.json({ success: true, record });

    } catch (error) {
        console.error('❌ [ManualAccess] POST /resend-access error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

