import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { Zap, CreditCard, Mic, Loader2 } from 'lucide-react';

const AIAutomationsPage = () => {
    const [config, setConfig] = useState(null);
    const [responseDelay, setResponseDelay] = useState(1.0);
    const [savingDelay, setSavingDelay] = useState(false);
    const [loading, setLoading] = useState(true);
    const [toggling, setToggling] = useState(null); // which toggle is in progress

    useEffect(() => {
        fetchConfig();
    }, []);

    const fetchConfig = async () => {
        try {
            const [autoRes, welcomeRes] = await Promise.all([
                api.get('/api/ai-automations/config'),
                api.get('/api/welcome-automation/config').catch(() => ({ data: { data: { responseDelay: 1.0 } } }))
            ]);
            setConfig(autoRes.data.config);
            setResponseDelay(welcomeRes.data.data?.responseDelay ?? 1.0);
        } catch (err) {
            console.error('Error fetching automations config:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleDelayChange = async (newVal) => {
        setResponseDelay(newVal);
        setSavingDelay(true);
        try {
            await api.post('/api/welcome-automation/config', { responseDelay: newVal });
        } catch (err) {
            console.error('Error saving response delay:', err);
        } finally {
            setSavingDelay(false);
        }
    };

    const handleToggle = async (field) => {
        if (toggling) return;
        setToggling(field);
        try {
            const { data } = await api.put('/api/ai-automations/config', {
                [field]: !config[field]
            });
            setConfig(data.config);
        } catch (err) {
            console.error('Error updating automation:', err);
        } finally {
            setToggling(null);
        }
    };

    if (loading) {
        return (
            <div className="dashboard-content analytics-dashboard">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '80px 0', color: 'var(--neon-green)' }}>
                    <Loader2 size={24} className="spin-animation" />
                    <span>Cargando configuración...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="dashboard-content analytics-dashboard">
            <header className="analytics-page-header">
                <div>
                    <h1 className="analytics-page-title">
                        <Zap size={28} style={{ marginRight: '10px', color: 'var(--neon-green)' }} />
                        Automatizaciones IA
                    </h1>
                    <p className="analytics-page-sub">
                        Controla las funciones automáticas del chatbot
                    </p>
                </div>
            </header>

            <div className="automations-grid">
                {/* Payment Detection Toggle */}
                <div className={`automation-card ${config?.paymentDetectionEnabled ? 'automation-active' : ''}`}>
                    <div className="automation-card-header">
                        <div className="automation-icon-wrap" style={{ background: config?.paymentDetectionEnabled ? 'rgba(0, 255, 65, 0.15)' : 'rgba(255, 255, 255, 0.05)' }}>
                            <CreditCard size={28} style={{ color: config?.paymentDetectionEnabled ? 'var(--neon-green)' : 'var(--text-secondary)' }} />
                        </div>
                        <label className="automation-switch">
                            <input
                                type="checkbox"
                                checked={config?.paymentDetectionEnabled || false}
                                onChange={() => handleToggle('paymentDetectionEnabled')}
                                disabled={toggling === 'paymentDetectionEnabled'}
                            />
                            <span className="automation-slider"></span>
                        </label>
                    </div>
                    <h3 className="automation-card-title">Verificación de pago por imagen</h3>
                    <p className="automation-card-desc">
                        Cuando un cliente envía una imagen, el sistema analiza si es un comprobante de pago usando IA con visión.
                    </p>
                    <div className={`automation-status-badge ${config?.paymentDetectionEnabled ? 'badge-active' : 'badge-inactive'}`}>
                        {toggling === 'paymentDetectionEnabled' ? (
                            <><Loader2 size={14} className="spin-animation" /> Actualizando...</>
                        ) : config?.paymentDetectionEnabled ? (
                            '● Activo'
                        ) : (
                            '○ Inactivo'
                        )}
                    </div>
                </div>

                {/* Voice Processing Toggle */}
                <div className={`automation-card ${config?.voiceProcessingEnabled ? 'automation-active' : ''}`}>
                    <div className="automation-card-header">
                        <div className="automation-icon-wrap" style={{ background: config?.voiceProcessingEnabled ? 'rgba(0, 255, 65, 0.15)' : 'rgba(255, 255, 255, 0.05)' }}>
                            <Mic size={28} style={{ color: config?.voiceProcessingEnabled ? 'var(--neon-green)' : 'var(--text-secondary)' }} />
                        </div>
                        <label className="automation-switch">
                            <input
                                type="checkbox"
                                checked={config?.voiceProcessingEnabled || false}
                                onChange={() => handleToggle('voiceProcessingEnabled')}
                                disabled={toggling === 'voiceProcessingEnabled'}
                            />
                            <span className="automation-slider"></span>
                        </label>
                    </div>
                    <h3 className="automation-card-title">Procesamiento de voz</h3>
                    <p className="automation-card-desc">
                        Convierte los mensajes de voz a texto y los procesa con la IA para generar respuestas automáticas.
                    </p>
                    <div className={`automation-status-badge ${config?.voiceProcessingEnabled ? 'badge-active' : 'badge-inactive'}`}>
                        {toggling === 'voiceProcessingEnabled' ? (
                            <><Loader2 size={14} className="spin-animation" /> Actualizando...</>
                        ) : config?.voiceProcessingEnabled ? (
                            '● Activo'
                        ) : (
                            '○ Inactivo'
                        )}
                    </div>
                </div>
            </div>

            {/* AI Response Speed (Human Typing Simulation) Control */}
            <div style={{ marginTop: '24px' }}>
                <div className="automation-card automation-active" style={{ maxWidth: '100%', borderLeft: '4px solid #00ff66' }}>
                    <div className="automation-card-header" style={{ justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div className="automation-icon-wrap" style={{ background: 'rgba(0, 255, 102, 0.15)' }}>
                                <Zap size={28} style={{ color: '#00ff66' }} />
                            </div>
                            <div>
                                <h3 className="automation-card-title" style={{ margin: 0 }}>⚡ Velocidad de Respuesta IA (Simulación Humana)</h3>
                                <p className="automation-card-desc" style={{ margin: '4px 0 0 0' }}>
                                    Controla qué tan rápido o despacio escribe y responde el bot para simular que un humano se demora en contestar desde el celular.
                                </p>
                            </div>
                        </div>
                        <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#00ff66', background: 'rgba(0, 255, 102, 0.1)', padding: '6px 14px', borderRadius: '10px', border: '1px solid rgba(0, 255, 102, 0.3)' }}>
                            {savingDelay ? '⏳' : `${Number(responseDelay).toFixed(1)}x`}
                        </div>
                    </div>

                    <div style={{ margin: '20px 0 16px 0', display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Súper Rápido (0.1x)</span>
                        <input
                            type="range"
                            min={0.1}
                            max={3.0}
                            step={0.1}
                            value={responseDelay}
                            onChange={e => handleDelayChange(Number(e.target.value))}
                            style={{ flex: 1, accentColor: '#00ff66', height: '6px', cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Súper Lento (3.0x)</span>
                    </div>

                    {/* Quick Presets */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
                        {[
                            { label: '⚡ Instantáneo (~0.5s)', val: 0.2 },
                            { label: '🏎️ Rápido (~1.5s)', val: 0.5 },
                            { label: '🧑 Humano Normal (~3-4s)', val: 1.0 },
                            { label: '☕ Pausado (~6-7s)', val: 1.8 },
                            { label: '🐢 Súper Lento (~10s+)', val: 2.6 }
                        ].map(preset => (
                            <button
                                key={preset.val}
                                type="button"
                                onClick={() => handleDelayChange(preset.val)}
                                style={{
                                    background: Math.abs(responseDelay - preset.val) < 0.15 ? '#00ff66' : 'rgba(255, 255, 255, 0.05)',
                                    color: Math.abs(responseDelay - preset.val) < 0.15 ? '#000' : '#fff',
                                    border: '1px solid rgba(255, 255, 255, 0.1)',
                                    padding: '8px 14px',
                                    borderRadius: '8px',
                                    fontWeight: 600,
                                    fontSize: '0.85rem',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                }}
                            >
                                {preset.label}
                            </button>
                        ))}
                    </div>

                    <div style={{ background: 'rgba(0, 255, 102, 0.05)', border: '1px dashed rgba(0, 255, 102, 0.25)', borderRadius: '8px', padding: '12px 16px', fontSize: '0.86rem', color: 'rgba(255, 255, 255, 0.85)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                        <span>Tiempo de respuesta estimado para mensaje corto: <strong style={{ color: '#00ff66' }}>~{Math.max(0.3, (1.5 * responseDelay)).toFixed(1)} segundos</strong></span>
                        <span>Para mensaje largo (temarios/combos): <strong style={{ color: '#00ff66' }}>~{Math.max(0.6, (4.0 * responseDelay)).toFixed(1)} segundos</strong></span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AIAutomationsPage;
