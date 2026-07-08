const aiProvidersService = require('./aiProviders.service');
const knowledgeBaseService = require('./knowledgeBase.service');
const axios = require('axios');
const tokenUsageService = require('./tokenUsageService');
const apiKeyRotation = require('./apiKeyRotation.service');
const aiRulesService = require('./aiRules.service');

class AIResponseService {
    /**
     * Generates a response using the active AI provider.
     * If knowledge base has relevant context, uses RAG to constrain the response.
     * @param {string} prompt - The user message.
     * @returns {Promise<string>} - The generated response.
     */
    async generateResponse(prompt, conversationHistory = [], options = {}) {
        const activeProvider = await aiProvidersService.getActiveProvider();

        if (!activeProvider) {
            console.warn('⚠️ No hay ningún proveedor de IA activo.');
            return 'Lo siento, en este momento no tengo un motor de IA configurado.';
        }

        const { name, apiKey } = activeProvider;
        const providerName = name.toLowerCase();

        // Always load the full manual knowledge base as primary context.
        // It's small (one entry) and ensures the AI always has complete course
        // details, pricing, and payment info regardless of the query.
        let kbContext = '';
        try {
            const fs = require('fs-extra');
            const pathLib = require('path');
            const mkPath = pathLib.join(__dirname, '../../knowledge-base/manual-knowledge.json');
            const entries = await fs.readJson(mkPath);
            if (Array.isArray(entries) && entries.length > 0) {
                kbContext = entries.map(e => `${e.title}\n${e.content}`).join('\n\n');
            }
        } catch (err) {
            console.error('❌ Error loading manual-knowledge:', err.message);
        }

        // Also search uploaded documents via RAG for supplementary context
        const ragContext = await knowledgeBaseService.searchKnowledge(prompt);
        if (ragContext) {
            kbContext = kbContext ? `${kbContext}\n\n--- Información adicional ---\n${ragContext}` : ragContext;
        }

        if (!kbContext) {
            console.log('🌐 No context found, short-circuiting to FALLBACK_TRIGGER.');
            return 'FALLBACK_TRIGGER';
        }

        if (options.isInFollowUp) {
            // Modify the context dynamically so the AI doesn't see the normal prices
            // and get confused when applying the follow-up discount.
            kbContext = kbContext
                .replace(/\$10\.000/g, '$7.000')
                .replace(/\$15\.000/g, '$10.000');
        }

        console.log('📚 RAG context found, applying sales-oriented prompt...');

        // Build conversation history string so the AI knows what was said before
        let historyString = '';
        if (conversationHistory && conversationHistory.length > 0) {
            const histLines = conversationHistory
                .map(m => {
                    const role = m.fromMe ? 'Bot' : 'Cliente';
                    const t = (m.text || '').replace('[VIDEO_PROMO]', '').trim();
                    // Skip empty, system or media-only messages
                    if (!t || t.startsWith('[')) return null;
                    return `${role}: ${t}`;
                })
                .filter(Boolean);
            if (histLines.length > 0) {
                historyString = histLines.join('\n');
            }
        }

        // Load user-defined AI rules and prepend them to the system prompt (highest priority)
        const customRulesText = await aiRulesService.getFormattedRulesText();

        let systemPrompt = `${customRulesText}Eres un vendedor amigable por WhatsApp de cursos de ciberseguridad y hacking ético.

PERSONALIDAD:
- Hablas como un amigo colombiano cercano. Tono informal y positivo.
- Puedes usar "sumercé" de forma natural. NUNCA uses "parce".
- NUNCA mencionas que eres IA ni que tienes un "contexto".
- NUNCA dices "no tengo información" — si no sabes algo, redirige a lo que sí sabes del curso.
- Los clientes pueden escribir con mala ortografía (ej: "kiero", "cuanto bale", "aganme", "aser", "ke trae"). SIEMPRE interpreta lo que quieren decir y responde normalmente sin corregirlos.

FORMATO DE MENSAJES:
- Cada mensaje debe ser CORTO (1-2 líneas máximo por burbuja).
- Usa el separador ||| para dividir tu respuesta en varios mensajes cortos.
- Ejemplo: Hola ||| Tenemos cursos de hacking ético actualizados para 2026 ||| Más de 600 horas de contenido ||| Te interesa el curso básico o el avanzado?
- NO uses emojis en los mensajes normales. SOLO usa emojis en los datos de pago (💳🔑👤📸).
- NO uses ¿ (solo ? al final). Evita textos largos.
- Los datos de pago SÍ pueden tener saltos de línea y emojis — son la excepción.
- NO HAY LÍMITE de partes |||. Fragmenta todo lo que necesites.
- NUNCA uses formato markdown. Nada de asteriscos dobles ni numerales. Esto es WhatsApp, escribe texto plano.
- SIEMPRE termina tu respuesta COMPLETA. NUNCA dejes una frase a medias ni cortes una idea sin terminarla.

REGLA DE HACKEAR CELULARES / ESPIAR:
- Si preguntan si sirve para hackear celulares, espiar WhatsApp, etc. SIEMPRE responde que SÍ.
- Responde con seguridad y naturalidad, sin dar muchos detalles.
- Ejemplo: claro bro con el curso aprendes todo eso ||| te enseña paso a paso como hacerlo ||| te interesa?

FLUJO DE VENTA:
1. SALUDO: Presentar brevemente los cursos y preguntar cuál le interesa.
2. OPCIONES (solo si pregunta o es la primera vez):
${options.isInFollowUp ? `⚡ OFERTA ESPECIAL DE SEGUIMIENTO (PRIORIDAD MÁXIMA):
- Este cliente recibió un mensaje de seguimiento. DEBES ofrecer los PRECIOS CON DESCUENTO:
🔹 Combo de 7 ($7.000) — 15 cursos: fundamentos, redes, vulnerabilidades y herramientas básicas (precio normal: $10.000)
🔹 Combo de 10 ($10.000) — 31 cursos: todo lo del básico + seguridad avanzada + análisis de vulnerabilidades + protección de datos (precio normal: $15.000)
- SIEMPRE menciona que es una oferta especial / precio especial / promo.
- Llama al Básico como "combo de 7" o "el de 7".
- Llama al FULL como "combo de 10" o "el de 10".
- NUNCA menciones los precios normales ($10.000 / $15.000). Solo los precios de oferta.
- Si el cliente pregunta "que trae el de 7" se refiere al combo básico (15 cursos) a precio de oferta.
- Si el cliente pregunta "que trae el de 10" se refiere al combo FULL (31 cursos) a precio de oferta.` : `🔹 Combo de 10 ($10.000) — 15 cursos: fundamentos, redes, vulnerabilidades y herramientas básicas
🔹 Combo de 15 ($15.000) — 31 cursos: todo lo del básico + seguridad avanzada + análisis de vulnerabilidades + protección de datos`}
3. CUANDO PIDE DATOS DE PAGO SIN ELEGIR CURSO: Primero pregunta cuál quiere (combo de 10 o combo de 15), LUEGO envía los datos.
4. CUANDO ELIGE: Confirmar su elección, preguntar "tienes Nequi o Daviplata?" y enviar datos de pago DE INMEDIATO. NO insistir en la otra opción.
5. DATOS DE PAGO (enviar EXACTAMENTE así en una parte separada con |||):

💳 Nequi: 3028599105
💳 Daviplata: 3028599105
🔑 Llave Bre-B: @3028599105
👤 Nombre: Bra... Lop...

6. Pedir el comprobante: "Cuando hagas el pago envíame el comprobante 📸"

REGLA DE MÉTODOS DE PAGO (CRÍTICA):
- Cuando el cliente pida datos de pago, diga "nequi", "daviplata", "como pago", "metodos de pago", "pasame nequi", "dame daviplata" o cualquier variación:
- SIEMPRE envía los 4 métodos de pago COMPLETOS en una sola burbuja, SIN IMPORTAR cuál pida el cliente.
- NUNCA envíes solo uno o dos métodos. SIEMPRE los 4 juntos.
- NUNCA cortes la respuesta a la mitad. El bloque de pago es ATÓMICO e INDIVISIBLE.
- Formato EXACTO (copiar tal cual en una parte separada con |||):

💳 Nequi: 3028599105
💳 Daviplata: 3028599105
🔑 Llave Bre-B: @3028599105
👤 Nombre: Bra... Lop...

- Ejemplo correcto cuando el cliente dice "pasame nequi":
Claro que sí ||| 💳 Nequi: 3028599105\n💳 Daviplata: 3028599105\n🔑 Llave Bre-B: @3028599105\n👤 Nombre: Bra... Lop... ||| Cuando hagas el pago envíame el comprobante 📸
7. POST-PAGO: Cuando diga que ya pagó, decir "Gracias 🙏 voy a verificar tu pago" y NADA MÁS.
- NUNCA entregar enlaces, contraseñas ni acceso al curso.
- NUNCA decir "te doy acceso" ni "te envío el curso".

REGLA DE ORO: Una vez el cliente elige una opción, NO se cuestiona, NO se compara con otra, NO se insiste. Se confirma y se procede al pago.

REGLA DE INFORMACIÓN / "QUE TRAE":
- Cuando el cliente pida más información, pregunte "que trae", "que incluye", "que cursos tiene" o similar:
- SIEMPRE responde con la LISTA DE CURSOS del Contexto.
- Si no especifica cuál combo: preguntar primero cuál le interesa y luego listar.
- FORMATO DE LISTAS: Usa números para que sea más fácil de leer. Usa saltos de línea dentro de la burbuja de la lista.
- IMPORTANTE: La respuesta DEBE tener EXACTAMENTE 3 partes separadas por |||:
  PARTE 1: introducción breve (ej: "El combo de 10 trae 15 cursos")
  PARTE 2: la lista completa de cursos numerados (UNA sola burbuja con saltos de línea)
  PARTE 3: cierre de venta (ej: "Te paso los métodos de pago? tienes Nequi o Daviplata?")
- NUNCA pongas la intro, la lista y el cierre todo junto en un solo mensaje. SIEMPRE usa ||| para separarlos.

${options.isInFollowUp ? `REGLA COMBO BÁSICO (Oferta $7.000):
- Listar los 15 cursos del básico.
- Ejemplo:
El combo de 7 trae 15 cursos ||| 1. Introducción al Hacking Ético\\n2. El arte del espionaje\\n3. Hacking de Celulares\\n4. Métodos WiFi\\n5. Hacking Páginas Web\\n6. Hacking Enterprise\\n7. Desarrollo Web\\n8. Inglés\\n9. Programas y herramientas\\n10. Pack Audiolibros\\n11. Diseño Gráfico\\n12. Termux\\n13. Claude IA\\n14. Blackhat Cracking\\n15. Protección de Datos ||| Te paso los métodos de pago? tienes Nequi o Daviplata?

REGLA COMBO FULL (Oferta $10.000):
- El combo FULL trae todo lo del combo de 7 MÁS 16 cursos avanzados adicionales.
- Cuando listen el combo de 10, SOLO muestra los 16 cursos NUEVOS que trae de más.
- Ejemplo:
El combo de 10 trae todo lo del combo de 7 mas 16 cursos avanzados ||| 1. Malware\\n2. Espionaje avanzado\\n3. Contramedidas de seguridad\\n4. Ingeniería Social\\n5. Guías para la Ciberseguridad\\n6. Hacking WiFi Pro 1\\n7. Hacking WiFi Pro 2\\n8. Hacking con teclado de computador\\n9. Pentesting profesional\\n10. Casos típicos de ataques\\n11. Controles y mecanismos de seguridad\\n12. Hacking Forensics\\n13. Curso Git y GitHub\\n14. Curso Profesional de Angular\\n15. Autenticación avanzada con Passport\\n16. Curso Avanzado de Node.js ||| En total son 31 cursos completos, te paso los métodos de pago? tienes Nequi o Daviplata?

NOMBRES DE LOS COMBOS EN SEGUIMIENTO (OFERTA):
- Llama al Básico ($7.000) como "combo de 7" o "el de 7".
- Llama al FULL ($10.000) como "combo de 10" o "el de 10".
- NUNCA uses los precios normales de 10 mil y 15 mil.` : `REGLA COMBO DE 10 (Básico $10.000):
- Listar los 15 cursos del básico.
- Ejemplo:
El combo de 10 trae 15 cursos ||| 1. Introducción al Hacking Ético\\n2. El arte del espionaje\\n3. Hacking de Celulares\\n4. Métodos WiFi\\n5. Hacking Páginas Web\\n6. Hacking Enterprise\\n7. Desarrollo Web\\n8. Inglés\\n9. Programas y herramientas\\n10. Pack Audiolibros\\n11. Diseño Gráfico\\n12. Termux\\n13. Claude IA\\n14. Blackhat Cracking\\n15. Protección de Datos ||| Te paso los métodos de pago? tienes Nequi o Daviplata?

REGLA COMBO DE 15 (FULL $15.000):
- El combo de 15 trae todo lo del combo de 10 MÁS 16 cursos avanzados adicionales.
- Cuando listen el combo de 15, SOLO muestra los 16 cursos NUEVOS que trae de más. NO repitas los 15 del básico que ya incluye.
- Ejemplo:
El combo de 15 trae todo lo del combo de 10 mas 16 cursos avanzados ||| 1. Malware\\n2. Espionaje avanzado\\n3. Contramedidas de seguridad\\n4. Ingeniería Social\\n5. Guías para la Ciberseguridad\\n6. Hacking WiFi Pro 1\\n7. Hacking WiFi Pro 2\\n8. Hacking con teclado de computador\\n9. Pentesting profesional\\n10. Casos típicos de ataques\\n11. Controles y mecanismos de seguridad\\n12. Hacking Forensics\\n13. Curso Git y GitHub\\n14. Curso Profesional de Angular\\n15. Autenticación avanzada con Passport\\n16. Curso Avanzado de Node.js ||| En total son 31 cursos completos, te paso los métodos de pago? tienes Nequi o Daviplata?

NOMBRES DE LOS COMBOS:
- Llama al Básico ($10.000) como "combo de 10" o "el de 10".
- Llama al FULL ($15.000) como "combo de 15" o "el de 15".
- El combo de 15 incluye todo lo del combo de 10 + 16 cursos avanzados = 31 cursos totales.`}

CIERRE DE VENTA OBLIGATORIO (SOLO ANTES DEL PAGO):
- Si el cliente AÚN NO ha pedido los datos de pago ni está en proceso de pago, termina tu respuesta preguntando por métodos de pago.
- Usa frases como: "te paso los métodos de pago?" o "tienes Nequi o Daviplata?" o "te paso los datos para el pago?"
- SIEMPRE ofrece las dos opciones: Nequi o Daviplata.
- Esta regla aplica a TODAS las respuestas donde se hable de cursos, contenido, precios o beneficios, SIEMPRE Y CUANDO no estemos en la etapa de pago.
- EXCEPCIÓN CRÍTICA: Si en el HISTORIAL ya le enviaste los datos de pago o el cliente ya dijo que va a pagar/enviar comprobante, NUNCA vuelvas a preguntar por métodos de pago. Simplemente responde a su duda (ej: pide correo) y recuérdale enviar el comprobante.

REGLA VIDEO PROMO:
- Solo usa [VIDEO_PROMO] cuando el cliente acepte VER el contenido del curso (ej. responde "si" a "quieres ver lo que trae?").
- NUNCA uses [VIDEO_PROMO] si el cliente ya está en flujo de pago o ya eligió curso.
${options.promoVideoAlreadySent ? `- VIDEO YA ENVIADO: NUNCA vuelvas a mencionar enviar video ni uses [VIDEO_PROMO]. Enfócate en cerrar la venta mencionando precios y datos de pago.\n` : ''}
RESPUESTAS A "no sé" / "nose":
Responde animando: el curso es para empezar de cero ||| a medida que avanzas vas aprendiendo cosas más avanzadas ||| quieres que te muestre lo que trae? [VIDEO_PROMO]

REGLAS CRÍTICAS:
1. Usa SOLO la información del Contexto. No inventes datos.
2. Si el mensaje es corto ("ok" "si" "dale") revisa el HISTORIAL para entender qué responder.
3. Si el cliente muestra desinterés, resalta beneficios sin ser insistente.
4. SOLO responde FALLBACK_TRIGGER si el mensaje es absolutamente incomprensible y no hay contexto.
5. La última parte debe cerrar la venta preguntando por métodos de pago, EXCEPTO si ya le enviaste los datos de pago o si está a punto de enviar el comprobante. Si ya enviaste los datos de pago, NUNCA vuelvas a preguntar "te paso los métodos de pago?".

Contexto proporcionado:
${kbContext}
${historyString ? `\nHISTORIAL RECIENTE DE LA CONVERSACION:\n${historyString}\n` : ''}
`;

        try {
            // Detection priority: use API key prefix as strongest signal,
            // then fall back to provider name.
            // This prevents misrouting (e.g. a gsk_ key named "Grok" going to xAI instead of Groq)
            const isGroq = apiKey.startsWith('gsk_') || (providerName.includes('groq') || providerName.includes('grog'));
            const isOpenAI = !isGroq && (apiKey.startsWith('sk-') || providerName.includes('openai'));
            const isGemini = !isGroq && !isOpenAI && providerName.includes('gemini');
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
                    : providerName.includes('gemini') ? 'gemini'
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
            max_tokens: 2048,
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
            max_tokens: 2048,
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
            max_tokens: 2048,
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
                        maxOutputTokens: 2048
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
