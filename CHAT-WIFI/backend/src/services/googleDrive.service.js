const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

/**
 * GoogleDriveService
 *
 * Manages Google Drive API v3 interactions using a Service Account.
 * Handles folder listing, sharing with specific emails, permission
 * revocation, and configuration management.
 *
 * Authentication priority:
 *   1. GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY env vars
 *   2. GOOGLE_CREDENTIALS_PATH env var (path to JSON key file)
 *   3. ./google-credentials.json in backend root
 */
class GoogleDriveService {

    constructor() {
        this._drive = null;
        this._initialized = false;
        this._initError = null;
        this._io = null;
    }

    setIo(io) {
        this._io = io;
    }

    // ── Initialization ─────────────────────────────────────────

    /**
     * Lazy-initialize the Google Drive client.
     * Returns true if connected, false otherwise.
     */
    async _ensureInitialized() {
        if (this._initialized) return true;
        if (this._initError) return false;

        try {
            let auth;

            // Priority 1: Environment variables
            if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
                auth = new google.auth.GoogleAuth({
                    credentials: {
                        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
                        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                    },
                    scopes: ['https://www.googleapis.com/auth/drive'],
                });
                console.log('🔑 [GoogleDrive] Authenticated via environment variables');
            }
            // Priority 2: Credentials file path from env
            else if (process.env.GOOGLE_CREDENTIALS_PATH) {
                const credPath = path.resolve(process.env.GOOGLE_CREDENTIALS_PATH);
                if (!fs.existsSync(credPath)) {
                    throw new Error(`Credentials file not found: ${credPath}`);
                }
                auth = new google.auth.GoogleAuth({
                    keyFile: credPath,
                    scopes: ['https://www.googleapis.com/auth/drive'],
                });
                console.log(`🔑 [GoogleDrive] Authenticated via credentials file: ${credPath}`);
            }
            // Priority 3: Default credentials file in backend root
            else {
                const defaultPath = path.join(__dirname, '../../google-credentials.json');
                if (fs.existsSync(defaultPath)) {
                    auth = new google.auth.GoogleAuth({
                        keyFile: defaultPath,
                        scopes: ['https://www.googleapis.com/auth/drive'],
                    });
                    console.log('🔑 [GoogleDrive] Authenticated via default credentials file');
                } else {
                    this._initError = 'No Google credentials configured';
                    console.warn('⚠️ [GoogleDrive] No credentials found. Set GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY or provide google-credentials.json');
                    return false;
                }
            }

            this._drive = google.drive({ version: 'v3', auth, timeout: 15000 });
            this._initialized = true;
            console.log('✅ [GoogleDrive] Service initialized successfully');
            return true;
        } catch (err) {
            this._initError = err.message;
            console.error(`❌ [GoogleDrive] Initialization failed: ${err.message}`);
            return false;
        }
    }

    // ── Status ──────────────────────────────────────────────────

    /**
     * Get connection status and configuration info.
     */
    async getStatus() {
        const connected = await this._ensureInitialized();
        return {
            connected,
            error: this._initError,
            serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '(from file)',
            adminEmail: process.env.GOOGLE_DRIVE_ADMIN_EMAIL || '',
            defaultFolderId: process.env.GOOGLE_DRIVE_DEFAULT_FOLDER_ID || '',
            autoGrant: process.env.GOOGLE_DRIVE_AUTO_GRANT === 'true',
            defaultRole: process.env.GOOGLE_DRIVE_DEFAULT_ROLE || 'reader',
            expiryDays: parseInt(process.env.GOOGLE_DRIVE_ACCESS_EXPIRY_DAYS || '0', 10),
        };
    }

    // ── Folder Operations ──────────────────────────────────────

    /**
     * List all folders accessible by the Service Account.
     * @returns {Array<{id, name, webViewLink, createdTime}>}
     */
    async listFolders() {
        if (!await this._ensureInitialized()) {
            throw new Error('Google Drive not initialized');
        }

        const response = await this._drive.files.list({
            q: "mimeType='application/vnd.google-apps.folder' and trashed=false",
            fields: 'files(id, name, webViewLink, createdTime, parents)',
            orderBy: 'name',
            pageSize: 100,
        });

        return response.data.files || [];
    }

    /**
     * Get metadata for a specific folder.
     * @param {string} folderId
     * @returns {object} folder metadata
     */
    async getFolderInfo(folderId) {
        if (!await this._ensureInitialized()) {
            throw new Error('Google Drive not initialized');
        }

        const response = await this._drive.files.get({
            fileId: folderId,
            fields: 'id, name, webViewLink, createdTime, mimeType',
        });

        return response.data;
    }

    /**
     * Create a new folder inside a parent folder.
     * @param {string} name - Folder name
     * @param {string} parentId - Parent folder ID (optional)
     * @returns {object} created folder metadata
     */
    async createFolder(name, parentId) {
        if (!await this._ensureInitialized()) {
            throw new Error('Google Drive not initialized');
        }

        const fileMetadata = {
            name,
            mimeType: 'application/vnd.google-apps.folder',
        };

        if (parentId) {
            fileMetadata.parents = [parentId];
        }

        const response = await this._drive.files.create({
            requestBody: fileMetadata,
            fields: 'id, name, webViewLink, createdTime',
        });

        console.log(`📁 [GoogleDrive] Folder created: "${name}" (${response.data.id})`);
        return response.data;
    }

    /**
     * Search for a folder by name.
     */
    async findFolderByName(name, parentId = null) {
        if (!await this._ensureInitialized()) {
            throw new Error('Google Drive not initialized');
        }
        
        let q = `mimeType='application/vnd.google-apps.folder' and name='${name.replace(/'/g, "\\'")}' and trashed=false`;
        if (parentId) {
            q += ` and '${parentId}' in parents`;
        }
        
        const response = await this._drive.files.list({
            q: q,
            fields: 'files(id, name)',
            pageSize: 1
        });
        
        return response.data.files && response.data.files.length > 0 ? response.data.files[0] : null;
    }

    // ── File Operations (Backups) ──────────────────────────────

    /**
     * Upload a file to Google Drive.
     * @param {string} filePath - Local path of the file to upload
     * @param {string} fileName - Desired name in Drive
     * @param {string} mimeType - File mimeType (e.g. 'application/zip')
     * @param {string} parentId - Parent folder ID (optional)
     */
    async uploadFile(filePath, fileName, mimeType, parentId = null) {
        if (!await this._ensureInitialized()) {
            throw new Error('Google Drive not initialized');
        }

        const fileMetadata = { name: fileName };
        if (parentId) fileMetadata.parents = [parentId];

        const media = {
            mimeType: mimeType,
            body: fs.createReadStream(filePath)
        };

        const response = await this._drive.files.create({
            requestBody: fileMetadata,
            media: media,
            fields: 'id, name, webViewLink'
        });

        console.log(`☁️ [GoogleDrive] File uploaded: "${fileName}" (${response.data.id})`);
        return response.data;
    }

    /**
     * Delete a file from Google Drive.
     */
    async deleteFile(fileId) {
        if (!await this._ensureInitialized()) {
            throw new Error('Google Drive not initialized');
        }
        await this._drive.files.delete({ fileId });
        console.log(`🗑️ [GoogleDrive] File deleted: ${fileId}`);
    }

    /**
     * List files in a folder, sorted by creation date.
     */
    async listFilesInFolder(folderId) {
        if (!await this._ensureInitialized()) {
            throw new Error('Google Drive not initialized');
        }
        const response = await this._drive.files.list({
            q: `'${folderId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`,
            fields: 'files(id, name, createdTime)',
            orderBy: 'createdTime desc',
            pageSize: 100
        });
        return response.data.files || [];
    }

    // ── Permission Operations ──────────────────────────────────

    /**
     * Share a folder with a specific email address.
     * @param {string} folderId - Google Drive folder ID
     * @param {string} email - Email to share with
     * @param {string} role - 'reader', 'writer', or 'commenter'
     * @param {string} emailMessage - Optional custom message
     * @returns {object} { permissionId, email, role }
     */
    async shareFolderWithEmail(folderId, email, role = 'reader', emailMessage = '') {
        if (!await this._ensureInitialized()) {
            throw new Error('Google Drive not initialized');
        }

        const defaultMessage = '¡Ya tienes acceso a tu contenido! 🎉 Abre esta carpeta para ver el material.';

        try {
            const createPromise = this._drive.permissions.create({
                fileId: folderId,
                requestBody: {
                    type: 'user',
                    role: role,
                    emailAddress: email,
                },
                sendNotificationEmail: true,
                emailMessage: emailMessage || defaultMessage,
                fields: 'id, emailAddress, role',
            });

            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Tiempo de espera agotado de Google Drive API (14s)')), 14000)
            );

            const response = await Promise.race([createPromise, timeoutPromise]);

            console.log(`✅ [GoogleDrive] Shared folder ${folderId} with ${email} as ${role} (permissionId: ${response.data.id})`);

            if (this._io) {
                this._io.emit('gdrive:shared', { folderId, email, role, permissionId: response.data.id });
            }

            return {
                permissionId: response.data.id,
                email: response.data.emailAddress || email,
                role: response.data.role || role,
            };
        } catch (err) {
            // Handle common errors
            if (err.code === 404) {
                throw new Error(`Folder not found: ${folderId}`);
            }
            if (err.code === 400 && err.message?.includes('invalid')) {
                throw new Error(`Invalid email address: ${email}`);
            }
            throw err;
        }
    }

    /**
     * Revoke access for a specific permission.
     * @param {string} folderId - Google Drive folder ID
     * @param {string} permissionId - Permission ID to revoke
     */
    async revokeAccess(folderId, permissionId) {
        if (!await this._ensureInitialized()) {
            throw new Error('Google Drive not initialized');
        }

        try {
            await this._drive.permissions.delete({
                fileId: folderId,
                permissionId: permissionId,
            });

            console.log(`🗑️ [GoogleDrive] Revoked permission ${permissionId} from folder ${folderId}`);

            if (this._io) {
                this._io.emit('gdrive:revoked', { folderId, permissionId });
            }
        } catch (err) {
            if (err.code === 404) {
                console.warn(`⚠️ [GoogleDrive] Permission ${permissionId} not found (already revoked?)`);
                return; // Consider already revoked
            }
            if (err.code === 403) {
                console.warn(`⚠️ [GoogleDrive] Cannot revoke permission ${permissionId} (owner/inherited permission)`);
                return; // Owner permissions cannot be revoked, skip gracefully
            }
            throw err;
        }
    }

    /**
     * Revoke access for a specific email from a folder.
     * Finds the permission by email and deletes it.
     * @param {string} folderId
     * @param {string} email
     * @returns {boolean} true if revoked, false if not found
     */
    async revokeAccessByEmail(folderId, email) {
        if (!await this._ensureInitialized()) {
            throw new Error('Google Drive not initialized');
        }

        const permissions = await this.listPermissions(folderId);
        const perm = permissions.find(p =>
            p.emailAddress && p.emailAddress.toLowerCase() === email.toLowerCase()
        );

        if (!perm) {
            console.warn(`⚠️ [GoogleDrive] No permission found for ${email} on folder ${folderId}`);
            return false;
        }

        await this.revokeAccess(folderId, perm.id);
        return true;
    }

    /**
     * List all permissions for a folder.
     * @param {string} folderId
     * @returns {Array<{id, type, role, emailAddress, displayName}>}
     */
    async listPermissions(folderId) {
        if (!await this._ensureInitialized()) {
            throw new Error('Google Drive not initialized');
        }

        const response = await this._drive.permissions.list({
            fileId: folderId,
            fields: 'permissions(id, type, role, emailAddress, displayName)',
            pageSize: 100,
        });

        return response.data.permissions || [];
    }

    /**
     * Check if a specific email has access to a folder.
     * @param {string} folderId
     * @param {string} email
     * @returns {object|null} permission object or null
     */
    async checkAccess(folderId, email) {
        const permissions = await this.listPermissions(folderId);
        return permissions.find(p =>
            p.emailAddress && p.emailAddress.toLowerCase() === email.toLowerCase()
        ) || null;
    }

    // ── Reset (for re-initialization after config change) ──────

    reset() {
        this._drive = null;
        this._initialized = false;
        this._initError = null;
        console.log('🔄 [GoogleDrive] Service reset — will re-initialize on next call');
    }
}

module.exports = new GoogleDriveService();
