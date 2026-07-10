const fs = require('fs-extra');
const path = require('path');
const dynamo = require('./dynamoStore');

const DATA_PATH = path.join(__dirname, '../../knowledge-base/course-access.json');

const DYNAMO_PK = 'CONFIG';
const DYNAMO_SK = 'course-access';

/**
 * CourseAccessService
 *
 * Manages course access records after payment detection.
 * Supports DynamoDB (primary) and local JSON file (fallback).
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
        if (dynamo.isEnabled()) {
            try {
                const data = await dynamo.getItem(DYNAMO_PK, DYNAMO_SK);
                if (data && Array.isArray(data.records)) return data.records;
                // Seed from local
                const local = await this._loadLocal();
                await dynamo.putItem(DYNAMO_PK, DYNAMO_SK, { records: local });
                return local;
            } catch (err) {
                console.error(`❌ [CourseAccess] DynamoDB read failed: ${err.message}`);
            }
        }
        return this._loadLocal();
    }

    async _loadLocal() {
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
        if (dynamo.isEnabled()) {
            try {
                await dynamo.putItem(DYNAMO_PK, DYNAMO_SK, { records });
                return;
            } catch (err) {
                console.error(`❌ [CourseAccess] DynamoDB write failed: ${err.message}`);
            }
        }
        await fs.writeJson(DATA_PATH, records, { spaces: 2 });
    }

    _genId() {
        return Math.random().toString(36).substring(2) + Date.now().toString(36);
    }

    _extractPhone(jid) {
        return (jid || '').replace(/@.*$/, '');
    }

    // ── Core Methods ──────────────────────────────────────────

    async createPendingAccess(jid, pushName, plan = '') {
        const records = await this._load();

        const existing = records.find(r => r.jid === jid && (r.status === 'pending_email' || r.status === 'pending_access'));
        if (existing) {
            console.log(`📋 [CourseAccess] Existing pending record for ${jid}, skipping duplicate`);
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

        records.unshift(record);
        await this._save(records);

        console.log(`📋 [CourseAccess] Created pending access for ${jid} (${pushName}) with plan "${plan}"`);

        if (this._io) {
            this._io.emit('course-access:new', record);
        }

        return record;
    }

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

    async updateNotes(id, notes) {
        const records = await this._load();
        const record = records.find(r => r.id === id);
        if (!record) return null;

        record.notes = notes;
        record.updatedAt = new Date().toISOString();

        await this._save(records);
        return record;
    }

    async deleteAccess(id) {
        let records = await this._load();
        const before = records.length;
        const record = records.find(r => r.id === id);

        if (!record) return false;

        try {
            const accessManagerService = require('./accessManager.service');
            console.log(`🗑️ [CourseAccess] Auto-revoking Google Drive permissions for record ${id} before deletion`);
            await accessManagerService.revokeAccess(id);
        } catch (err) {
            console.error(`⚠️ [CourseAccess] Auto-revocation failed during deletion of ${id}: ${err.message}`);
        }

        records = records.filter(r => r.id !== id);
        await this._save(records);

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

    async getAll() {
        return await this._load();
    }

    async updateDrivePermissions(id, drivePermissions, expiryDays = 0) {
        const records = await this._load();
        const record = records.find(r => r.id === id);
        if (!record) return null;

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

    async getByJid(jid) {
        const records = await this._load();
        return records.find(r => r.jid === jid && (r.status === 'pending_email' || r.status === 'pending_access'));
    }

    /**
     * Find the most recent record for a JID, regardless of status.
     * Used by the manual access panel in the chat UI to show the saved email.
     */
    async getLatestByJid(jid) {
        const records = await this._load();
        // Filter all records for this JID and return the most recent one
        const jidRecords = records.filter(r => r.jid === jid);
        if (jidRecords.length === 0) return null;
        // Prefer access_granted > pending_access > pending_email > denied
        const priority = { access_granted: 0, pending_access: 1, pending_email: 2, access_denied: 3 };
        return jidRecords.sort((a, b) => {
            const pa = priority[a.status] ?? 99;
            const pb = priority[b.status] ?? 99;
            if (pa !== pb) return pa - pb;
            // Same status: prefer most recent
            return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
        })[0];
    }

    /**
     * Update the email for an existing record.
     * Used when the admin enters a different email from the chat panel.
     */
    async updateEmail(id, email) {
        const records = await this._load();
        const record = records.find(r => r.id === id);
        if (!record) return null;

        record.email = email.trim().toLowerCase();
        record.emailReceivedAt = new Date().toISOString();
        // If it was pending_email, advance to pending_access
        if (record.status === 'pending_email') {
            record.status = 'pending_access';
        }
        record.updatedAt = new Date().toISOString();

        await this._save(records);
        console.log(`📧 [CourseAccess] Email updated for record ${id}: ${record.email}`);

        if (this._io) {
            this._io.emit('course-access:update', record);
        }

        return record;
    }

    /**
     * Update the plan (course folder type e.g. combo-10, combo-15) for a record.
     */
    async updatePlan(id, plan) {
        const records = await this._load();
        const record = records.find(r => r.id === id);
        if (!record) return null;

        record.plan = plan || '';
        record.updatedAt = new Date().toISOString();

        await this._save(records);
        console.log(`📦 [CourseAccess] Plan updated for record ${id}: "${record.plan}"`);

        if (this._io) {
            this._io.emit('course-access:update', record);
        }

        return record;
    }

    async isPendingEmail(jid) {
        const records = await this._load();
        return records.some(r => r.jid === jid && r.status === 'pending_email');
    }

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
