import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';
import {
    BellRing, Power, Upload, Trash2, Clock, MessageSquare,
    CheckCircle, XCircle, Users, Calendar, AlertCircle, Save,
    RotateCcw, Search, RefreshCw, Settings2, UserCheck
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
    const [toast, setToast] = useState(null);

    // Local editable fields
    const [messageText, setMessageText] = useState('');
    const [cooldownHours, setCooldownHours] = useState(24);
    const [isEnabled, setIsEnabled] = useState(false);
    const [audioFileName, setAudioFileName] = useState(null);

    const fileInputRef = useRef(null);
    const dropRef = useRef(null);
    const [dragging, setDragging] = useState(false);

    // ── Users state ─────────────────────────────────────────────────────
    const [users, setUsers] = useState([]);
    const [usersLoading, setUsersLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [togglingUser, setTogglingUser] = useState(null); // "jid:field"

    // ── Load initial data ───────────────────────────────────────────────
    useEffect(() => {
        loadAll();
    }, []);

    // Auto-refresh users every 10 seconds when on users tab
    useEffect(() => {
        if (activeTab !== 'users') return;
        loadUsers();
        const interval = setInterval(loadUsers, 10000);
        return () => clearInterval(interval);
    }, [activeTab]);

    const loadAll = async () => {
        setLoading(true);
        try {
            const [cfgRes, statsRes] = await Promise.all([
                api.get('/api/welcome-automation/config'),
                api.get('/api/welcome-automation/stats')
            ]);
            const cfg = cfgRes.data.data;
            setConfig(cfg);
            setIsEnabled(cfg.isEnabled);
            setMessageText(cfg.messageText || '');
            setCooldownHours(cfg.cooldownHours || 24);
            setAudioFileName(cfg.audioFilePath ? 'welcome-audio.ogg' : null);
            setStats(statsRes.data.data);
        } catch (err) {
            showToast('error', 'Error cargando configuración');
        } finally {
            setLoading(false);
        }
    };

    const loadUsers = useCallback(async () => {
        try {
            setUsersLoading(true);
            const { data } = await api.get('/api/welcome-automation/users');
            setUsers(data.data || []);
        } catch (err) {
            console.error('Error loading users:', err);
        } finally {
            setUsersLoading(false);
        }
    }, []);

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
                cooldownHours: Number(cooldownHours)
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

    // ── Drag & drop ─────────────────────────────────────────────────────
    const onDragOver = (e) => { e.preventDefault(); setDragging(true); };
    const onDragLeave = () => setDragging(false);
    const onDrop = (e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        uploadAudio(file);
    };

    // ── Per-user actions ────────────────────────────────────────────────
    const toggleUserAI = async (jid, currentVal) => {
        const key = `${jid}:ai`;
        setTogglingUser(key);
        try {
            await api.put(`/api/welcome-automation/users/${encodeURIComponent(jid)}/ai`, {
                enabled: !currentVal
            });
            setUsers(prev => prev.map(u =>
                u.jid === jid ? { ...u, aiEnabled: !currentVal } : u
            ));
            showToast('success', `IA ${!currentVal ? 'activada' : 'desactivada'} para ${jid.replace('@s.whatsapp.net', '')}`);
        } catch {
            showToast('error', 'Error al cambiar estado IA');
        } finally {
            setTogglingUser(null);
        }
    };

    const toggleUserCooldown = async (jid, currentVal) => {
        const key = `${jid}:cooldown`;
        setTogglingUser(key);
        try {
            await api.put(`/api/welcome-automation/users/${encodeURIComponent(jid)}/cooldown`, {
                enabled: !currentVal
            });
            setUsers(prev => prev.map(u =>
                u.jid === jid ? { ...u, cooldownEnabled: !currentVal } : u
            ));
            showToast('success', `Cooldown ${!currentVal ? 'activado' : 'desactivado'} para ${jid.replace('@s.whatsapp.net', '')}`);
        } catch {
            showToast('error', 'Error al cambiar cooldown');
        } finally {
            setTogglingUser(null);
        }
    };

    const resetUserCooldown = async (jid) => {
        const key = `${jid}:reset`;
        setTogglingUser(key);
        try {
            await api.post('/api/welcome-automation/reset-user', { jid });
            setUsers(prev => prev.map(u =>
                u.jid === jid ? { ...u, cooldownStatus: 'expired', lastWelcomeSentAt: null } : u
            ));
            showToast('success', `Cooldown reseteado para ${jid.replace('@s.whatsapp.net', '')}`);
        } catch {
            showToast('error', 'Error al resetear cooldown');
        } finally {
            setTogglingUser(null);
        }
    };

    // ── Helpers ──────────────────────────────────────────────────────────
    const formatDate = (isoStr) => {
        if (!isoStr) return '—';
        const d = new Date(isoStr);
        return d.toLocaleDateString('es-ES', {
            day: '2-digit', month: '2-digit', year: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });
    };

    const filteredUsers = users.filter(u => {
        if (!searchTerm) return true;
        const term = searchTerm.toLowerCase();
        return u.displayName.toLowerCase().includes(term) ||
            u.jid.toLowerCase().includes(term) ||
            (u.lastMessageText && u.lastMessageText.toLowerCase().includes(term));
    });

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
                    <span className="wa-toggle-label-text" style={{ color: isEnabled ? '#10b981' : 'var(--text-muted)' }}>
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
                    <Users size={20} style={{ color: '#6366f1' }} />
                    <div>
                        <span className="wa-stat-value">{stats?.totalUsers ?? 0}</span>
                        <span className="wa-stat-label">Clientes registrados</span>
                    </div>
                </div>
                <div className="wa-stat-card premium-card">
                    <Calendar size={20} style={{ color: '#10b981' }} />
                    <div>
                        <span className="wa-stat-value">{stats?.sentLast24h ?? 0}</span>
                        <span className="wa-stat-label">Enviados hoy</span>
                    </div>
                </div>
                <div className="wa-stat-card premium-card">
                    <Clock size={20} style={{ color: '#f59e0b' }} />
                    <div>
                        <span className="wa-stat-value">{cooldownHours}h</span>
                        <span className="wa-stat-label">Cooldown activo</span>
                    </div>
                </div>
                <div className={`wa-stat-card premium-card ${isEnabled ? 'wa-stat-on' : 'wa-stat-off'}`}>
                    <Power size={20} style={{ color: isEnabled ? '#10b981' : '#ef4444' }} />
                    <div>
                        <span className="wa-stat-value" style={{ color: isEnabled ? '#10b981' : '#ef4444' }}>
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
                    className={`wa-tab ${activeTab === 'users' ? 'wa-tab-active' : ''}`}
                    onClick={() => setActiveTab('users')}
                >
                    <UserCheck size={16} />
                    Control de Usuarios
                    {users.length > 0 && (
                        <span className="wa-tab-badge">{users.length}</span>
                    )}
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
                                <MessageSquare size={20} style={{ color: '#6366f1' }} />
                                <span className="wa-card-title">Mensaje de Bienvenida</span>
                            </div>
                            <p className="wa-card-desc">
                                Este texto se enviará <strong>después del audio</strong> cuando un cliente contacte por primera vez (o después del cooldown).
                            </p>
                            <textarea
                                className="wa-textarea"
                                value={messageText}
                                onChange={e => setMessageText(e.target.value)}
                                placeholder="Escribe tu mensaje de bienvenida aquí..."
                                rows={6}
                                maxLength={1000}
                            />
                            <div className="wa-char-count">{messageText.length} / 1000</div>
                        </div>

                        {/* Cooldown */}
                        <div className="premium-card wa-card">
                            <div className="wa-card-header">
                                <Clock size={20} style={{ color: '#f59e0b' }} />
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
                                <BellRing size={20} style={{ color: '#a855f7' }} />
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
                                        <Upload size={28} style={{ color: '#a855f7', marginBottom: 8 }} />
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

                        {/* Flow diagram */}
                        <div className="premium-card wa-card wa-flow-card">
                            <div className="wa-card-header">
                                <span className="wa-card-title">Flujo de envío</span>
                            </div>
                            <div className="wa-flow">
                                <div className="wa-flow-step">
                                    <span className="wa-flow-num">1</span>
                                    <span>Cliente envía mensaje</span>
                                </div>
                                <div className="wa-flow-arrow">↓</div>
                                <div className="wa-flow-step">
                                    <span className="wa-flow-num">2</span>
                                    <span>¿Módulo activo + cooldown expirado?</span>
                                </div>
                                <div className="wa-flow-arrow">↓ SÍ</div>
                                <div className="wa-flow-step wa-flow-action">
                                    <span>🔊 Envía audio .ogg</span>
                                </div>
                                <div className="wa-flow-arrow">↓</div>
                                <div className="wa-flow-step wa-flow-action">
                                    <span>📝 Envía mensaje texto</span>
                                </div>
                                <div className="wa-flow-arrow">↓</div>
                                <div className="wa-flow-step">
                                    <span className="wa-flow-num">3</span>
                                    <span>Flujo normal continúa (IA responde)</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ═══════════════════════════════════════════════════════════
                TAB 2: USER CONTROL
                ═══════════════════════════════════════════════════════════ */}
            {activeTab === 'users' && (
                <div className="wa-users-panel">
                    {/* Search & refresh bar */}
                    <div className="wa-users-toolbar">
                        <div className="wa-search-wrapper">
                            <Search size={16} className="wa-search-icon" />
                            <input
                                type="text"
                                className="wa-search-input"
                                placeholder="Buscar por número o mensaje..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <button
                            className="wa-refresh-btn"
                            onClick={loadUsers}
                            disabled={usersLoading}
                        >
                            <RefreshCw size={16} className={usersLoading ? 'wa-spin' : ''} />
                            Actualizar
                        </button>
                    </div>

                    {/* User list */}
                    {filteredUsers.length === 0 ? (
                        <div className="wa-users-empty premium-card">
                            <Users size={40} style={{ color: 'var(--text-muted)', marginBottom: '0.5rem' }} />
                            <p>{searchTerm ? 'No se encontraron usuarios' : 'Aún no hay usuarios registrados'}</p>
                            <span className="wa-users-empty-hint">
                                {searchTerm
                                    ? 'Intenta con otro término de búsqueda'
                                    : 'Los usuarios aparecerán aquí cuando escriban al bot'
                                }
                            </span>
                        </div>
                    ) : (
                        <div className="wa-users-list">
                            {filteredUsers.map(user => (
                                <div key={user.jid} className="wa-user-card premium-card">
                                    {/* User info */}
                                    <div className="wa-user-info">
                                        <div className="wa-user-avatar">
                                            {user.displayName.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="wa-user-details">
                                            <span className="wa-user-name">{user.displayName}</span>
                                            <span className="wa-user-msg">
                                                {user.lastMessageText
                                                    ? (user.lastMessageText.length > 60
                                                        ? user.lastMessageText.substring(0, 60) + '...'
                                                        : user.lastMessageText)
                                                    : 'Sin mensaje registrado'
                                                }
                                            </span>
                                            <span className="wa-user-time">
                                                {user.lastMessageAt ? formatDate(user.lastMessageAt) : '—'}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Status badges */}
                                    <div className="wa-user-badges">
                                        <span className={`wa-badge ${user.cooldownStatus === 'active' ? 'wa-badge-active' : 'wa-badge-expired'}`}>
                                            <Clock size={12} />
                                            {user.cooldownStatus === 'active' ? 'Cooldown Activo' : 'Cooldown Expirado'}
                                        </span>
                                        <span className={`wa-badge ${user.aiEnabled ? 'wa-badge-ai-on' : 'wa-badge-ai-off'}`}>
                                            <Power size={12} />
                                            {user.aiEnabled ? 'IA Activa' : 'IA Desactivada'}
                                        </span>
                                    </div>

                                    {/* Controls */}
                                    <div className="wa-user-controls">
                                        {/* AI toggle */}
                                        <div className="wa-user-toggle-group">
                                            <span className="wa-user-toggle-label">IA</span>
                                            <button
                                                className={`wa-toggle-sm ${user.aiEnabled ? 'wa-toggle-sm-on' : 'wa-toggle-sm-off'}`}
                                                onClick={() => toggleUserAI(user.jid, user.aiEnabled)}
                                                disabled={togglingUser === `${user.jid}:ai`}
                                            >
                                                <span className="wa-toggle-sm-thumb" />
                                            </button>
                                        </div>

                                        {/* Cooldown toggle */}
                                        <div className="wa-user-toggle-group">
                                            <span className="wa-user-toggle-label">24H</span>
                                            <button
                                                className={`wa-toggle-sm ${user.cooldownEnabled ? 'wa-toggle-sm-on' : 'wa-toggle-sm-off'}`}
                                                onClick={() => toggleUserCooldown(user.jid, user.cooldownEnabled)}
                                                disabled={togglingUser === `${user.jid}:cooldown`}
                                            >
                                                <span className="wa-toggle-sm-thumb" />
                                            </button>
                                        </div>

                                        {/* Reset cooldown button */}
                                        <button
                                            className="wa-user-reset-btn"
                                            onClick={() => resetUserCooldown(user.jid)}
                                            disabled={togglingUser === `${user.jid}:reset`}
                                            title="Resetear cooldown"
                                        >
                                            <RotateCcw size={14} />
                                            Reset
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default WelcomeAutomationPage;
