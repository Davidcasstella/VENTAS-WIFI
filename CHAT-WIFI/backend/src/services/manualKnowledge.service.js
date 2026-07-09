const fs = require('fs-extra');
const path = require('path');
const fileStorage = require('./fileStorage');
const embeddingService = require('./embeddingService');
const dynamo = require('./dynamoStore');

const MK_PATH = path.join(__dirname, '../../knowledge-base/manual-knowledge.json');
const CHUNKS_DIR = path.join(__dirname, '../../knowledge-base/chunks');
const EMBEDDINGS_DIR = path.join(__dirname, '../../knowledge-base/embeddings');

const DYNAMO_PK = 'CONFIG';
const DYNAMO_SK = 'manual-knowledge';

/**
 * ManualKnowledgeService — CRUD for free-form knowledge entries.
 *
 * Each entry has a title + content. The content is chunked (to support
 * large text) and vectorized so the retriever can find it just like
 * uploaded documents or Q&A pairs.
 *
 * Chunk / embedding naming convention:
 *   chunkId  = mk_{entryId}_chunk_{n}
 *   docId    = mk_{entryId}
 */
class ManualKnowledgeService {

    // ── Persistence helpers ────────────────────────────────────────

    /**
     * Read the JSON array from disk or DynamoDB.
     */
    async getAll() {
        if (dynamo.isEnabled()) {
            try {
                const data = await dynamo.getItem(DYNAMO_PK, DYNAMO_SK);
                if (data && Array.isArray(data.entries)) return data.entries;
                // Seed from local
                await fs.ensureFile(MK_PATH);
                const local = await fs.readJson(MK_PATH).catch(() => []);
                const entries = Array.isArray(local) ? local : [];
                await dynamo.putItem(DYNAMO_PK, DYNAMO_SK, { entries });
                return entries;
            } catch (err) {
                console.error(`❌ [ManualKnowledge] DynamoDB read failed: ${err.message}`);
            }
        }

        await fs.ensureFile(MK_PATH);
        try {
            const data = await fs.readJson(MK_PATH);
            return Array.isArray(data) ? data : [];
        } catch {
            return [];
        }
    }

    /** Persist the full array back. */
    async _save(entries) {
        if (dynamo.isEnabled()) {
            try {
                await dynamo.putItem(DYNAMO_PK, DYNAMO_SK, { entries });
                return;
            } catch (err) {
                console.error(`❌ [ManualKnowledge] DynamoDB write failed: ${err.message}`);
            }
        }
        await fs.writeJson(MK_PATH, entries, { spaces: 2 });
    }

    // ── Text chunking (replicates KnowledgeBaseService.chunkText) ──

    _chunkText(text, maxTokens = 500) {
        const cleaned = text
            .replace(/\r\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/\s+/g, ' ')
            .trim();

        const words = cleaned.split(' ');
        const chunks = [];
        const overlap = Math.floor(maxTokens * 0.1);
        let start = 0;

        while (start < words.length) {
            const end = Math.min(start + maxTokens, words.length);
            const chunk = words.slice(start, end).join(' ');

            if (chunk.trim().length > 50) {
                chunks.push(chunk.trim());
            }

            start = end - overlap;
            if (start >= words.length) break;
            if (end === words.length) break;
        }

        return chunks.length > 0 ? chunks : [cleaned];
    }

    // ── Chunk + Embedding lifecycle ────────────────────────────────

    async _saveChunksAndEmbeddings(entryId, title, content) {
        const documentId = `mk_${entryId}`;
        const fullText = `${title}\n\n${content}`;
        const chunks = this._chunkText(fullText);

        for (let i = 0; i < chunks.length; i++) {
            const chunkId = `mk_${entryId}_chunk_${i + 1}`;

            const chunkPath = path.join(CHUNKS_DIR, `${chunkId}.txt`);
            await fs.writeFile(chunkPath, chunks[i], 'utf8');

            const embedding = await embeddingService.generateEmbedding(chunks[i]);
            await fileStorage.saveEmbedding(chunkId, documentId, embedding);
        }

        console.log(`🧠 Manual knowledge "${title.substring(0, 30)}..." vectorized (${chunks.length} chunks)`);
        return chunks.length;
    }

    async _removeChunksAndEmbeddings(entryId) {
        const prefix = `mk_${entryId}_chunk_`;

        const chunkFiles = (await fs.readdir(CHUNKS_DIR)).filter(f => f.startsWith(prefix));
        for (const file of chunkFiles) {
            await fs.remove(path.join(CHUNKS_DIR, file));
        }

        const embFiles = (await fs.readdir(EMBEDDINGS_DIR)).filter(f => f.startsWith(prefix));
        for (const file of embFiles) {
            await fs.remove(path.join(EMBEDDINGS_DIR, file));
        }
    }

    // ── CRUD Operations ────────────────────────────────────────────

    async create(title, content) {
        const entries = await this.getAll();
        const newEntry = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            title: title.trim(),
            content: content.trim(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        entries.push(newEntry);
        await this._save(entries);

        const chunkCount = await this._saveChunksAndEmbeddings(newEntry.id, newEntry.title, newEntry.content);
        newEntry.chunkCount = chunkCount;

        console.log(`📝 Manual knowledge created: "${newEntry.title}"`);
        return newEntry;
    }

    async update(id, title, content) {
        const entries = await this.getAll();
        const idx = entries.findIndex(e => e.id === id);
        if (idx === -1) return null;

        entries[idx].title = title.trim();
        entries[idx].content = content.trim();
        entries[idx].updatedAt = new Date().toISOString();
        await this._save(entries);

        await this._removeChunksAndEmbeddings(id);
        const chunkCount = await this._saveChunksAndEmbeddings(id, entries[idx].title, entries[idx].content);
        entries[idx].chunkCount = chunkCount;

        console.log(`✏️ Manual knowledge updated and re-vectorized: ${id}`);
        return entries[idx];
    }

    async delete(id) {
        const entries = await this.getAll();
        const filtered = entries.filter(e => e.id !== id);
        if (filtered.length === entries.length) return false;
        await this._save(filtered);

        await this._removeChunksAndEmbeddings(id);

        console.log(`🗑️ Manual knowledge deleted: ${id}`);
        return true;
    }

    async reprocessAll() {
        const entries = await this.getAll();
        console.log(`🔄 Re-vectorizing ${entries.length} manual knowledge entries...`);

        for (const entry of entries) {
            await this._removeChunksAndEmbeddings(entry.id);
            await this._saveChunksAndEmbeddings(entry.id, entry.title, entry.content);
        }

        console.log(`✅ All ${entries.length} manual knowledge entries re-vectorized`);
        return entries.length;
    }
}

module.exports = new ManualKnowledgeService();
