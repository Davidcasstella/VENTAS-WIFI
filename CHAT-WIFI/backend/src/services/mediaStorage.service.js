/**
 * MediaStorageService
 *
 * Stores media files (images, audio, video) on the local filesystem
 * and tracks metadata in a SQLite database.
 *
 * Files are stored in: data/media/<type>/<filename>
 * Metadata is stored in: data/media.db
 */

const Database = require('better-sqlite3');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '../../data');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const DB_PATH = path.join(DATA_DIR, 'media.db');

class MediaStorageService {
    constructor() {
        fs.ensureDirSync(MEDIA_DIR);
        fs.ensureDirSync(path.join(MEDIA_DIR, 'image'));
        fs.ensureDirSync(path.join(MEDIA_DIR, 'audio'));
        fs.ensureDirSync(path.join(MEDIA_DIR, 'video'));
        fs.ensureDirSync(path.join(MEDIA_DIR, 'document'));

        this.db = new Database(DB_PATH);
        this.db.pragma('journal_mode = WAL');
        this._initSchema();
    }

    _initSchema() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS media (
                id TEXT PRIMARY KEY,
                jid TEXT NOT NULL,
                message_id TEXT,
                type TEXT NOT NULL,
                filename TEXT NOT NULL,
                original_name TEXT,
                mimetype TEXT,
                size INTEGER DEFAULT 0,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_media_jid ON media(jid);
            CREATE INDEX IF NOT EXISTS idx_media_message_id ON media(message_id);
        `);
    }

    /**
     * Save a media file to the filesystem and record metadata in SQLite.
     * @param {string} jid - WhatsApp JID
     * @param {Buffer} buffer - File data
     * @param {string} type - 'image' | 'audio' | 'video' | 'document'
     * @param {string} mimetype - MIME type (e.g. 'image/jpeg')
     * @param {string} [messageId] - Optional message ID for linking
     * @param {string} [originalName] - Original filename
     * @returns {{ id: string, filename: string, type: string, size: number }}
     */
    saveMedia(jid, buffer, type, mimetype, messageId = null, originalName = null) {
        const id = crypto.randomBytes(12).toString('hex');
        const ext = this._getExtension(mimetype, type);
        const filename = `${id}${ext}`;
        const filePath = path.join(MEDIA_DIR, type, filename);

        // Write file to disk
        fs.writeFileSync(filePath, buffer);

        // Insert metadata into SQLite
        const stmt = this.db.prepare(`
            INSERT INTO media (id, jid, message_id, type, filename, original_name, mimetype, size, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(id, jid, messageId, type, filename, originalName, mimetype, buffer.length, new Date().toISOString());

        console.log(`💾 Media saved: ${type}/${filename} (${(buffer.length / 1024).toFixed(1)} KB) for ${jid}`);

        return { id, filename, type, size: buffer.length, mimetype };
    }

    /**
     * Get media metadata by ID.
     * @param {string} id
     * @returns {object|null}
     */
    getMedia(id) {
        const stmt = this.db.prepare('SELECT * FROM media WHERE id = ?');
        return stmt.get(id) || null;
    }

    /**
     * Get the full file path for a media entry.
     * @param {string} id
     * @returns {string|null}
     */
    getFilePath(id) {
        const media = this.getMedia(id);
        if (!media) return null;
        const filePath = path.join(MEDIA_DIR, media.type, media.filename);
        return fs.existsSync(filePath) ? filePath : null;
    }

    /**
     * Get all media for a specific JID.
     * @param {string} jid
     * @returns {Array}
     */
    getMediaByJid(jid) {
        const stmt = this.db.prepare('SELECT * FROM media WHERE jid = ? ORDER BY created_at DESC');
        return stmt.all(jid);
    }

    /**
     * Delete a media entry and its file.
     * @param {string} id
     * @returns {boolean}
     */
    deleteMedia(id) {
        const media = this.getMedia(id);
        if (!media) return false;

        // Delete file
        const filePath = path.join(MEDIA_DIR, media.type, media.filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        // Delete from database
        const stmt = this.db.prepare('DELETE FROM media WHERE id = ?');
        stmt.run(id);
        return true;
    }

    /**
     * Determine file extension from MIME type.
     * @param {string} mimetype
     * @param {string} type
     * @returns {string}
     */
    _getExtension(mimetype, type) {
        const mimeMap = {
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'audio/ogg': '.ogg',
            'audio/ogg; codecs=opus': '.ogg',
            'audio/mpeg': '.mp3',
            'audio/mp4': '.m4a',
            'audio/webm': '.webm',
            'audio/wav': '.wav',
            'video/mp4': '.mp4',
            'video/3gpp': '.3gp',
            'video/webm': '.webm',
            'application/pdf': '.pdf',
        };

        if (mimetype && mimeMap[mimetype]) {
            return mimeMap[mimetype];
        }

        // Fallback based on type
        const fallbacks = { image: '.jpg', audio: '.ogg', video: '.mp4', document: '.bin' };
        return fallbacks[type] || '.bin';
    }

    /**
     * Get storage stats.
     * @returns {{ totalFiles: number, totalSize: number, byType: object }}
     */
    getStats() {
        const total = this.db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as totalSize FROM media').get();
        const byType = this.db.prepare('SELECT type, COUNT(*) as count, COALESCE(SUM(size), 0) as totalSize FROM media GROUP BY type').all();

        return {
            totalFiles: total.count,
            totalSize: total.totalSize,
            byType: byType.reduce((acc, row) => {
                acc[row.type] = { count: row.count, totalSize: row.totalSize };
                return acc;
            }, {})
        };
    }
}

module.exports = new MediaStorageService();
