const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth.middleware');
const googleDriveService = require('../services/googleDrive.service');
const accessManagerService = require('../services/accessManager.service');
const cronRevokeService = require('../services/cronRevoke.service');

// All routes require authentication
router.use(verifyToken);

/**
 * GET /api/google-drive/status
 * Get Google Drive connection status and configuration
 */
router.get('/status', async (req, res) => {
    try {
        const status = await googleDriveService.getStatus();
        const cronStatus = cronRevokeService.getStatus();
        res.json({ success: true, ...status, cron: cronStatus });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/google-drive/folders
 * List all folders accessible by the Service Account
 */
router.get('/folders', async (req, res) => {
    try {
        const folders = await googleDriveService.listFolders();
        res.json({ success: true, folders });
    } catch (err) {
        console.error('❌ [GoogleDrive] GET /folders error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/google-drive/folders/:id/permissions
 * List permissions for a specific folder
 */
router.get('/folders/:id/permissions', async (req, res) => {
    try {
        const permissions = await googleDriveService.listPermissions(req.params.id);
        res.json({ success: true, permissions });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/google-drive/share
 * Share folder(s) with an email
 * Body: { folderId, email, role? }
 */
router.post('/share', async (req, res) => {
    try {
        const { folderId, email, role } = req.body;
        if (!folderId || !email) {
            return res.status(400).json({ success: false, error: 'folderId and email are required' });
        }
        const result = await googleDriveService.shareFolderWithEmail(
            folderId, email, role || 'reader'
        );
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('❌ [GoogleDrive] POST /share error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * DELETE /api/google-drive/share
 * Revoke access for an email from a folder
 * Body: { folderId, permissionId } OR { folderId, email }
 */
router.delete('/share', async (req, res) => {
    try {
        const { folderId, permissionId, email } = req.body;
        if (!folderId) {
            return res.status(400).json({ success: false, error: 'folderId is required' });
        }
        if (permissionId) {
            await googleDriveService.revokeAccess(folderId, permissionId);
        } else if (email) {
            await googleDriveService.revokeAccessByEmail(folderId, email);
        } else {
            return res.status(400).json({ success: false, error: 'permissionId or email is required' });
        }
        res.json({ success: true });
    } catch (err) {
        console.error('❌ [GoogleDrive] DELETE /share error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/google-drive/config
 * Get plan-folder configuration
 */
router.get('/config', async (req, res) => {
    try {
        const config = await accessManagerService.getPlanFolderConfig();
        res.json({ success: true, config });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * PUT /api/google-drive/config/plan-folders
 * Update plan-to-folder mapping
 * Body: { plan, folderIds }
 */
router.put('/config/plan-folders', async (req, res) => {
    try {
        const { plan, folderIds } = req.body;
        if (!plan || !Array.isArray(folderIds)) {
            return res.status(400).json({ success: false, error: 'plan and folderIds[] are required' });
        }
        await accessManagerService.setPlanFolders(plan, folderIds);
        const config = await accessManagerService.getPlanFolderConfig();
        res.json({ success: true, config });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/google-drive/activity
 * Get recent activity log
 */
router.get('/activity', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit || '50', 10);
        const log = await accessManagerService.getActivityLog(limit);
        res.json({ success: true, log });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/google-drive/cron/trigger
 * Manually trigger expiry check
 */
router.post('/cron/trigger', async (req, res) => {
    try {
        const result = await cronRevokeService.triggerCheck();
        res.json({ success: true, result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
