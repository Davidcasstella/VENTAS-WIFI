import React, { useEffect, useState, useCallback } from 'react';
import {
    ScrollText, Plus, Trash2, Save, ToggleLeft, ToggleRight,
    Loader, CheckCircle, AlertCircle, X, Pencil, Check,
    ChevronDown, ChevronUp, Sparkles, Info
} from 'lucide-react';
import api from '../services/api';

// ── Unique ID generator (no uuid dependency needed in frontend) ──
const genId = () => Math.random().toString(36).substring(2) + Date.now().toString(36);

const AIRulesPage = () => {
    const [rules, setRules] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saveOk, setSaveOk] = useState(false);
    const [error, setError] = useState('');

    // Modal state
    const [modalOpen, setModalOpen] = useState(false);
    const [editingRule, setEditingRule] = useState(null); // null = new
    const [modalTitle, setModalTitle] = useState('');
    const [modalContent, setModalContent] = useState('');
    const [modalSaving, setModalSaving] = useState(false);

    // Expanded rule (to see full content)
    const [expandedId, setExpandedId] = useState(null);

    // ── Fetch rules ──────────────────────────────────────────
    const fetchRules = useCallback(async () => {
        try {
            setLoading(true);
            const { data } = await api.get('/api/ai-rules');
            if (data.success) setRules(data.rules || []);
        } catch {
            setError('Error al cargar las reglas');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchRules(); }, [fetchRules]);

    // ── Save all rules to backend ────────────────────────────
    const handleSaveAll = async () => {
        try {
            setSaving(true);
            setError('');
            const { data } = await api.post('/api/ai-rules', { rules });
            if (data.success) {
                setRules(data.rules);
                setSaveOk(true);
                setTimeout(() => setSaveOk(false), 2500);
            }
        } catch {
            setError('Error al guardar las reglas');
        } finally {
            setSaving(false);
        }
    };

    // ── Toggle enabled/disabled ──────────────────────────────
    const handleToggle = (id) => {
        setRules(prev => prev.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
    };

    // ── Delete rule ──────────────────────────────────────────
    const handleDelete = async (id) => {
        if (!window.confirm('¿Eliminar esta regla?')) return;
        const updated = rules.filter(r => r.id !== id);
        setRules(updated);
        // Auto-save after delete
        try {
            await api.post('/api/ai-rules', { rules: updated });
        } catch { setError('Error al eliminar'); }
    };

    // ── Open modal ───────────────────────────────────────────
    const openNewModal = () => {
        setEditingRule(null);
        setModalTitle('');
        setModalContent('');
        setModalOpen(true);
    };

    const openEditModal = (rule) => {
        setEditingRule(rule);
        setModalTitle(rule.title);
        setModalContent(rule.content);
        setModalOpen(true);
    };

    const closeModal = () => {
        setModalOpen(false);
        setEditingRule(null);
        setModalTitle('');
        setModalContent('');
    };

    // ── Save modal ───────────────────────────────────────────
    const handleModalSave = async () => {
        if (!modalTitle.trim() || !modalContent.trim()) return;
        setModalSaving(true);
        try {
            let updated;
            if (editingRule) {
                updated = rules.map(r => r.id === editingRule.id
                    ? { ...r, title: modalTitle.trim(), content: modalContent.trim() }
                    : r
                );
            } else {
                const newRule = {
                    id: genId(),
                    title: modalTitle.trim(),
                    content: modalContent.trim(),
                    enabled: true,
                    createdAt: new Date().toISOString(),
                };
                updated = [...rules, newRule];
            }
            const { data } = await api.post('/api/ai-rules', { rules: updated });
            if (data.success) setRules(data.rules);
            closeModal();
        } catch {
            setError('Error al guardar la regla');
        } finally {
            setModalSaving(false);
        }
    };

    // ── Render ───────────────────────────────────────────────
    const activeCount = rules.filter(r => r.enabled).length;

    return (
        <>
            {/* ── STICKY HEADER ── */}
            <div style={{
                position: 'sticky', top: 0, zIndex: 50,
                background: 'rgba(0, 30, 0, 0.95)',
                backdropFilter: 'blur(12px)',
                borderBottom: '1px solid rgba(0,255,0,0.2)',
                width: '100%',
                boxShadow: '0 4px 20px rgba(0,0,0,0.4)'
            }}>
                <div style={{
                    padding: '0.75rem 1.5rem',
                    display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', gap: '0.75rem'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <ScrollText size={22} style={{ color: '#00ff00' }} />
                        <h1 style={{ fontSize: '1.3rem', fontWeight: 800, margin: 0, color: '#e9edef' }}>
                            Reglas de IA
                        </h1>
                        {!loading && (
                            <span style={{
                                fontSize: '0.72rem', fontWeight: 700, padding: '0.2rem 0.6rem',
                                borderRadius: '50px',
                                background: activeCount > 0 ? 'rgba(0,255,0,0.15)' : 'rgba(255,255,255,0.07)',
                                color: activeCount > 0 ? '#00ff00' : 'rgba(255,255,255,0.4)',
                                border: `1px solid ${activeCount > 0 ? 'rgba(0,255,0,0.3)' : 'rgba(255,255,255,0.1)'}`,
                            }}>
                                {activeCount} activa{activeCount !== 1 ? 's' : ''}
                            </span>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: '0.6rem' }}>
                        <button
                            onClick={openNewModal}
                            className="kb-btn-pri"
                            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}
                        >
                            <Plus size={14} /> Nueva regla
                        </button>
                        <button
                            onClick={handleSaveAll}
                            disabled={saving || loading}
                            className="kb-btn-pri"
                            style={{
                                display: 'flex', alignItems: 'center', gap: '0.4rem',
                                fontSize: '0.82rem',
                                background: saveOk ? 'rgba(0,255,0,0.3)' : undefined,
                            }}
                        >
                            {saving ? <Loader size={14} className="spin" />
                                : saveOk ? <CheckCircle size={14} />
                                    : <Save size={14} />}
                            {saveOk ? 'Guardado!' : 'Guardar todo'}
                        </button>
                    </div>
                </div>
            </div>

            <div style={{ padding: '1rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>

                {/* Error banner */}
                {error && (
                    <div className="kb-error-banner">
                        <AlertCircle size={16} /><span>{error}</span>
                        <button onClick={() => setError('')}><X size={14} /></button>
                    </div>
                )}

                {/* Info box */}
                <div style={{
                    display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                    padding: '0.85rem 1rem',
                    background: 'rgba(0,255,0,0.04)',
                    border: '1px solid rgba(0,255,0,0.12)',
                    borderRadius: '10px',
                    fontSize: '0.82rem',
                    color: 'rgba(255,255,255,0.55)',
                    lineHeight: 1.5,
                }}>
                    <Info size={15} style={{ color: '#00ff00', flexShrink: 0, marginTop: '0.1rem' }} />
                    <span>
                        Las reglas activas se inyectan al inicio del <strong style={{ color: '#e9edef' }}>system prompt</strong> de la IA
                        con <strong style={{ color: '#00ff00' }}>prioridad máxima</strong>. Úsalas para definir la personalidad,
                        restricciones, precios u cualquier instrucción que el bot debe seguir siempre.
                    </span>
                </div>

                {/* Rules list */}
                {loading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem', color: 'rgba(255,255,255,0.3)' }}>
                        <Loader size={28} className="spin" />
                    </div>
                ) : rules.length === 0 ? (
                    <div style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        justifyContent: 'center', gap: '1rem',
                        padding: '4rem 2rem', color: 'rgba(255,255,255,0.25)',
                        textAlign: 'center',
                    }}>
                        <Sparkles size={44} style={{ opacity: 0.2 }} />
                        <h2 style={{ margin: 0, fontSize: '1.1rem', color: 'rgba(255,255,255,0.35)' }}>Sin reglas todavía</h2>
                        <p style={{ margin: 0, fontSize: '0.85rem' }}>
                            Crea tu primera regla para personalizar cómo responde la IA
                        </p>
                        <button onClick={openNewModal} className="kb-btn-pri" style={{ marginTop: '0.5rem' }}>
                            <Plus size={14} /> Crear primera regla
                        </button>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                        {rules.map((rule) => {
                            const isExpanded = expandedId === rule.id;
                            return (
                                <div
                                    key={rule.id}
                                    className="premium-card"
                                    style={{
                                        padding: '0',
                                        border: rule.enabled
                                            ? '1px solid rgba(0,255,0,0.18)'
                                            : '1px solid rgba(255,255,255,0.06)',
                                        opacity: rule.enabled ? 1 : 0.55,
                                        transition: 'all 0.2s ease',
                                        overflow: 'hidden',
                                    }}
                                >
                                    {/* Rule header row */}
                                    <div style={{
                                        display: 'flex', alignItems: 'center',
                                        gap: '0.75rem', padding: '0.75rem 1rem',
                                    }}>
                                        {/* Toggle */}
                                        <button
                                            onClick={() => handleToggle(rule.id)}
                                            title={rule.enabled ? 'Desactivar regla' : 'Activar regla'}
                                            style={{
                                                background: 'none', border: 'none', cursor: 'pointer',
                                                padding: 0, flexShrink: 0,
                                                color: rule.enabled ? '#00ff00' : 'rgba(255,255,255,0.25)',
                                                transition: 'color 0.2s',
                                            }}
                                        >
                                            {rule.enabled
                                                ? <ToggleRight size={22} />
                                                : <ToggleLeft size={22} />
                                            }
                                        </button>

                                        {/* Title */}
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <span style={{
                                                fontWeight: 700,
                                                fontSize: '0.88rem',
                                                color: rule.enabled ? '#e9edef' : 'rgba(255,255,255,0.4)',
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                display: 'block',
                                            }}>
                                                {rule.title}
                                            </span>
                                            {!isExpanded && (
                                                <span style={{
                                                    fontSize: '0.75rem',
                                                    color: 'rgba(255,255,255,0.3)',
                                                    whiteSpace: 'nowrap',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    display: 'block',
                                                    marginTop: '0.1rem',
                                                }}>
                                                    {rule.content.length > 90 ? rule.content.substring(0, 90) + '…' : rule.content}
                                                </span>
                                            )}
                                        </div>

                                        {/* Status badge */}
                                        <span style={{
                                            fontSize: '0.68rem', fontWeight: 700,
                                            padding: '0.18rem 0.55rem', borderRadius: '50px',
                                            background: rule.enabled ? 'rgba(0,255,0,0.12)' : 'rgba(255,255,255,0.05)',
                                            color: rule.enabled ? '#00ff00' : 'rgba(255,255,255,0.25)',
                                            border: `1px solid ${rule.enabled ? 'rgba(0,255,0,0.2)' : 'rgba(255,255,255,0.08)'}`,
                                            flexShrink: 0,
                                        }}>
                                            {rule.enabled ? 'ACTIVA' : 'INACTIVA'}
                                        </span>

                                        {/* Actions */}
                                        <div style={{ display: 'flex', gap: '0.3rem', flexShrink: 0 }}>
                                            <button
                                                className="kb-icon-btn"
                                                title="Editar regla"
                                                onClick={() => openEditModal(rule)}
                                            >
                                                <Pencil size={13} />
                                            </button>
                                            <button
                                                className="kb-icon-btn kb-icon-btn-danger"
                                                title="Eliminar regla"
                                                onClick={() => handleDelete(rule.id)}
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                            <button
                                                className="kb-icon-btn"
                                                title={isExpanded ? 'Colapsar' : 'Ver contenido completo'}
                                                onClick={() => setExpandedId(isExpanded ? null : rule.id)}
                                            >
                                                {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Expanded content */}
                                    {isExpanded && (
                                        <div style={{
                                            padding: '0.75rem 1rem 1rem',
                                            borderTop: '1px solid rgba(255,255,255,0.06)',
                                            background: 'rgba(0,0,0,0.2)',
                                        }}>
                                            <p style={{
                                                margin: 0,
                                                fontSize: '0.83rem',
                                                color: 'rgba(255,255,255,0.65)',
                                                lineHeight: 1.6,
                                                whiteSpace: 'pre-wrap',
                                            }}>
                                                {rule.content}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── MODAL ── */}
            {modalOpen && (
                <div className="kb-modal-overlay" onClick={closeModal}>
                    <div className="kb-modal" style={{ maxWidth: '540px' }} onClick={e => e.stopPropagation()}>
                        <div className="kb-modal-header">
                            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <ScrollText size={16} style={{ color: '#00ff00' }} />
                                {editingRule ? 'Editar regla' : 'Nueva regla de IA'}
                            </h3>
                            <button className="kb-modal-close" onClick={closeModal}><X size={16} /></button>
                        </div>
                        <div className="kb-modal-body">
                            <div style={{ marginBottom: '0.5rem' }}>
                                <label style={{
                                    display: 'block', fontSize: '0.75rem',
                                    fontWeight: 700, color: 'rgba(255,255,255,0.5)',
                                    marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em'
                                }}>
                                    Nombre de la regla
                                </label>
                                <input
                                    type="text"
                                    className="form-input kb-modal-title-input"
                                    placeholder="Ej: Precio del producto, Saludo especial, Restricción..."
                                    value={modalTitle}
                                    onChange={e => setModalTitle(e.target.value)}
                                    autoFocus
                                />
                            </div>
                            <div>
                                <label style={{
                                    display: 'block', fontSize: '0.75rem',
                                    fontWeight: 700, color: 'rgba(255,255,255,0.5)',
                                    marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em'
                                }}>
                                    Instrucción para la IA
                                </label>
                                <textarea
                                    className="form-input kb-modal-textarea"
                                    placeholder={"Escribe aquí la instrucción exacta que debe seguir la IA...\n\nEjemplos:\n• El precio del plan básico es $15.000 pesos\n• Siempre saluda con 'Hola bro, qué más?'\n• Nunca menciones a la competencia\n• Si preguntan por soporte, da el número 300-123-4567"}
                                    value={modalContent}
                                    onChange={e => setModalContent(e.target.value)}
                                    rows={9}
                                />
                            </div>
                        </div>
                        <div className="kb-modal-footer">
                            <button className="btn-premium danger" onClick={closeModal}>
                                <X size={13} /> Cancelar
                            </button>
                            <button
                                className="btn-premium primary"
                                onClick={handleModalSave}
                                disabled={modalSaving || !modalTitle.trim() || !modalContent.trim()}
                            >
                                {modalSaving ? <Loader size={13} className="spin" /> : <Check size={13} />}
                                {editingRule ? 'Guardar cambios' : 'Agregar regla'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default AIRulesPage;
