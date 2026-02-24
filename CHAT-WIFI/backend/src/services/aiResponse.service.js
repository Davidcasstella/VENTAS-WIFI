const aiProvidersService = require('./aiProviders.service');
const knowledgeBaseService = require('./knowledgeBase.service');
const axios = require('axios');
const tokenUsageService = require('./tokenUsageService');

class AIResponseService {
    /**
     * Generates a response using the active AI provider.
     * If knowledge base has relevant context, uses RAG to constrain the response.
     * @param {string} prompt - The user message.
     * @returns {Promise<string>} - The generated response.
     */
    async generateResponse(prompt) {
        const activeProvider = await aiProvidersService.getActiveProvider();

        if (!activeProvider) {
            console.warn('⚠️ No hay ningún proveedor de IA activo.');
            return 'Lo siento, en este momento no tengo un motor de IA configurado.';
        }

        const { name, apiKey } = activeProvider;
        const providerName = name.toLowerCase();

        try {
            // Search knowledge base for relevant context
            const kbContext = await knowledgeBaseService.searchKnowledge(prompt);
            let systemPrompt = 'Eres un asistente de atención al cliente. Responde de manera breve, clara y directa (máximo 2-3 oraciones).';

            if (kbContext) {
                console.log('📚 RAG context found, applying constraints...');
                systemPrompt += '\nUsa SOLO la información del contexto proporcionado.\nSi no encuentras la respuesta en el contexto, o si no entiendes la pregunta, o si la pregunta no tiene sentido, responde EXACTAMENTE con esta palabra y NADA MÁS: FALLBACK_TRIGGER\nNo inventes respuestas. No digas "no entiendo". Si no estás 100% seguro de la respuesta, responde FALLBACK_TRIGGER\n\nContexto:\n' + kbContext;
            } else {
                console.log('🌐 No RAG context found, using generic AI response.');
                systemPrompt += '\nIMPORTANTE: Si no puedes responder la pregunta con certeza, si no entiendes el mensaje, si el mensaje no tiene sentido, o si no tienes información útil que ofrecer, responde EXACTAMENTE con esta palabra y NADA MÁS: FALLBACK_TRIGGER\nNunca digas "no entiendo tu pregunta" ni pidas más contexto. Solo responde FALLBACK_TRIGGER';
            }

            // Detection by name or by API key prefix (Groq keys start with gsk_)
            const isGroq = providerName.includes('groq') || providerName.includes('grog') || apiKey.startsWith('gsk_');
            const isOpenAI = providerName.includes('openai') || apiKey.startsWith('sk-');
            const isGrok = providerName.includes('grok') && !isGroq;

            if (isOpenAI) {
                return await this.callOpenAI(apiKey, systemPrompt, prompt);
            } else if (isGroq) {
                return await this.callGroq(apiKey, systemPrompt, prompt);
            } else if (isGrok) {
                return await this.callGrok(apiKey, systemPrompt, prompt);
            } else if (providerName.includes('z.ia')) {
                // For Z.ia we still use the old complex prompt as it's a local extractor
                const combinedPrompt = `Contexto:\n${kbContext || ''}\n\nPregunta del cliente:\n${prompt}`;
                return await this.callZIA(apiKey, combinedPrompt);
            } else {
                throw new Error(`Proveedor ${name} no soportado para generación.`);
            }
        } catch (error) {
            console.error(`❌ Error generando respuesta con ${name}:`, error.message);
            return 'Hubo un error al procesar tu mensaje con la IA.';
        }
    }

    /**
     * Build a RAG-augmented prompt that constrains the AI to use only the knowledge base.
     */
    buildRAGPrompt(context, userMessage) {
        // Limit context to 1500 chars to avoid excessively long prompts
        const trimmedContext = context.length > 1500 ? context.substring(0, 1500) + '...' : context;
        return `Eres un asistente de atención al cliente. Responde de manera breve, clara y directa (máximo 2-3 oraciones).
Usa SOLO la información del contexto proporcionado.
Si no encuentras la respuesta, responde: "No tengo información suficiente en la base de conocimiento."

Contexto:
${trimmedContext}

Pregunta del cliente:
${userMessage}`;
    }

    async callOpenAI(apiKey, systemPrompt, userPrompt) {
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-3.5-turbo',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ]
        }, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        // Track token usage without blocking the response
        const usage = response.data.usage;
        if (usage) tokenUsageService.trackUsage(usage.total_tokens || 0);
        return response.data.choices[0].message.content;
    }

    async callGrok(apiKey, systemPrompt, userPrompt) {
        const response = await axios.post('https://api.x.ai/v1/chat/completions', {
            model: 'grok-beta',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ]
        }, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        // Track token usage without blocking the response
        const usage = response.data.usage;
        if (usage) tokenUsageService.trackUsage(usage.total_tokens || 0);
        return response.data.choices[0].message.content;
    }

    async callGroq(apiKey, systemPrompt, userPrompt) {
        // Groq (groq.com) uses OpenAI-compatible API format
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ]
        }, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        // Track token usage without blocking the response
        const usage = response.data.usage;
        if (usage) tokenUsageService.trackUsage(usage.total_tokens || 0);
        return response.data.choices[0].message.content;
    }

    async callZIA(apiKey, prompt) {
        // Robust extraction using simple indices instead of regex
        let context = '';
        let userQuestion = '';

        const contextIndex = prompt.lastIndexOf('Contexto:');
        const questionIndex = prompt.lastIndexOf('Pregunta del cliente:');

        if (contextIndex !== -1 && questionIndex !== -1) {
            context = prompt.substring(contextIndex + 9, questionIndex).trim();
            userQuestion = prompt.substring(questionIndex + 21).trim();
        } else {
            userQuestion = prompt;
        }

        if (!context) {
            console.log('⚠️ Z.ia: No se pudo extraer el contexto del prompt');
            return 'No tengo información suficiente en la base de conocimiento.';
        }

        // Split context into Q&A pairs using "¿" as delimiter
        const qaPairs = context.split(/(?=¿)/).filter(q => q.trim().length > 15);

        if (qaPairs.length === 0) {
            return 'No tengo información suficiente en la base de conocimiento.';
        }

        // Score each Q&A pair by fuzzy keyword overlap
        const queryWords = userQuestion.toLowerCase()
            .replace(/[¿?.,!]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length >= 3);

        let bestPair = null;
        let bestScore = 0;

        for (const pair of qaPairs) {
            const pairLower = pair.toLowerCase();
            let score = 0;
            for (const word of queryWords) {
                // Exact word match
                if (pairLower.includes(word)) {
                    score += 3;
                }
                // Fuzzy match for prefixes (e.g. "aprend" matches "aprender" and "aprenderé")
                else if (word.length >= 5 && pairLower.includes(word.substring(0, 5))) {
                    score += 1;
                }
            }

            if (score > bestScore) {
                bestScore = score;
                bestPair = pair.trim();
            }
        }

        if (!bestPair || bestScore < 1) {
            return 'No tengo información suficiente en la base de conocimiento para responder esa pregunta.';
        }

        // Extrae la respuesta (lo que viene después del signo de interrogación)
        const answerParts = bestPair.split('?');
        let finalResponse = '';

        if (answerParts.length > 1) {
            finalResponse = answerParts.slice(1).join('?').trim();
        } else {
            finalResponse = bestPair;
        }

        // Garantizar que sea concisa (max ~3 líneas / 250 chars)
        if (finalResponse.length > 250) {
            return finalResponse.substring(0, 247).trim() + '...';
        }
        return finalResponse;
    }
}

module.exports = new AIResponseService();
