import React, { useEffect, useState, useCallback } from 'react';
import {
    Mail, Users, HardDrive, FolderOpen, Shield, CheckCircle,
    XCircle, Trash2, Loader, AlertCircle, X, RefreshCw,
    Settings, Activity, Eye, EyeOff, Link, Unlink,
    Clock, ChevronDown, ChevronUp, FolderPlus, Share2,
    Zap, ZapOff, Info
} from 'lucide-react';
import api from '../services/api';
import socket from '../services/socket';

// ── STATUS CONFIGS ──────────────────────────────────────────

const STATUS_CONFIG = {
    pending_email: { label: 'Esperando correo', color: '#ffaa00', bg: 'rgba(255,170,0,0.12)', border: 'rgba(255,170,0,0.25)', icon: Clock },
    pending_access: { label: 'Pendiente acceso', color: '#00aaff', bg: 'rgba(0,170,255,0.12)', border: 'rgba(0,170,255,0.25)', icon: Mail },
    access_granted: { label: 'Acceso activo', color: '#00ff00', bg: 'rgba(0,255,0,0.12)', border: 'rgba(0,255,0,0.25)', icon: CheckCircle },
    access_denied: { label: 'Denegado', color: '#ff4444', bg: 'rgba(255,68,68,0.12)', border: 'rgba(255,68,68,0.25)', icon: XCircle },
};

const PLAN_LABELS = {
    'combo-10': 'Combo de 10',
    'combo-15': 'Combo de 15',
    '': 'Sin asignar',
};

// ── MAIN COMPONENT ──────────────────────────────────────────

