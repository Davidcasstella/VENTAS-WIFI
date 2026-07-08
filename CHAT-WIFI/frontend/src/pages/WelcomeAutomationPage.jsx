import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';
import {
    BellRing, Power, Upload, Trash2, Clock, MessageSquare,
    CheckCircle, XCircle, Users, Calendar, AlertCircle, Save,
    RotateCcw, Search, RefreshCw, Settings2, Video, Phone,
    Zap, CreditCard, Mic, Loader2, Timer
} from 'lucide-react';

const WelcomeAutomationPage = () => {
    // ── Tab state ───────────────────────────────────────────────────────
    const [activeTab, setActiveTab] = useState('config');

    // ── Config state ────────────────────────────────────────────────────
    const [config, setConfig] = useState(null);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [resettingConfig, setResettingConfig] = useState(false);
    const [uploadingAudio, setUploadingAudio] = useState(false);
    const [uploadingVideo, setUploadingVideo] = useState(false);
    const [uploadingImage, setUploadingImage] = useState(false);
    const [toast, setToast] = useState(null);

    // Admin number state (moved from PendingChatsPage)
    const [adminNumber, setAdminNumber] = useState('');
    const [savingAdmin, setSavingAdmin] = useState(false);

    // Local editable fields
    const [messageText, setMessageText] = useState('');
    const [cooldownHours, setCooldownHours] = useState(24);
    const [isEnabled, setIsEnabled] = useState(false);
    const [audioFileName, setAudioFileName] = useState(null);
    const [videoFileName, setVideoFileName] = useState(null);
    const [videoEnabled, setVideoEnabled] = useState(false);
    const [imageFileName, setImageFileName] = useState(null);
    const [imageEnabled, setImageEnabled] = useState(false);
    const [messageDelays, setMessageDelays] = useState([]);
    const [responseDelay, setResponseDelay] = useState(1.0);
    const [greetingByTimeEnabled, setGreetingByTimeEnabled] = useState(false);
    const [greetingByTimeMessageIndex, setGreetingByTimeMessageIndex] = useState(3);
    const [postVideoMessage, setPostVideoMessage] = useState('');
    const [postVideoDelays, setPostVideoDelays] = useState([]);

    const fileInputRef = useRef(null);
    const videoInputRef = useRef(null);
    const imageInputRef = useRef(null);
    const dropRef = useRef(null);
    const videoDropRef = useRef(null);
    const imageDropRef = useRef(null);
    const [dragging, setDragging] = useState(false);
    const [draggingVideo, setDraggingVideo] = useState(false);
    const [draggingImage, setDraggingImage] = useState(false);

    // ── Automations state ─────────────────────────────────────────────
    const [automationsConfig, setAutomationsConfig] = useState(null);
    const [togglingAutomation, setTogglingAutomation] = useState(null);

    // ── Load initial data ───────────────────────────────────────────────
    useEffect(() => {
        loadAll();
    }, []);

    // Users auto-refresh now handled by UserControlPanel component

    const loadAll = async () => {
        setLoading(true);
        try {
            const [cfgRes, statsRes, fallbackCfgRes, autoCfgRes] = await Promise.all([
                api.get('/api/welcome-automation/config'),
                api.get('/api/welcome-automation/stats'),
                api.get('/api/ai-fallback/config').catch(() => ({ data: { data: {} } })),
                api.get('/api/ai-automations/config').catch(() => ({ data: { config: {} } }))
            ]);
            const cfg = cfgRes.data.data;
            setConfig(cfg);
            setIsEnabled(cfg.isEnabled);
            setMessageText(cfg.messageText || '');
            setCooldownHours(cfg.cooldownHours || 24);
            setAudioFileName(cfg.audioFilePath ? 'welcome-audio.ogg' : null);
            setVideoFileName(cfg.videoFilePath ? 'welcome-video.mp4' : null);
            setVideoEnabled(cfg.videoEnabled || false);
            if (cfg.imageFilePath) {
                const ext = cfg.imageFilePath.split('.').pop() || 'jpg';
                setImageFileName(`welcome-image.${ext}`);
            } else {
                setImageFileName(null);
            }
            setImageEnabled(cfg.imageEnabled || false);
            setMessageDelays(Array.isArray(cfg.messageDelays) ? cfg.messageDelays : []);
            setResponseDelay(cfg.responseDelay ?? 1.0);
            setGreetingByTimeEnabled(cfg.greetingByTimeEnabled || false);
            setGreetingByTimeMessageIndex(cfg.greetingByTimeMessageIndex || 3);
            setPostVideoMessage(cfg.postVideoMessage || 'si tienes alguna duda me preguntas bro');
            setPostVideoDelays(Array.isArray(cfg.postVideoDelays) ? cfg.postVideoDelays : []);
            setStats(statsRes.data.data);
            // Load admin number from fallback config
            const fbCfg = fallbackCfgRes.data.data;
            setAdminNumber(fbCfg.adminJid?.replace('@s.whatsapp.net', '') || '');
            // Load automations config
            setAutomationsConfig(autoCfgRes.data.config || {});
        } catch (err) {
            showToast('error', 'Error cargando configuración');
        } finally {
            setLoading(false);
        }
    };


    // ── Toast helper ────────────────────────────────────────────────────
    const showToast = (type, msg) => {
        setToast({ type, msg });
        setTimeout(() => setToast(null), 3500);
    };

    // ── Save all config ─────────────────────────────────────────────────
    const handleSave = async () => {
        if (saving) return;
        setSaving(true);
        try {
            const { data } = await api.put('/api/welcome-automation/config', {
                isEnabled,
                messageText,
                cooldownHours: Number(cooldownHours),
                videoEnabled,
                imageEnabled,
                messageDelays,
                responseDelay,
                greetingByTimeEnabled,
                greetingByTimeMessageIndex,
                postVideoMessage,
                postVideoDelays
            });
            setConfig(data.data);
            showToast('success', 'Configuración guardada correctamente');
        } catch {
            showToast('error', 'Error al guardar');
        } finally {
            setSaving(false);
        }
    };

    // ── Reset config to defaults ────────────────────────────────────────
    const handleResetConfig = async () => {
        if (resettingConfig) return;
        if (!window.confirm('¿Estás seguro de resetear toda la configuración a valores por defecto?')) return;
        setResettingConfig(true);
        try {
            const { data } = await api.post('/api/welcome-automation/reset-config');
            const cfg = data.data;
            setConfig(cfg);
            setIsEnabled(cfg.isEnabled);
            setMessageText(cfg.messageText || '');
            setCooldownHours(cfg.cooldownHours || 24);
            setAudioFileName(null);
            setVideoFileName(null);
            setVideoEnabled(false);
            setImageFileName(null);
            setImageEnabled(false);
            setMessageDelays([]);
            setResponseDelay(1.0);
            setGreetingByTimeEnabled(false);
            setGreetingByTimeMessageIndex(3);
            setPostVideoMessage('si tienes alguna duda me preguntas bro');
            setPostVideoDelays([]);
            showToast('success', 'Configuración reseteada a valores por defecto');
        } catch {
            showToast('error', 'Error al resetear configuración');
        } finally {
            setResettingConfig(false);
        }
    };

    // ── Toggle only (quick action) ──────────────────────────────────────
    const handleToggle = async () => {
        const newVal = !isEnabled;
        setIsEnabled(newVal);
        try {
            await api.put('/api/welcome-automation/config', { isEnabled: newVal });
            showToast('success', newVal ? 'Automatización activada' : 'Automatización desactivada');
        } catch {
            setIsEnabled(!newVal); // rollback
            showToast('error', 'Error al cambiar estado');
        }
    };

    // ── Audio upload ────────────────────────────────────────────────────
    const uploadAudio = async (file) => {
        if (!file) return;
        if (!file.name.endsWith('.ogg')) {
            showToast('error', 'Solo se aceptan archivos .ogg');
            return;
        }
        setUploadingAudio(true);
        try {
            const form = new FormData();
            form.append('audio', file);
            await api.post('/api/welcome-automation/audio', form, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            setAudioFileName(file.name);
            showToast('success', 'Audio subido correctamente');
            loadAll();
        } catch (err) {
            showToast('error', err.response?.data?.error || 'Error al subir audio');
        } finally {
            setUploadingAudio(false);
        }
    };

    const handleFileInput = (e) => uploadAudio(e.target.files[0]);

    const handleDeleteAudio = async () => {
        try {
            await api.delete('/api/welcome-automation/audio');
            setAudioFileName(null);
            showToast('success', 'Audio eliminado');
        } catch {
            showToast('error', 'Error al eliminar audio');
        }
    };

    // ── Video upload ─────────────────────────────────────────────────────
    const uploadVideoFile = async (file) => {
        if (!file) return;
        if (!file.name.endsWith('.mp4')) {
            showToast('error', 'Solo se aceptan archivos .mp4');
            return;
        }
        setUploadingVideo(true);
        try {
            const form = new FormData();
            form.append('video', file);
            await api.post('/api/welcome-automation/video', form, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            setVideoFileName(file.name);
            setVideoEnabled(true);
            showToast('success', 'Video subido correctamente');
            loadAll();
        } catch (err) {
            showToast('error', err.response?.data?.error || 'Error al subir video');
        } finally {
            setUploadingVideo(false);
        }
    };

    const handleVideoInput = (e) => uploadVideoFile(e.target.files[0]);

    const handleDeleteVideo = async () => {
        try {
            await api.delete('/api/welcome-automation/video');
            setVideoFileName(null);
            setVideoEnabled(false);
            showToast('success', 'Video eliminado');
        } catch {
            showToast('error', 'Error al eliminar video');
        }
    };

    const handleToggleVideo = async () => {
        const newVal = !videoEnabled;
        setVideoEnabled(newVal);
        try {
            await api.put('/api/welcome-automation/config', { videoEnabled: newVal });
            showToast('success', newVal ? 'Video activado' : 'Video desactivado');
        } catch {
            setVideoEnabled(!newVal);
            showToast('error', 'Error al cambiar estado del video');
        }
    };

    // ── Drag & drop (audio) ──────────────────────────────────────────────
    const onDragOver = (e) => { e.preventDefault(); setDragging(true); };
    const onDragLeave = () => setDragging(false);
    const onDrop = (e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        uploadAudio(file);
    };

    // ── Drag & drop (video) ──────────────────────────────────────────────
    const onDragOverVideo = (e) => { e.preventDefault(); setDraggingVideo(true); };
    const onDragLeaveVideo = () => setDraggingVideo(false);
    const onDropVideo = (e) => {
        e.preventDefault();
        setDraggingVideo(false);
        const file = e.dataTransfer.files[0];
        uploadVideoFile(file);
    };

    // ── Image upload ─────────────────────────────────────────────────────
    const uploadImageFile = async (file) => {
        if (!file) return;
        const validExts = ['.jpg', '.jpeg', '.png', '.webp'];
        const isValid = validExts.some(ext => file.name.toLowerCase().endsWith(ext));
        if (!isValid) {
            showToast('error', 'Solo se aceptan archivos .jpg, .png o .webp');
            return;
        }
        setUploadingImage(true);
        try {
            const form = new FormData();
            form.append('image', file);
            await api.post('/api/welcome-automation/image', form, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            setImageFileName(file.name);
            setImageEnabled(true);
            showToast('success', 'Imagen subida correctamente');
            loadAll();
        } catch (err) {
            showToast('error', err.response?.data?.error || 'Error al subir imagen');
        } finally {
            setUploadingImage(false);
        }
    };

    const handleImageInput = (e) => uploadImageFile(e.target.files[0]);

    const handleDeleteImage = async () => {
        try {
            await api.delete('/api/welcome-automation/image');
            setImageFileName(null);
            setImageEnabled(false);
            showToast('success', 'Imagen eliminada');
        } catch {
            showToast('error', 'Error al eliminar imagen');
        }
    };

    const handleToggleImage = async () => {
        const newVal = !imageEnabled;
        setImageEnabled(newVal);
        try {
            await api.put('/api/welcome-automation/config', { imageEnabled: newVal });
            showToast('success', newVal ? 'Imagen activada' : 'Imagen desactivada');
        } catch {
            setImageEnabled(!newVal);
            showToast('error', 'Error al cambiar estado de la imagen');
        }
    };

    // ── Drag & drop (image) ──────────────────────────────────────────────
    const onDragOverImage = (e) => { e.preventDefault(); setDraggingImage(true); };
    const onDragLeaveImage = () => setDraggingImage(false);
    const onDropImage = (e) => {
        e.preventDefault();
        setDraggingImage(false);
        const file = e.dataTransfer.files[0];
        uploadImageFile(file);
    };


    // ── Save admin number ────────────────────────────────────────────────
    const handleSaveAdmin = async () => {
        if (savingAdmin) return;
        setSavingAdmin(true);
        try {
            const jid = adminNumber.includes('@')
                ? adminNumber
                : `${adminNumber.replace(/\D/g, '')}@s.whatsapp.net`;
            await api.put('/api/ai-fallback/config', { adminJid: jid });
            showToast('success', 'Número de admin guardado');
        } catch {
            showToast('error', 'Error al guardar número');
        } finally {
            setSavingAdmin(false);
        }
    };

    // ── Loading state ───────────────────────────────────────────────────
    if (loading) {
        return (
            <div className="dashboard-content">
                <div className="wa-skeleton-block" style={{ height: 120, borderRadius: 16, marginBottom: 16 }} />
                <div className="wa-skeleton-block" style={{ height: 280, borderRadius: 16, marginBottom: 16 }} />
                <div className="wa-skeleton-block" style={{ height: 160, borderRadius: 16 }} />
            </div>
        );
    }

    return (
        <div className="dashboard-content wa-page">
            {/* ── Toast ── */}
            {toast && (
                <div className={`wa-toast ${toast.type === 'success' ? 'wa-toast-ok' : 'wa-toast-err'}`}>
                    {toast.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                    {toast.msg}
                </div>
            )}

            {/* ── Page Header ── */}
            <header className="analytics-page-header">
                <div>
                    <h1 className="analytics-page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <BellRing size={28} />
                        Control de Bienvenida 24H
                    </h1>
                    <p className="analytics-page-sub">
                        Gestión completa del sistema de bienvenida automática
                    </p>
                </div>

                {/* Master toggle (large) */}
                <div className="wa-header-toggle">
                    <span className="wa-toggle-label-text" style={{ color: isEnabled ? '#00ff00' : 'var(--text-muted)' }}>
                        {isEnabled ? 'ACTIVO' : 'INACTIVO'}
                    </span>
                    <button
                        className={`ai-toggle-btn-large ${isEnabled ? 'toggle-on' : 'toggle-off'}`}
                        onClick={handleToggle}
                    >
                        <span className="ai-toggle-thumb-large" />
                    </button>
                </div>
            </header>

            {/* ── Stats bar ── */}
            <div className="wa-stats-row">
                <div className="wa-stat-card premium-card">
                    <Users size={20} style={{ color: '#00ff00' }} />
                    <div>
                        <span className="wa-stat-value">{stats?.totalUsers ?? 0}</span>
                        <span className="wa-stat-label">Clientes registrados</span>
                    </div>
                </div>
                <div className="wa-stat-card premium-card">
                    <Calendar size={20} style={{ color: '#00ff00' }} />
                    <div>
                        <span className="wa-stat-value">{stats?.sentLast24h ?? 0}</span>
                        <span className="wa-stat-label">Enviados hoy</span>
                    </div>
                </div>
                <div className="wa-stat-card premium-card">
                    <Clock size={20} style={{ color: '#ffaa00' }} />
                    <div>
                        <span className="wa-stat-value">{cooldownHours}h</span>
                        <span className="wa-stat-label">Cooldown activo</span>
                    </div>
                </div>
                <div className={`wa-stat-card premium-card ${isEnabled ? 'wa-stat-on' : 'wa-stat-off'}`}>
                    <Power size={20} style={{ color: isEnabled ? '#00ff00' : '#ff4444' }} />
                    <div>
                        <span className="wa-stat-value" style={{ color: isEnabled ? '#00ff00' : '#ff4444' }}>
                            {isEnabled ? 'ON' : 'OFF'}
                        </span>
                        <span className="wa-stat-label">Estado del módulo</span>
                    </div>
                </div>
            </div>

            {/* ── Tabs ── */}
            <div className="wa-tabs">
                <button
                    className={`wa-tab ${activeTab === 'config' ? 'wa-tab-active' : ''}`}
                    onClick={() => setActiveTab('config')}
                >
                    <Settings2 size={16} />
                    Configuración
                </button>
                <button
                    className={`wa-tab ${activeTab === 'automations' ? 'wa-tab-active' : ''}`}
                    onClick={() => setActiveTab('automations')}
                >
                    <Zap size={16} />
                    Automatizaciones IA
                </button>
            </div>

            {/* ═══════════════════════════════════════════════════════════
                TAB 1: CONFIGURATION
                ═══════════════════════════════════════════════════════════ */}
            {activeTab === 'config' && (
                <div className="wa-grid">
                    {/* ── LEFT COLUMN: Message + Cooldown ── */}
                    <div className="wa-col">

                        {/* Message editor */}
                        <div className="premium-card wa-card">
                            <div className="wa-card-header">
                                <MessageSquare size={20} style={{ color: '#00ff00' }} />
                                <span className="wa-card-title">Mensaje de Bienvenida</span>
                            </div>
                            <p className="wa-card-desc" style={{ marginBottom: '1rem' }}>
                                Este texto se enviará <strong>después del audio</strong>. <br/>
                                <span style={{ color: '#00ff00', fontSize: '0.85rem' }}>💡 Tip: Si quieres mandar múltiples mensajes separados, usa la opción "+ Añadir otro globo de mensaje".</span>
                            </p>
                            <textarea
                                className="wa-textarea"
                                value={messageText}
                                onChange={e => setMessageText(e.target.value)}
                                placeholder="Escribe tu mensaje de bienvenida aquí..."
                                rows={10}
                                maxLength={10000}
                            />
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
                                <button 
                                    className="wa-refresh-btn" 
                                    style={{ margin: 0, padding: '6px 12px', fontSize: '0.85rem', background: 'rgba(0, 255, 0, 0.1)', color: '#00ff00', border: '1px solid rgba(0, 255, 0, 0.2)' }}
                                    onClick={() => setMessageText(prev => prev + '\n\n---MSG---\n\n')}
                                    title="Separa el texto en múltiples globos de mensaje"
                                >
                                    + Añadir otro globo de mensaje
                                </button>
                                <div className="wa-char-count" style={{ marginTop: 0 }}>{messageText.length} / 10000</div>
                            </div>

                            {/* ── Message Delays Preview ── */}
                            {(() => {
                                // Keep empty parts so delay controls appear immediately when adding a new message
                                const rawParts = messageText.split('---MSG---').map(p => p.trim());
                                // Only filter empty parts if there's no separator at all (single message)
                                const parts = rawParts.length > 1 ? rawParts : rawParts.filter(p => p.length > 0);
                                if (parts.length <= 1) return null;
                                return (
                                    <div className="wa-delays-section">
                                        <div className="wa-delays-header">
                                            <Timer size={18} style={{ color: '#ffaa00' }} />
                                            <span className="wa-delays-title">Tiempos de espera entre mensajes</span>
                                            <span className="wa-delays-subtitle">Configura cuántos segundos esperar antes de cada mensaje</span>
                                        </div>
                                        <div className="wa-delays-list">
                                            {parts.map((part, idx) => {
                                                const preview = part.length > 80 ? part.substring(0, 80) + '…' : (part || '(mensaje vacío — escribe el texto arriba)');
                                                const isEmpty = !part;
                                                return (
                                                    <React.Fragment key={idx}>
                                                        <div className={`wa-delay-msg-preview ${isEmpty ? 'wa-delay-msg-empty' : ''}`}>
                                                            <div className="wa-delay-msg-num">{idx + 1}</div>
                                                            <div className="wa-delay-msg-text">{preview}</div>
                                                        </div>
                                                        {idx < parts.length - 1 && (
                                                            <div className="wa-delay-control">
                                                                <div className="wa-delay-control-icon">⏳</div>
                                                                <input
                                                                    type="range"
                                                                    className="wa-delay-slider"
                                                                    min={0}
                                                                    max={60}
                                                                    step={1}
                                                                    value={messageDelays[idx] ?? 2}
                                                                    onChange={e => {
                                                                        const val = Number(e.target.value);
                                                                        setMessageDelays(prev => {
                                                                            const next = [...prev];
                                                                            // Ensure array is long enough
                                                                            while (next.length <= idx) next.push(2);
                                                                            next[idx] = val;
                                                                            return next;
                                                                        });
                                                                    }}
                                                                />
                                                                <div className="wa-delay-input-wrap">
                                                                    <input
                                                                        type="number"
                                                                        className="wa-delay-input"
                                                                        min={0}
                                                                        max={60}
                                                                        value={messageDelays[idx] ?? 2}
                                                                        onChange={e => {
                                                                            const val = Math.max(0, Math.min(60, Number(e.target.value) || 0));
                                                                            setMessageDelays(prev => {
                                                                                const next = [...prev];
                                                                                while (next.length <= idx) next.push(2);
                                                                                next[idx] = val;
                                                                                return next;
                                                                            });
                                                                        }}
                                                                    />
                                                                    <span className="wa-delay-unit">seg</span>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </React.Fragment>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>

                        {/* Response Speed Slider */}
                        <div className="premium-card wa-card">
                            <div className="wa-card-header">
                                <Zap size={20} style={{ color: responseDelay <= 0.8 ? '#00ff41' : responseDelay >= 2.0 ? '#ff4444' : '#ffaa00' }} />
                                <span className="wa-card-title">Velocidad de respuestas IA</span>
                            </div>
                            <p className="wa-card-desc">
                                Controla qué tan rápido o lento responde la IA entre mensajes. Un valor más alto simula mejor a un humano escribiendo.
                            </p>
                            <div className="wa-speed-control">
                                <span className="wa-speed-label wa-speed-fast">⚡ Rápido</span>
                                <input
                                    type="range"
                                    className="wa-delay-slider wa-speed-slider"
                                    min={0.5}
                                    max={10.0}
                                    step={0.5}
                                    value={responseDelay}
                                    onChange={e => setResponseDelay(Number(e.target.value))}
                                />
                                <span className="wa-speed-label wa-speed-slow">🐢 Lento</span>
                                <div className="wa-speed-value">{responseDelay.toFixed(1)}x</div>
                            </div>
                        </div>

                        {/* Greeting by Time Toggle */}
                        <div className="premium-card wa-card">
                            <div className="wa-card-header">
                                <Clock size={20} style={{ color: greetingByTimeEnabled ? '#00ff41' : '#666' }} />
                                <span className="wa-card-title">Saludo por hora (Mensaje {greetingByTimeMessageIndex})</span>
                                <label className="wa-toggle-switch" style={{ marginLeft: 'auto' }}>
                                    <input
                                        type="checkbox"
                                        checked={greetingByTimeEnabled}
                                        onChange={e => setGreetingByTimeEnabled(e.target.checked)}
                                    />
                                    <span className="wa-toggle-slider"></span>
                                </label>
                            </div>
                            <p className="wa-card-desc">
                                Cuando está activo, el <strong>mensaje #{greetingByTimeMessageIndex}</strong> de bienvenida se reemplaza automáticamente con un saludo según la hora actual en Colombia.
                            </p>
                            {greetingByTimeEnabled && (
                                <>
                                    {/* Message index selector */}
                                    <div style={{
                                        display: 'flex', alignItems: 'center', gap: '0.75rem',
                                        padding: '0.75rem 1rem', marginBottom: '0.75rem',
                                        background: 'rgba(0,255,0,0.04)',
                                        border: '1px solid rgba(0,255,0,0.12)',
                                        borderRadius: '10px',
                                    }}>
                                        <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.6)', whiteSpace: 'nowrap' }}>
                                            Aplicar en mensaje #
                                        </span>
                                        <select
                                            value={greetingByTimeMessageIndex}
                                            onChange={e => setGreetingByTimeMessageIndex(Number(e.target.value))}
                                            style={{
                                                background: 'rgba(0,0,0,0.4)',
                                                border: '1px solid rgba(0,255,0,0.3)',
                                                borderRadius: '8px',
                                                color: '#00ff00',
                                                padding: '0.4rem 0.7rem',
                                                fontSize: '0.9rem',
                                                fontWeight: 700,
                                                cursor: 'pointer',
                                                outline: 'none',
                                            }}
                                        >
                                            {Array.from({ length: Math.max(messageText.split('---MSG---').filter(p => p.trim()).length, 1) }, (_, i) => (
                                                <option key={i + 1} value={i + 1}>Mensaje {i + 1}</option>
                                            ))}
                                        </select>
                                        <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.35)' }}>
                                            de {Math.max(messageText.split('---MSG---').filter(p => p.trim()).length, 1)} mensajes
                                        </span>
                                    </div>

                                    <div className="wa-greeting-preview">
                                        <div className="wa-greeting-times">
                                            <div className="wa-greeting-time-item">
                                                <span className="wa-greeting-icon">🌅</span>
                                                <span>5:00 – 11:59</span>
                                                <span className="wa-greeting-text">Buenos días</span>
                                            </div>
                                            <div className="wa-greeting-time-item">
                                                <span className="wa-greeting-icon">☀️</span>
                                                <span>12:00 – 17:59</span>
                                                <span className="wa-greeting-text">Buenas tardes</span>
                                            </div>
                                            <div className="wa-greeting-time-item">
                                                <span className="wa-greeting-icon">🌙</span>
                                                <span>18:00 – 4:59</span>
                                                <span className="wa-greeting-text">Buenas noches</span>
                                            </div>
                                        </div>
                                        <div className="wa-greeting-current">
                                            Ahora en Colombia → <strong>{(() => {
                                                const h = parseInt(new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', hour12: false }).format(new Date()));
                                                return h >= 5 && h < 12 ? '🌅 Buenos días' : h >= 12 && h < 18 ? '☀️ Buenas tardes' : '🌙 Buenas noches';
                                            })()}</strong>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Post-Video Follow-up Messages */}
                        <div className="premium-card wa-card">
                            <div className="wa-card-header">
                                <Video size={20} style={{ color: '#00ff00' }} />
                                <span className="wa-card-title">Mensajes después del video</span>
                            </div>
                            <p className="wa-card-desc" style={{ marginBottom: '1rem' }}>
                                Estos mensajes se envían automáticamente <strong>después de enviar el video promo</strong>. Déjalo vacío para no enviar nada.<br/>
                                <span style={{ color: '#00ff00', fontSize: '0.85rem' }}>💡 Tip: Usa "+ Añadir otro globo" para enviar múltiples mensajes separados con tiempos configurables.</span>
                            </p>
                            <textarea
                                className="wa-textarea"
                                value={postVideoMessage}
                                onChange={e => setPostVideoMessage(e.target.value)}
                                placeholder="Ej: si tienes alguna duda me preguntas bro"
                                rows={4}
                                maxLength={2000}
                            />
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
                                <button 
                                    className="wa-refresh-btn" 
                                    style={{ margin: 0, padding: '6px 12px', fontSize: '0.85rem', background: 'rgba(0, 255, 0, 0.1)', color: '#00ff00', border: '1px solid rgba(0, 255, 0, 0.2)' }}
                                    onClick={() => setPostVideoMessage(prev => prev + '\n\n---MSG---\n\n')}
                                    title="Separa el texto en múltiples globos de mensaje"
                                >
                                    + Añadir otro globo de mensaje
                                </button>
                                <div className="wa-char-count" style={{ marginTop: 0 }}>{postVideoMessage.length} / 2000</div>
                            </div>

                            {/* Post-video Message Delays Preview */}
                            {(() => {
                                const rawParts = postVideoMessage.split('---MSG---').map(p => p.trim());
                                const parts = rawParts.length > 1 ? rawParts : rawParts.filter(p => p.length > 0);
                                if (parts.length < 1) return null;
                                return (
                                    <div className="wa-delays-section">
                                        <div className="wa-delays-header">
                                            <Timer size={18} style={{ color: '#ffaa00' }} />
                                            <span className="wa-delays-title">Tiempos de espera</span>
                                            <span className="wa-delays-subtitle">Tiempo antes de cada mensaje (el primero es después del video)</span>
                                        </div>
                                        <div className="wa-delays-list">
                                            {parts.map((part, idx) => {
                                                const preview = part.length > 80 ? part.substring(0, 80) + '…' : (part || '(mensaje vacío)');
                                                const isEmpty = !part;
                                                return (
                                                    <React.Fragment key={idx}>
                                                        <div className={`wa-delay-msg-preview ${isEmpty ? 'wa-delay-msg-empty' : ''}`}>
                                                            <div className="wa-delay-msg-num">{idx + 1}</div>
                                                            <div className="wa-delay-msg-text">{preview}</div>
                                                        </div>
                                                        {/* Delay control BEFORE this message */}
                                                        <div className="wa-delay-control">
                                                            <div className="wa-delay-control-icon">⏳</div>
                                                            <input
                                                                type="range"
                                                                className="wa-delay-slider"
                                                                min={0}
                                                                max={60}
                                                                step={1}
                                                                value={postVideoDelays[idx] ?? (idx === 0 ? 3 : 2)}
                                                                onChange={e => {
                                                                    const val = Number(e.target.value);
                                                                    setPostVideoDelays(prev => {
                                                                        const next = [...prev];
                                                                        while (next.length <= idx) next.push(idx === 0 ? 3 : 2);
                                                                        next[idx] = val;
                                                                        return next;
                                                                    });
                                                                }}
                                                            />
                                                            <div className="wa-delay-input-wrap">
                                                                <input
                                                                    type="number"
                                                                    className="wa-delay-input"
                                                                    min={0}
                                                                    max={60}
                                                                    value={postVideoDelays[idx] ?? (idx === 0 ? 3 : 2)}
                                                                    onChange={e => {
                                                                        const val = Math.max(0, Math.min(60, Number(e.target.value) || 0));
                                                                        setPostVideoDelays(prev => {
                                                                            const next = [...prev];
                                                                            while (next.length <= idx) next.push(idx === 0 ? 3 : 2);
                                                                            next[idx] = val;
                                                                            return next;
                                                                        });
                                                                    }}
                                                                />
                                                                <span className="wa-delay-unit">seg</span>
                                                            </div>
                                                        </div>
                                                        {idx < parts.length - 1 && (
                                                            <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', margin: '4px 0' }} />
                                                        )}
                                                    </React.Fragment>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>

                        {/* Cooldown */}
                        <div className="premium-card wa-card">
                            <div className="wa-card-header">
                                <Clock size={20} style={{ color: '#ffaa00' }} />
                                <span className="wa-card-title">Cooldown (horas)</span>
                            </div>
                            <p className="wa-card-desc">
                                Tiempo mínimo entre bienvenidas para el mismo cliente. Por defecto: 24 horas.
                            </p>
                            <div className="wa-cooldown-row">
                                <input
                                    type="number"
                                    className="wa-number-input"
                                    value={cooldownHours}
                                    onChange={e => setCooldownHours(Math.max(1, Number(e.target.value)))}
                                    min={1}
                                    max={720}
                                />
                                <span className="wa-cooldown-unit">horas</span>
                                {/* Quick presets */}
                                {[12, 24, 48, 168].map(h => (
                                    <button
                                        key={h}
                                        className={`wa-preset-btn ${cooldownHours === h ? 'active' : ''}`}
                                        onClick={() => setCooldownHours(h)}
                                    >
                                        {h === 168 ? '7d' : `${h}h`}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Admin number config */}
                        <div className="premium-card wa-card">
                            <div className="wa-card-header">
                                <Phone size={20} style={{ color: '#00ff00' }} />
                                <span className="wa-card-title">Número del Administrador</span>
                            </div>
                            <p className="wa-card-desc">
                                Cuando la IA no sepa responder, se enviará una notificación a este número por WhatsApp.
                            </p>
                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                                <input
                                    type="text"
                                    className="wa-number-input"
                                    placeholder="Ej: 573028599105"
                                    value={adminNumber}
                                    onChange={e => setAdminNumber(e.target.value)}
                                    style={{ flex: 1, fontSize: '0.95rem' }}
                                />
                                <button
                                    className="wa-admin-save-btn"
                                    onClick={handleSaveAdmin}
                                    disabled={savingAdmin}
                                >
                                    <Save size={16} />
                                    {savingAdmin ? 'Guardando...' : 'Guardar'}
                                </button>
                            </div>
                        </div>

                        {/* Action buttons */}
                        <div className="wa-action-buttons">
                            <button className="wa-save-btn" onClick={handleSave} disabled={saving}>
                                <Save size={18} />
                                {saving ? 'Guardando...' : 'Guardar configuración'}
                            </button>
                            <button
                                className="wa-reset-defaults-btn"
                                onClick={handleResetConfig}
                                disabled={resettingConfig}
                            >
                                <Trash2 size={16} />
                                {resettingConfig ? 'Reseteando...' : 'Resetear a valores por defecto'}
                            </button>
                        </div>
                    </div>

                    {/* ── RIGHT COLUMN: Audio ── */}
                    <div className="wa-col">
                        <div className="premium-card wa-card">
                            <div className="wa-card-header">
                                <BellRing size={20} style={{ color: '#00ee00' }} />
                                <span className="wa-card-title">Audio de Bienvenida (.ogg)</span>
                            </div>
                            <p className="wa-card-desc">
                                Se envía <strong>antes del mensaje</strong> como nota de voz (PTT). Si no hay audio, solo se envía el texto.
                            </p>

                            {/* Current audio status */}
                            {audioFileName ? (
                                <div className="wa-audio-present">
                                    <div className="wa-audio-info">
                                        <div className="wa-audio-icon">🔊</div>
                                        <div>
                                            <span className="wa-audio-name">{audioFileName}</span>
                                            <span className="wa-audio-badge">Activo</span>
                                        </div>
                                    </div>
                                    <button className="wa-audio-delete-btn" onClick={handleDeleteAudio}>
                                        <Trash2 size={16} />
                                        Eliminar
                                    </button>
                                </div>
                            ) : (
                                <div className="wa-audio-empty">
                                    <span className="wa-audio-empty-icon">🔇</span>
                                    <span>Sin audio configurado — solo se enviará texto</span>
                                </div>
                            )}

                            {/* Drop zone */}
                            <div
                                ref={dropRef}
                                className={`wa-dropzone ${dragging ? 'wa-dropzone-drag' : ''} ${uploadingAudio ? 'wa-dropzone-loading' : ''}`}
                                onDragOver={onDragOver}
                                onDragLeave={onDragLeave}
                                onDrop={onDrop}
                                onClick={() => !uploadingAudio && fileInputRef.current?.click()}
                            >
                                {uploadingAudio ? (
                                    <div className="wa-upload-spinner" />
                                ) : (
                                    <>
                                        <Upload size={28} style={{ color: '#00ee00', marginBottom: 8 }} />
                                        <span className="wa-dropzone-text">
                                            {dragging ? 'Suelta el archivo aquí...' : 'Arrastra un .ogg o haz clic para seleccionar'}
                                        </span>
                                        <span className="wa-dropzone-hint">Máximo 10 MB · Solo formato .ogg</span>
                                    </>
                                )}
                            </div>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".ogg,audio/ogg"
                                style={{ display: 'none' }}
                                onChange={handleFileInput}
                            />
                        </div>

                        {/* Image card */}
                        <div className="premium-card wa-card">
                            <div className="wa-card-header" style={{ justifyContent: 'space-between' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{ fontSize: '1.2rem' }}>🖼️</span>
                                    <span className="wa-card-title">Imagen de Bienvenida (.jpg, .png)</span>
                                </div>
                                {imageFileName && (
                                    <button
                                        className={`ai-toggle-btn ${imageEnabled ? 'toggle-on' : 'toggle-off'}`}
                                        onClick={handleToggleImage}
                                        title={imageEnabled ? 'Desactivar imagen' : 'Activar imagen'}
                                    >
                                        <span className="ai-toggle-thumb" />
                                    </button>
                                )}
                            </div>
                            <p className="wa-card-desc">
                                Se envía <strong>justo después del primer globo de texto</strong>.
                            </p>

                            {imageFileName ? (
                                <div className="wa-audio-present">
                                    <div className="wa-audio-info">
                                        <div className="wa-audio-icon">🖼️</div>
                                        <div>
                                            <span className="wa-audio-name">{imageFileName}</span>
                                            <span className={`wa-audio-badge ${imageEnabled ? '' : 'wa-badge-off'}`}
                                                style={!imageEnabled ? { background: '#374151', color: '#9ca3af' } : {}}
                                            >
                                                {imageEnabled ? 'Activa' : 'Desactivada'}
                                            </span>
                                        </div>
                                    </div>
                                    <button className="wa-audio-delete-btn" onClick={handleDeleteImage}>
                                        <Trash2 size={16} />
                                        Eliminar
                                    </button>
                                </div>
                            ) : (
                                <div className="wa-audio-empty">
                                    <span className="wa-audio-empty-icon">📭</span>
                                    <span>Sin imagen configurada</span>
                                </div>
                            )}

                            {/* Image drop zone */}
                            <div
                                ref={imageDropRef}
                                className={`wa-dropzone ${draggingImage ? 'wa-dropzone-drag' : ''} ${uploadingImage ? 'wa-dropzone-loading' : ''}`}
                                onDragOver={onDragOverImage}
                                onDragLeave={onDragLeaveImage}
                                onDrop={onDropImage}
                                onClick={() => !uploadingImage && imageInputRef.current?.click()}
                            >
                                {uploadingImage ? (
                                    <div className="wa-upload-spinner" />
                                ) : (
                                    <>
                                        <Upload size={28} style={{ color: '#00ff00', marginBottom: 8 }} />
                                        <span className="wa-dropzone-text">
                                            {draggingImage ? 'Suelta la imagen aquí...' : 'Arrastra una imagen o haz clic'}
                                        </span>
                                        <span className="wa-dropzone-hint">Máximo 10 MB · JPG, PNG, WEBP</span>
                                    </>
                                )}
                            </div>
                            <input
                                ref={imageInputRef}
                                type="file"
                                accept=".jpg,.jpeg,.png,.webp,image/*"
                                style={{ display: 'none' }}
                                onChange={handleImageInput}
                            />
                        </div>

                        {/* Video card */}
                        <div className="premium-card wa-card">
                            <div className="wa-card-header" style={{ justifyContent: 'space-between' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <Video size={20} style={{ color: '#00ff00' }} />
                                    <span className="wa-card-title">Video de Bienvenida (.mp4)</span>
                                </div>
                                {videoFileName && (
                                    <button
                                        className={`ai-toggle-btn ${videoEnabled ? 'toggle-on' : 'toggle-off'}`}
                                        onClick={handleToggleVideo}
                                        title={videoEnabled ? 'Desactivar video' : 'Activar video'}
                                    >
                                        <span className="ai-toggle-thumb" />
                                    </button>
                                )}
                            </div>
                            <p className="wa-card-desc">
                                Se envía <strong>después del texto</strong> y <strong>antes de la respuesta IA</strong>. Puedes activar/desactivar sin eliminarlo.
                            </p>

                            {videoFileName ? (
                                <div className="wa-audio-present">
                                    <div className="wa-audio-info">
                                        <div className="wa-audio-icon">🎬</div>
                                        <div>
                                            <span className="wa-audio-name">{videoFileName}</span>
                                            <span className={`wa-audio-badge ${videoEnabled ? '' : 'wa-badge-off'}`}
                                                style={!videoEnabled ? { background: '#374151', color: '#9ca3af' } : {}}
                                            >
                                                {videoEnabled ? 'Activo' : 'Desactivado'}
                                            </span>
                                        </div>
                                    </div>
                                    <button className="wa-audio-delete-btn" onClick={handleDeleteVideo}>
                                        <Trash2 size={16} />
                                        Eliminar
                                    </button>
                                </div>
                            ) : (
                                <div className="wa-audio-empty">
                                    <span className="wa-audio-empty-icon">📭</span>
                                    <span>Sin video configurado — solo se enviará audio y texto</span>
                                </div>
                            )}

                            {/* Video drop zone */}
                            <div
                                ref={videoDropRef}
                                className={`wa-dropzone ${draggingVideo ? 'wa-dropzone-drag' : ''} ${uploadingVideo ? 'wa-dropzone-loading' : ''}`}
                                onDragOver={onDragOverVideo}
                                onDragLeave={onDragLeaveVideo}
                                onDrop={onDropVideo}
                                onClick={() => !uploadingVideo && videoInputRef.current?.click()}
                            >
                                {uploadingVideo ? (
                                    <div className="wa-upload-spinner" />
                                ) : (
                                    <>
                                        <Upload size={28} style={{ color: '#00ff00', marginBottom: 8 }} />
                                        <span className="wa-dropzone-text">
                                            {draggingVideo ? 'Suelta el archivo aquí...' : 'Arrastra un .mp4 o haz clic para seleccionar'}
                                        </span>
                                        <span className="wa-dropzone-hint">Máximo 50 MB · Solo formato .mp4</span>
                                    </>
                                )}
                            </div>
                            <input
                                ref={videoInputRef}
                                type="file"
                                accept=".mp4,video/mp4"
                                style={{ display: 'none' }}
                                onChange={handleVideoInput}
                            />
                        </div>

                    </div>
                </div>
            )}

            {/* ═══════════════════════════════════════════════════════════
                TAB 2: AUTOMATIONS (payment detection + voice processing)
                ═══════════════════════════════════════════════════════════ */}
            {activeTab === 'automations' && (
                <div style={{ marginTop: '1rem' }}>
                    <div className="automations-grid">
                        {/* Payment Detection Toggle */}
                        <div className={`automation-card ${automationsConfig?.paymentDetectionEnabled ? 'automation-active' : ''}`}>
                            <div className="automation-card-header">
                                <div className="automation-icon-wrap" style={{ background: automationsConfig?.paymentDetectionEnabled ? 'rgba(0, 255, 65, 0.15)' : 'rgba(255, 255, 255, 0.05)' }}>
                                    <CreditCard size={28} style={{ color: automationsConfig?.paymentDetectionEnabled ? 'var(--neon-green)' : 'var(--text-secondary)' }} />
                                </div>
                                <label className="automation-switch">
                                    <input
                                        type="checkbox"
                                        checked={automationsConfig?.paymentDetectionEnabled || false}
                                        onChange={async () => {
                                            if (togglingAutomation) return;
                                            setTogglingAutomation('paymentDetectionEnabled');
                                            try {
                                                const { data } = await api.put('/api/ai-automations/config', {
                                                    paymentDetectionEnabled: !automationsConfig.paymentDetectionEnabled
                                                });
                                                setAutomationsConfig(data.config);
                                                showToast('success', data.config.paymentDetectionEnabled ? 'Verificación de pago activada' : 'Verificación de pago desactivada');
                                            } catch {
                                                showToast('error', 'Error al cambiar estado');
                                            } finally {
                                                setTogglingAutomation(null);
                                            }
                                        }}
                                        disabled={togglingAutomation === 'paymentDetectionEnabled'}
                                    />
                                    <span className="automation-slider"></span>
                                </label>
                            </div>
                            <h3 className="automation-card-title">Verificación de pago por imagen</h3>
                            <p className="automation-card-desc">
                                Cuando un cliente envía una imagen, el sistema analiza si es un comprobante de pago usando IA con visión.
                            </p>
                            <div className={`automation-status-badge ${automationsConfig?.paymentDetectionEnabled ? 'badge-active' : 'badge-inactive'}`}>
                                {togglingAutomation === 'paymentDetectionEnabled' ? (
                                    <><Loader2 size={14} className="spin-animation" /> Actualizando...</>
                                ) : automationsConfig?.paymentDetectionEnabled ? (
                                    '● Activo'
                                ) : (
                                    '○ Inactivo'
                                )}
                            </div>
                        </div>

                        {/* Voice Processing Toggle */}
                        <div className={`automation-card ${automationsConfig?.voiceProcessingEnabled ? 'automation-active' : ''}`}>
                            <div className="automation-card-header">
                                <div className="automation-icon-wrap" style={{ background: automationsConfig?.voiceProcessingEnabled ? 'rgba(0, 255, 65, 0.15)' : 'rgba(255, 255, 255, 0.05)' }}>
                                    <Mic size={28} style={{ color: automationsConfig?.voiceProcessingEnabled ? 'var(--neon-green)' : 'var(--text-secondary)' }} />
                                </div>
                                <label className="automation-switch">
                                    <input
                                        type="checkbox"
                                        checked={automationsConfig?.voiceProcessingEnabled || false}
                                        onChange={async () => {
                                            if (togglingAutomation) return;
                                            setTogglingAutomation('voiceProcessingEnabled');
                                            try {
                                                const { data } = await api.put('/api/ai-automations/config', {
                                                    voiceProcessingEnabled: !automationsConfig.voiceProcessingEnabled
                                                });
                                                setAutomationsConfig(data.config);
                                                showToast('success', data.config.voiceProcessingEnabled ? 'Procesamiento de voz activado' : 'Procesamiento de voz desactivado');
                                            } catch {
                                                showToast('error', 'Error al cambiar estado');
                                            } finally {
                                                setTogglingAutomation(null);
                                            }
                                        }}
                                        disabled={togglingAutomation === 'voiceProcessingEnabled'}
                                    />
                                    <span className="automation-slider"></span>
                                </label>
                            </div>
                            <h3 className="automation-card-title">Procesamiento de voz</h3>
                            <p className="automation-card-desc">
                                Convierte los mensajes de voz a texto y los procesa con la IA para generar respuestas automáticas.
                            </p>
                            <div className={`automation-status-badge ${automationsConfig?.voiceProcessingEnabled ? 'badge-active' : 'badge-inactive'}`}>
                                {togglingAutomation === 'voiceProcessingEnabled' ? (
                                    <><Loader2 size={14} className="spin-animation" /> Actualizando...</>
                                ) : automationsConfig?.voiceProcessingEnabled ? (
                                    '● Activo'
                                ) : (
                                    '○ Inactivo'
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WelcomeAutomationPage;
