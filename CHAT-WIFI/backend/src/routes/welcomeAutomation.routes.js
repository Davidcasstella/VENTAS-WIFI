const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const welcomeService = require('../services/welcomeAutomation.service');
const { verifyToken } = require('../middleware/auth.middleware');

// All routes require authentication
router.use(verifyToken);

// ── Multer: store audio temp file in memory, validate .ogg ─────────────────
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadsDir = path.join(__dirname, '../../public/uploads');
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        // Always overwrite with the same name
        cb(null, 'welcome-audio-temp.ogg');
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
    fileFilter: (req, file, cb) => {
        const allowed = ['audio/ogg', 'audio/oga', 'application/ogg', 'audio/opus'];
        // Also allow by extension in case MIME is wrong
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(file.mimetype) || ext === '.ogg') {
            return cb(null, true);
        }
        cb(new Error('Solo se aceptan archivos .ogg'));
    }
});

// ── GET /api/welcome-automation/config ─────────────────────────────────────
router.get('/config', async (req, res) => {
    try {
        const config = await welcomeService.getConfig();
        res.json({ success: true, data: config });
    } catch (error) {
        console.error('Error fetching welcome config:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ── PUT /api/welcome-automation/config ─────────────────────────────────────
router.put('/config', async (req, res) => {
    try {
        const { isEnabled, messageText, cooldownHours } = req.body;
        const updated = await welcomeService.saveConfig({
            ...(isEnabled !== undefined && { isEnabled: Boolean(isEnabled) }),
            ...(messageText !== undefined && { messageText: String(messageText) }),
            ...(cooldownHours !== undefined && { cooldownHours: Number(cooldownHours) })
        });
        console.log(`⚙️ Welcome config updated: enabled=${updated.isEnabled}, cooldown=${updated.cooldownHours}h`);
        res.json({ success: true, data: updated });
    } catch (error) {
        console.error('Error updating welcome config:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ── POST /api/welcome-automation/reset-config ──────────────────────────────
// Reset all config to factory defaults
router.post('/reset-config', async (req, res) => {
    try {
        const config = await welcomeService.resetConfig();
        res.json({ success: true, data: config, message: 'Configuración reseteada a valores por defecto' });
    } catch (error) {
        console.error('Error resetting config:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ── POST /api/welcome-automation/audio  (upload .ogg) ──────────────────────
router.post('/audio', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No se recibió archivo de audio' });
        }
        const savedPath = await welcomeService.saveAudioFile(req.file.path);
        console.log(`🎙️ Welcome audio uploaded: ${savedPath}`);
        res.json({ success: true, message: 'Audio guardado correctamente', path: savedPath });
    } catch (error) {
        console.error('Error saving audio:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ── DELETE /api/welcome-automation/audio ───────────────────────────────────
router.delete('/audio', async (req, res) => {
    try {
        await welcomeService.deleteAudio();
        res.json({ success: true, message: 'Audio eliminado correctamente' });
    } catch (error) {
        console.error('Error deleting audio:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ── GET /api/welcome-automation/stats ──────────────────────────────────────
router.get('/stats', async (req, res) => {
    try {
        const stats = await welcomeService.getStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        console.error('Error fetching welcome stats:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ── GET /api/welcome-automation/users ──────────────────────────────────────
// Returns enriched user list for the dashboard
router.get('/users', async (req, res) => {
    try {
        const users = await welcomeService.getUsersForDashboard();
        res.json({ success: true, data: users });
    } catch (error) {
        console.error('Error fetching welcome users:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ── PUT /api/welcome-automation/users/:jid/ai ──────────────────────────────
// Toggle AI for a specific user
router.put('/users/:jid/ai', async (req, res) => {
    try {
        const jid = decodeURIComponent(req.params.jid);
        const { enabled } = req.body;
        if (enabled === undefined) {
            return res.status(400).json({ success: false, error: 'enabled es obligatorio' });
        }
        const state = await welcomeService.setUserAI(jid, enabled);
        res.json({ success: true, data: state });
    } catch (error) {
        console.error('Error toggling user AI:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ── PUT /api/welcome-automation/users/:jid/cooldown ────────────────────────
// Toggle cooldown for a specific user
router.put('/users/:jid/cooldown', async (req, res) => {
    try {
        const jid = decodeURIComponent(req.params.jid);
        const { enabled } = req.body;
        if (enabled === undefined) {
            return res.status(400).json({ success: false, error: 'enabled es obligatorio' });
        }
        const state = await welcomeService.setUserCooldown(jid, enabled);
        res.json({ success: true, data: state });
    } catch (error) {
        console.error('Error toggling user cooldown:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ── POST /api/welcome-automation/reset-user ────────────────────────────────
// Manually reset a JID welcome state (useful for testing)
router.post('/reset-user', async (req, res) => {
    try {
        const { jid } = req.body;
        if (!jid) return res.status(400).json({ success: false, error: 'jid es obligatorio' });
        await welcomeService.resetUserState(jid);
        res.json({ success: true, message: `Estado reseteado para ${jid}` });
    } catch (error) {
        console.error('Error resetting user state:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Handle multer errors
router.use((err, req, res, next) => {
    if (err.name === 'MulterError' || err.message) {
        return res.status(400).json({ success: false, error: err.message });
    }
    next(err);
});

module.exports = router;
