const fs = require('fs-extra');
const path = require('path');

const DATA_PATH = path.join(__dirname, '../../knowledge-base/course-access.json');

/**
 * CourseAccessService
 *
 * Manages course access records after payment detection.
 * Stores data in a JSON file following the same pattern as
 * ai-rules.json and other knowledge-base files.
 *
 * Lifecycle:
 *   1. Payment detected → createPendingAccess() → status: "pending_email"
 *   2. Client sends email → saveEmail() → status: "pending_access"
 *   3. Admin grants access → grantAccess() → status: "access_granted"
 */
class CourseAccessService {

    constructor() {
        this._io = null;
    }

    setIo(io) {
        this._io = io;
    }

    // ── Data I/O ──────────────────────────────────────────────

    async _load() {
        try {
            await fs.ensureFile(DATA_PATH);
            const raw = await fs.readFile(DATA_PATH, 'utf-8');
            const trimmed = raw.trim();
            if (!trimmed || trimmed === '') return [];
            return JSON.parse(trimmed);
        } catch {
            return [];
        }
    }

    async _save(records) {
        await fs.writeJson(DATA_PATH, records, { spaces: 2 });
    }

    _genId() {
        return Math.random().toString(36).substring(2) + Date.now().toString(36);
    }

    _extractPhone(jid) {
        return (jid || '').replace(/@.*$/, '');
    }

    // ── Core Methods ──────────────────────────────────────────

