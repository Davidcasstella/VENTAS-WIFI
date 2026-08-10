const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.ENCRYPTION_KEY = '0'.repeat(64);
const aiResponseService = require('../src/services/aiResponse.service');

function startBridge(handler) {
    const server = http.createServer(handler);
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ server, url: `http://127.0.0.1:${port}/v1/chat/completions` });
        });
    });
}

test('callHermes sends authenticated OpenAI-compatible request', async (t) => {
    const { server, url } = await startBridge((req, res) => {
        assert.equal(req.method, 'POST');
        assert.equal(req.headers.authorization, 'Bearer bridge-test-token');
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            const payload = JSON.parse(body);
            assert.deepEqual(payload.messages, [
                { role: 'system', content: 'Reglas comerciales' },
                { role: 'user', content: 'Cuanto cuesta?' },
            ]);
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
                choices: [{ message: { role: 'assistant', content: 'Cuesta 15.000 COP' } }],
            }));
        });
    });
    t.after(() => {
        server.closeAllConnections();
        server.close();
    });

    process.env.HERMES_BRIDGE_URL = url;
    process.env.HERMES_BRIDGE_TOKEN = 'bridge-test-token';
    const response = await aiResponseService.callHermes('Reglas comerciales', 'Cuanto cuesta?');
    assert.equal(response, 'Cuesta 15.000 COP');
});

test('generateResponse prefers Hermes bridge without requiring another active provider', async (t) => {
    const aiProvidersService = require('../src/services/aiProviders.service');
    const manualKnowledgeService = require('../src/services/manualKnowledge.service');
    const knowledgeBaseService = require('../src/services/knowledgeBase.service');
    const aiRulesService = require('../src/services/aiRules.service');

    const originals = {
        getActiveProvider: aiProvidersService.getActiveProvider,
        getAll: manualKnowledgeService.getAll,
        searchKnowledge: knowledgeBaseService.searchKnowledge,
        getAllMediaSummary: knowledgeBaseService.getAllMediaSummary,
        getFormattedRulesText: aiRulesService.getFormattedRulesText,
        callHermes: aiResponseService.callHermes,
    };
    t.after(() => {
        aiProvidersService.getActiveProvider = originals.getActiveProvider;
        manualKnowledgeService.getAll = originals.getAll;
        knowledgeBaseService.searchKnowledge = originals.searchKnowledge;
        knowledgeBaseService.getAllMediaSummary = originals.getAllMediaSummary;
        aiRulesService.getFormattedRulesText = originals.getFormattedRulesText;
        aiResponseService.callHermes = originals.callHermes;
        delete process.env.HERMES_BRIDGE_ENABLED;
    });

    process.env.HERMES_BRIDGE_ENABLED = 'true';
    aiProvidersService.getActiveProvider = async () => null;
    manualKnowledgeService.getAll = async () => [{ title: 'Curso', content: 'Precio 15.000 COP' }];
    knowledgeBaseService.searchKnowledge = async () => '';
    knowledgeBaseService.getAllMediaSummary = async () => '';
    aiRulesService.getFormattedRulesText = async () => '';
    let capturedSystemPrompt = '';
    aiResponseService.callHermes = async (systemPrompt, userPrompt) => {
        capturedSystemPrompt = systemPrompt;
        return `Hermes:${userPrompt}`;
    };

    const response = await aiResponseService.generateResponse('Cuanto cuesta?', []);
    assert.equal(response, 'Hermes:Cuanto cuesta?');
    assert.doesNotMatch(capturedSystemPrompt, /hackear celulares[\s\S]*SIEMPRE responde que SÍ/i);
    assert.match(capturedSystemPrompt, /ciberseguridad ética/i);
});

test('callHermes rejects an empty bridge response', async (t) => {
    const { server, url } = await startBridge((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [] }));
    });
    t.after(() => {
        server.closeAllConnections();
        server.close();
    });

    process.env.HERMES_BRIDGE_URL = url;
    process.env.HERMES_BRIDGE_TOKEN = 'bridge-test-token';
    await assert.rejects(
        aiResponseService.callHermes('Reglas', 'Hola'),
        /respuesta vacía/i,
    );
});
