const aiProvidersService = require('./aiProviders.service');
const knowledgeBaseService = require('./knowledgeBase.service');
const axios = require('axios');
const tokenUsageService = require('./tokenUsageService');
const apiKeyRotation = require('./apiKeyRotation.service');

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

        const kbContext = await knowledgeBaseService.searchKnowledge(prompt);
        if (!kbContext) {
            console.log('🌐 No RAG context found, short-circuiting to FALLBACK_TRIGGER to enforce strict KB usage.');
            return 'FALLBACK_TRIGGER';
        }

        console.log('📚 RAG context found, applying strict constraints...');
        const systemPrompt = `CRITICAL SYSTEM INSTRUCTION:
1. Analiza cuidadosamente la intención del usuario y el "Contexto" proporcionado.
2. El Contexto puede contener DATOS INFORMATIVOS o REGLAS CONDICIONALES (ej. "Si el cliente dice X, responde Y").
3. Si la intención del usuario ENCAJA con alguna regla condicional (flujo) o si la respuesta exacta a su duda se encuentra en los datos informativos del contexto, responde basándote ÚNICAMENTE en eso.
4. Si el mensaje del usuario no tiene relación, es incomprensible, o la respuesta/regla NO está en el Contexto, DEBES emitir ESTRICTAMENTE la palabra: FALLBACK_TRIGGER
5. NUNCA inventes información, no asumas cosas, ni des respuestas genéricas.

REGLA DE FORMATO (solo si NO es FALLBACK_TRIGGER):
Formatea tu respuesta final en EXACTAMENTE 3 frases o renglones cortos, separados por el delimitador ||| (ejemplo: frase 1 ||| frase 2 ||| frase 3). Usa un tono muy natural, casual y humano. No uses saludos excesivos, no uses emojis.

Contexto proporcionado:
${kbContext}
`;

        try {
            // Detection priority: use API key prefix as strongest signal,
            // then fall back to provider name.
            // This prevents misrouting (e.g. a gsk_ key named "Grok" going to xAI instead of Groq)
            const isGroq = apiKey.startsWith('gsk_') || (providerName.includes('groq') || providerName.includes('grog'));
            const isOpenAI = !isGroq && (apiKey.startsWith('sk-') || providerName.includes('openai'));
            const isGemini = !isGroq && !isOpenAI && (apiKey.startsWith('AIza') || providerName.includes('gemini'));
            const isGrok = !isGroq && !isOpenAI && !isGemini && providerName.includes('grok');

            if (isGroq) {
                console.log(`🔑 [AI] Provider "${name}" routed to GROQ (key prefix: ${apiKey.substring(0, 4)}...)`);
                // Use key rotation for Groq — tries all available keys on rotatable errors
                return await apiKeyRotation.callWithRotation(
                    'groq',
                    (key, sys, usr) => this.callGroq(key, sys, usr),
                    systemPrompt,
                    prompt,
                    apiKey
                );
            } else if (isOpenAI) {
                console.log(`🔑 [AI] Provider "${name}" routed to OPENAI`);
                // Use key rotation for OpenAI — tries all available keys on rotatable errors
                return await apiKeyRotation.callWithRotation(
                    'openai',
                    (key, sys, usr) => this.callOpenAI(key, sys, usr),
                    systemPrompt,
                    prompt,
                    apiKey
                );
            } else if (isGrok) {
                console.log(`🔑 [AI] Provider "${name}" routed to GROK (xAI)`);
                // Use key rotation for Grok — tries all available keys on rotatable errors
                return await apiKeyRotation.callWithRotation(
                    'grok',
                    (key, sys, usr) => this.callGrok(key, sys, usr),
                    systemPrompt,
                    prompt,
                    apiKey
                );
            } else if (isGemini) {
                console.log(`🔑 [AI] Provider "${name}" routed to GEMINI`);
                // Use key rotation for Gemini — tries all available keys on rotatable errors
                return await apiKeyRotation.callWithRotation(
                    'gemini',
                    (key, sys, usr) => this.callGemini(key, sys, usr),
                    systemPrompt,
                    prompt,
                    apiKey
                );
            } else if (providerName.includes('z.ia')) {
                // For Z.ia we still use the old complex prompt as it's a local extractor
                const combinedPrompt = `Contexto:\n${kbContext || ''}\n\nPregunta del cliente:\n${prompt}`;
                return await this.callZIA(apiKey, combinedPrompt);
            } else {
                throw new Error(`Proveedor ${name} no soportado para generación.`);
            }
        } catch (primaryError) {
            console.error(`❌ Error generando respuesta con ${name}:`, primaryError.message);

            // Cross-provider fallback: try ALL other provider types that have available keys
            console.log('🔄 [AI] Active provider failed. Trying cross-provider fallback...');

            const fallbackProviders = [
                { type: 'groq', callFn: (key, sys, usr) => this.callGroq(key, sys, usr) },
                { type: 'openai', callFn: (key, sys, usr) => this.callOpenAI(key, sys, usr) },
                { type: 'grok', callFn: (key, sys, usr) => this.callGrok(key, sys, usr) },
                { type: 'gemini', callFn: (key, sys, usr) => this.callGemini(key, sys, usr) },
            ];

            // Determine which type the active provider was, to skip it
            const activeType = apiKey.startsWith('gsk_') ? 'groq'
                : apiKey.startsWith('sk-') ? 'openai'
                    : apiKey.startsWith('AIza') ? 'gemini'
                        : providerName.includes('grok') ? 'grok'
                            : providerName.includes('groq') ? 'groq'
                                : null;

            for (const fb of fallbackProviders) {
                if (fb.type === activeType) continue; // Skip the type that already failed

                try {
                    const keys = await aiProvidersService.getProvidersByType(fb.type);
                    if (!keys || keys.length === 0) continue;

                    console.log(`🔄 [AI] Fallback: trying ${fb.type.toUpperCase()} (${keys.length} key(s) available)`);

                    const result = await apiKeyRotation.callWithRotation(
                        fb.type,
                        fb.callFn,
                        systemPrompt,
                        prompt,
                        keys[0] // Start with the first key of this type
                    );

                    console.log(`✅ [AI] Fallback succeeded with ${fb.type.toUpperCase()}`);

                    // Auto-activate the working provider so future requests go directly to it
                    const workingKey = keys[0];
                    const activated = await aiProvidersService.activateByDecryptedKey(workingKey);
                    if (activated) {
                        console.log(`🔄 [AI] Auto-switched active provider to "${activated.name}" (${activated.apiKey})`);
                        // Emit Socket.io event so the frontend widget updates in real-time
                        apiKeyRotation._emitRotationEvent('provider-switched', {
                            providerType: fb.type,
                            status: 'rotated',
                            activeKeyMask: activated.apiKey,
                            newProvider: activated.name,
                            previousProvider: name,
                            attempt: 1,
                            totalKeys: keys.length
                        });
                    }

                    return result;
                } catch (fallbackErr) {
                    console.warn(`⚠️ [AI] Fallback with ${fb.type.toUpperCase()} also failed: ${fallbackErr.message}`);
                    continue;
                }
            }

            // All providers exhausted — return internal marker for app.js to handle
            console.error('❌ [AI] All providers exhausted. No AI response possible.');
            return '__ALL_PROVIDERS_EXHAUSTED__';
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

    async callGemini(apiKey, systemPrompt, userPrompt) {
        // Google Gemini API (generativelanguage.googleapis.com)
        try {
            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
                {
                    system_instruction: {
                        parts: [{ text: systemPrompt }]
                    },
                    contents: [
                        { role: 'user', parts: [{ text: userPrompt }] }
                    ],
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: 256
                    }
                },
                {
                    headers: { 'Content-Type': 'application/json' }
                }
            );
            // Track token usage (Gemini reports in usageMetadata)
            const usage = response.data.usageMetadata;
            if (usage) tokenUsageService.trackUsage((usage.promptTokenCount || 0) + (usage.candidatesTokenCount || 0));
            return response.data.candidates[0].content.parts[0].text;
        } catch (error) {
            // Log detailed error from Google API
            const errData = error.response?.data?.error;
            if (errData) {
                console.error(`❌ Gemini API error [${errData.code}]: ${errData.message}`);
                console.error(`   Status: ${errData.status || 'unknown'}`);
            }
            throw error;
        }
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
