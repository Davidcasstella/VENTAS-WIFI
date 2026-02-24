const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

const KB_BASE = path.join(__dirname, '../../knowledge-base');
const DOCUMENTS_DIR = path.join(KB_BASE, 'documents');
const CHUNKS_DIR = path.join(KB_BASE, 'chunks');
const EMBEDDINGS_DIR = path.join(KB_BASE, 'embeddings');
const INDEX_PATH = path.join(KB_BASE, 'index.json');

class FileStorage {
    constructor() {
        this.ensureDirectories();
    }

    /**
     * Ensure all required directories and files exist.
     */
    ensureDirectories() {
        fs.ensureDirSync(DOCUMENTS_DIR);
        fs.ensureDirSync(CHUNKS_DIR);
        fs.ensureDirSync(EMBEDDINGS_DIR);
        if (!fs.existsSync(INDEX_PATH)) {
            fs.writeJsonSync(INDEX_PATH, []);
        }
    }

    // ==================== INDEX OPERATIONS ====================

    async getIndex() {
        return fs.readJson(INDEX_PATH);
    }

    async saveIndex(index) {
        await fs.writeJson(INDEX_PATH, index, { spaces: 2 });
    }

    // ==================== DOCUMENT OPERATIONS ====================

    /**
     * Save an uploaded file to the documents folder and register it in index.
     * @param {Object} file - Multer file object { originalname, buffer, mimetype }
     * @returns {Object} - The created document entry
     */
    async saveDocument(file) {
        const docId = `doc_${crypto.randomUUID().replace(/-/g, '').substring(0, 12)}`;
        const ext = path.extname(file.originalname).toLowerCase();
        const fileName = `${docId}${ext}`;
        const filePath = path.join(DOCUMENTS_DIR, fileName);

        // Write file to disk
        await fs.writeFile(filePath, file.buffer);

        // Build index entry
        const entry = {
            id: docId,
            name: file.originalname,
            storedName: fileName,
            type: ext === '.pdf' ? 'pdf' : 'txt',
            size: file.size,
            createdAt: new Date().toISOString(),
            status: 'uploaded',
            chunkCount: 0
        };

        // Append to index
        const index = await this.getIndex();
        index.push(entry);
        await this.saveIndex(index);

        return entry;
    }

    /**
     * Get the full path of a document by its ID.
     */
    async getDocumentPath(docId) {
        const index = await this.getIndex();
        const doc = index.find(d => d.id === docId);
        if (!doc) return null;
        return path.join(DOCUMENTS_DIR, doc.storedName);
    }

    /**
     * Update a document's status and metadata in the index.
     */
    async updateDocumentStatus(docId, updates) {
        const index = await this.getIndex();
        const docIndex = index.findIndex(d => d.id === docId);
        if (docIndex === -1) return null;
        index[docIndex] = { ...index[docIndex], ...updates };
        await this.saveIndex(index);
        return index[docIndex];
    }

    // ==================== CHUNK OPERATIONS ====================

    /**
     * Save text chunks to individual files.
     * @param {string} docId - Document ID
     * @param {string[]} chunks - Array of text chunks
     * @returns {string[]} - Array of chunk IDs
     */
    async saveChunks(docId, chunks) {
        const chunkIds = [];
        for (let i = 0; i < chunks.length; i++) {
            const chunkId = `${docId}_chunk_${i + 1}`;
            const chunkPath = path.join(CHUNKS_DIR, `${chunkId}.txt`);
            await fs.writeFile(chunkPath, chunks[i], 'utf8');
            chunkIds.push(chunkId);
        }
        return chunkIds;
    }

    /**
     * Read a specific chunk's text content.
     */
    async getChunkText(chunkId) {
        const chunkPath = path.join(CHUNKS_DIR, `${chunkId}.txt`);
        if (!fs.existsSync(chunkPath)) return null;
        return fs.readFile(chunkPath, 'utf8');
    }

    /**
     * Get all chunk IDs for a given document.
     */
    async getChunkIdsForDocument(docId) {
        const files = await fs.readdir(CHUNKS_DIR);
        return files
            .filter(f => f.startsWith(docId) && f.endsWith('.txt'))
            .map(f => f.replace('.txt', ''));
    }

    // ==================== EMBEDDING OPERATIONS ====================

    /**
     * Save an embedding vector for a chunk.
     */
    async saveEmbedding(chunkId, documentId, embedding) {
        const embPath = path.join(EMBEDDINGS_DIR, `${chunkId}.json`);
        await fs.writeJson(embPath, {
            chunkId,
            documentId,
            embedding
        }, { spaces: 2 });
    }

    /**
     * Load all embeddings from disk.
     * @returns {Array<{chunkId: string, documentId: string, embedding: number[]}>}
     */
    async getAllEmbeddings() {
        const files = await fs.readdir(EMBEDDINGS_DIR);
        const jsonFiles = files.filter(f => f.endsWith('.json'));
        const embeddings = [];
        for (const file of jsonFiles) {
            const data = await fs.readJson(path.join(EMBEDDINGS_DIR, file));
            embeddings.push(data);
        }
        return embeddings;
    }

    // ==================== DELETE OPERATIONS ====================

    /**
     * Delete a document and all its associated chunks and embeddings.
     */
    async deleteDocument(docId) {
        // Remove document file
        const docPath = await this.getDocumentPath(docId);
        if (docPath && fs.existsSync(docPath)) {
            await fs.remove(docPath);
        }

        // Remove all chunks for this document
        const chunkFiles = (await fs.readdir(CHUNKS_DIR))
            .filter(f => f.startsWith(docId));
        for (const file of chunkFiles) {
            await fs.remove(path.join(CHUNKS_DIR, file));
        }

        // Remove all embeddings for this document
        const embFiles = (await fs.readdir(EMBEDDINGS_DIR))
            .filter(f => f.startsWith(docId));
        for (const file of embFiles) {
            await fs.remove(path.join(EMBEDDINGS_DIR, file));
        }

        // Remove from index
        const index = await this.getIndex();
        const updated = index.filter(d => d.id !== docId);
        await this.saveIndex(updated);
    }
}

module.exports = new FileStorage();
