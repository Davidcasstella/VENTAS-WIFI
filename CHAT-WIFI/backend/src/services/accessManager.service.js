const googleDriveService = require('./googleDrive.service');
const courseAccessService = require('./courseAccess.service');
const dynamo = require('./dynamoStore');

/**
 * AccessManagerService
 *
 * Orchestrates the business logic between course-access records
 * and Google Drive permissions. Handles automatic granting,
 * manual assignment, revocation, and expiry checks.
 */
class AccessManagerService {

    constructor() {
        this._io = null;
        this._sock = null;
    }

    setIo(io) {
        this._io = io;
    }

    setSock(sock) {
        this._sock = sock;
    }

    // ── Configuration helpers ──────────────────────────────────

    _getConfig() {
        return {
            autoGrant: process.env.GOOGLE_DRIVE_AUTO_GRANT === 'true',
            defaultFolderId: process.env.GOOGLE_DRIVE_DEFAULT_FOLDER_ID || '',
            defaultRole: process.env.GOOGLE_DRIVE_DEFAULT_ROLE || 'reader',
            expiryDays: parseInt(process.env.GOOGLE_DRIVE_ACCESS_EXPIRY_DAYS || '0', 10),
            adminEmail: process.env.GOOGLE_DRIVE_ADMIN_EMAIL || '',
        };
    }

    /**
     * Get plan-folder mappings from the config file.
     * Stored in knowledge-base/drive-config.json
     */
    async _getPlanFolders() {
        const fs = require('fs-extra');
        const path = require('path');
        const configPath = path.join(__dirname, '../../knowledge-base/drive-config.json');

        if (dynamo.isEnabled()) {
            try {
                const data = await dynamo.getItem('CONFIG', 'drive-config');
                if (data) return data;
                // Migrate from local
                const local = await fs.readJson(configPath).catch(() => ({ planFolders: {}, activityLog: [] }));
                await dynamo.putItem('CONFIG', 'drive-config', local);
                return local;
            } catch (err) {
                console.error(`❌ [AccessManager] DynamoDB read failed: ${err.message}`);
            }
        }

        try {
            await fs.ensureFile(configPath);
            const raw = await fs.readFile(configPath, 'utf-8');
            const trimmed = raw.trim();
            if (!trimmed) return { planFolders: {}, activityLog: [] };
            return JSON.parse(trimmed);
        } catch {
            return { planFolders: {}, activityLog: [] };
        }
    }

    async _savePlanFolders(config) {
        const fs = require('fs-extra');
        const path = require('path');
        const configPath = path.join(__dirname, '../../knowledge-base/drive-config.json');

        if (dynamo.isEnabled()) {
            try {
                await dynamo.putItem('CONFIG', 'drive-config', config);
            } catch (err) {
                console.error(`❌ [AccessManager] DynamoDB write failed: ${err.message}`);
            }
        }

        await fs.writeJson(configPath, config, { spaces: 2 });
    }

    // ── Access Granting ────────────────────────────────────────

