import React, { useState, useEffect } from 'react';
import { KeyRound, Send, RefreshCw, CheckCircle2, AlertTriangle, Loader2, Edit3, X, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../../../services/api';

const GrantAccessPanel = ({ jid }) => {
    const [record, setRecord] = useState(null);
    const [email, setEmail] = useState('');
    const [plan, setPlan] = useState('combo-10');
    const [planFolders, setPlanFolders] = useState({});
    const [loading, setLoading] = useState(true);
    const [granting, setGranting] = useState(false);
    const [resending, setResending] = useState(false);
    const [error, setError] = useState(null);
    const [successMsg, setSuccessMsg] = useState(null);
    
    // UI states
    const [isEditing, setIsEditing] = useState(false);
    const [confirmModal, setConfirmModal] = useState(null); // { existingEmail, newEmail, plan }
    const [isExpanded, setIsExpanded] = useState(() => window.innerWidth > 768);

    // Load access info when JID changes
    useEffect(() => {
        if (!jid) return;
        let isMounted = true;
        setLoading(true);
        setError(null);
        setSuccessMsg(null);
        setIsEditing(false);
        // On mobile screens, start collapsed by default to save chat vertical space
        if (window.innerWidth <= 768) {
            setIsExpanded(false);
        } else {
            setIsExpanded(true);
        }

        const fetchAccessInfo = async () => {
            try {
                const res = await api.get(`/api/chat/access-info/${encodeURIComponent(jid)}`);
                if (isMounted && res.data.success) {
                    const rec = res.data.record;
                    const pf = res.data.planFolders || {};
                    setPlanFolders(pf);
                    setRecord(rec);
                    if (rec && rec.email) {
                        setEmail(rec.email);
                    } else {
                        setEmail('');
                    }
                    if (rec && rec.plan) {
                        setPlan(rec.plan);
                    } else {
                        setPlan('combo-10');
                    }
                }
            } catch (err) {
                console.error('Error fetching access info:', err);
                if (isMounted) setError('Error al cargar información de acceso.');
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        fetchAccessInfo();
        return () => { isMounted = false; };
    }, [jid]);

    const showTemporarySuccess = (msg) => {
        setSuccessMsg(msg);
        setTimeout(() => setSuccessMsg(null), 4000);
    };

    // Helper to get readable plan name
    const getPlanLabel = (p) => {
        if (p === 'combo-15') return 'Curso $15.000 (TODO-HACKING)';
        if (p === 'combo-10') return 'Curso $10.000 (CURSOS HACKING)';
        return p || 'Curso $10.000 (CURSOS HACKING)';
    };

    // Handle Grant Access button
    const handleGrantAccess = async (force = false) => {
        if (!email.trim()) {
            setError('Ingresa un correo electrónico.');
            return;
        }
        const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
        if (!emailRegex.test(email.trim())) {
            setError('El formato del correo no es válido.');
            return;
        }

        // If there's an existing record with a different email and we haven't confirmed replacement yet
        if (record && record.email && record.email !== email.trim().toLowerCase() && !force) {
            setConfirmModal({
                existingEmail: record.email,
                newEmail: email.trim().toLowerCase(),
                plan
            });
            return;
        }

        setGranting(true);
        setError(null);
        try {
            const res = await api.post('/api/chat/grant-access', {
                jid,
                email: email.trim().toLowerCase(),
                plan,
                force
            });

            if (res.data.success) {
                setRecord(res.data.record);
                setIsEditing(false);
                setConfirmModal(null);
                showTemporarySuccess(`¡Acceso a "${getPlanLabel(plan)}" concedido y mensaje enviado por WhatsApp!`);
                if (window.innerWidth <= 768) {
                    setIsExpanded(false);
                }
            }
        } catch (err) {
            console.error('Error granting access:', err);
            const resData = err.response?.data;
            if (resData?.conflict) {
                setConfirmModal({
                    existingEmail: resData.existingEmail,
                    newEmail: email.trim().toLowerCase(),
                    plan
                });
            } else {
                setConfirmModal(null);
                setError(resData?.error || 'Ocurrió un error al otorgar o compartir el acceso en Google Drive.');
            }
        } finally {
            setGranting(false);
        }
    };

    // Handle Resend Access button
    const handleResendAccess = async () => {
        if (!record || !record.email) return;
        setResending(true);
        setError(null);
        try {
            const res = await api.post('/api/chat/resend-access', { jid });
            if (res.data.success) {
                showTemporarySuccess('¡Mensaje de acceso reenviado por WhatsApp!');
            }
        } catch (err) {
            console.error('Error resending access:', err);
            const errMsg = err.response?.data?.error || 'No se pudo reenviar el mensaje.';
            setError(errMsg);
        } finally {
            setResending(false);
        }
    };

    if (loading) {
        return (
            <div className="grant-access-panel grant-access-loading">
                <Loader2 size={16} className="chat-spin" />
                <span>Verificando acceso del cliente...</span>
            </div>
        );
    }

    const hasAccess = record && record.status === 'access_granted';

    return (
        <div className="grant-access-panel">
            {!isExpanded ? (
                <div 
                    className="grant-access-collapsed-bar"
                    onClick={() => setIsExpanded(true)}
                    title="Desplegar opciones de acceso y Google Drive"
                >
                    <div className="grant-access-icon-label">
                        <KeyRound size={15} className={hasAccess ? 'icon-granted' : 'icon-pending'} />
                        <span className="grant-access-title">
                            {hasAccess ? `🔑 Curso ${record.plan === 'combo-15' ? '$15.000' : '$10.000'} (${record.email})` : '🔑 Dar Acceso al Curso'}
                        </span>
                    </div>
                    <button type="button" className="grant-access-toggle-btn">
                        <span>Desplegar</span>
                        <ChevronDown size={14} />
                    </button>
                </div>
            ) : (
                <>
                    <div className="grant-access-row">
                        <div className="grant-access-icon-label">
                            <KeyRound size={16} className={hasAccess ? 'icon-granted' : 'icon-pending'} />
                            <span className="grant-access-title">Acceso Curso:</span>
                            <button
                                type="button"
                                className="grant-access-toggle-btn btn-collapse"
                                onClick={() => setIsExpanded(false)}
                                title="Ocultar panel de acceso"
                            >
                                <ChevronUp size={14} />
                            </button>
                        </div>

                        {hasAccess && !isEditing ? (
                            <div className="grant-access-status">
                                <span className="grant-access-email-badge">
                                    <CheckCircle2 size={14} className="icon-success" />
                                    <span className="grant-access-email-text" title={record.email}>{record.email}</span>
                                </span>

                                <span className="grant-access-plan-badge" title="Carpeta y plan asignado a este cliente">
                                    <span className="plan-badge-icon">📁</span>
                                    <span className="plan-badge-text">{getPlanLabel(record.plan)}</span>
                                </span>
                                
                                <div className="grant-access-actions">
                                    <button
                                        className="grant-access-btn btn-resend"
                                        onClick={handleResendAccess}
                                        disabled={resending || granting}
                                        title="Reenviar mensajes de bienvenida al WhatsApp (sin volver a compartir Drive)"
                                    >
                                        {resending ? <Loader2 size={13} className="chat-spin" /> : <RefreshCw size={13} />}
                                        <span>Reenviar</span>
                                    </button>

                                    <button
                                        className="grant-access-btn btn-edit"
                                        onClick={() => setIsEditing(true)}
                                        disabled={resending || granting}
                                        title="Cambiar correo o cambiar a otra carpeta del curso ($10.000 / $15.000)"
                                    >
                                        <Edit3 size={13} />
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="grant-access-form">
                                <input
                                    type="email"
                                    className="grant-access-input"
                                    placeholder="ejemplo@gmail.com"
                                    value={email}
                                    onChange={(e) => {
                                        setEmail(e.target.value);
                                        if (error) setError(null);
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleGrantAccess(false);
                                    }}
                                    disabled={granting}
                                />

                                <select
                                    className="grant-access-select"
                                    value={plan}
                                    onChange={(e) => {
                                        setPlan(e.target.value);
                                        if (error) setError(null);
                                    }}
                                    disabled={granting}
                                    title="Selecciona la carpeta o curso al que le darás ingreso"
                                >
                                    <option value="combo-10">📁 Curso $10.000 (CURSOS HACKING)</option>
                                    <option value="combo-15">📁 Curso $15.000 (TODO-HACKING)</option>
                                    {Object.keys(planFolders).filter(k => k !== 'combo-10' && k !== 'combo-15').map(k => (
                                        <option key={k} value={k}>📁 Plan: {k}</option>
                                    ))}
                                </select>

                                <div className="grant-access-actions">
                                    <button
                                        className="grant-access-btn btn-grant"
                                        onClick={() => handleGrantAccess(false)}
                                        disabled={granting || !email.trim()}
                                    >
                                        {granting ? <Loader2 size={13} className="chat-spin" /> : <Send size={13} />}
                                        <span>{hasAccess ? 'Actualizar carpeta' : 'Dar acceso'}</span>
                                    </button>

                                    {hasAccess && isEditing && (
                                        <button
                                            className="grant-access-btn btn-cancel"
                                            onClick={() => {
                                                setIsEditing(false);
                                                setEmail(record.email || '');
                                                if (record.plan) setPlan(record.plan);
                                                setError(null);
                                            }}
                                            disabled={granting}
                                            title="Cancelar edición"
                                        >
                                            <X size={14} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Feedback messages */}
                    {error && (
                        <div className="grant-access-message message-error">
                            <span>{error}</span>
                        </div>
                    )}

                    {successMsg && (
                        <div className="grant-access-message message-success">
                            <CheckCircle2 size={14} />
                            <span>{successMsg}</span>
                        </div>
                    )}
                </>
            )}

            {/* Confirmation modal for changing existing email */}
            {confirmModal && (
                <div className="grant-access-modal-overlay">
                    <div className="grant-access-modal">
                        <div className="grant-access-modal-header">
                            <AlertTriangle size={20} className="icon-warning" />
                            <h4>Reemplazar correo o carpeta de acceso</h4>
                        </div>
                        <p>
                            Este contacto ya tenía registrado el correo <strong>{confirmModal.existingEmail}</strong>.
                        </p>
                        <p>
                            ¿Deseas reemplazarlo por <strong>{confirmModal.newEmail}</strong> y otorgarle acceso a <strong>{getPlanLabel(confirmModal.plan)}</strong>?
                        </p>
                        <div className="grant-access-modal-buttons">
                            <button
                                className="grant-access-btn btn-cancel"
                                onClick={() => setConfirmModal(null)}
                                disabled={granting}
                            >
                                Cancelar
                            </button>
                            <button
                                className="grant-access-btn btn-grant"
                                onClick={() => handleGrantAccess(true)}
                                disabled={granting}
                            >
                                {granting ? <Loader2 size={14} className="chat-spin" /> : 'Sí, reemplazar y enviar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default GrantAccessPanel;
