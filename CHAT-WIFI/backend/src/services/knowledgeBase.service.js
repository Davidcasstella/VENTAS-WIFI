const fs = require('fs-extra');
const path = require('path');
const pdfParse = require('pdf-parse');
const fileStorage = require('./fileStorage');
const embeddingService = require('./embeddingService');
const retriever = require('./retriever');

class KnowledgeBaseService {
    /**
     * Upload and process a document: save → extract text → chunk → embed.
     * @param {Object} file - Multer file object
     * @returns {Object} - The document entry with processing status
     */
    async uploadAndProcess(file) {
        // Step 1: Save document to disk
        const doc = await fileStorage.saveDocument(file);
        console.log(`📄 Document saved: ${doc.name} (${doc.id})`);

        // Step 2: Process asynchronously (don't block the upload response)
        this.processDocument(doc.id).catch(err => {
            console.error(`❌ Error processing document ${doc.id}:`, err.message);
        });

        return doc;
    }

    /**
     * Full processing pipeline for a document.
     */
    async processDocument(docId) {
        try {
            await fileStorage.updateDocumentStatus(docId, { status: 'processing' });

            // Get document path
            const docPath = await fileStorage.getDocumentPath(docId);
            if (!docPath) throw new Error(`Document ${docId} not found`);

            // Get document info
            const index = await fileStorage.getIndex();
            const doc = index.find(d => d.id === docId);

            // Extract text
            console.log(`📝 Extracting text from ${doc.name}...`);
            const text = await this.extractText(docPath, doc.type);

            if (!text || text.trim().length === 0) {
                await fileStorage.updateDocumentStatus(docId, { status: 'error', error: 'No text extracted' });
                return;
            }

            // Chunk text
            console.log(`✂️ Chunking text (${text.length} chars)...`);
            const chunks = this.chunkText(text, 500);
            console.log(`📦 Created ${chunks.length} chunks`);

            // Save chunks
            const chunkIds = await fileStorage.saveChunks(docId, chunks);

            // Generate and save embeddings
            console.log(`🧠 Generating embeddings for ${chunks.length} chunks...`);
            for (let i = 0; i < chunks.length; i++) {
                const embedding = await embeddingService.generateEmbedding(chunks[i]);
                await fileStorage.saveEmbedding(chunkIds[i], docId, embedding);
                console.log(`  ✅ Embedding ${i + 1}/${chunks.length}`);
            }

            // Update document status
            await fileStorage.updateDocumentStatus(docId, {
                status: 'processed',
                chunkCount: chunks.length,
                processedAt: new Date().toISOString()
            });

            console.log(`🎉 Document ${doc.name} fully processed!`);
        } catch (error) {
            console.error(`❌ Processing failed for ${docId}:`, error.message);
            await fileStorage.updateDocumentStatus(docId, {
                status: 'error',
                error: error.message
            });
        }
    }

    /**
     * Extract text from a document file.
     */
    async extractText(filePath, type) {
        if (type === 'pdf') {
            const buffer = await fs.readFile(filePath);
            const data = await pdfParse(buffer);
            return data.text;
        } else {
            // TXT file
            return fs.readFile(filePath, 'utf8');
        }
    }

    /**
     * Split text into overlapping chunks of approximately `maxTokens` words.
     * Uses word-based splitting with 10% overlap for context continuity.
     */
    chunkText(text, maxTokens = 800) {
        // Clean the text
        const cleaned = text
            .replace(/\r\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/\s+/g, ' ')
            .trim();

        const words = cleaned.split(' ');
        const chunks = [];
        const overlap = Math.floor(maxTokens * 0.1); // 10% overlap
        let start = 0;

        while (start < words.length) {
            const end = Math.min(start + maxTokens, words.length);
            const chunk = words.slice(start, end).join(' ');

            if (chunk.trim().length > 50) { // Minimum chunk size
                chunks.push(chunk.trim());
            }

            start = end - overlap;
            if (start >= words.length) break;
            if (end === words.length) break;
        }

        return chunks;
    }

    /**
     * Search the knowledge base and return a formatted context string.
     * @param {string} query - User query
     * @returns {Promise<string|null>} - Context string or null if no results
     */
    async searchKnowledge(query) {
        try {
            const results = await retriever.search(query, 5);

            if (results.length === 0) return null;

            // Filter out low-similarity results (threshold)
            // Lowered to 0.02 for local fallback compatibility
            const relevant = results.filter(r => r.score > 0.02);
            if (relevant.length === 0) return null;

            // Build context from top chunks — send full text so AI can extract the answer
            const context = relevant
                .slice(0, 3)
                .map((r, i) => r.text)
                .join('\n\n');

            return context;
        } catch (error) {
            console.error('❌ Error searching knowledge base:', error.message);
            return null;
        }
    }

    /**
     * Reprocess a document: delete old chunks/embeddings and re-process.
     */
    async reprocessDocument(docId) {
        // Delete old chunks and embeddings (keep the original document)
        const chunkIds = await fileStorage.getChunkIdsForDocument(docId);
        for (const chunkId of chunkIds) {
            const chunkPath = path.join(__dirname, '../../knowledge-base/chunks', `${chunkId}.txt`);
            const embPath = path.join(__dirname, '../../knowledge-base/embeddings', `${chunkId}.json`);
            if (fs.existsSync(chunkPath)) await fs.remove(chunkPath);
            if (fs.existsSync(embPath)) await fs.remove(embPath);
        }

        // Re-process
        await this.processDocument(docId);
    }

    /**
     * Delete a document and all associated data.
     */
    async deleteDocument(docId) {
        await fileStorage.deleteDocument(docId);
        console.log(`🗑️ Document ${docId} fully deleted`);
    }

    /**
     * Get all documents from the index.
     */
    async getDocuments() {
        return fileStorage.getIndex();
    }
}

module.exports = new KnowledgeBaseService();