    /**
     * Auto-grant access after payment approval.
     * Determines which folders to share based on the record's plan.
     * @param {string} recordId
     * @returns {object} updated record
     */
    async autoGrantAccess(recordId) {
        const records = await courseAccessService.getAll();
        const record = records.find(r => r.id === recordId);
        if (!record) throw new Error('Record not found');

        if (!record.email) {
            throw new Error('Cannot grant access: no email on record');
        }

        const config = this._getConfig();
        const driveConfig = await this._getPlanFolders();
        const planMapping = driveConfig.planFolders || {};

        // Determine which folders to share
        let folderIds = [];

        // 1. Check plan-specific folders
        if (record.plan && planMapping[record.plan]) {
            const planFolders = planMapping[record.plan];
            folderIds = Array.isArray(planFolders)
                ? planFolders.map(f => typeof f === 'string' ? f : f.folderId)
                : [planFolders];
        }

        // 2. Fallback to default folder
        if (folderIds.length === 0 && config.defaultFolderId) {
            folderIds = [config.defaultFolderId];
        }

        if (folderIds.length === 0) {
            console.warn(`⚠️ [AccessManager] No folders configured for plan "${record.plan}" and no default folder set`);
            // Still grant the record status but skip Drive sharing
            await courseAccessService.grantAccess(recordId);
            return await this._getRecord(recordId);
        }

        // Share each folder
        const drivePermissions = [];
        for (const folderId of folderIds) {
            try {
                console.log(`⏳ [AccessManager] Sharing folder ${folderId} with ${record.email}...`);
                const result = await googleDriveService.shareFolderWithEmail(
                    folderId,
                    record.email,
                    config.defaultRole
                );

                let folderName = folderId;
                let folderLink = '';
                try {
                    const infoPromise = googleDriveService.getFolderInfo(folderId);
                    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 6000));
                    const info = await Promise.race([infoPromise, timeoutPromise]);
                    folderName = info.name || folderId;
                    folderLink = info.webViewLink || '';
                } catch { }

                drivePermissions.push({
                    folderId,
                    permissionId: result.permissionId,
                    folderName,
                    role: result.role,
                    sharedAt: new Date().toISOString(),
                    webViewLink: folderLink
                });

                console.log(`✅ [AccessManager] Shared "${folderName}" with ${record.email}`);
            } catch (err) {
                console.error(`❌ [AccessManager] Failed to share folder ${folderId} with ${record.email}: ${err.message}`);
            }
        }

        if (folderIds.length > 0 && drivePermissions.length === 0) {
            throw new Error(`No fue posible compartir la carpeta de Google Drive con ${record.email}. Verifica que el servicio de Drive esté conectado y que el correo sea válido.`);
        }

        // Update the record with Drive permissions
        await courseAccessService.grantAccess(recordId);
        await courseAccessService.updateDrivePermissions(recordId, drivePermissions, config.expiryDays);

        // Log activity
        await this._logActivity(recordId, 'shared', record.email, drivePermissions);

        // Send WhatsApp confirmation with links to client
        if (this._sock && record.jid) {
            try {
                let linksText = '';
                const activePerms = drivePermissions.filter(p => !p.revokedAt);
                if (activePerms.length > 0) {
                    linksText = '\n\n📂 Enlaces de acceso directo:\n' + 
                        activePerms.map(p => `• *${p.folderName}*:\n${p.webViewLink || 'https://drive.google.com'}`).join('\n\n');
                }

                const msgText = `🎉 ¡Listo! Ya te he dado acceso a las carpetas del curso en tu Google Drive. Revisa tu correo (bandeja de entrada o spam) para acceder al material. ¡Que lo disfrutes! 🚀${linksText}`;
                
                const welcomeAutomationService = require('./welcomeAutomation.service');
                welcomeAutomationService.markBotSent(record.jid);

                await this._sock.sendMessage(record.jid, { text: msgText });
                
                const chatHistoryService = require('./chatHistory.service');
                const s = await chatHistoryService.addMessage(record.jid, msgText, true, undefined, 'bot');
                
                if (this._io) {
                    this._io.emit('chat:message', { jid: record.jid, message: s });
                }
            } catch (msgErr) {
                console.error(`⚠️ [AccessManager] Failed to send WhatsApp notification to ${record.jid}:`, msgErr.message);
            }
        }

        // Notify dashboard
        if (this._io) {
            this._io.emit('gdrive:access-granted', { recordId, email: record.email, folders: drivePermissions.length });
        }

        return await this._getRecord(recordId);
    }

    /**
     * Manually grant access with specific folder IDs.
     * @param {string} recordId
     * @param {string[]} folderIds - Specific folders to share
     * @param {string} role - Permission role
     * @returns {object} updated record
     */
    async manualGrantAccess(recordId, folderIds, role = 'reader') {
        const records = await courseAccessService.getAll();
        const record = records.find(r => r.id === recordId);
        if (!record) throw new Error('Record not found');
        if (!record.email) throw new Error('Cannot grant access: no email on record');

        const drivePermissions = [];
        for (const folderId of folderIds) {
            try {
                const result = await googleDriveService.shareFolderWithEmail(
                    folderId,
                    record.email,
                    role
                );

                let folderName = folderId;
                try {
                    const info = await googleDriveService.getFolderInfo(folderId);
                    folderName = info.name || folderId;
                } catch { }

                drivePermissions.push({
                    folderId,
                    permissionId: result.permissionId,
                    folderName,
                    role: result.role,
                    sharedAt: new Date().toISOString(),
                });
            } catch (err) {
                console.error(`❌ [AccessManager] Failed to share folder ${folderId}: ${err.message}`);
            }
        }

        const config = this._getConfig();
        await courseAccessService.grantAccess(recordId);
        await courseAccessService.updateDrivePermissions(recordId, drivePermissions, config.expiryDays);
        await this._logActivity(recordId, 'shared', record.email, drivePermissions);

        return await this._getRecord(recordId);
    }

    // ── Access Revocation ──────────────────────────────────────

    /**
     * Revoke all Google Drive access for a record.
     * @param {string} recordId
     * @returns {object} updated record
     */
    async revokeAccess(recordId) {
        const records = await courseAccessService.getAll();
        const record = records.find(r => r.id === recordId);
        if (!record) throw new Error('Record not found');

        const drivePerms = record.drivePermissions || [];
        let revokedCount = 0;
        const email = record.email;

        // 1. Revoke using stored permission IDs
        for (const perm of drivePerms) {
            if (perm.revokedAt) continue; // Already revoked

            try {
                await googleDriveService.revokeAccess(perm.folderId, perm.permissionId);
                perm.revokedAt = new Date().toISOString();
                revokedCount++;
                console.log(`🗑️ [AccessManager] Revoked access to "${perm.folderName}" for ${email}`);
            } catch (err) {
                console.error(`❌ [AccessManager] Failed to revoke ${perm.permissionId}: ${err.message}`);
                // Mark as revoked anyway (permission might have been deleted externally)
                perm.revokedAt = new Date().toISOString();
            }
        }

        // 2. Fallback: Search and revoke by email across all potential folders
        if (email) {
            const folderIds = new Set();
            
            // Add folders from drivePermissions
            drivePerms.forEach(p => folderIds.add(p.folderId));
            
            // Add folders from plan configurations
            try {
                const driveConfig = await this._getPlanFolders();
                const planMapping = driveConfig.planFolders || {};
                Object.values(planMapping).forEach(folders => {
                    if (Array.isArray(folders)) {
                        folders.forEach(f => folderIds.add(typeof f === 'string' ? f : f.folderId));
                    } else if (folders) {
                        folderIds.add(typeof folders === 'string' ? folders : folders.folderId);
                    }
                });
            } catch (err) {
                console.error('⚠️ [AccessManager] Error listing plan folders for fallback revocation:', err.message);
            }
            
            // Add default folder
            const config = this._getConfig();
            if (config.defaultFolderId) {
                folderIds.add(config.defaultFolderId);
            }

            // Attempt to revoke by email on each folder
            for (const folderId of folderIds) {
                try {
                    const revoked = await googleDriveService.revokeAccessByEmail(folderId, email);
                    if (revoked) {
                        revokedCount++;
                        console.log(`🗑️ [AccessManager] Fallback: Revoked email ${email} from folder ${folderId}`);
                    }
                } catch (err) {
                    console.error(`❌ [AccessManager] Fallback revoke failed for folder ${folderId} and email ${email}: ${err.message}`);
                }
            }
        }

        await courseAccessService.updateDriveRevocation(recordId, drivePerms);
        await this._logActivity(recordId, 'revoked', email, drivePerms);

        if (this._io) {
            this._io.emit('gdrive:access-revoked', { recordId, email, revokedCount });
        }

        console.log(`🗑️ [AccessManager] Revoked ${revokedCount} permissions for ${email}`);
        return await this._getRecord(recordId);
    }

    // ── Expiry Check ───────────────────────────────────────────

    /**
     * Find all records with expired access and revoke them.
     * Called by the cron service.
     * @returns {number} number of records revoked
     */
    async revokeExpiredAccesses() {
        const records = await courseAccessService.getAll();
        const now = new Date();
        let revokedCount = 0;

        for (const record of records) {
            if (record.status !== 'access_granted') continue;
            if (!record.accessExpiresAt) continue;

            const expiresAt = new Date(record.accessExpiresAt);
            if (expiresAt > now) continue;

            // Expired!
            console.log(`⏰ [AccessManager] Access expired for ${record.email} (expired at ${record.accessExpiresAt})`);
            try {
                await this.revokeAccess(record.id);
                await courseAccessService.denyAccess(record.id);
                revokedCount++;
            } catch (err) {
                console.error(`❌ [AccessManager] Failed to revoke expired access for ${record.email}: ${err.message}`);
            }
        }

        if (revokedCount > 0) {
            console.log(`⏰ [AccessManager] Revoked ${revokedCount} expired accesses`);
        }

        return revokedCount;
    }

    // ── Plan-Folder Mapping ────────────────────────────────────

    /**
     * Get plan-to-folder configuration.
     */
    async getPlanFolderConfig() {
        return await this._getPlanFolders();
    }

    /**
     * Update plan-to-folder mapping.
     * @param {string} plan - Plan name (e.g. 'combo-10')
     * @param {string[]} folderIds - Array of folder IDs for this plan
     */
    async setPlanFolders(plan, folderIds) {
        const config = await this._getPlanFolders();
        if (!config.planFolders) config.planFolders = {};
        config.planFolders[plan] = folderIds;
        await this._savePlanFolders(config);
        console.log(`📂 [AccessManager] Updated plan "${plan}" → ${folderIds.length} folder(s)`);
    }

    /**
     * Remove plan-to-folder mapping.
     */
    async removePlanFolders(plan) {
        const config = await this._getPlanFolders();
        if (config.planFolders) {
            delete config.planFolders[plan];
            await this._savePlanFolders(config);
        }
    }

    // ── Activity Log ───────────────────────────────────────────

    async _logActivity(accessId, action, email, details) {
        try {
            const config = await this._getPlanFolders();
            if (!config.activityLog) config.activityLog = [];

            config.activityLog.unshift({
                accessId,
                action,
                email,
                details: Array.isArray(details)
                    ? details.map(d => ({ folderId: d.folderId, folderName: d.folderName }))
                    : details,
                timestamp: new Date().toISOString(),
            });

            // Keep last 200 entries
            if (config.activityLog.length > 200) {
                config.activityLog = config.activityLog.slice(0, 200);
            }

            await this._savePlanFolders(config);
        } catch (err) {
            console.error(`⚠️ [AccessManager] Failed to log activity: ${err.message}`);
        }
    }

    /**
     * Get recent activity log.
     * @param {number} limit
     */
    async getActivityLog(limit = 50) {
        const config = await this._getPlanFolders();
        return (config.activityLog || []).slice(0, limit);
    }

    // ── Helpers ─────────────────────────────────────────────────

    async _getRecord(id) {
        const records = await courseAccessService.getAll();
        return records.find(r => r.id === id) || null;
    }
}

module.exports = new AccessManagerService();