const EmailManagementPage = () => {
    // Tab state
    const [activeTab, setActiveTab] = useState('users'); // 'users', 'drive', 'folders', 'activity'

    // Drive status
    const [driveStatus, setDriveStatus] = useState(null);
    const [driveLoading, setDriveLoading] = useState(true);

    // Folders
    const [folders, setFolders] = useState([]);
    const [foldersLoading, setFoldersLoading] = useState(false);
    const [expandedFolder, setExpandedFolder] = useState(null);
    const [folderPermissions, setFolderPermissions] = useState({});

    // Users (course access records)
    const [records, setRecords] = useState([]);
    const [stats, setStats] = useState({});
    const [usersLoading, setUsersLoading] = useState(true);
    const [filter, setFilter] = useState('all');

    // Drive config
    const [driveConfig, setDriveConfig] = useState({ planFolders: {} });

    // Activity log
    const [activityLog, setActivityLog] = useState([]);
    const [activityLoading, setActivityLoading] = useState(false);

    // UI state
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [addModal, setAddModal] = useState(null);
    const [addSaving, setAddSaving] = useState(false);
    const [shareModal, setShareModal] = useState(null); // { recordId, email }
    const [shareSaving, setShareSaving] = useState(false);

    // ── DATA FETCHING ─────────────────────────────────────────

    const fetchDriveStatus = useCallback(async () => {
        setDriveLoading(true);
        try {
            const { data } = await api.get('/api/google-drive/status');
            if (data.success) setDriveStatus(data);
        } catch { setDriveStatus({ connected: false, error: 'Could not reach server' }); }
        finally { setDriveLoading(false); }
    }, []);

    const fetchFolders = useCallback(async () => {
        setFoldersLoading(true);
        try {
            const { data } = await api.get('/api/google-drive/folders');
            if (data.success) setFolders(data.folders || []);
        } catch { }
        finally { setFoldersLoading(false); }
    }, []);

    const fetchUsers = useCallback(async () => {
        setUsersLoading(true);
        try {
            const { data } = await api.get('/api/course-access');
            if (data.success) {
                setRecords(data.records || []);
                setStats(data.stats || {});
            }
        } catch { setError('Error al cargar usuarios'); }
        finally { setUsersLoading(false); }
    }, []);

    const fetchConfig = useCallback(async () => {
        try {
            const { data } = await api.get('/api/google-drive/config');
            if (data.success) setDriveConfig(data.config || { planFolders: {} });
        } catch { }
    }, []);

    const fetchActivity = useCallback(async () => {
        setActivityLoading(true);
        try {
            const { data } = await api.get('/api/google-drive/activity');
            if (data.success) setActivityLog(data.log || []);
        } catch { }
        finally { setActivityLoading(false); }
    }, []);

    useEffect(() => {
        fetchDriveStatus();
        fetchUsers();
        fetchConfig();
    }, [fetchDriveStatus, fetchUsers, fetchConfig]);

    // Fetch tab-specific data
    useEffect(() => {
        if (activeTab === 'folders' && folders.length === 0) fetchFolders();
        if (activeTab === 'activity') fetchActivity();
    }, [activeTab, fetchFolders, fetchActivity, folders.length]);

    // ── SOCKET.IO REAL-TIME ──────────────────────────────────

    useEffect(() => {
        const handleNew = (record) => {
            setRecords(prev => {
                if (prev.some(r => r.id === record.id)) return prev;
                return [record, ...prev];
            });
        };
        const handleUpdate = (record) => {
            setRecords(prev => prev.map(r => r.id === record.id ? record : r));
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

    // ── ACTIONS ──────────────────────────────────────────────

    const handleGrant = async (id) => {
        try {
            const { data } = await api.put(`/api/course-access/${id}/grant`);
            if (data.success) {
                setRecords(prev => prev.map(r => r.id === id ? data.record : r));
                setSuccess('Acceso concedido correctamente');
                setTimeout(() => setSuccess(''), 3000);
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Error al conceder acceso');
        }
    };

    const handleDeny = async (id) => {
        try {
            const { data } = await api.put(`/api/course-access/${id}/deny`);
            if (data.success) {
                setRecords(prev => prev.map(r => r.id === id ? data.record : r));
                setSuccess('Acceso revocado correctamente');
                setTimeout(() => setSuccess(''), 3000);
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Error al revocar acceso');
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('¿Eliminar este registro permanentemente?')) return;
        try {
            const { data } = await api.delete(`/api/course-access/${id}`);
            if (data.success) {
                setRecords(prev => prev.filter(r => r.id !== id));
            }
        } catch { setError('Error al eliminar'); }
    };

    const handlePlanChange = async (id, plan) => {
        try {
            const { data } = await api.put(`/api/course-access/${id}/plan`, { plan });
            if (data.success) {
                setRecords(prev => prev.map(r => r.id === id ? data.record : r));
            }
        } catch { setError('Error al cambiar plan'); }
    };

    const handleCreateManual = async () => {
        if (!addModal || !addModal.email.trim()) {
            setError('El correo electrónico es requerido');
            return;
        }
        setAddSaving(true);
        try {
            const { data } = await api.post('/api/course-access', addModal);
            if (data.success) {
                setAddModal(null);
                fetchUsers();
                setSuccess('Usuario agregado correctamente');
                setTimeout(() => setSuccess(''), 3000);
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Error al crear acceso');
        } finally { setAddSaving(false); }
    };

    const handleShareDirect = async (folderId, email) => {
        setShareSaving(true);
        try {
            const { data } = await api.post('/api/google-drive/share', { folderId, email, role: 'reader' });
            if (data.success) {
                setSuccess(`Carpeta compartida con ${email}`);
                setTimeout(() => setSuccess(''), 3000);
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Error al compartir');
        } finally { setShareSaving(false); }
    };

    const handleRevokeDirect = async (folderId, permissionId) => {
        try {
            await api.delete('/api/google-drive/share', { data: { folderId, permissionId } });
            setSuccess('Permiso revocado');
            setTimeout(() => setSuccess(''), 3000);
            // Refresh permissions for this folder
            loadFolderPermissions(folderId);
        } catch (err) {
            setError(err.response?.data?.error || 'Error al revocar');
        }
    };

    const loadFolderPermissions = async (folderId) => {
        try {
            const { data } = await api.get(`/api/google-drive/folders/${folderId}/permissions`);
            if (data.success) {
                setFolderPermissions(prev => ({ ...prev, [folderId]: data.permissions }));
            }
        } catch { }
    };

    const handleSavePlanFolders = async (plan, folderIds) => {
        try {
            const { data } = await api.put('/api/google-drive/config/plan-folders', { plan, folderIds });
            if (data.success) {
                setDriveConfig(data.config);
                setSuccess(`Carpetas de "${PLAN_LABELS[plan] || plan}" actualizadas`);
                setTimeout(() => setSuccess(''), 3000);
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Error al guardar configuración');
        }
    };

    // ── FILTER ───────────────────────────────────────────────

    const filtered = filter === 'all' ? records : records.filter(r => r.status === filter);

    const formatDate = (iso) => {
        if (!iso) return '—';
        const d = new Date(iso);
        return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
            + ' ' + d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    };

    const formatPhone = (phone) => {
        if (!phone) return '—';
        if (phone.startsWith('57') && phone.length >= 10) {
            return `+${phone.slice(0, 2)} ${phone.slice(2, 5)} ${phone.slice(5, 8)} ${phone.slice(8)}`;
        }
        return phone;
    };

    const pendingCount = (stats.pendingEmail || 0) + (stats.pendingAccess || 0);

    // ── RENDER ───────────────────────────────────────────────

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
                        <h1 id="email-management-title" style={{ fontSize: '1.3rem', fontWeight: 800, margin: 0, color: '#e9edef' }}>
                            Correos y Accesos
                        </h1>
                        {!usersLoading && pendingCount > 0 && (
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
                        {/* Drive connection indicator */}
                        {!driveLoading && (
                            <span style={{
                                fontSize: '0.68rem', fontWeight: 700, padding: '0.2rem 0.55rem',
                                borderRadius: '50px',
                                background: driveStatus?.connected ? 'rgba(0,255,0,0.1)' : 'rgba(255,68,68,0.1)',
                                color: driveStatus?.connected ? '#00ff00' : '#ff4444',
                                border: `1px solid ${driveStatus?.connected ? 'rgba(0,255,0,0.25)' : 'rgba(255,68,68,0.25)'}`,
                                display: 'flex', alignItems: 'center', gap: '0.3rem',
                            }}>
                                <HardDrive size={10} />
                                {driveStatus?.connected ? 'Drive OK' : 'Drive ✗'}
                            </span>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <button
                            onClick={() => setAddModal({ pushName: '', phone: '', email: '', plan: '', status: 'access_granted', notes: '' })}
                            className="kb-btn-pri"
                            id="add-user-btn"
                            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', background: '#00ff00', color: '#000000' }}
                        >
                            <Users size={14} /> Agregar
                        </button>
                        <button
                            onClick={() => { fetchUsers(); fetchDriveStatus(); }}
                            className="kb-btn-pri"
                            id="refresh-btn"
                            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}
                        >
                            <RefreshCw size={14} />
                        </button>
                    </div>
                </div>

                {/* ── TAB BAR ── */}
                <div style={{
                    display: 'flex', gap: 0,
                    borderTop: '1px solid rgba(255,255,255,0.05)',
                    overflowX: 'auto',
                }}>
                    {[
                        { id: 'users', label: 'Usuarios', icon: Users, count: stats.total || 0 },
                        { id: 'drive', label: 'Google Drive', icon: HardDrive },
                        { id: 'folders', label: 'Carpetas', icon: FolderOpen },
                        { id: 'activity', label: 'Actividad', icon: Activity },
                    ].map(tab => (
                        <button
                            key={tab.id}
                            id={`tab-${tab.id}`}
                            onClick={() => setActiveTab(tab.id)}
                            style={{
                                flex: '1 1 0',
                                padding: '0.6rem 1rem',
                                background: 'none',
                                border: 'none',
                                borderBottom: activeTab === tab.id ? '2px solid #00ff00' : '2px solid transparent',
                                color: activeTab === tab.id ? '#00ff00' : 'rgba(255,255,255,0.4)',
                                fontWeight: 700,
                                fontSize: '0.78rem',
                                cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                                transition: 'all 0.2s ease',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            <tab.icon size={14} />
                            {tab.label}
                            {tab.count !== undefined && (
                                <span style={{
                                    fontSize: '0.65rem', padding: '0.1rem 0.4rem',
                                    borderRadius: '50px',
                                    background: 'rgba(255,255,255,0.08)',
                                }}>{tab.count}</span>
                            )}
                        </button>
                    ))}
                </div>
            </div>

            <div style={{ padding: '1rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                {/* Banners */}
                {error && (
                    <div className="kb-error-banner">
                        <AlertCircle size={16} /><span>{error}</span>
                        <button onClick={() => setError('')}><X size={14} /></button>
                    </div>
                )}
                {success && (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        padding: '0.6rem 1rem', borderRadius: '10px',
                        background: 'rgba(0,255,0,0.08)', border: '1px solid rgba(0,255,0,0.2)',
                        color: '#00ff00', fontSize: '0.85rem', fontWeight: 600,
                    }}>
                        <CheckCircle size={16} /><span>{success}</span>
                        <button onClick={() => setSuccess('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#00ff00', cursor: 'pointer' }}>
                            <X size={14} />
                        </button>
                    </div>
                )}

                {/* ══════════════════════════════════════════════ */}
                {/* TAB: USERS */}
                {/* ══════════════════════════════════════════════ */}
                {activeTab === 'users' && (
                    <>
                        {/* Stats cards */}
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                            gap: '0.75rem',
                        }}>
                            {[
                                { label: 'Total', value: stats.total || 0, color: '#00ff00', icon: Users },
                                { label: 'Pendientes', value: pendingCount, color: '#ffaa00', icon: Clock },
                                { label: 'Activos', value: stats.granted || 0, color: '#00ff00', icon: CheckCircle },
                                { label: 'Denegados', value: stats.denied || 0, color: '#ff4444', icon: XCircle },
                            ].map(s => (
                                <div key={s.label} className="premium-card" style={{
                                    padding: '0.85rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem',
                                }}>
                                    <div style={{
                                        width: 36, height: 36, borderRadius: 8,
                                        background: `${s.color}15`,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}>
                                        <s.icon size={18} style={{ color: s.color }} />
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>{s.label}</div>
                                        <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#e9edef' }}>{s.value}</div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Filter */}
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                            {[
                                { key: 'all', label: 'Todos' },
                                { key: 'pending_email', label: 'Esperando correo' },
                                { key: 'pending_access', label: 'Pendiente acceso' },
                                { key: 'access_granted', label: 'Activos' },
                                { key: 'access_denied', label: 'Denegados' },
                            ].map(f => (
                                <button
                                    key={f.key}
                                    id={`filter-${f.key}`}
                                    onClick={() => setFilter(f.key)}
                                    style={{
                                        padding: '0.35rem 0.75rem',
                                        borderRadius: '50px',
                                        border: `1px solid ${filter === f.key ? 'rgba(0,255,0,0.3)' : 'rgba(255,255,255,0.1)'}`,
                                        background: filter === f.key ? 'rgba(0,255,0,0.1)' : 'rgba(255,255,255,0.03)',
                                        color: filter === f.key ? '#00ff00' : 'rgba(255,255,255,0.5)',
                                        fontSize: '0.75rem',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        transition: 'all 0.2s ease',
                                    }}
                                >
                                    {f.label}
                                </button>
                            ))}
                        </div>

                        {/* Records list */}
                        {usersLoading ? (
                            <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem', color: 'rgba(255,255,255,0.3)' }}>
                                <Loader size={28} className="spin" />
                            </div>
                        ) : filtered.length === 0 ? (
                            <div style={{
                                display: 'flex', flexDirection: 'column', alignItems: 'center',
                                justifyContent: 'center', gap: '1rem', padding: '4rem 2rem',
                                color: 'rgba(255,255,255,0.25)', textAlign: 'center',
                            }}>
                                <Shield size={44} style={{ opacity: 0.2 }} />
                                <h2 style={{ margin: 0, fontSize: '1.1rem', color: 'rgba(255,255,255,0.35)' }}>
                                    {filter === 'all' ? 'Sin registros' : 'Sin resultados para este filtro'}
                                </h2>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                {filtered.map((record) => {
                                    const statusCfg = STATUS_CONFIG[record.status] || STATUS_CONFIG.pending_email;
                                    const StatusIcon = statusCfg.icon;
                                    const hasDriveAccess = record.drivePermissions && record.drivePermissions.length > 0
                                        && record.drivePermissions.some(p => !p.revokedAt);
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
                                            <div style={{
                                                display: 'flex', alignItems: 'center',
                                                gap: '0.75rem', padding: '0.85rem 1rem',
                                                flexWrap: 'wrap',
                                            }}>
                                                {/* Name & Phone */}
                                                <div style={{ flex: '1 1 140px', minWidth: 0 }}>
                                                    <div style={{
                                                        fontWeight: 700, fontSize: '0.9rem', color: '#e9edef',
                                                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                                    }}>
                                                        {record.pushName || 'Sin nombre'}
                                                    </div>
                                                    <div style={{
                                                        fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)',
                                                        fontFamily: 'monospace',
                                                    }}>
                                                        {formatPhone(record.phone)}
                                                    </div>
                                                </div>

                                                {/* Email */}
                                                <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                                                    {record.email ? (
                                                        <div style={{
                                                            display: 'flex', alignItems: 'center', gap: '0.4rem',
                                                            fontSize: '0.82rem', color: '#00aaff',
                                                        }}>
                                                            <Mail size={13} />
                                                            <span style={{
                                                                whiteSpace: 'nowrap', overflow: 'hidden',
                                                                textOverflow: 'ellipsis',
                                                            }}>{record.email}</span>
                                                        </div>
                                                    ) : (
                                                        <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.25)', fontStyle: 'italic' }}>
                                                            Sin correo
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Plan */}
                                                <div style={{ flex: '0 0 auto' }}>
                                                    <select
                                                        value={record.plan || ''}
                                                        onChange={e => handlePlanChange(record.id, e.target.value)}
                                                        id={`plan-select-${record.id}`}
                                                        style={{
                                                            background: record.plan ? 'rgba(0,255,0,0.08)' : 'rgba(255,255,255,0.05)',
                                                            border: `1px solid ${record.plan ? 'rgba(0,255,0,0.2)' : 'rgba(255,255,255,0.1)'}`,
                                                            borderRadius: '6px',
                                                            color: record.plan ? '#00ff00' : 'rgba(255,255,255,0.4)',
                                                            padding: '0.3rem 0.5rem',
                                                            fontSize: '0.73rem',
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

                                                {/* Drive indicator */}
                                                <div style={{
                                                    display: 'flex', alignItems: 'center', gap: '0.3rem',
                                                    fontSize: '0.68rem', fontWeight: 700,
                                                    color: hasDriveAccess ? '#00ff00' : 'rgba(255,255,255,0.2)',
                                                }}>
                                                    <HardDrive size={12} />
                                                    {hasDriveAccess ? 'Drive ✓' : 'Sin Drive'}
                                                </div>

                                                {/* Status badge */}
                                                <span style={{
                                                    fontSize: '0.66rem', fontWeight: 700,
                                                    padding: '0.2rem 0.55rem', borderRadius: '50px',
                                                    background: statusCfg.bg,
                                                    color: statusCfg.color,
                                                    border: `1px solid ${statusCfg.border}`,
                                                    flexShrink: 0, whiteSpace: 'nowrap',
                                                    display: 'flex', alignItems: 'center', gap: '0.25rem',
                                                }}>
                                                    <StatusIcon size={10} />
                                                    {statusCfg.label}
                                                </span>

                                                {/* Date */}
                                                <div style={{
                                                    fontSize: '0.7rem', color: 'rgba(255,255,255,0.25)',
                                                    flexShrink: 0, whiteSpace: 'nowrap',
                                                }}>
                                                    {formatDate(record.paymentDetectedAt)}
                                                </div>

                                                {/* Actions */}
                                                <div style={{ display: 'flex', gap: '0.25rem', flexShrink: 0 }}>
                                                    {(record.status === 'pending_access' || record.status === 'pending_email') && (
                                                        <button
                                                            className="kb-icon-btn"
                                                            title="Conceder acceso + Drive"
                                                            onClick={() => handleGrant(record.id)}
                                                            style={{ color: '#00ff00' }}
                                                            id={`grant-${record.id}`}
                                                        >
                                                            <CheckCircle size={14} />
                                                        </button>
                                                    )}
                                                    {record.status === 'access_granted' && (
                                                        <button
                                                            className="kb-icon-btn"
                                                            title="Revocar acceso + Drive"
                                                            onClick={() => handleDeny(record.id)}
                                                            style={{ color: '#ff4444' }}
                                                            id={`revoke-${record.id}`}
                                                        >
                                                            <Unlink size={14} />
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
                                                        className="kb-icon-btn kb-icon-btn-danger"
                                                        title="Eliminar"
                                                        onClick={() => handleDelete(record.id)}
                                                        id={`delete-${record.id}`}
                                                    >
                                                        <Trash2 size={13} />
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Drive permissions detail */}
                                            {record.drivePermissions && record.drivePermissions.length > 0 && (
                                                <div style={{
                                                    padding: '0.5rem 1rem',
                                                    borderTop: '1px solid rgba(255,255,255,0.05)',
                                                    background: 'rgba(0,0,0,0.15)',
                                                    fontSize: '0.75rem',
                                                    display: 'flex', gap: '0.5rem', flexWrap: 'wrap',
                                                    alignItems: 'center',
                                                }}>
                                                    <FolderOpen size={12} style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }} />
                                                    {record.drivePermissions.map((p, idx) => (
                                                        <span key={idx} style={{
                                                            padding: '0.15rem 0.5rem',
                                                            borderRadius: '4px',
                                                            background: p.revokedAt ? 'rgba(255,68,68,0.08)' : 'rgba(0,255,0,0.08)',
                                                            color: p.revokedAt ? 'rgba(255,68,68,0.5)' : 'rgba(0,255,0,0.7)',
                                                            border: `1px solid ${p.revokedAt ? 'rgba(255,68,68,0.15)' : 'rgba(0,255,0,0.15)'}`,
                                                            fontSize: '0.7rem',
                                                            textDecoration: p.revokedAt ? 'line-through' : 'none',
                                                        }}>
                                                            {p.folderName || p.folderId}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}

                {/* ══════════════════════════════════════════════ */}
                {/* TAB: GOOGLE DRIVE */}
                {/* ══════════════════════════════════════════════ */}
                {activeTab === 'drive' && (
                    <>
                        {/* Connection Status Card */}
                        <div className="premium-card" style={{ padding: '1.25rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                                <div style={{
                                    width: 44, height: 44, borderRadius: 10,
                                    background: driveStatus?.connected ? 'rgba(0,255,0,0.1)' : 'rgba(255,68,68,0.1)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                    <HardDrive size={22} style={{ color: driveStatus?.connected ? '#00ff00' : '#ff4444' }} />
                                </div>
                                <div>
                                    <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#e9edef' }}>
                                        {driveLoading ? 'Verificando...' : driveStatus?.connected ? 'Google Drive Conectado' : 'Google Drive No Conectado'}
                                    </div>
                                    <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.45)' }}>
                                        {driveStatus?.connected ? 'Service Account autenticada correctamente' : (driveStatus?.error || 'Configura las credenciales en .env')}
                                    </div>
                                </div>
                            </div>

                            {driveStatus?.connected && (
                                <div style={{
                                    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                                    gap: '0.75rem',
                                }}>
                                    {[
                                        { label: 'Service Account', value: driveStatus.serviceAccountEmail, icon: Mail },
                                        { label: 'Admin Principal', value: driveStatus.adminEmail || 'No configurado', icon: Shield },
                                        { label: 'Carpeta Predeterminada', value: driveStatus.defaultFolderId || 'No configurada', icon: FolderOpen },
                                        { label: 'Acceso Automático', value: driveStatus.autoGrant ? 'Activado' : 'Desactivado', icon: driveStatus.autoGrant ? Zap : ZapOff },
                                        { label: 'Rol por Defecto', value: driveStatus.defaultRole, icon: Users },
                                        { label: 'Días de Expiración', value: driveStatus.expiryDays === 0 ? 'Sin expiración' : `${driveStatus.expiryDays} días`, icon: Clock },
                                    ].map((item) => (
                                        <div key={item.label} style={{
                                            padding: '0.75rem',
                                            background: 'rgba(255,255,255,0.03)',
                                            borderRadius: '8px',
                                            border: '1px solid rgba(255,255,255,0.06)',
                                        }}>
                                            <div style={{
                                                display: 'flex', alignItems: 'center', gap: '0.4rem',
                                                fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', fontWeight: 600,
                                                marginBottom: '0.3rem',
                                            }}>
                                                <item.icon size={12} />
                                                {item.label}
                                            </div>
                                            <div style={{
                                                fontSize: '0.82rem', color: '#e9edef', fontWeight: 600,
                                                wordBreak: 'break-all',
                                            }}>
                                                {item.value}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Plan-Folder Mapping */}
                        <div className="premium-card" style={{ padding: '1.25rem' }}>
                            <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#e9edef', margin: '0 0 0.75rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <Settings size={16} style={{ color: '#00ff00' }} />
                                Carpetas por Plan
                            </h3>
                            <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.4)', margin: '0 0 1rem 0' }}>
                                Configura qué carpetas de Google Drive se comparten automáticamente con cada plan.
                            </p>

                            {['combo-10', 'combo-15'].map(plan => {
                                const currentFolders = driveConfig.planFolders?.[plan] || [];
                                return (
                                    <div key={plan} style={{
                                        padding: '0.75rem',
                                        background: 'rgba(255,255,255,0.03)',
                                        borderRadius: '8px',
                                        border: '1px solid rgba(255,255,255,0.06)',
                                        marginBottom: '0.5rem',
                                    }}>
                                        <div style={{
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                            marginBottom: '0.5rem',
                                        }}>
                                            <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#e9edef' }}>
                                                {PLAN_LABELS[plan]}
                                            </span>
                                            <span style={{
                                                fontSize: '0.68rem', color: 'rgba(255,255,255,0.35)',
                                            }}>
                                                {currentFolders.length} carpeta{currentFolders.length !== 1 ? 's' : ''}
                                            </span>
                                        </div>
                                        {currentFolders.length > 0 ? (
                                            <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                                                {currentFolders.map((fId, idx) => (
                                                    <span key={idx} style={{
                                                        padding: '0.15rem 0.5rem', borderRadius: '4px',
                                                        background: 'rgba(0,255,0,0.08)', color: 'rgba(0,255,0,0.7)',
                                                        border: '1px solid rgba(0,255,0,0.15)',
                                                        fontSize: '0.7rem', fontFamily: 'monospace',
                                                    }}>
                                                        {typeof fId === 'string' ? fId.substring(0, 20) + '...' : fId.folderId?.substring(0, 20) + '...'}
                                                    </span>
                                                ))}
                                            </div>
                                        ) : (
                                            <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.25)', fontStyle: 'italic' }}>
                                                Sin carpetas asignadas — usa la pestaña "Carpetas" para seleccionar
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Cron Status */}
                        {driveStatus?.cron && (
                            <div className="premium-card" style={{ padding: '1rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                    <Clock size={14} style={{ color: '#00aaff' }} />
                                    <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#e9edef' }}>
                                        Revocación Automática
                                    </span>
                                    <span style={{
                                        fontSize: '0.65rem', fontWeight: 700, padding: '0.1rem 0.45rem',
                                        borderRadius: '50px',
                                        background: driveStatus.cron.running ? 'rgba(0,255,0,0.1)' : 'rgba(255,255,255,0.05)',
                                        color: driveStatus.cron.running ? '#00ff00' : 'rgba(255,255,255,0.3)',
                                    }}>
                                        {driveStatus.cron.running ? 'Activo' : 'Inactivo'}
                                    </span>
                                </div>
                                {driveStatus.cron.lastRun && (
                                    <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.35)' }}>
                                        Última verificación: {formatDate(driveStatus.cron.lastRun)}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Setup Instructions */}
                        {!driveStatus?.connected && (
                            <div className="premium-card" style={{ padding: '1.25rem', border: '1px solid rgba(255,170,0,0.2)' }}>
                                <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#ffaa00', margin: '0 0 0.75rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <Info size={16} />
                                    Configuración Requerida
                                </h3>
                                <ol style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.6)', paddingLeft: '1.2rem', margin: 0, lineHeight: 1.8 }}>
                                    <li>Crea un proyecto en <strong>Google Cloud Console</strong></li>
                                    <li>Habilita <strong>Google Drive API</strong></li>
                                    <li>Crea una <strong>Service Account</strong> y descarga el JSON de credenciales</li>
                                    <li>Comparte tus carpetas de Drive con el email del Service Account</li>
                                    <li>Agrega las variables al archivo <code style={{ background: 'rgba(255,255,255,0.1)', padding: '0.1rem 0.3rem', borderRadius: '3px' }}>.env</code></li>
                                    <li>Reinicia el servidor</li>
                                </ol>
                            </div>
                        )}
                    </>
                )}

                {/* ══════════════════════════════════════════════ */}
                {/* TAB: FOLDERS */}
                {/* ══════════════════════════════════════════════ */}
                {activeTab === 'folders' && (
                    <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)' }}>
                                Carpetas compartidas con el Service Account
                            </span>
                            <button
                                onClick={fetchFolders}
                                className="kb-btn-pri"
                                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem' }}
                            >
                                <RefreshCw size={13} /> Actualizar
                            </button>
                        </div>

                        {foldersLoading ? (
                            <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem', color: 'rgba(255,255,255,0.3)' }}>
                                <Loader size={28} className="spin" />
                            </div>
                        ) : folders.length === 0 ? (
                            <div className="premium-card" style={{ padding: '2rem', textAlign: 'center' }}>
                                <FolderOpen size={40} style={{ color: 'rgba(255,255,255,0.15)', marginBottom: '0.75rem' }} />
                                <p style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.35)', margin: 0 }}>
                                    {driveStatus?.connected
                                        ? 'No se encontraron carpetas. Comparte carpetas con el Service Account desde Google Drive.'
                                        : 'Conecta Google Drive primero para ver las carpetas.'}
                                </p>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                {folders.map(folder => {
                                    const isExpanded = expandedFolder === folder.id;
                                    const perms = folderPermissions[folder.id] || [];
                                    const planMappings = Object.entries(driveConfig.planFolders || {})
                                        .filter(([, ids]) => (Array.isArray(ids) ? ids : [ids]).includes(folder.id));

                                    return (
                                        <div key={folder.id} className="premium-card" style={{ padding: 0, overflow: 'hidden' }}>
                                            <div
                                                style={{
                                                    display: 'flex', alignItems: 'center',
                                                    gap: '0.75rem', padding: '0.85rem 1rem',
                                                    cursor: 'pointer',
                                                }}
                                                onClick={() => {
                                                    if (isExpanded) {
                                                        setExpandedFolder(null);
                                                    } else {
                                                        setExpandedFolder(folder.id);
                                                        loadFolderPermissions(folder.id);
                                                    }
                                                }}
                                            >
                                                <FolderOpen size={18} style={{ color: '#00ff00', flexShrink: 0 }} />
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#e9edef' }}>
                                                        {folder.name}
                                                    </div>
                                                    <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>
                                                        {folder.id}
                                                    </div>
                                                </div>

                                                {/* Plan assignment badges */}
                                                {planMappings.length > 0 && (
                                                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                                                        {planMappings.map(([plan]) => (
                                                            <span key={plan} style={{
                                                                fontSize: '0.65rem', fontWeight: 700, padding: '0.15rem 0.45rem',
                                                                borderRadius: '4px', background: 'rgba(0,255,0,0.1)',
                                                                color: '#00ff00', border: '1px solid rgba(0,255,0,0.2)',
                                                            }}>
                                                                {PLAN_LABELS[plan] || plan}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Assign to plan buttons */}
                                                <div style={{ display: 'flex', gap: '0.25rem' }}>
                                                    {['combo-10', 'combo-15'].map(plan => {
                                                        const isAssigned = planMappings.some(([p]) => p === plan);
                                                        return (
                                                            <button
                                                                key={plan}
                                                                className="kb-icon-btn"
                                                                title={isAssigned ? `Quitar de ${PLAN_LABELS[plan]}` : `Asignar a ${PLAN_LABELS[plan]}`}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    const current = driveConfig.planFolders?.[plan] || [];
                                                                    const asArray = Array.isArray(current) ? current : [current];
                                                                    if (isAssigned) {
                                                                        handleSavePlanFolders(plan, asArray.filter(id => id !== folder.id));
                                                                    } else {
                                                                        handleSavePlanFolders(plan, [...asArray, folder.id]);
                                                                    }
                                                                }}
                                                                style={{
                                                                    fontSize: '0.65rem', fontWeight: 700,
                                                                    color: isAssigned ? '#00ff00' : 'rgba(255,255,255,0.3)',
                                                                    padding: '0.2rem 0.4rem',
                                                                }}
                                                            >
                                                                {isAssigned ? <Link size={12} /> : <FolderPlus size={12} />}
                                                            </button>
                                                        );
                                                    })}
                                                </div>

                                                {isExpanded ? <ChevronUp size={16} style={{ color: 'rgba(255,255,255,0.3)' }} />
                                                    : <ChevronDown size={16} style={{ color: 'rgba(255,255,255,0.3)' }} />}
                                            </div>

                                            {/* Expanded permissions */}
                                            {isExpanded && (
                                                <div style={{
                                                    borderTop: '1px solid rgba(255,255,255,0.05)',
                                                    background: 'rgba(0,0,0,0.15)',
                                                    padding: '0.75rem 1rem',
                                                }}>
                                                    <div style={{
                                                        fontSize: '0.72rem', fontWeight: 700,
                                                        color: 'rgba(255,255,255,0.4)',
                                                        marginBottom: '0.5rem',
                                                    }}>
                                                        Usuarios con acceso:
                                                    </div>
                                                    {perms.length === 0 ? (
                                                        <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.25)', fontStyle: 'italic' }}>
                                                            Cargando permisos...
                                                        </span>
                                                    ) : (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                                            {perms.map((perm) => (
                                                                <div key={perm.id} style={{
                                                                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                                                                    padding: '0.3rem 0.5rem',
                                                                    borderRadius: '6px',
                                                                    background: 'rgba(255,255,255,0.03)',
                                                                }}>
                                                                    <Mail size={12} style={{ color: 'rgba(255,255,255,0.3)' }} />
                                                                    <span style={{ fontSize: '0.78rem', color: '#e9edef', flex: 1 }}>
                                                                        {perm.emailAddress || perm.displayName || perm.type}
                                                                    </span>
                                                                    <span style={{
                                                                        fontSize: '0.65rem', fontWeight: 700,
                                                                        padding: '0.1rem 0.35rem', borderRadius: '3px',
                                                                        background: 'rgba(255,255,255,0.05)',
                                                                        color: 'rgba(255,255,255,0.4)',
                                                                    }}>
                                                                        {perm.role}
                                                                    </span>
                                                                    {perm.type === 'user' && perm.role !== 'owner' && (
                                                                        <button
                                                                            className="kb-icon-btn kb-icon-btn-danger"
                                                                            title="Revocar acceso"
                                                                            onClick={() => handleRevokeDirect(folder.id, perm.id)}
                                                                            style={{ padding: '0.2rem' }}
                                                                        >
                                                                            <Trash2 size={11} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}

                {/* ══════════════════════════════════════════════ */}
                {/* TAB: ACTIVITY */}
                {/* ══════════════════════════════════════════════ */}
                {activeTab === 'activity' && (
                    <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)' }}>
                                Historial de acciones de Google Drive
                            </span>
                            <button
                                onClick={fetchActivity}
                                className="kb-btn-pri"
                                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem' }}
                            >
                                <RefreshCw size={13} /> Actualizar
                            </button>
                        </div>

                        {activityLoading ? (
                            <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem', color: 'rgba(255,255,255,0.3)' }}>
                                <Loader size={28} className="spin" />
                            </div>
                        ) : activityLog.length === 0 ? (
                            <div className="premium-card" style={{ padding: '2rem', textAlign: 'center' }}>
                                <Activity size={40} style={{ color: 'rgba(255,255,255,0.15)', marginBottom: '0.75rem' }} />
                                <p style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.35)', margin: 0 }}>
                                    Sin actividad registrada aún
                                </p>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                {activityLog.map((entry, idx) => {
                                    const isShare = entry.action === 'shared';
                                    return (
                                        <div key={idx} className="premium-card" style={{
                                            padding: '0.65rem 1rem',
                                            display: 'flex', alignItems: 'center', gap: '0.6rem',
                                            border: `1px solid ${isShare ? 'rgba(0,255,0,0.1)' : 'rgba(255,68,68,0.1)'}`,
                                        }}>
                                            {isShare
                                                ? <Share2 size={14} style={{ color: '#00ff00', flexShrink: 0 }} />
                                                : <Unlink size={14} style={{ color: '#ff4444', flexShrink: 0 }} />}
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <span style={{ fontSize: '0.82rem', color: '#e9edef', fontWeight: 600 }}>
                                                    {entry.email}
                                                </span>
                                                <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.35)' }}>
                                                    {' — '}{isShare ? 'Acceso compartido' : 'Acceso revocado'}
                                                </span>
                                                {Array.isArray(entry.details) && entry.details.length > 0 && (
                                                    <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.25)' }}>
                                                        {' → '}{entry.details.map(d => d.folderName || d.folderId).join(', ')}
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{
                                                fontSize: '0.68rem', color: 'rgba(255,255,255,0.25)',
                                                flexShrink: 0, whiteSpace: 'nowrap',
                                            }}>
                                                {formatDate(entry.timestamp)}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* ── ADD USER MODAL ── */}
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
                                    id="add-modal-name"
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
                                    id="add-modal-phone"
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
                                    id="add-modal-email"
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
                                    id="add-modal-plan"
                                    value={addModal.plan}
                                    onChange={e => setAddModal(prev => ({ ...prev, plan: e.target.value }))}
                                    style={{
                                        width: '100%', padding: '0.6rem',
                                        background: 'rgba(255,255,255,0.05)',
                                        border: '1px solid rgba(0,255,0,0.2)',
                                        borderRadius: '8px', color: '#e9edef', outline: 'none',
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
                                    id="add-modal-status"
                                    value={addModal.status}
                                    onChange={e => setAddModal(prev => ({ ...prev, status: e.target.value }))}
                                    style={{
                                        width: '100%', padding: '0.6rem',
                                        background: 'rgba(255,255,255,0.05)',
                                        border: '1px solid rgba(0,255,0,0.2)',
                                        borderRadius: '8px', color: '#e9edef', outline: 'none',
                                    }}
                                >
                                    <option value="pending_email">Esperando correo</option>
                                    <option value="pending_access">Pendiente acceso</option>
                                    <option value="access_granted">Acceso concedido</option>
                                    <option value="access_denied">Denegado</option>
                                </select>
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
                                id="add-modal-save"
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

export default EmailManagementPage;
