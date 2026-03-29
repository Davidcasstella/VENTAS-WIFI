const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const chatHistoryService = require('../services/chatHistory.service');
const whatsapp = require('../core/WhatsApp');
const welcomeAutomationService = require('../services/welcomeAutomation.service');

// All routes require authentication
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
        const { jid, text } = req.body;
        if (!jid || !text) {
            return res.status(400).json({ success: false, message: 'jid and text are required' });
        }

        if (!whatsapp.sock) {
            return res.status(503).json({ success: false, message: 'WhatsApp not connected' });
        }

        // Mark as bot-sent to avoid triggering manual intervention detection
        welcomeAutomationService.markBotSent(jid);

        // Send via WhatsApp
        await whatsapp.sock.sendMessage(jid, { text });

        // Store in chat history
        const message = await chatHistoryService.addMessage(jid, text, true);

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

module.exports = router;
