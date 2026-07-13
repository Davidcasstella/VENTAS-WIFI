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
     * @param {string} [description=''] - Optional description (used for video/audio indexing)
     * @returns {Object} - The document entry with processing status
     */
    async uploadAndProcess(file, description = '') {
        // Step 1: Save document to disk
        const doc = await fileStorage.saveDocument(file, description);
        console.log(`📄 Document saved: ${doc.name} (${doc.id}) [type: ${doc.type}]`);

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
            const text = await this.extractText(docPath, doc.type, doc);

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
    async extractText(filePath, type, doc = {}) {
        if (type === 'video' || type === 'audio') {
            const descText = doc.description || doc.name.replace(/\.[^/.]+$/, "");
            const typeLabel = type === 'video' ? 'Video explicativo / demostrativo' : 'Audio / nota de voz explicativa';
            return `[MEDIA: ${type.toUpperCase()}] ID: [MEDIA_${doc.id}]
Nombre del archivo: ${doc.name}
Tipo: ${typeLabel}
Descripción / Contenido: ${descText}
Para enviar este archivo multimedia al usuario por WhatsApp en el momento oportuno, debes incluir exactamente su etiqueta [MEDIA_${doc.id}] al final de tu respuesta.`;
        } else if (type === 'pdf') {
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
            // Search all embeddings (documents + Q&A pairs) via cosine similarity
            const results = await retriever.search(query, 5);

            if (results.length === 0) return null;

            // Filter out low-similarity results (threshold)
            const relevant = results.filter(r => r.score > 0.02);
            if (relevant.length === 0) return null;

            // Build context from top chunks — includes both document and Q&A chunks
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
     * Get a formatted summary of all video and audio files currently stored in the knowledge base.
     * This is injected into the AI system prompt so the AI knows all available media and when to send them.
     */
    async getAllMediaSummary() {
        try {
            const index = await fileStorage.getIndex();
            const mediaDocs = index.filter(d => (d.type === 'video' || d.type === 'audio') && d.status === 'processed');
            if (mediaDocs.length === 0) return '';

            let summary = '=== ARCHIVOS MULTIMEDIA DISPONIBLES EN LA BASE DE CONOCIMIENTO (VIDEOS Y AUDIOS) ===\n';
            summary += '¡INSTRUCCIÓN CRÍTICA PARA LA IA! Cada archivo multimedia a continuación tiene condiciones específicas de cuándo usarlo y frases típicas que lo activan.\n';
            summary += 'Cuando el usuario haga una pregunta o comentario que encaje con las condiciones o frases de un archivo, DEBES responder con el texto / respuesta sugerida y OBLIGATORIAMENTE pegar al final del mensaje la etiqueta exacta [MEDIA_id] de ese archivo.\n\n';

            mediaDocs.forEach((doc, idx) => {
                const typeName = doc.type.toUpperCase();
                summary += `${idx + 1}. [MEDIA_${doc.id}] (Tipo: ${typeName})\n`;
                summary += `Nombre: ${doc.name}\n`;
                summary += `Descripción / Condiciones de activación / Cuándo enviarlo:\n${doc.description || 'Sin descripción'}\n\n`;
            });

            summary += '=== FIN ARCHIVOS MULTIMEDIA ===';
            return summary;
        } catch (error) {
            console.error('❌ Error in getAllMediaSummary:', error.message);
            return '';
        }
    }

    /**
     * Get all documents from the index.
     */
    async getDocuments() {
        return fileStorage.getIndex();
    }
}

module.exports = new KnowledgeBaseService();
