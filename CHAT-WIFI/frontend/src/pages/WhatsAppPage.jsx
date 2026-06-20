import React, { useState, useEffect } from 'react';
import { RefreshCw, WifiOff, ShieldCheck, QrCode, Info, Smartphone, Hash, Phone, Loader } from 'lucide-react';
import socket from '../services/socket';
import api from '../services/api';

const WhatsAppPage = () => {
    const [qr, setQr] = useState(null);
    const [status, setStatus] = useState('disconnected'); // disconnected, connecting, waiting_qr, waiting_pairing_code, connected
    const [loading, setLoading] = useState(false);
    const [connectionMethod, setConnectionMethod] = useState('qr'); // 'qr' or 'pairing_code'
    const [phoneNumber, setPhoneNumber] = useState('');
    const [pairingCode, setPairingCode] = useState(null);
    const [pairingLoading, setPairingLoading] = useState(false);
    const [pairingError, setPairingError] = useState(null);

    useEffect(() => {
        // Fetch current status on mount
        const fetchStatus = async () => {
            try {
                const { data } = await api.get('/api/whatsapp/status');
                if (data.status) setStatus(data.status);
                if (data.qr) setQr(data.qr);
                if (data.pairingCode) setPairingCode(data.pairingCode);
            } catch (error) {
                console.error('Error al obtener estado inicial:', error);
            }
        };

        fetchStatus();

        // Socket listeners for updates
        socket.on('whatsapp-status', (data) => {
            if (data.status) setStatus(data.status);
            if (data.qr) setQr(data.qr);
            if (data.pairingCode !== undefined) setPairingCode(data.pairingCode);
        });

        socket.on('whatsapp-update', (data) => {
            if (data.status) setStatus(data.status);
            if (data.qr) setQr(data.qr);
            if (data.pairingCode !== undefined) setPairingCode(data.pairingCode);
            if (data.status === 'connected') {
                setQr(null);
                setPairingCode(null);
                setPairingLoading(false);
            }
        });

        return () => {
            socket.off('whatsapp-status');
            socket.off('whatsapp-update');
        };
    }, []);


    const handleRestart = async () => {
        setLoading(true);
        try {
            await api.post('/api/whatsapp/restart');
        } catch (error) {
            console.error('Error al reiniciar WhatsApp:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleClearSession = async () => {
        if (!window.confirm('¿Estás seguro de que quieres cerrar sesión y limpiar todas las credenciales?')) return;
        setLoading(true);
        try {
            await api.post('/api/whatsapp/clear-session');
            setPairingCode(null);
            setPairingError(null);
        } catch (error) {
            console.error('Error al limpiar sesión:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleRequestPairingCode = async () => {
        // Validate phone number
        const cleaned = phoneNumber.replace(/\D/g, '');
        if (!cleaned || cleaned.length < 10 || cleaned.length > 15) {
            setPairingError('Ingresa un número válido (ej: 573028599105)');
            return;
        }

        setPairingLoading(true);
        setPairingError(null);
        setPairingCode(null);

        try {
            const { data } = await api.post('/api/whatsapp/request-pairing-code', { phoneNumber: cleaned });
            if (data.success && data.pairingCode) {
                setPairingCode(data.pairingCode);
            } else {
                setPairingError(data.message || 'Error al generar código');
            }
        } catch (error) {
            const msg = error.response?.data?.message || error.message || 'Error de conexión';
            setPairingError(msg);
        } finally {
            setPairingLoading(false);
        }
    };

    // Format pairing code for display: XXXX-XXXX
    const formatPairingCode = (code) => {
        if (!code) return '';
        const clean = code.replace(/\s/g, '');
        if (clean.length <= 4) return clean;
        return clean.slice(0, 4) + ' - ' + clean.slice(4);
    };

    const getStatusInfo = () => {
        switch (status) {
            case 'connected':
                return {
                    text: 'WhatsApp Conectado',
                    description: 'Tu sesión está activa y lista para enviar mensajes.',
                    color: 'success',
                    icon: <ShieldCheck size={48} className="text-success" />
                };
            case 'waiting_qr':
                return {
                    text: 'Escanea el Código QR',
                    description: 'Abre WhatsApp en tu teléfono > Dispositivos vinculados > Vincular un dispositivo.',
                    color: 'warning',
                    icon: <QrCode size={48} className="text-warning" />
                };
            case 'waiting_pairing_code':
                return {
                    text: 'Ingresa el Código de Emparejamiento',
                    description: 'Introduce el código mostrado en WhatsApp > Dispositivos vinculados > Vincular con número.',
                    color: 'warning',
                    icon: <Hash size={48} className="text-warning" />
                };
            case 'connecting':
                return {
                    text: 'Conectando...',
                    description: 'Estamos preparando el motor de vinculación.',
                    color: 'info',
                    icon: <RefreshCw size={48} className="text-info spin" />
                };
            default:
                return {
                    text: 'Desconectado',
                    description: 'No hay una sesión activa de WhatsApp.',
                    color: 'error',
                    icon: <WifiOff size={48} className="text-error" />
                };
        }
    };

    const info = getStatusInfo();

    return (
        <div className="whatsapp-page-container">
            <header className="page-header" style={{ textAlign: 'center' }}>
                <h1>Vinculación de WhatsApp</h1>
            </header>

            <div className="whatsapp-grid">
                {/* Left Column: Connection Method & Status */}
                <article className="whatsapp-main-card premium-card" style={{ padding: '1.25rem' }}>
                    <div className="card-header">
                        <QrCode size={20} />
                        <h3>Conexión del Dispositivo</h3>
                    </div>

                    <div className="status-banner">
                        <div className={`status-dot ${status}`}></div>
                        <span className="status-text">{info.text}</span>
                    </div>

                    {/* Method Selection Tabs (only show when not connected) */}
                    {status !== 'connected' && (
                        <div className="connection-method-tabs">
                            <button
                                className={`method-tab ${connectionMethod === 'qr' ? 'active' : ''}`}
                                onClick={() => { setConnectionMethod('qr'); setPairingError(null); }}
                            >
                                <QrCode size={16} />
                                Escanear QR
                            </button>
                            <button
                                className={`method-tab ${connectionMethod === 'pairing_code' ? 'active' : ''}`}
                                onClick={() => { setConnectionMethod('pairing_code'); setPairingError(null); }}
                            >
                                <Smartphone size={16} />
                                Código numérico
                            </button>
                        </div>
                    )}

                    <div className="qr-wrapper-section">
                        {status === 'connected' ? (
                            <div className="connected-display" style={{ textAlign: 'center', padding: '1rem' }}>
                                <ShieldCheck size={64} className="text-success" style={{ margin: '0 auto 1.5rem' }} />
                                <h2>¡Dispositivo Vinculado!</h2>
                                <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>El motor de WhatsApp está operando correctamente.</p>
                            </div>
                        ) : connectionMethod === 'qr' ? (
                            /* ========== QR CODE METHOD ========== */
                            <div className="qr-scan-area">
                                <div className="qr-frame">
                                    {qr ? (
                                        <img src={qr} alt="WhatsApp QR" />
                                    ) : (
                                        <div className="qr-loading" style={{ textAlign: 'center', padding: '2rem' }}>
                                            <RefreshCw className="spin" size={48} style={{ margin: '0 auto 1rem', display: 'block' }} />
                                            <p>Generando código...</p>
                                        </div>
                                    )}
                                </div>
                                <p className="qr-hint">Escanea este código desde la app de WhatsApp</p>
                            </div>
                        ) : (
                            /* ========== PAIRING CODE METHOD ========== */
                            <div className="pairing-code-section">
                                {!pairingCode && !pairingLoading && (
                                    <div className="pairing-form">
                                        <div className="pairing-icon-wrapper">
                                            <Phone size={36} className="text-warning" />
                                        </div>
                                        <label className="pairing-label">Número de teléfono con código de país</label>
                                        <div className="phone-input-group">
                                            <span className="phone-prefix">+</span>
                                            <input
                                                type="tel"
                                                className="form-input phone-input"
                                                placeholder="573028599105"
                                                value={phoneNumber}
                                                onChange={(e) => setPhoneNumber(e.target.value.replace(/[^0-9]/g, ''))}
                                                maxLength={15}
                                                onKeyDown={(e) => e.key === 'Enter' && handleRequestPairingCode()}
                                            />
                                        </div>
                                        {pairingError && (
                                            <div className="pairing-error">
                                                <span>⚠️ {pairingError}</span>
                                            </div>
                                        )}
                                        <button
                                            className="btn-premium primary wide pairing-generate-btn"
                                            onClick={handleRequestPairingCode}
                                            disabled={pairingLoading || !phoneNumber}
                                        >
                                            <Hash size={18} />
                                            Generar Código de Emparejamiento
                                        </button>
                                    </div>
                                )}

                                {pairingLoading && (
                                    <div className="pairing-loading">
                                        <Loader size={48} className="spin" />
                                        <p>Generando código de emparejamiento...</p>
                                        <p className="pairing-loading-hint">Esto puede tardar unos segundos</p>
                                    </div>
                                )}

                                {pairingCode && !pairingLoading && (
                                    <div className="pairing-code-result">
                                        <div className="pairing-code-display">
                                            {formatPairingCode(pairingCode).split('').map((char, i) => (
                                                char === '-' ? (
                                                    <span key={i} className="pairing-code-separator">—</span>
                                                ) : char === ' ' ? null : (
                                                    <span key={i} className="pairing-code-digit">{char}</span>
                                                )
                                            ))}
                                        </div>
                                        <p className="pairing-code-instruction">Introduce este código en WhatsApp</p>
                                        <p className="pairing-code-sub-instruction">
                                            WhatsApp → Dispositivos vinculados → Vincular con número de teléfono
                                        </p>
                                        <button
                                            className="btn-premium primary wide"
                                            style={{ marginTop: '1rem' }}
                                            onClick={() => { setPairingCode(null); setPairingError(null); }}
                                        >
                                            <RefreshCw size={16} />
                                            Generar nuevo código
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="whatsapp-actions">
                        {connectionMethod === 'qr' && (
                            <button
                                className="btn-premium primary wide"
                                onClick={handleRestart}
                                disabled={loading || status === 'connected'}
                            >
                                <RefreshCw className={loading ? 'spin' : ''} size={18} />
                                {loading ? 'Generando...' : 'Nuevo Código QR'}
                            </button>
                        )}
                        <button
                            className="btn-premium danger wide"
                            onClick={handleClearSession}
                            disabled={loading}
                        >
                            <WifiOff size={18} /> Cerrar Sesión
                        </button>
                    </div>
                </article>

                {/* Right Column: Instructions & Security */}
                <aside className="whatsapp-side-info">
                    <section className="instruction-card premium-card">
                        <div className="card-header">
                            <Info size={20} />
                            <h3>{connectionMethod === 'qr' ? '¿Cómo vincular con QR?' : '¿Cómo usar el código?'}</h3>
                        </div>
                        <div className="steps-list">
                            {connectionMethod === 'qr' ? (
                                <>
                                    <div className="step-item">
                                        <div className="step-badge">1</div>
                                        <p>Abre <strong>WhatsApp</strong> en tu teléfono móvil.</p>
                                    </div>
                                    <div className="step-item">
                                        <div className="step-badge">2</div>
                                        <p>Ve a <strong>Configuración</strong> o <strong>Menú</strong>.</p>
                                    </div>
                                    <div className="step-item">
                                        <div className="step-badge">3</div>
                                        <p>Selecciona <strong>Dispositivos vinculados</strong>.</p>
                                    </div>
                                    <div className="step-item">
                                        <div className="step-badge">4</div>
                                        <p>Toca en <strong>Vincular un dispositivo</strong> y apunta al QR.</p>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="step-item">
                                        <div className="step-badge">1</div>
                                        <p>Ingresa tu <strong>número de teléfono</strong> con código de país y genera el código.</p>
                                    </div>
                                    <div className="step-item">
                                        <div className="step-badge">2</div>
                                        <p>Abre <strong>WhatsApp</strong> en tu teléfono y ve a <strong>Dispositivos vinculados</strong>.</p>
                                    </div>
                                    <div className="step-item">
                                        <div className="step-badge">3</div>
                                        <p>Toca <strong>Vincular un dispositivo</strong> y selecciona <strong>"Vincular con número de teléfono"</strong>.</p>
                                    </div>
                                    <div className="step-item">
                                        <div className="step-badge">4</div>
                                        <p>Introduce el <strong>código de 8 caracteres</strong> que aparece en pantalla.</p>
                                    </div>
                                </>
                            )}
                        </div>
                    </section>

                    <section className="security-card premium-card">
                        <ShieldCheck size={32} className="text-success" />
                        <div className="security-info">
                            <h4>Conexión Segura</h4>
                            <p>Tus datos y mensajes están protegidos por el cifrado oficial.</p>
                        </div>
                    </section>
                </aside>
            </div>
        </div>
    );
};

export default WhatsAppPage;
