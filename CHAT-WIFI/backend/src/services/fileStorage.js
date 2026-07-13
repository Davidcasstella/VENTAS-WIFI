const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const dynamo = require('./dynamoStore');

const KB_BASE = path.join(__dirname, '../../knowledge-base');
const DOCUMENTS_DIR = path.join(KB_BASE, 'documents');
const CHUNKS_DIR = path.join(KB_BASE, 'chunks');
const EMBEDDINGS_DIR = path.join(KB_BASE, 'embeddings');
const INDEX_PATH = path.join(KB_BASE, 'index.json');

const DYNAMO_PK_CONFIG = 'KB_CONFIG';
const DYNAMO_PK_CHUNK = 'KB_CHUNK';
const DYNAMO_PK_EMBEDDING = 'KB_EMBEDDING';

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
        if (dynamo.isEnabled()) {
            try {
                const data = await dynamo.getItem(DYNAMO_PK_CONFIG, 'index');
                if (data && Array.isArray(data.index) && data.index.length > 0) {
                    return data.index;
                }
                // Seed from local disk if existing and dynamo is empty
                if (fs.existsSync(INDEX_PATH)) {
                    const localIndex = await fs.readJson(INDEX_PATH).catch(() => []);
                    if (Array.isArray(localIndex) && localIndex.length > 0) {
                        await dynamo.putItem(DYNAMO_PK_CONFIG, 'index', { index: localIndex });
                        return localIndex;
                    }
                }
                return data && Array.isArray(data.index) ? data.index : [];
            } catch (err) {
                console.error(`❌ [FileStorage] DynamoDB getIndex failed: ${err.message}`);
            }
        }
        if (!fs.existsSync(INDEX_PATH)) return [];
        return fs.readJson(INDEX_PATH).catch(() => []);
    }

    async saveIndex(index) {
        await fs.writeJson(INDEX_PATH, index, { spaces: 2 });
        if (dynamo.isEnabled()) {
            try {
                await dynamo.putItem(DYNAMO_PK_CONFIG, 'index', { index });
            } catch (err) {
                console.error(`❌ [FileStorage] DynamoDB saveIndex failed: ${err.message}`);
            }
        }
    }

    // ==================== DOCUMENT OPERATIONS ====================

    /**
     * Save an uploaded file to the documents folder and register it in index.
     * @param {Object} file - Multer file object { originalname, buffer, mimetype }
     * @param {string} [description=''] - Optional description for media indexing
     * @returns {Object} - The created document entry
     */
    async saveDocument(file, description = '') {
        const docId = `doc_${crypto.randomUUID().replace(/-/g, '').substring(0, 12)}`;
        const ext = path.extname(file.originalname).toLowerCase();
        const fileName = `${docId}${ext}`;
        const filePath = path.join(DOCUMENTS_DIR, fileName);

        // Write file to disk
        await fs.writeFile(filePath, file.buffer);

        const videoExts = ['.mp4', '.mov', '.avi', '.webm', '.mkv'];
        const audioExts = ['.mp3', '.ogg', '.wav', '.m4a', '.aac'];
        let docType = 'txt';
        if (ext === '.pdf') docType = 'pdf';
        else if (videoExts.includes(ext)) docType = 'video';
        else if (audioExts.includes(ext)) docType = 'audio';

        // Build index entry
        const entry = {
            id: docId,
            name: file.originalname,
            storedName: fileName,
            type: docType,
            description: description || '',
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
        index[docIndex] = { ...index[docIndex], ...updates, updatedAt: new Date().toISOString() };
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
            if (dynamo.isEnabled()) {
                try {
                    await dynamo.putItem(DYNAMO_PK_CHUNK, chunkId, { chunkId, docId, text: chunks[i] });
                } catch (e) {
                    console.error(`❌ [FileStorage] DynamoDB putItem chunk error: ${e.message}`);
                }
            }
            chunkIds.push(chunkId);
        }
        return chunkIds;
    }

    /**
     * Read a specific chunk's text content.
     */
    async getChunkText(chunkId) {
        if (dynamo.isEnabled()) {
            try {
                const data = await dynamo.getItem(DYNAMO_PK_CHUNK, chunkId);
                if (data && data.text) return data.text;
            } catch (e) { }
        }
        const chunkPath = path.join(CHUNKS_DIR, `${chunkId}.txt`);
        if (!fs.existsSync(chunkPath)) return null;
        return fs.readFile(chunkPath, 'utf8');
    }

    /**
     * Get all chunk IDs for a given document.
     */
    async getChunkIdsForDocument(docId) {
        if (dynamo.isEnabled()) {
            try {
                const items = await dynamo.queryItems(DYNAMO_PK_CHUNK, docId);
                if (items && items.length > 0) {
                    return items.map(it => it.sk);
                }
            } catch (e) { }
        }
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
        const payload = { chunkId, documentId, embedding };
        await fs.writeJson(embPath, payload, { spaces: 2 });
        if (dynamo.isEnabled()) {
            try {
                await dynamo.putItem(DYNAMO_PK_EMBEDDING, chunkId, payload);
            } catch (e) {
                console.error(`❌ [FileStorage] DynamoDB putItem embedding error: ${e.message}`);
            }
        }
    }

    /**
     * Load all embeddings from disk or DynamoDB.
     * @returns {Array<{chunkId: string, documentId: string, embedding: number[]}>}
     */
    async getAllEmbeddings() {
        if (dynamo.isEnabled()) {
            try {
                const items = await dynamo.queryItems(DYNAMO_PK_EMBEDDING);
                if (items && items.length > 0) {
                    return items.map(it => it.data);
                }
                // If DynamoDB is empty, seed from local disk if embeddings exist
                const files = await fs.readdir(EMBEDDINGS_DIR);
                const jsonFiles = files.filter(f => f.endsWith('.json'));
                if (jsonFiles.length > 0) {
                    const localEmbs = [];
                    for (const file of jsonFiles) {
                        const data = await fs.readJson(path.join(EMBEDDINGS_DIR, file)).catch(() => null);
                        if (data && data.chunkId) {
                            localEmbs.push(data);
                            await dynamo.putItem(DYNAMO_PK_EMBEDDING, data.chunkId, data).catch(() => {});
                        }
                    }
                    if (localEmbs.length > 0) return localEmbs;
                }
            } catch (e) {
                console.error(`❌ [FileStorage] DynamoDB getAllEmbeddings error: ${e.message}`);
            }
        }
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
        if (dynamo.isEnabled()) {
            try {
                const chunkItems = await dynamo.queryItems(DYNAMO_PK_CHUNK, docId);
                for (const it of chunkItems) {
                    await dynamo.deleteItem(DYNAMO_PK_CHUNK, it.sk);
                }
            } catch (e) { }
        }

        // Remove all embeddings for this document
        const embFiles = (await fs.readdir(EMBEDDINGS_DIR))
            .filter(f => f.startsWith(docId));
        for (const file of embFiles) {
            await fs.remove(path.join(EMBEDDINGS_DIR, file));
        }
        if (dynamo.isEnabled()) {
            try {
                const embItems = await dynamo.queryItems(DYNAMO_PK_EMBEDDING, docId);
                for (const it of embItems) {
                    await dynamo.deleteItem(DYNAMO_PK_EMBEDDING, it.sk);
                }
            } catch (e) { }
        }

        // Remove from index
        const index = await this.getIndex();
        const updated = index.filter(d => d.id !== docId);
        await this.saveIndex(updated);
    }
}

module.exports = new FileStorage();
