const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { verifyToken } = require('../middleware/auth.middleware');
const followUpService = require('../services/followUp.service');

// ── Multer config ────────────────────────────────────────────────────
const TEMP_DIR = path.join(__dirname, '../../data/temp');
fs.ensureDirSync(TEMP_DIR);

const upload = multer({
    dest: TEMP_DIR,
    limits: { fileSize: 50 * 1024 * 1024 } // 50 MB
});

// All routes require authentication
router.use(verifyToken);

// ══════════════════════════════════════════════════════════════════════
// CONFIG ENDPOINTS
// ══════════════════════════════════════════════════════════════════════

// GET /api/follow-up/config — Get full configuration
router.get('/config', async (req, res) => {
    try {
        const config = await followUpService.getConfig();
        res.json({ success: true, config });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/follow-up/config — Update global settings (globalEnabled, stopOnReply)
router.put('/config', async (req, res) => {
    try {
        const { globalEnabled, stopOnReply } = req.body;
        const updates = {};
        if (globalEnabled !== undefined) updates.globalEnabled = globalEnabled;
        if (stopOnReply !== undefined) updates.stopOnReply = stopOnReply;
        const config = await followUpService.saveConfig(updates);
        res.json({ success: true, config });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ══════════════════════════════════════════════════════════════════════
// STEP CRUD ENDPOINTS
// ══════════════════════════════════════════════════════════════════════

// POST /api/follow-up/steps — Add a new step
router.post('/steps', async (req, res) => {
    try {
        const step = await followUpService.addStep(req.body);
        res.json({ success: true, step });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/follow-up/steps/:stepId — Update a step
router.put('/steps/:stepId', async (req, res) => {
    try {
        const { label, delayMinutes, enabled, text } = req.body;
        const updates = {};
        if (label !== undefined) updates.label = label;
        if (delayMinutes !== undefined) updates.delayMinutes = Number(delayMinutes);
        if (enabled !== undefined) updates.enabled = enabled;
        if (text !== undefined) updates.text = text;
        const step = await followUpService.updateStep(req.params.stepId, updates);
        res.json({ success: true, step });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// DELETE /api/follow-up/steps/:stepId — Delete a step
router.delete('/steps/:stepId', async (req, res) => {
    try {
        await followUpService.deleteStep(req.params.stepId);
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// ══════════════════════════════════════════════════════════════════════
// MEDIA UPLOAD/DELETE PER STEP
// ══════════════════════════════════════════════════════════════════════

// POST /api/follow-up/steps/:stepId/audio
router.post('/steps/:stepId/audio', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No audio file' });
        const dest = await followUpService.saveStepMedia(
            req.params.stepId, 'audio', req.file.path, req.file.originalname
        );
        res.json({ success: true, path: dest });
    } catch (err) {
        if (req.file?.path) fs.remove(req.file.path).catch(() => {});
        res.status(400).json({ error: err.message });
    }
});

// POST /api/follow-up/steps/:stepId/video
router.post('/steps/:stepId/video', upload.single('video'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No video file' });
        const dest = await followUpService.saveStepMedia(
            req.params.stepId, 'video', req.file.path, req.file.originalname
        );
        res.json({ success: true, path: dest });
    } catch (err) {
        if (req.file?.path) fs.remove(req.file.path).catch(() => {});
        res.status(400).json({ error: err.message });
    }
});

// POST /api/follow-up/steps/:stepId/image
router.post('/steps/:stepId/image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No image file' });
        const dest = await followUpService.saveStepMedia(
            req.params.stepId, 'image', req.file.path, req.file.originalname
        );
        res.json({ success: true, path: dest });
    } catch (err) {
        if (req.file?.path) fs.remove(req.file.path).catch(() => {});
        res.status(400).json({ error: err.message });
    }
});

// DELETE /api/follow-up/steps/:stepId/:mediaType (audio|video|image)
router.delete('/steps/:stepId/:mediaType', async (req, res) => {
    try {
        const { stepId, mediaType } = req.params;
        if (!['audio', 'video', 'image'].includes(mediaType)) {
            return res.status(400).json({ error: 'Invalid media type' });
        }
        await followUpService.deleteStepMedia(stepId, mediaType);
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// ══════════════════════════════════════════════════════════════════════
// STATE ENDPOINTS
// ══════════════════════════════════════════════════════════════════════

// GET /api/follow-up/states — Get active + paused follow-up states
router.get('/states', async (req, res) => {
    try {
        const states = await followUpService.getActiveStates();
        res.json({ success: true, states });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/follow-up/states/all — Full audit view (active, paused, closed)
router.get('/states/all', async (req, res) => {
    try {
        const raw = await followUpService.getAllStates();
        const states = Object.entries(raw).map(([jid, s]) => ({
            jid,
            displayName: jid.replace('@s.whatsapp.net', ''),
            status: s.status || (s.cancelled || s.completed ? 'closed' : 'active'),
            ...s
        })).sort((a, b) => new Date(b.updatedAt || b.startedAt || 0) - new Date(a.updatedAt || a.startedAt || 0));
        res.json({ success: true, states });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/follow-up/start/:jid — Start follow-up for a lead
router.post('/start/:jid', async (req, res) => {
    try {
        const jid = decodeURIComponent(req.params.jid);
        const started = await followUpService.startFollowUp(jid, { isManual: true, forceImmediate: true });
        res.json({ success: true, started });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST /api/follow-up/cancel/:jid — Cancel follow-up
router.post('/cancel/:jid', async (req, res) => {
    try {
        const jid = decodeURIComponent(req.params.jid);
        const cancelled = await followUpService.cancelFollowUp(jid, 'manual');
        res.json({ success: true, cancelled });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;
