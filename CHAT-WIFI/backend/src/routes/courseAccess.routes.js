const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const courseAccessService = require('../services/courseAccess.service');
const accessManagerService = require('../services/accessManager.service');

// All routes require authentication
router.use(verifyToken);

/**
 * GET /api/course-access
 * List all course access records + stats
 */
router.get('/', async (req, res) => {
    try {
        const [records, stats] = await Promise.all([
            courseAccessService.getAll(),
            courseAccessService.getStats(),
        ]);
        res.json({ success: true, records, stats });
    } catch (err) {
        console.error('❌ [CourseAccess] GET / error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/course-access
 * Manually create a new course access record
 */
router.post('/', async (req, res) => {
    try {
        const { phone, pushName, email, plan, status } = req.body;
        if (!email) {
            return res.status(400).json({ success: false, error: 'Email is required' });
        }
        const record = await courseAccessService.createManualAccess({ phone, pushName, email, plan, status });
        res.status(201).json({ success: true, record });
    } catch (err) {
        console.error('❌ [CourseAccess] POST / error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});


/**
 * PUT /api/course-access/:id/grant
 * Mark access as granted and share Google Drive folders
 */
router.put('/:id/grant', async (req, res) => {
    try {
        // Try to auto-grant with Google Drive
        try {
            const record = await accessManagerService.autoGrantAccess(req.params.id);
            if (record) return res.json({ success: true, record });
        } catch (driveErr) {
            console.warn(`⚠️ [CourseAccess] Drive auto-grant failed: ${driveErr.message}. Granting without Drive.`);
        }

        // Fallback: grant access without Drive
        const record = await courseAccessService.grantAccess(req.params.id);
        if (!record) return res.status(404).json({ success: false, error: 'Record not found' });
        res.json({ success: true, record });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * PUT /api/course-access/:id/deny
 * Mark access as denied and revoke Google Drive access
 */
router.put('/:id/deny', async (req, res) => {
    try {
        // Try to revoke Drive access first
        try {
            await accessManagerService.revokeAccess(req.params.id);
        } catch (driveErr) {
            console.warn(`⚠️ [CourseAccess] Drive revoke failed: ${driveErr.message}`);
        }

        const record = await courseAccessService.denyAccess(req.params.id);
        if (!record) return res.status(404).json({ success: false, error: 'Record not found' });
        res.json({ success: true, record });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * PUT /api/course-access/:id/plan
 * Update the plan for a record
 */
router.put('/:id/plan', async (req, res) => {
    try {
        const { plan } = req.body;
        if (!plan || !['combo-10', 'combo-15'].includes(plan)) {
            return res.status(400).json({ success: false, error: 'Plan must be combo-10 or combo-15' });
        }
        const record = await courseAccessService.updatePlan(req.params.id, plan);
        if (!record) return res.status(404).json({ success: false, error: 'Record not found' });
        res.json({ success: true, record });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * PUT /api/course-access/:id/notes
 * Update notes for a record
 */
router.put('/:id/notes', async (req, res) => {
    try {
        const { notes } = req.body;
        const record = await courseAccessService.updateNotes(req.params.id, notes || '');
        if (!record) return res.status(404).json({ success: false, error: 'Record not found' });
        res.json({ success: true, record });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * DELETE /api/course-access/:id
 * Delete a record
 */
router.delete('/:id', async (req, res) => {
    try {
        const deleted = await courseAccessService.deleteAccess(req.params.id);
        if (!deleted) return res.status(404).json({ success: false, error: 'Record not found' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