    /**
     * Create a pending access record when payment is detected.
     * Returns the created record.
     */
    async createPendingAccess(jid, pushName, plan = '') {
        const records = await this._load();

        // Check if there's already a pending record for this JID
        const existing = records.find(r => r.jid === jid && (r.status === 'pending_email' || r.status === 'pending_access'));
        if (existing) {
            console.log(`📋 [CourseAccess] Existing pending record for ${jid}, skipping duplicate`);
            // Update plan if it was empty but now we detected one
            if (plan && !existing.plan) {
                existing.plan = plan;
                existing.amount = plan === 'combo-10' ? 10000 : plan === 'combo-15' ? 15000 : 0;
                await this._save(records);
            }
            return existing;
        }

        const record = {
            id: this._genId(),
            jid,
            phone: this._extractPhone(jid),
            pushName: pushName || '',
            email: '',
            plan: plan || '',
            amount: plan === 'combo-10' ? 10000 : plan === 'combo-15' ? 15000 : 0,
            status: 'pending_email',
            drivePermissions: [],
            driveAccessGrantedAt: null,
            driveAccessRevokedAt: null,
            accessExpiresAt: null,
            paymentDetectedAt: new Date().toISOString(),
            emailReceivedAt: null,
            accessGrantedAt: null,
            notes: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        records.unshift(record); // newest first
        await this._save(records);

        console.log(`📋 [CourseAccess] Created pending access for ${jid} (${pushName}) with plan "${plan}"`);

        // Notify dashboard in real-time
        if (this._io) {
            this._io.emit('course-access:new', record);
        }

        return record;
    }

    /**
     * Create a manual access record from the admin dashboard.
     */
    async createManualAccess(data) {
        const records = await this._load();

        const phone = (data.phone || '').trim().replace('+', '');
        const jid = phone ? `${phone}@s.whatsapp.net` : '';

        const record = {
            id: this._genId(),
            jid,
            phone,
            pushName: data.pushName || '',
            email: (data.email || '').trim().toLowerCase(),
            plan: data.plan || '',
            amount: data.plan === 'combo-10' ? 10000 : data.plan === 'combo-15' ? 15000 : 0,
            status: data.status || 'access_granted',
            drivePermissions: [],
            driveAccessGrantedAt: null,
            driveAccessRevokedAt: null,
            accessExpiresAt: null,
            paymentDetectedAt: new Date().toISOString(),
            emailReceivedAt: data.email ? new Date().toISOString() : null,
            accessGrantedAt: data.status === 'access_granted' ? new Date().toISOString() : null,
            notes: data.notes || '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        records.unshift(record);
        await this._save(records);

        console.log(`📋 [CourseAccess] Manually created access for ${phone || 'unknown'} (${record.email})`);

        if (this._io) {
            this._io.emit('course-access:new', record);
        }

        return record;
    }


    /**
     * Save the client's email after they send it via WhatsApp.
     * Changes status from pending_email → pending_access.
     */
    async saveEmail(jid, email) {
        const records = await this._load();
        const record = records.find(r => r.jid === jid && r.status === 'pending_email');

        if (!record) {
            console.warn(`⚠️ [CourseAccess] No pending_email record found for ${jid}`);
            return null;
        }

        record.email = email.trim().toLowerCase();
        record.status = 'pending_access';
        record.emailReceivedAt = new Date().toISOString();
        record.updatedAt = new Date().toISOString();

        await this._save(records);
        console.log(`📧 [CourseAccess] Email saved for ${jid}: ${record.email}`);

        if (this._io) {
            this._io.emit('course-access:update', record);
        }

        return record;
    }

    /**
     * Admin grants access to the course.
     */
    async grantAccess(id) {
        const records = await this._load();
        const record = records.find(r => r.id === id);
        if (!record) return null;

        record.status = 'access_granted';
        record.accessGrantedAt = new Date().toISOString();
        record.updatedAt = new Date().toISOString();

        await this._save(records);
        console.log(`✅ [CourseAccess] Access granted for ${record.email || record.phone}`);

        if (this._io) {
            this._io.emit('course-access:update', record);
        }

        return record;
    }

    /**
     * Admin denies access.
     */
    async denyAccess(id) {
        const records = await this._load();
        const record = records.find(r => r.id === id);
        if (!record) return null;

        record.status = 'access_denied';
        record.updatedAt = new Date().toISOString();

        await this._save(records);
        console.log(`❌ [CourseAccess] Access denied for ${record.email || record.phone}`);

        if (this._io) {
            this._io.emit('course-access:update', record);
        }

        return record;
    }

    /**
     * Update the plan for a record.
     */
    async updatePlan(id, plan) {
        const records = await this._load();
        const record = records.find(r => r.id === id);
        if (!record) return null;

        record.plan = plan;
        record.amount = plan === 'combo-10' ? 10000 : plan === 'combo-15' ? 15000 : 0;
        record.updatedAt = new Date().toISOString();

        await this._save(records);

        if (this._io) {
            this._io.emit('course-access:update', record);
        }

        return record;
    }

    /**
     * Update notes for a record.
     */
    async updateNotes(id, notes) {
        const records = await this._load();
        const record = records.find(r => r.id === id);
        if (!record) return null;

        record.notes = notes;
        record.updatedAt = new Date().toISOString();

        await this._save(records);
        return record;
    }

    /**
     * Delete a record.
     */
    async deleteAccess(id) {
        let records = await this._load();
        const before = records.length;
        const record = records.find(r => r.id === id);

        if (!record) return false;

        // Auto-revoke Google Drive permissions before deleting the record
        try {
            const accessManagerService = require('./accessManager.service');
            console.log(`🗑️ [CourseAccess] Auto-revoking Google Drive permissions for record ${id} before deletion`);
            await accessManagerService.revokeAccess(id);
        } catch (err) {
            console.error(`⚠️ [CourseAccess] Auto-revocation failed during deletion of ${id}: ${err.message}`);
        }

        // Now filter and save the records
        records = records.filter(r => r.id !== id);
        await this._save(records);

        // Reset welcome automation state and re-enable AI for this user
        if (record && record.jid) {
            try {
                const welcomeAutomationService = require('./welcomeAutomation.service');
                await welcomeAutomationService.resetUserState(record.jid);
                console.log(`🤖 Reset welcome automation state and re-enabled AI for ${record.jid} after deleting access record`);
            } catch (err) {
                console.error(`⚠️ [CourseAccess] Failed to reset welcome state: ${err.message}`);
            }
        }

        if (this._io) {
            this._io.emit('course-access:delete', { id });
        }

        return true;
    }

    /**
     * Get all records.
     */
    async getAll() {
        return await this._load();
    }

    /**
     * Update Drive permissions for a record after sharing.
     * @param {string} id - Record ID
     * @param {Array} drivePermissions - Array of permission objects
     * @param {number} expiryDays - Days until access expires (0 = no expiry)
     */
    async updateDrivePermissions(id, drivePermissions, expiryDays = 0) {
        const records = await this._load();
        const record = records.find(r => r.id === id);
        if (!record) return null;

        // Merge new permissions with existing ones
        if (!record.drivePermissions) record.drivePermissions = [];
        record.drivePermissions = [...record.drivePermissions, ...drivePermissions];
        record.driveAccessGrantedAt = new Date().toISOString();
        record.driveAccessRevokedAt = null;

        if (expiryDays > 0) {
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + expiryDays);
            record.accessExpiresAt = expiresAt.toISOString();
        }

        record.updatedAt = new Date().toISOString();
        await this._save(records);

        if (this._io) {
            this._io.emit('course-access:update', record);
        }

        return record;
    }

    /**
     * Update Drive permissions after revocation.
     * @param {string} id - Record ID
     * @param {Array} drivePermissions - Updated permission objects (with revokedAt)
     */
    async updateDriveRevocation(id, drivePermissions) {
        const records = await this._load();
        const record = records.find(r => r.id === id);
        if (!record) return null;

        record.drivePermissions = drivePermissions;
        record.driveAccessRevokedAt = new Date().toISOString();
        record.updatedAt = new Date().toISOString();

        await this._save(records);

        if (this._io) {
            this._io.emit('course-access:update', record);
        }

        return record;
    }

    /**
     * Find a record by JID.
     */
    async getByJid(jid) {
        const records = await this._load();
        return records.find(r => r.jid === jid && (r.status === 'pending_email' || r.status === 'pending_access'));
    }

    /**
     * Check if a JID has a pending_email record (waiting for email input).
     */
    async isPendingEmail(jid) {
        const records = await this._load();
        return records.some(r => r.jid === jid && r.status === 'pending_email');
    }

    /**
     * Get statistics.
     */
    async getStats() {
        const records = await this._load();
        return {
            total: records.length,
            pendingEmail: records.filter(r => r.status === 'pending_email').length,
            pendingAccess: records.filter(r => r.status === 'pending_access').length,
            granted: records.filter(r => r.status === 'access_granted').length,
            denied: records.filter(r => r.status === 'access_denied').length,
            combo10: records.filter(r => r.plan === 'combo-10').length,
            combo15: records.filter(r => r.plan === 'combo-15').length,
        };
    }
}

module.exports = new CourseAccessService();
