/**
 * Pruebas del sistema de seguimiento (etiqueta de seguimiento).
 *
 * Regla de negocio que validamos:
 *   - Si el cliente NO responde y NO compra → entra a seguimiento y, pasado el
 *     tiempo configurado, recibe el mensaje + foto con la promo (7 mil / 10 mil)
 *     que insiste en la compra.
 *   - Si el cliente RESPONDE → el seguimiento se pausa (no lo perseguimos).
 *   - Si el cliente PAGA → el seguimiento se cierra y no se reactiva nunca.
 *
 * Usa el test runner nativo de Node (node:test), sin dependencias extra.
 * El servicio es un singleton que persiste en JSON reales, así que respaldamos
 * y restauramos esos archivos alrededor de la suite.
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const followUp = require('../src/services/followUp.service');

const DATA_DIR = path.join(__dirname, '../data');
const CONFIG_PATH = path.join(DATA_DIR, 'follow-up-config.json');
const STATES_PATH = path.join(DATA_DIR, 'follow-up-states.json');

let configBackup;
let statesBackup;
let tmpImage;

before(() => {
    // Respaldar los datos reales para restaurarlos al terminar.
    configBackup = fs.readJsonSync(CONFIG_PATH);
    statesBackup = fs.readJsonSync(STATES_PATH);

    // Foto temporal para que _sendStep encuentre la imagen (existsSync).
    tmpImage = path.join(os.tmpdir(), 'followup-test-promo.jpg');
    fs.writeFileSync(tmpImage, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    // Acelerar los delays internos del envío (por defecto son 2s).
    process.env.RESPONSE_DELAY = '1';
});

after(() => {
    fs.writeJsonSync(CONFIG_PATH, configBackup, { spaces: 2 });
    fs.writeJsonSync(STATES_PATH, statesBackup, { spaces: 2 });
    fs.removeSync(tmpImage);
});

beforeEach(() => {
    // Empezar cada prueba sin estados previos.
    fs.writeJsonSync(STATES_PATH, {});
});

// Sock/servicios simulados para no tocar WhatsApp real.
function makeDeps(historyMessages = []) {
    const sent = [];
    const sock = {
        sendMessage: async (to, content) => {
            sent.push({ to, content });
        }
    };
    const chatHistory = {
        getMessages: async () => ({ messages: historyMessages }),
        addMessage: async () => ({})
    };
    const io = { emit: () => {} };
    const welcome = { markBotSent: () => {} };
    followUp.setDependencies(sock, chatHistory, io, welcome);
    return sent;
}

test('no arma seguimiento si el sistema está desactivado', async () => {
    await followUp.saveConfig({ globalEnabled: false });
    const jid = '111@s.whatsapp.net';

    const armed = await followUp.startFollowUp(jid);

    assert.equal(armed, false);
    assert.equal(await followUp.getState(jid), null);
});

test('arma seguimiento cuando el negocio escribe (cliente aún sin responder)', async () => {
    await followUp.saveConfig({
        globalEnabled: true,
        steps: [{
            id: 'step_test_arm',
            label: 'Paso de prueba',
            delayMinutes: 120,
            enabled: true,
            text: 'Contenido de prueba',
            audioPath: null,
            videoPath: null,
            imagePath: null
        }]
    });
    const jid = '222@s.whatsapp.net';

    const armed = await followUp.startFollowUp(jid);

    assert.equal(armed, true);
    const st = await followUp.getState(jid);
    assert.equal(st.status, 'active');
    assert.equal(st.currentStepIndex, 0);
});

test('pausa el seguimiento si el cliente responde', async () => {
    await followUp.saveConfig({ globalEnabled: true, stopOnReply: true });
    const jid = '333@s.whatsapp.net';
    await followUp.startFollowUp(jid);

    const paused = await followUp.cancelIfClientReplied(jid);

    assert.equal(paused, true);
    const st = await followUp.getState(jid);
    assert.equal(st.status, 'paused');
});

test('cierra el seguimiento tras el pago y no lo revive', async () => {
    await followUp.saveConfig({ globalEnabled: true });
    const jid = '444@s.whatsapp.net';
    await followUp.startFollowUp(jid);

    // El cliente pagó: el flujo llama cancelFollowUp('payment_received').
    await followUp.cancelFollowUp(jid, 'payment_received');
    let st = await followUp.getState(jid);
    assert.equal(st.status, 'closed');

    // Un nuevo mensaje del negocio NO debe reactivar a quien ya compró.
    const armed = await followUp.startFollowUp(jid);
    assert.equal(armed, false);
    st = await followUp.getState(jid);
    assert.equal(st.status, 'closed');
});

test('envía texto de 15.000 COP y foto a quien no compró ni respondió', async () => {
    const jid = '555@s.whatsapp.net';
    const promoText = 'Oferta especial: curso de ciberseguridad ética por $15.000 COP';

    await followUp.saveConfig({
        globalEnabled: true,
        stopOnReply: true,
        steps: [{
            id: 'step_promo',
            label: 'Promo',
            delayMinutes: 0, // vence de inmediato para la prueba
            enabled: true,
            text: promoText,
            audioPath: null,
            videoPath: null,
            imagePath: tmpImage
        }]
    });

    const sent = makeDeps([]); // historial vacío: el cliente NO respondió

    await followUp.startFollowUp(jid);
    await followUp._processQueue();

    const texts = sent.filter(s => s.content.text).map(s => s.content.text);
    const images = sent.filter(s => s.content.image);

    assert.ok(
        texts.some(t => t.includes('$15.000 COP') && t.includes('ciberseguridad ética')),
        'el mensaje debe contener la oferta vigente de $15.000 COP'
    );
    assert.equal(images.length, 1, 'debe enviarse la foto de la promo');
    assert.ok(sent.every(s => s.to === jid), 'todo se envía al cliente correcto');

    const st = await followUp.getState(jid);
    assert.equal(st.currentStepIndex, 1, 'avanza al siguiente paso tras enviar');
    assert.equal(st.history.length, 1);
    assert.equal(st.history[0].ok, true);
});

test('envía primero la imagen de referencia y después la oferta ética de 15.000 COP', async () => {
    const jid = '777@s.whatsapp.net';
    const promoText = [
        'Hola bro 👋 Vi tu interés por aprender ciberseguridad y hacking ético.',
        'El precio de referencia mostrado en la imagen es COL$234.900.',
        'Solo por hoy te dejo el curso en $15.000 COP. Oferta válida hasta las 11:59 p. m. (hora Colombia).',
        'Si no deseas recibir más mensajes, responde NO.'
    ].join('---MSG---');

    await followUp.saveConfig({
        globalEnabled: true,
        stopOnReply: true,
        steps: [{
            id: 'step_reference_offer',
            label: 'Oferta inicial 15.000 COP',
            delayMinutes: 0,
            enabled: true,
            text: promoText,
            imageFirst: true,
            audioPath: null,
            videoPath: null,
            imagePath: tmpImage
        }]
    });

    const sent = makeDeps([]);
    await followUp.startFollowUp(jid);
    await followUp._processQueue();

    assert.ok(sent[0].content.image, 'la imagen de referencia debe enviarse primero');
    assert.deepEqual(
        sent.slice(1).map(item => item.content.text),
        promoText.split('---MSG---'),
        'los textos deben enviarse después de la imagen y en el orden acordado'
    );
    assert.ok(sent.some(item => item.content.text?.includes('$15.000 COP')));
    assert.ok(sent.some(item => item.content.text?.includes('11:59 p. m.')));
    assert.ok(sent.some(item => item.content.text?.includes('responde NO')));
});

test('no envía la promo si el cliente respondió justo antes del envío', async () => {
    const jid = '666@s.whatsapp.net';

    await followUp.saveConfig({
        globalEnabled: true,
        stopOnReply: true,
        steps: [{
            id: 'step_promo',
            label: 'Promo',
            delayMinutes: 0,
            enabled: true,
            text: 'Combo de 7 mil / 10 mil',
            audioPath: null,
            videoPath: null,
            imagePath: null
        }]
    });

    // Historial con un mensaje ENTRANTE reciente: el cliente respondió.
    const future = new Date(Date.now() + 60000).toISOString();
    const sent = makeDeps([{ fromMe: false, timestamp: future }]);

    await followUp.startFollowUp(jid);
    await followUp._processQueue();

    assert.equal(sent.length, 0, 'no se insiste a quien acaba de responder');
    const st = await followUp.getState(jid);
    assert.equal(st.status, 'paused');
});
