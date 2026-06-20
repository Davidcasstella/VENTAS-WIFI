import React, { useEffect, useState, useCallback } from 'react';
import {
    Mail, Users, Clock, CheckCircle, XCircle, Trash2,
    Loader, AlertCircle, X, ChevronDown, StickyNote,
    Package, Filter, RefreshCw, Shield
} from 'lucide-react';
import api from '../services/api';
import socket from '../services/socket';

const PLAN_LABELS = {
    'combo-10': 'Combo de 10',
    'combo-15': 'Combo de 15',
    '': 'Sin asignar',
};

const STATUS_CONFIG = {
    pending_email: { label: 'Esperando correo', color: '#ffaa00', bg: 'rgba(255,170,0,0.12)', border: 'rgba(255,170,0,0.25)' },
    pending_access: { label: 'Pendiente acceso', color: '#00aaff', bg: 'rgba(0,170,255,0.12)', border: 'rgba(0,170,255,0.25)' },
    access_granted: { label: 'Acceso concedido', color: '#00ff00', bg: 'rgba(0,255,0,0.12)', border: 'rgba(0,255,0,0.25)' },
    access_denied: { label: 'Denegado', color: '#ff4444', bg: 'rgba(255,68,68,0.12)', border: 'rgba(255,68,68,0.25)' },
};

