import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';
import {
    Clock, MessageSquare, Save, Trash2, Upload, Plus,
    Power, CheckCircle, XCircle, Loader2, AlertCircle,
    Mic, Video, Image, ChevronDown, ChevronUp, X, Users,
    Play, Pause, RefreshCw, ChevronLeft, ChevronRight
} from 'lucide-react';

const FollowUpPage = ({ setDashboardTab }) => {
    // ── State ────────────────────────────────────────────────────────────
    const [config, setConfig] = useState(null);
    const [activeStates, setActiveStates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState(null);
    const [expandedStep, setExpandedStep] = useState(null);
    const [uploadingMedia, setUploadingMedia] = useState({}); // { stepId_type: true }

    // ── Load data ────────────────────────────────────────────────────────
    useEffect(() => {
        loadAll();
    }, []);

    const loadAll = async () => {
        setLoading(true);
        try {
            const [configRes, statesRes] = await Promise.all([
                api.get('/api/follow-up/config'),
                api.get('/api/follow-up/states')
            ]);
            setConfig(configRes.data.config);
            setActiveStates(statesRes.data.states || []);
        } catch (err) {
            showToast('Error cargando configuración', 'error');
        } finally {
            setLoading(false);
        }
    };

    // ── Toast ────────────────────────────────────────────────────────────
    const showToast = useCallback((message, type = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    }, []);

    // ── Save global config ───────────────────────────────────────────────
    const saveGlobalConfig = async (updates) => {
        try {
            const res = await api.put('/api/follow-up/config', updates);
            setConfig(res.data.config);
            showToast('Configuración guardada');
        } catch (err) {
            showToast('Error al guardar', 'error');
        }
    };

    // ── Step CRUD ─────────────────────────────────────────────────────────
    const updateStep = async (stepId, updates) => {
        setSaving(true);
        try {
            const res = await api.put(`/api/follow-up/steps/${stepId}`, updates);
            setConfig(prev => ({
                ...prev,
                steps: prev.steps.map(s => s.id === stepId ? { ...s, ...res.data.step } : s)
            }));
            showToast('Paso actualizado');
        } catch (err) {
            showToast('Error al actualizar paso', 'error');
        } finally {
            setSaving(false);
        }
    };

    const addStep = async () => {
        try {
            const res = await api.post('/api/follow-up/steps', {
                label: `Paso ${(config?.steps?.length || 0) + 1}`,
                delayMinutes: 60
            });
            setConfig(prev => ({
                ...prev,
                steps: [...(prev.steps || []), res.data.step]
            }));
            setExpandedStep(res.data.step.id);
            showToast('Nuevo paso agregado');
        } catch (err) {
            showToast('Error al agregar paso', 'error');
        }
    };

    const deleteStep = async (stepId) => {
        if (!window.confirm('¿Eliminar este paso de seguimiento?')) return;
        try {
            await api.delete(`/api/follow-up/steps/${stepId}`);
            setConfig(prev => ({
                ...prev,
                steps: prev.steps.filter(s => s.id !== stepId)
            }));
            showToast('Paso eliminado');
        } catch (err) {
            showToast('Error al eliminar paso', 'error');
        }
    };

    // ── Media upload ──────────────────────────────────────────────────────
    const uploadMedia = async (stepId, type, file) => {
        const key = `${stepId}_${type}`;
        setUploadingMedia(prev => ({ ...prev, [key]: true }));
        try {
            const formData = new FormData();
            formData.append(type, file);
            const res = await api.post(`/api/follow-up/steps/${stepId}/${type}`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            setConfig(prev => ({
                ...prev,
                steps: prev.steps.map(s =>
                    s.id === stepId ? { ...s, [`${type}Path`]: res.data.path } : s
                )
            }));
            showToast(`${type === 'audio' ? 'Audio' : type === 'video' ? 'Video' : 'Imagen'} subido`);
        } catch (err) {
            showToast(`Error al subir ${type}`, 'error');
        } finally {
            setUploadingMedia(prev => ({ ...prev, [key]: false }));
        }
    };

    const deleteMedia = async (stepId, type) => {
        try {
            await api.delete(`/api/follow-up/steps/${stepId}/${type}`);
            setConfig(prev => ({
                ...prev,
                steps: prev.steps.map(s =>
                    s.id === stepId ? { ...s, [`${type}Path`]: null } : s
                )
            }));
            showToast(`${type === 'audio' ? 'Audio' : type === 'video' ? 'Video' : 'Imagen'} eliminado`);
        } catch (err) {
            showToast(`Error al eliminar ${type}`, 'error');
        }
    };

    // ── Follow-up state actions ───────────────────────────────────────────
    const cancelFollowUp = async (jid) => {
        try {
            await api.post(`/api/follow-up/cancel/${encodeURIComponent(jid)}`);
            setActiveStates(prev => prev.filter(s => s.jid !== jid));
            showToast('Seguimiento cancelado');
        } catch (err) {
            showToast('Error al cancelar', 'error');
        }
    };

    // ── Helpers ──────────────────────────────────────────────────────────
    const formatDelay = (minutes) => {
        if (minutes < 60) return `${minutes} min`;
        if (minutes < 1440) return `${Math.round(minutes / 60)} horas`;
        return `${Math.round(minutes / 1440)} días`;
    };

    const formatDate = (iso) => {
        if (!iso) return '—';
        return new Date(iso).toLocaleString('es-CO', {
            day: '2-digit', month: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });
    };

    // ── Loading state ────────────────────────────────────────────────────
    if (loading) {
        return (
            <div className="fu-loading">
                <Loader2 className="fu-spinner" size={32} />
                <p>Cargando seguimiento...</p>
            </div>
        );
    }

    return (
        <div className="fu-container">
            {/* Toast */}
            {toast && (
                <div className={`fu-toast fu-toast-${toast.type}`}>
                    {toast.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                    {toast.message}
                </div>
            )}

            {/* ── Header ── */}
            <div className="fu-header">
                <div className="fu-header-info">
                    <h2 className="fu-title">
                        <Clock size={22} />
                        Mensajes de Seguimiento
                    </h2>
                    <p className="fu-subtitle">
                        Configura mensajes automáticos para personas que no responden al primer mensaje
                    </p>
                </div>
                <div className="fu-header-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {setDashboardTab && (
                        <div className="conv-tab-nav" style={{ display: 'flex', gap: '4px' }}>
                            <button className="conv-tab-nav-btn" onClick={() => setDashboardTab('users')} title="Chats">
                                <ChevronLeft size={18} />
                            </button>
                            <button className="conv-tab-nav-btn" onClick={() => setDashboardTab('alerts')} title="Alertas Pendientes">
                                <ChevronRight size={18} />
                            </button>
                        </div>
                    )}
                    <button
                        className="fu-refresh-btn"
                        onClick={loadAll}
                        title="Recargar"
                    >
                        <RefreshCw size={16} />
                    </button>
                </div>
            </div>

            {/* ── Global Controls ── */}
            <div className="fu-global-controls">
                <div className="fu-toggle-row">
                    <div className="fu-toggle-info">
                        <Power size={18} />
                        <div>
                            <span className="fu-toggle-label">Seguimiento Automático</span>
                            <span className="fu-toggle-desc">Enviar mensajes automáticos a personas sin respuesta</span>
                        </div>
                    </div>
                    <button
                        className={`fu-toggle-btn ${config?.globalEnabled ? 'fu-toggle-on' : 'fu-toggle-off'}`}
                        onClick={() => saveGlobalConfig({ globalEnabled: !config?.globalEnabled })}
                    >
                        <span className="fu-toggle-knob" />
                        {config?.globalEnabled ? 'ON' : 'OFF'}
                    </button>
                </div>

                <div className="fu-toggle-row">
                    <div className="fu-toggle-info">
                        <MessageSquare size={18} />
                        <div>
                            <span className="fu-toggle-label">Detener al Responder</span>
                            <span className="fu-toggle-desc">Cancelar seguimiento cuando el cliente responda</span>
                        </div>
                    </div>
                    <button
                        className={`fu-toggle-btn ${config?.stopOnReply ? 'fu-toggle-on' : 'fu-toggle-off'}`}
                        onClick={() => saveGlobalConfig({ stopOnReply: !config?.stopOnReply })}
                    >
                        <span className="fu-toggle-knob" />
                        {config?.stopOnReply ? 'ON' : 'OFF'}
                    </button>
                </div>
            </div>

            {/* ── Steps Timeline ── */}
            <div className="fu-steps-section">
                <div className="fu-steps-header">
                    <h3 className="fu-section-title">
                        <Clock size={18} />
                        Pasos de Seguimiento
                    </h3>
                    <button className="fu-add-step-btn" onClick={addStep}>
                        <Plus size={16} />
                        Agregar Paso
                    </button>
                </div>

                <div className="fu-timeline">
                    {(config?.steps || []).map((step, idx) => (
                        <StepCard
                            key={step.id}
                            step={step}
                            index={idx}
                            isLast={idx === (config?.steps?.length || 0) - 1}
                            isExpanded={expandedStep === step.id}
                            onToggleExpand={() => setExpandedStep(expandedStep === step.id ? null : step.id)}
                            onUpdate={updateStep}
                            onDelete={deleteStep}
                            onUploadMedia={uploadMedia}
                            onDeleteMedia={deleteMedia}
                            uploadingMedia={uploadingMedia}
                            saving={saving}
                        />
                    ))}
                </div>

                {(!config?.steps || config.steps.length === 0) && (
                    <div className="fu-empty">
                        <Clock size={40} />
                        <p>No hay pasos de seguimiento configurados</p>
                        <button className="fu-add-step-btn" onClick={addStep}>
                            <Plus size={16} /> Agregar Primer Paso
                        </button>
                    </div>
                )}
            </div>

            {/* ── Active Follow-ups ── */}
            <div className="fu-active-section">
                <h3 className="fu-section-title">
                    <Users size={18} />
                    Seguimientos Activos
                    {activeStates.length > 0 && (
                        <span className="fu-active-badge">{activeStates.length}</span>
                    )}
                </h3>

                {activeStates.length === 0 ? (
                    <div className="fu-empty-states">
                        <p>No hay seguimientos activos en este momento</p>
                    </div>
                ) : (
                    <div className="fu-active-list">
                        {activeStates.map(state => (
                            <div key={state.jid} className="fu-active-item">
                                <div className="fu-active-info">
                                    <span className="fu-active-name">{state.displayName}</span>
                                    <span className="fu-active-meta">
                                        Paso {state.currentStepIndex + 1} · Iniciado {formatDate(state.startedAt)}
                                    </span>
                                </div>
                                <button
                                    className="fu-cancel-btn"
                                    onClick={() => cancelFollowUp(state.jid)}
                                    title="Cancelar seguimiento"
                                >
                                    <X size={14} />
                                    Cancelar
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

// ══════════════════════════════════════════════════════════════════════════════
// STEP CARD COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

const StepCard = ({
    step, index, isLast, isExpanded, onToggleExpand,
    onUpdate, onDelete, onUploadMedia, onDeleteMedia,
    uploadingMedia, saving
}) => {
    const [localText, setLocalText] = useState(step.text || '');
    const [localLabel, setLocalLabel] = useState(step.label || '');
    const [localDelay, setLocalDelay] = useState(step.delayMinutes || 60);
    const [delayUnit, setDelayUnit] = useState(step.delayMinutes >= 1440 ? 'days' : step.delayMinutes >= 60 ? 'hours' : 'minutes');

    const audioRef = useRef(null);
    const videoRef = useRef(null);
    const imageRef = useRef(null);

    // Sync local state when step prop changes
    useEffect(() => {
        setLocalText(step.text || '');
        setLocalLabel(step.label || '');
        setLocalDelay(step.delayMinutes || 60);
    }, [step]);

    const getDelayValue = () => {
        if (delayUnit === 'days') return Math.round(localDelay / 1440);
        if (delayUnit === 'hours') return Math.round(localDelay / 60);
        return localDelay;
    };

    const setDelayValue = (val) => {
        const num = parseInt(val, 10) || 1;
        if (delayUnit === 'days') setLocalDelay(num * 1440);
        else if (delayUnit === 'hours') setLocalDelay(num * 60);
        else setLocalDelay(num);
    };

    const handleUnitChange = (newUnit) => {
        const currentValue = getDelayValue();
        setDelayUnit(newUnit);
        if (newUnit === 'days') setLocalDelay(currentValue * 1440);
        else if (newUnit === 'hours') setLocalDelay(currentValue * 60);
        else setLocalDelay(currentValue);
    };

    const handleSave = () => {
        onUpdate(step.id, {
            label: localLabel,
            text: localText,
            delayMinutes: localDelay
        });
    };

    const handleFileChange = (type) => (e) => {
        const file = e.target.files?.[0];
        if (file) onUploadMedia(step.id, type, file);
        e.target.value = '';
    };

    const formatDelay = (minutes) => {
        if (minutes < 60) return `${minutes} min`;
        if (minutes < 1440) {
            const h = Math.round(minutes / 60);
            return `${h} hora${h > 1 ? 's' : ''}`;
        }
        const d = Math.round(minutes / 1440);
        return `${d} día${d > 1 ? 's' : ''}`;
    };

    return (
        <div className={`fu-step-card ${isExpanded ? 'fu-step-expanded' : ''} ${step.enabled ? '' : 'fu-step-disabled'}`}>
            {/* Timeline connector */}
            {!isLast && <div className="fu-timeline-line" />}

            {/* Timeline dot */}
            <div className={`fu-timeline-dot ${step.enabled ? 'fu-dot-active' : 'fu-dot-inactive'}`}>
                <span>{index + 1}</span>
            </div>

            {/* Card content */}
            <div className="fu-step-content">
                {/* Header — always visible */}
                <div className="fu-step-header" onClick={onToggleExpand}>
                    <div className="fu-step-summary">
                        <span className="fu-step-label">{step.label}</span>
                        <span className="fu-step-delay">
                            <Clock size={12} />
                            {formatDelay(step.delayMinutes)}
                        </span>
                        {/* Media indicators */}
                        <div className="fu-step-indicators">
                            {step.text && <span className="fu-indicator" title="Texto"><MessageSquare size={11} /></span>}
                            {step.audioPath && <span className="fu-indicator" title="Audio"><Mic size={11} /></span>}
                            {step.imagePath && <span className="fu-indicator" title="Imagen"><Image size={11} /></span>}
                            {step.videoPath && <span className="fu-indicator" title="Video"><Video size={11} /></span>}
                        </div>
                    </div>
                    <div className="fu-step-actions-header">
                        <button
                            className={`fu-mini-toggle ${step.enabled ? 'fu-mini-on' : 'fu-mini-off'}`}
                            onClick={(e) => { e.stopPropagation(); onUpdate(step.id, { enabled: !step.enabled }); }}
                            title={step.enabled ? 'Desactivar' : 'Activar'}
                        >
                            {step.enabled ? <Play size={12} /> : <Pause size={12} />}
                        </button>
                        {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </div>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                    <div className="fu-step-body">
                        {/* Label edit */}
                        <div className="fu-field">
                            <label className="fu-field-label">Nombre del paso</label>
                            <input
                                type="text"
                                className="fu-input"
                                value={localLabel}
                                onChange={e => setLocalLabel(e.target.value)}
                                placeholder="Ej: Seguimiento 2 horas"
                            />
                        </div>

                        {/* Delay config */}
                        <div className="fu-field">
                            <label className="fu-field-label">Tiempo de espera</label>
                            <div className="fu-delay-row">
                                <input
                                    type="number"
                                    className="fu-input fu-input-small"
                                    value={getDelayValue()}
                                    onChange={e => setDelayValue(e.target.value)}
                                    min={1}
                                />
                                <div className="fu-delay-units">
                                    <button
                                        className={`fu-unit-btn ${delayUnit === 'minutes' ? 'fu-unit-active' : ''}`}
                                        onClick={() => handleUnitChange('minutes')}
                                    >Min</button>
                                    <button
                                        className={`fu-unit-btn ${delayUnit === 'hours' ? 'fu-unit-active' : ''}`}
                                        onClick={() => handleUnitChange('hours')}
                                    >Horas</button>
                                    <button
                                        className={`fu-unit-btn ${delayUnit === 'days' ? 'fu-unit-active' : ''}`}
                                        onClick={() => handleUnitChange('days')}
                                    >Días</button>
                                </div>
                            </div>
                        </div>

                        {/* Text message */}
                        <div className="fu-field">
                            <label className="fu-field-label">
                                <MessageSquare size={14} />
                                Mensaje de texto
                            </label>
                            <textarea
                                className="fu-textarea"
                                value={localText}
                                onChange={e => setLocalText(e.target.value)}
                                placeholder="Escribe el mensaje de seguimiento...&#10;&#10;Usa ---MSG--- para separar en varios mensajes"
                                rows={4}
                            />
                            <span className="fu-hint">
                                💡 Usa <strong>---MSG---</strong> para enviar varios mensajes separados
                            </span>
                        </div>

                        {/* Media uploads */}
                        <div className="fu-media-section">
                            <label className="fu-field-label">Contenido multimedia</label>

                            {/* Audio */}
                            <MediaSlot
                                type="audio"
                                icon={<Mic size={16} />}
                                label="Audio (.ogg)"
                                accept=".ogg,.mp3,.m4a,.wav"
                                hasFile={!!step.audioPath}
                                uploading={!!uploadingMedia[`${step.id}_audio`]}
                                inputRef={audioRef}
                                onChange={handleFileChange('audio')}
                                onDelete={() => onDeleteMedia(step.id, 'audio')}
                            />

                            {/* Image */}
                            <MediaSlot
                                type="image"
                                icon={<Image size={16} />}
                                label="Imagen (.jpg, .png)"
                                accept=".jpg,.jpeg,.png,.webp"
                                hasFile={!!step.imagePath}
                                uploading={!!uploadingMedia[`${step.id}_image`]}
                                inputRef={imageRef}
                                onChange={handleFileChange('image')}
                                onDelete={() => onDeleteMedia(step.id, 'image')}
                            />

                            {/* Video */}
                            <MediaSlot
                                type="video"
                                icon={<Video size={16} />}
                                label="Video (.mp4)"
                                accept=".mp4,.mov,.avi"
                                hasFile={!!step.videoPath}
                                uploading={!!uploadingMedia[`${step.id}_video`]}
                                inputRef={videoRef}
                                onChange={handleFileChange('video')}
                                onDelete={() => onDeleteMedia(step.id, 'video')}
                            />
                        </div>

                        {/* Action buttons */}
                        <div className="fu-step-actions">
                            <button className="fu-save-btn" onClick={handleSave} disabled={saving}>
                                {saving ? <Loader2 className="fu-spinner" size={16} /> : <Save size={16} />}
                                Guardar Paso
                            </button>
                            <button className="fu-delete-btn" onClick={() => onDelete(step.id)}>
                                <Trash2 size={16} />
                                Eliminar
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// ══════════════════════════════════════════════════════════════════════════════
// MEDIA SLOT COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

const MediaSlot = ({ type, icon, label, accept, hasFile, uploading, inputRef, onChange, onDelete }) => {
    return (
        <div className={`fu-media-slot ${hasFile ? 'fu-media-has-file' : ''}`}>
            <div className="fu-media-info">
                {icon}
                <span>{label}</span>
            </div>
            <div className="fu-media-actions">
                {uploading ? (
                    <Loader2 className="fu-spinner" size={14} />
                ) : hasFile ? (
                    <>
                        <span className="fu-media-status">
                            <CheckCircle size={12} /> Subido
                        </span>
                        <button className="fu-media-delete" onClick={onDelete} title="Eliminar">
                            <Trash2 size={13} />
                        </button>
                    </>
                ) : (
                    <button className="fu-media-upload-btn" onClick={() => inputRef.current?.click()}>
                        <Upload size={13} />
                        Subir
                    </button>
                )}
            </div>
            <input
                ref={inputRef}
                type="file"
                accept={accept}
                onChange={onChange}
                style={{ display: 'none' }}
            />
        </div>
    );
};

export default FollowUpPage;
