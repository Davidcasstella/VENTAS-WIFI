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
        if (!media) {
            return res.status(404).json({ success: false, message: 'Media not found' });
        }

        const filePath = mediaStorageService.getFilePath(req.params.id);
        if (!filePath) {
            return res.status(404).json({ success: false, message: 'Media file not found on disk' });
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

module.exports = router;