const CourseAccessPage = () => {
    const [records, setRecords] = useState([]);
    const [stats, setStats] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [filter, setFilter] = useState('all'); // all, pending_email, pending_access, access_granted
    const [notesModal, setNotesModal] = useState(null); // { id, notes }
    const [notesSaving, setNotesSaving] = useState(false);
    const [addModal, setAddModal] = useState(null); // null or { pushName, phone, email, plan, status, notes }
    const [addSaving, setAddSaving] = useState(false);

    // ── Fetch data ──────────────────────────────────────────
    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            const { data } = await api.get('/api/course-access');
            if (data.success) {
                setRecords(data.records || []);
                setStats(data.stats || {});
            }
        } catch {
            setError('Error al cargar los accesos');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    // ── Real-time Socket.io updates ─────────────────────────
    useEffect(() => {
        const handleNew = (record) => {
            setRecords(prev => {
                if (prev.some(r => r.id === record.id)) return prev;
                return [record, ...prev];
            });
            setStats(prev => ({
                ...prev,
                total: (prev.total || 0) + 1,
                pendingEmail: (prev.pendingEmail || 0) + 1,
            }));
        };
        const handleUpdate = (record) => {
            setRecords(prev => prev.map(r => r.id === record.id ? record : r));
            // Refresh stats on next load
        };
        const handleDelete = ({ id }) => {
            setRecords(prev => prev.filter(r => r.id !== id));
        };

        socket.on('course-access:new', handleNew);
        socket.on('course-access:update', handleUpdate);
        socket.on('course-access:delete', handleDelete);

        return () => {
            socket.off('course-access:new', handleNew);
            socket.off('course-access:update', handleUpdate);
            socket.off('course-access:delete', handleDelete);
        };
    }, []);

    // ── Actions ─────────────────────────────────────────────
    const handleGrant = async (id) => {
        try {
            const { data } = await api.put(`/api/course-access/${id}/grant`);
            if (data.success) {
                setRecords(prev => prev.map(r => r.id === id ? data.record : r));
            }
        } catch { setError('Error al conceder acceso'); }
    };

    const handleDeny = async (id) => {
        try {
            const { data } = await api.put(`/api/course-access/${id}/deny`);
            if (data.success) {
                setRecords(prev => prev.map(r => r.id === id ? data.record : r));
            }
        } catch { setError('Error al denegar acceso'); }
    };

    const handlePlanChange = async (id, plan) => {
        try {
            const { data } = await api.put(`/api/course-access/${id}/plan`, { plan });
            if (data.success) {
                setRecords(prev => prev.map(r => r.id === id ? data.record : r));
            }
        } catch { setError('Error al cambiar plan'); }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('¿Eliminar este registro?')) return;
        try {
            const { data } = await api.delete(`/api/course-access/${id}`);
            if (data.success) {
                setRecords(prev => prev.filter(r => r.id !== id));
            }
        } catch { setError('Error al eliminar'); }
    };

    const handleSaveNotes = async () => {
        if (!notesModal) return;
        setNotesSaving(true);
        try {
            await api.put(`/api/course-access/${notesModal.id}/notes`, { notes: notesModal.notes });
            setRecords(prev => prev.map(r => r.id === notesModal.id ? { ...r, notes: notesModal.notes } : r));
            setNotesModal(null);
        } catch { setError('Error al guardar notas'); }
        finally { setNotesSaving(false); }
    };

    const handleCreateManual = async () => {
        if (!addModal) return;
        if (!addModal.email.trim()) {
            setError('El correo electrónico es requerido');
            return;
        }
        setAddSaving(true);
        try {
            const { data } = await api.post('/api/course-access', addModal);
            if (data.success) {
                setAddModal(null);
                fetchData();
            } else {
                setError(data.error || 'Error al crear el acceso');
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Error al crear el acceso');
        } finally {
            setAddSaving(false);
        }
    };

    // ── Filter records ──────────────────────────────────────
    const filtered = filter === 'all' ? records : records.filter(r => r.status === filter);

    const pendingCount = (stats.pendingEmail || 0) + (stats.pendingAccess || 0);

    const formatDate = (iso) => {
        if (!iso) return '—';
        const d = new Date(iso);
        return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
            + ' ' + d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    };

    const formatPhone = (phone) => {
        if (!phone) return '—';
        // Format as +57 302 859 9105
        if (phone.startsWith('57') && phone.length >= 10) {
            return `+${phone.slice(0, 2)} ${phone.slice(2, 5)} ${phone.slice(5, 8)} ${phone.slice(8)}`;
        }
        return phone;
    };

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
                    justifyContent: 'space-between', gap: '0.75rem',
                    flexWrap: 'wrap',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <Mail size={22} style={{ color: '#00ff00' }} />
                        <h1 style={{ fontSize: '1.3rem', fontWeight: 800, margin: 0, color: '#e9edef' }}>
                            Acceso a Cursos
                        </h1>
                        {!loading && pendingCount > 0 && (
                            <span style={{
                                fontSize: '0.72rem', fontWeight: 700, padding: '0.2rem 0.6rem',
                                borderRadius: '50px',
                                background: 'rgba(255,170,0,0.15)',
                                color: '#ffaa00',
                                border: '1px solid rgba(255,170,0,0.3)',
                                animation: 'pulse 2s infinite',
                            }}>
                                {pendingCount} pendiente{pendingCount !== 1 ? 's' : ''}
                            </span>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                        {/* Filter dropdown */}
                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                            <Filter size={13} style={{ color: 'rgba(255,255,255,0.4)', position: 'absolute', left: '0.6rem', pointerEvents: 'none' }} />
                            <select
                                value={filter}
                                onChange={e => setFilter(e.target.value)}
                                style={{
                                    background: 'rgba(255,255,255,0.05)',
                                    border: '1px solid rgba(0,255,0,0.15)',
                                    borderRadius: '8px',
                                    color: '#e9edef',
                                    padding: '0.45rem 0.75rem 0.45rem 2rem',
                                    fontSize: '0.8rem',
                                    cursor: 'pointer',
                                    outline: 'none',
                                }}
                            >
                                <option value="all">Todos</option>
                                <option value="pending_email">Esperando correo</option>
                                <option value="pending_access">Pendiente acceso</option>
                                <option value="access_granted">Acceso concedido</option>
                                <option value="access_denied">Denegados</option>
                            </select>
                        </div>
                        <button
                            onClick={() => setAddModal({ pushName: '', phone: '', email: '', plan: '', status: 'access_granted', notes: '' })}
                            className="kb-btn-pri"
                            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', background: '#00ff00', color: '#000000' }}
                        >
                            <Users size={14} /> Agregar Acceso
                        </button>
                        <button
                            onClick={fetchData}
                            className="kb-btn-pri"
                            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}
                        >
                            <RefreshCw size={14} /> Actualizar
                        </button>
                    </div>
                </div>
            </div>

            <div style={{ padding: '1rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                {/* Error banner */}
                {error && (
                    <div className="kb-error-banner">
                        <AlertCircle size={16} /><span>{error}</span>
                        <button onClick={() => setError('')}><X size={14} /></button>
                    </div>
                )}

                {/* Stats cards */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: '0.75rem',
                }}>
                    {/* Total */}
                    <div className="premium-card" style={{
                        padding: '1rem 1.2rem',
                        display: 'flex', alignItems: 'center', gap: '0.85rem',
                    }}>
                        <div style={{
                            width: 40, height: 40, borderRadius: 10,
                            background: 'rgba(0,255,0,0.1)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            <Users size={20} style={{ color: '#00ff00' }} />
                        </div>
                        <div>
                            <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>Total</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#e9edef' }}>{stats.total || 0}</div>
                        </div>
                    </div>

                    {/* Pending */}
                    <div className="premium-card" style={{
                        padding: '1rem 1.2rem',
                        display: 'flex', alignItems: 'center', gap: '0.85rem',
                    }}>
                        <div style={{
                            width: 40, height: 40, borderRadius: 10,
                            background: 'rgba(255,170,0,0.1)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            <Clock size={20} style={{ color: '#ffaa00' }} />
                        </div>
                        <div>
                            <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>Pendientes</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#ffaa00' }}>{pendingCount}</div>
                        </div>
                    </div>

                    {/* Granted */}
                    <div className="premium-card" style={{
                        padding: '1rem 1.2rem',
                        display: 'flex', alignItems: 'center', gap: '0.85rem',
                    }}>
                        <div style={{
                            width: 40, height: 40, borderRadius: 10,
                            background: 'rgba(0,255,0,0.1)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            <CheckCircle size={20} style={{ color: '#00ff00' }} />
                        </div>
                        <div>
                            <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>Concedidos</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#00ff00' }}>{stats.granted || 0}</div>
                        </div>
                    </div>
                </div>

                {/* Records table */}
                {loading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem', color: 'rgba(255,255,255,0.3)' }}>
                        <Loader size={28} className="spin" />
                    </div>
                ) : filtered.length === 0 ? (
                    <div style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        justifyContent: 'center', gap: '1rem',
                        padding: '4rem 2rem', color: 'rgba(255,255,255,0.25)',
                        textAlign: 'center',
                    }}>
                        <Shield size={44} style={{ opacity: 0.2 }} />
                        <h2 style={{ margin: 0, fontSize: '1.1rem', color: 'rgba(255,255,255,0.35)' }}>
                            {filter === 'all' ? 'Sin registros de acceso' : 'No hay registros con este filtro'}
                        </h2>
                        <p style={{ margin: 0, fontSize: '0.85rem' }}>
                            Los registros aparecerán aquí cuando un cliente envíe un comprobante de pago
                        </p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {filtered.map((record) => {
                            const statusCfg = STATUS_CONFIG[record.status] || STATUS_CONFIG.pending_email;
                            return (
                                <div
                                    key={record.id}
                                    className="premium-card"
                                    style={{
                                        padding: 0,
                                        border: `1px solid ${statusCfg.border}`,
                                        overflow: 'hidden',
                                        transition: 'all 0.2s ease',
                                    }}
                                >
                                    {/* Main row */}
                                    <div style={{
                                        display: 'flex', alignItems: 'center',
                                        gap: '0.75rem', padding: '0.85rem 1rem',
                                        flexWrap: 'wrap',
                                    }}>
                                        {/* Phone & Name */}
                                        <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                                            <div style={{
                                                fontWeight: 700, fontSize: '0.9rem', color: '#e9edef',
                                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                            }}>
                                                {record.pushName || 'Sin nombre'}
                                            </div>
                                            <div style={{
                                                fontSize: '0.78rem', color: 'rgba(255,255,255,0.45)',
                                                fontFamily: 'monospace',
                                            }}>
                                                {formatPhone(record.phone)}
                                            </div>
                                        </div>

                                        {/* Email */}
                                        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                                            {record.email ? (
                                                <div style={{
                                                    display: 'flex', alignItems: 'center', gap: '0.4rem',
                                                    fontSize: '0.85rem', color: '#00aaff',
                                                }}>
                                                    <Mail size={13} />
                                                    <span style={{
                                                        whiteSpace: 'nowrap', overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                    }}>
                                                        {record.email}
                                                    </span>
                                                </div>
                                            ) : (
                                                <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.25)', fontStyle: 'italic' }}>
                                                    Sin correo
                                                </span>
                                            )}
                                        </div>

                                        {/* Plan selector */}
                                        <div style={{ flex: '0 0 auto' }}>
                                            <select
                                                value={record.plan || ''}
                                                onChange={e => handlePlanChange(record.id, e.target.value)}
                                                style={{
                                                    background: record.plan ? 'rgba(0,255,0,0.08)' : 'rgba(255,255,255,0.05)',
                                                    border: `1px solid ${record.plan ? 'rgba(0,255,0,0.2)' : 'rgba(255,255,255,0.1)'}`,
                                                    borderRadius: '6px',
                                                    color: record.plan ? '#00ff00' : 'rgba(255,255,255,0.4)',
                                                    padding: '0.3rem 0.5rem',
                                                    fontSize: '0.75rem',
                                                    fontWeight: 700,
                                                    cursor: 'pointer',
                                                    outline: 'none',
                                                }}
                                            >
                                                <option value="">Plan...</option>
                                                <option value="combo-10">Combo de 10</option>
                                                <option value="combo-15">Combo de 15</option>
                                            </select>
                                        </div>

                                        {/* Status badge */}
                                        <span style={{
                                            fontSize: '0.68rem', fontWeight: 700,
                                            padding: '0.2rem 0.6rem', borderRadius: '50px',
                                            background: statusCfg.bg,
                                            color: statusCfg.color,
                                            border: `1px solid ${statusCfg.border}`,
                                            flexShrink: 0,
                                            whiteSpace: 'nowrap',
                                        }}>
                                            {statusCfg.label}
                                        </span>

                                        {/* Date */}
                                        <div style={{
                                            fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)',
                                            flexShrink: 0, whiteSpace: 'nowrap',
                                        }}>
                                            {formatDate(record.paymentDetectedAt)}
                                        </div>

                                        {/* Actions */}
                                        <div style={{ display: 'flex', gap: '0.3rem', flexShrink: 0 }}>
                                            {(record.status === 'pending_access' || record.status === 'pending_email') && (
                                                <button
                                                    className="kb-icon-btn"
                                                    title="Conceder acceso"
                                                    onClick={() => handleGrant(record.id)}
                                                    style={{ color: '#00ff00' }}
                                                >
                                                    <CheckCircle size={14} />
                                                </button>
                                            )}
                                            {record.status !== 'access_denied' && record.status !== 'access_granted' && (
                                                <button
                                                    className="kb-icon-btn"
                                                    title="Denegar acceso"
                                                    onClick={() => handleDeny(record.id)}
                                                    style={{ color: '#ff4444' }}
                                                >
                                                    <XCircle size={14} />
                                                </button>
                                            )}
                                            <button
                                                className="kb-icon-btn"
                                                title="Notas"
                                                onClick={() => setNotesModal({ id: record.id, notes: record.notes || '' })}
                                            >
                                                <StickyNote size={13} />
                                            </button>
                                            <button
                                                className="kb-icon-btn kb-icon-btn-danger"
                                                title="Eliminar"
                                                onClick={() => handleDelete(record.id)}
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Notes row (if has notes) */}
                                    {record.notes && (
                                        <div style={{
                                            padding: '0.5rem 1rem',
                                            borderTop: '1px solid rgba(255,255,255,0.05)',
                                            background: 'rgba(0,0,0,0.15)',
                                            fontSize: '0.78rem',
                                            color: 'rgba(255,255,255,0.45)',
                                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                                        }}>
                                            <StickyNote size={12} style={{ flexShrink: 0, opacity: 0.5 }} />
                                            {record.notes}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── NOTES MODAL ── */}
            {notesModal && (
                <div className="kb-modal-overlay" onClick={() => setNotesModal(null)}>
                    <div className="kb-modal" style={{ maxWidth: '440px' }} onClick={e => e.stopPropagation()}>
                        <div className="kb-modal-header">
                            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <StickyNote size={16} style={{ color: '#00ff00' }} />
                                Notas
                            </h3>
                            <button className="kb-modal-close" onClick={() => setNotesModal(null)}><X size={16} /></button>
                        </div>
                        <div className="kb-modal-body">
                            <textarea
                                className="form-input kb-modal-textarea"
                                placeholder="Escribe notas sobre este acceso..."
                                value={notesModal.notes}
                                onChange={e => setNotesModal(prev => ({ ...prev, notes: e.target.value }))}
                                rows={5}
                                autoFocus
                            />
                        </div>
                        <div className="kb-modal-footer">
                            <button className="btn-premium danger" onClick={() => setNotesModal(null)}>
                                <X size={13} /> Cancelar
                            </button>
                            <button
                                className="btn-premium primary"
                                onClick={handleSaveNotes}
                                disabled={notesSaving}
                            >
                                {notesSaving ? <Loader size={13} className="spin" /> : <CheckCircle size={13} />}
                                Guardar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── ADD MANUAL ACCESS MODAL ── */}
            {addModal && (
                <div className="kb-modal-overlay" onClick={() => setAddModal(null)}>
                    <div className="kb-modal" style={{ maxWidth: '440px' }} onClick={e => e.stopPropagation()}>
                        <div className="kb-modal-header">
                            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <Users size={16} style={{ color: '#00ff00' }} />
                                Nuevo Acceso Manual
                            </h3>
                            <button className="kb-modal-close" onClick={() => setAddModal(null)}><X size={16} /></button>
                        </div>
                        <div className="kb-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', color: 'rgba(255,255,255,0.45)', marginBottom: '0.3rem', fontWeight: 600 }}>Nombre del Cliente</label>
                                <input
                                    type="text"
                                    className="form-input kb-modal-title-input"
                                    placeholder="Ej. Juan Pérez"
                                    value={addModal.pushName}
                                    onChange={e => setAddModal(prev => ({ ...prev, pushName: e.target.value }))}
                                    style={{ width: '100%', boxSizing: 'border-box' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', color: 'rgba(255,255,255,0.45)', marginBottom: '0.3rem', fontWeight: 600 }}>Teléfono (WhatsApp)</label>
                                <input
                                    type="text"
                                    className="form-input kb-modal-title-input"
                                    placeholder="Ej. 573028599105"
                                    value={addModal.phone}
                                    onChange={e => setAddModal(prev => ({ ...prev, phone: e.target.value }))}
                                    style={{ width: '100%', boxSizing: 'border-box' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', color: 'rgba(255,255,255,0.45)', marginBottom: '0.3rem', fontWeight: 600 }}>Correo Electrónico (Requerido)</label>
                                <input
                                    type="email"
                                    className="form-input kb-modal-title-input"
                                    placeholder="Ej. cliente@gmail.com"
                                    value={addModal.email}
                                    onChange={e => setAddModal(prev => ({ ...prev, email: e.target.value }))}
                                    style={{ width: '100%', boxSizing: 'border-box' }}
                                    required
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', color: 'rgba(255,255,255,0.45)', marginBottom: '0.3rem', fontWeight: 600 }}>Plan del Curso</label>
                                <select
                                    value={addModal.plan}
                                    onChange={e => setAddModal(prev => ({ ...prev, plan: e.target.value }))}
                                    style={{
                                        width: '100%',
                                        padding: '0.6rem',
                                        background: 'rgba(255,255,255,0.05)',
                                        border: '1px solid rgba(0,255,0,0.2)',
                                        borderRadius: '8px',
                                        color: '#e9edef',
                                        outline: 'none',
                                    }}
                                >
                                    <option value="">Seleccionar plan...</option>
                                    <option value="combo-10">Combo de 10</option>
                                    <option value="combo-15">Combo de 15</option>
                                </select>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', color: 'rgba(255,255,255,0.45)', marginBottom: '0.3rem', fontWeight: 600 }}>Estado de Acceso</label>
                                <select
                                    value={addModal.status}
                                    onChange={e => setAddModal(prev => ({ ...prev, status: e.target.value }))}
                                    style={{
                                        width: '100%',
                                        padding: '0.6rem',
                                        background: 'rgba(255,255,255,0.05)',
                                        border: '1px solid rgba(0,255,0,0.2)',
                                        borderRadius: '8px',
                                        color: '#e9edef',
                                        outline: 'none',
                                    }}
                                >
                                    <option value="pending_email">Esperando correo</option>
                                    <option value="pending_access">Pendiente acceso</option>
                                    <option value="access_granted">Acceso concedido</option>
                                    <option value="access_denied">Denegado</option>
                                </select>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', color: 'rgba(255,255,255,0.45)', marginBottom: '0.3rem', fontWeight: 600 }}>Notas</label>
                                <textarea
                                    className="form-input kb-modal-textarea"
                                    placeholder="Escribe notas adicionales..."
                                    value={addModal.notes}
                                    onChange={e => setAddModal(prev => ({ ...prev, notes: e.target.value }))}
                                    rows={3}
                                    style={{ width: '100%', boxSizing: 'border-box' }}
                                />
                            </div>
                        </div>
                        <div className="kb-modal-footer">
                            <button className="btn-premium danger" onClick={() => setAddModal(null)}>
                                <X size={13} /> Cancelar
                            </button>
                            <button
                                className="btn-premium primary"
                                onClick={handleCreateManual}
                                disabled={addSaving || !addModal.email.trim()}
                            >
                                {addSaving ? <Loader size={13} className="spin" /> : <CheckCircle size={13} />}
                                Guardar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default CourseAccessPage;
