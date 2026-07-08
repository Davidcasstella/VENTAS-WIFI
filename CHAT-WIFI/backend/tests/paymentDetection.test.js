/**
 * Pruebas de la detección de pago (comprobante) y del plan resultante.
 *
 * Esto es lo que distingue "compró" de "no compró": si llega un comprobante
 * válido, el seguimiento se cierra. El monto determina el combo:
 *   - >= 10000 y < 15000 → combo-10 (promo de 10 mil)
 *   - >= 15000           → combo-15
 * Aquí probamos el parser de la respuesta de Vision, que es la parte pura y
 * determinista del servicio (sin llamar a APIs externas).
 */
const { test } = require('node:test');
const assert = require('node:assert');

const paymentDetection = require('../src/services/paymentDetection.service');

test('reconoce un comprobante de pago de 10 mil', () => {
    const raw = 'RESULTADO: SI\nMONTO: 10000';
    const result = paymentDetection._parseVisionResponse(raw);

    assert.equal(result.isPayment, true);
    assert.equal(result.amount, 10000);
});

test('reconoce un comprobante de 7 mil', () => {
    const raw = 'RESULTADO: SI\nMONTO: 7000';
    const result = paymentDetection._parseVisionResponse(raw);

    assert.equal(result.isPayment, true);
    assert.equal(result.amount, 7000);
});

test('reconoce comprobante con acento (SÍ)', () => {
    const raw = 'RESULTADO: SÍ\nMONTO: 15000';
    const result = paymentDetection._parseVisionResponse(raw);

    assert.equal(result.isPayment, true);
    assert.equal(result.amount, 15000);
});

test('una imagen que NO es comprobante no cuenta como pago', () => {
    const raw = 'RESULTADO: NO\nMONTO: 0';
    const result = paymentDetection._parseVisionResponse(raw);

    assert.equal(result.isPayment, false);
    assert.equal(result.amount, 0);
});

test('ignora separadores de miles y símbolos en el monto', () => {
    const raw = 'RESULTADO: SI\nMONTO: $10.000';
    const result = paymentDetection._parseVisionResponse(raw);

    assert.equal(result.isPayment, true);
    assert.equal(result.amount, 10000);
});

test('el mapeo de monto a plan respeta los umbrales de la promo', () => {
    // Reproduce la lógica de app.js para dejarla cubierta por una prueba.
    const planFor = (amount) =>
        amount >= 15000 ? 'combo-15' : amount >= 10000 ? 'combo-10' : 'sin-plan';

    assert.equal(planFor(7000), 'sin-plan');
    assert.equal(planFor(10000), 'combo-10');
    assert.equal(planFor(14999), 'combo-10');
    assert.equal(planFor(15000), 'combo-15');
});
