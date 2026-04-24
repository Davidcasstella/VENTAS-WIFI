import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Search, MessageSquare, Trash2, Check, CheckCheck, Star, X, Users, Edit2 } from 'lucide-react';

// Persist leads in localStorage so they survive page reloads
const LEADS_KEY = 'chatwifi_leads';

const loadLeads = () => {
    try {
        const raw = localStorage.getItem(LEADS_KEY);
        return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
        return new Set();
    }
};

const saveLeads = (leadsSet) => {
    try {
        localStorage.setItem(LEADS_KEY, JSON.stringify([...leadsSet]));
    } catch { /* noop */ }
};

// Filter tab definitions
const TABS = [
    { id: 'todos',     label: 'Todos'     },
    { id: 'leads',     label: '⭐ Leads'  },
    { id: 'no-leidos', label: 'No leídos' },
];

const ConversationList = ({ conversations, activeJid, onSelect, onDelete, searchTerm, onSearchChange, customNames, setCustomNames }) => {
    const [confirmDelete, setConfirmDelete]   = useState(null);
    const [activeTab, setActiveTab]           = useState('todos');
    const [leads, setLeads]                   = useState(loadLeads);
    const [contextMenu, setContextMenu]       = useState(null); // { jid, x, y }

    // Long-press detection
    const pressTimer  = useRef(null);
    const pressTarget = useRef(null);

    // Persist leads whenever they change
    useEffect(() => { saveLeads(leads); }, [leads]);

    // Close context menu on outside click
    useEffect(() => {
        if (!contextMenu) return;
        const close = () => setContextMenu(null);
        window.addEventListener('pointerdown', close);
        return () => window.removeEventListener('pointerdown', close);
    }, [contextMenu]);

    // ── Long-press handlers ──────────────────────────────────────────
    const startPress = useCallback((e, jid) => {
        // Ignore right-click
        if (e.button === 2) return;
        pressTarget.current = jid;
        pressTimer.current = setTimeout(() => {
            // Get position for context menu
            const rect = e.currentTarget?.getBoundingClientRect?.() || {};
            setContextMenu({
                jid,
                // On mobile, center the menu; on desktop, use pointer position
                x: e.clientX ?? (rect.left + rect.width / 2),
                y: e.clientY ?? (rect.top  + rect.height / 2),
            });
        }, 600);
    }, []);

    const cancelPress = useCallback(() => {
        clearTimeout(pressTimer.current);
        pressTarget.current = null;
    }, []);

    // ── Lead actions ─────────────────────────────────────────────────
    const toggleLead = (jid) => {
        setLeads(prev => {
            const next = new Set(prev);
            if (next.has(jid)) next.delete(jid);
            else next.add(jid);
            return next;
        });
        setContextMenu(null);
    };

    const renameChat = (jid, currentName) => {
        setContextMenu(null);
        // Using a simple native prompt for renaming
        const newName = window.prompt('Introduce el nuevo nombre para este chat:', currentName);
        if (newName !== null) { // if not cancelled
            setCustomNames(prev => {
                const next = { ...prev };
                if (newName.trim() === '') {
                    delete next[jid]; // Revert to original
                } else {
                    next[jid] = newName.trim();
                }
                return next;
            });
        }
    };

    // ── Filtering ────────────────────────────────────────────────────
    const filtered = conversations.filter(c => {
        if (activeTab === 'no-leidos') return c.unreadCount > 0;
        if (activeTab === 'leads')    return leads.has(c.jid);
        return true; // 'todos'
    });

    // ── Helpers ──────────────────────────────────────────────────────
    const formatTime = (isoStr) => {
        if (!isoStr) return '';
        const d   = new Date(isoStr);
        const now = new Date();
        if (d.toDateString() === now.toDateString()) {
            return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        }
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (d.toDateString() === yesterday.toDateString()) return 'Ayer';
        return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
    };

    const getInitial     = (name)  => (name || '?').charAt(0).toUpperCase();
    const getAvatarColor = (jid)   => {
        const colors = ['#00aa55', '#0088cc', '#aa5500', '#cc0044', '#6600cc', '#00aaaa'];
        let hash = 0;
        for (let i = 0; i < jid.length; i++) hash = jid.charCodeAt(i) + ((hash << 5) - hash);
        return colors[Math.abs(hash) % colors.length];
    };

    const noLeidos = conversations.filter(c => c.unreadCount > 0).length;
    const leadsCount = leads.size;

    return (
        <div className="conv-list">
            {/* ── Header ── */}
            <div className="conv-list-header">
                <h3 className="conv-list-title">
                    <MessageSquare size={18} />
                    Chats
                </h3>
                <span className="conv-list-count">{conversations.length}</span>
            </div>

            {/* ── Search ── */}
            <div className="conv-search-wrapper">
                <Search size={14} className="conv-search-icon" />
                <input
                    type="text"
                    className="conv-search-input"
                    placeholder="Buscar chat..."
                    value={searchTerm}
                    onChange={e => onSearchChange(e.target.value)}
                />
            </div>

            {/* ── Filter tabs (WhatsApp-style) ── */}
            <div className="conv-filter-tabs">
                {TABS.map(tab => (
                    <button
                        key={tab.id}
                        className={`conv-filter-tab ${activeTab === tab.id ? 'conv-filter-tab-active' : ''}`}
                        onClick={() => setActiveTab(tab.id)}
                    >
                        {tab.label}
                        {tab.id === 'no-leidos' && noLeidos > 0 && (
                            <span className="conv-tab-badge">{noLeidos}</span>
                        )}
                        {tab.id === 'leads' && leadsCount > 0 && (
                            <span className="conv-tab-badge conv-tab-badge-lead">{leadsCount}</span>
                        )}
                    </button>
                ))}
            </div>

            {/* ── Conversation items ── */}
            <div className="conv-list-items">
                {filtered.length === 0 ? (
                    <div className="conv-empty">
                        {activeTab === 'leads' ? (
                            <>
                                <Star size={32} />
                                <p>Mantén presionado un chat<br/>para agregarlo a Leads</p>
                            </>
                        ) : activeTab === 'no-leidos' ? (
                            <>
                                <MessageSquare size={32} />
                                <p>No hay mensajes sin leer</p>
                            </>
                        ) : (
                            <>
                                <MessageSquare size={32} />
                                <p>{searchTerm ? 'Sin resultados' : 'No hay chats aún'}</p>
                            </>
                        )}
                    </div>
                ) : (
                    filtered.map(conv => (
                        <div
                            key={conv.jid}
                            className={`conv-item ${conv.jid === activeJid ? 'conv-item-active' : ''} ${leads.has(conv.jid) ? 'conv-item-lead' : ''}`}
                            onClick={() => onSelect(conv.jid)}
                            /* ── Long-press (touch) ── */
                            onTouchStart={e => startPress(e, conv.jid)}
                            onTouchEnd={cancelPress}
                            onTouchMove={cancelPress}
                            /* ── Long-press (desktop right-click) ── */
                            onMouseDown={e => startPress(e, conv.jid)}
                            onMouseUp={cancelPress}
                            onMouseLeave={cancelPress}
                            onContextMenu={e => { e.preventDefault(); /* handled by long-press */ }}
                        >
                            <div
                                className="conv-avatar"
                                style={{ backgroundColor: getAvatarColor(conv.jid) }}
                            >
                                {getInitial(customNames[conv.jid] || conv.pushName)}
                                {/* Lead star badge on avatar */}
                                {leads.has(conv.jid) && (
                                    <span className="conv-avatar-lead-dot" title="Lead">⭐</span>
                                )}
                            </div>
                            <div className="conv-info">
                                <div className="conv-info-top">
                                    <span className="conv-name">{customNames[conv.jid] || conv.pushName}</span>
                                    <span className={`conv-time ${conv.unreadCount > 0 ? 'conv-time-unread' : ''}`}>
                                        {formatTime(conv.lastMessageTime)}
                                    </span>
                                </div>
                                <div className="conv-info-bottom">
                                    <span className="conv-last-msg">
                                        {conv.lastMessageFromMe && <span className="conv-check"><CheckCheck size={14} /> </span>}
                                        {conv.lastMessage
                                            ? (conv.lastMessage.length > 45
                                                ? conv.lastMessage.substring(0, 45) + '...'
                                                : conv.lastMessage)
                                            : 'Sin mensajes'
                                        }
                                    </span>
                                    {conv.unreadCount > 0 && (
                                        <span className="conv-unread-badge">{conv.unreadCount}</span>
                                    )}
                                    <button
                                        className="conv-delete-btn"
                                        title={confirmDelete === conv.jid ? 'Click para confirmar' : 'Eliminar chat'}
                                        style={confirmDelete === conv.jid ? { color: '#f15c6d', background: 'rgba(241, 92, 109, 0.1)' } : {}}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (confirmDelete === conv.jid) {
                                                onDelete(conv.jid);
                                                setConfirmDelete(null);
                                            } else {
                                                setConfirmDelete(conv.jid);
                                                setTimeout(() => setConfirmDelete(null), 3000);
                                            }
                                        }}
                                    >
                                        {confirmDelete === conv.jid ? <Check size={13} /> : <Trash2 size={13} />}
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* ── Context menu (long-press) ── */}
            {contextMenu && (() => {
                const isLead = leads.has(contextMenu.jid);
                const conv   = conversations.find(c => c.jid === contextMenu.jid);
                return (
                    <div
                        className="conv-context-menu"
                        style={{
                            top:  Math.min(contextMenu.y, window.innerHeight - 200),
                            left: Math.min(contextMenu.x, window.innerWidth  - 220),
                        }}
                        onPointerDown={e => e.stopPropagation()}
                    >
                        <div className="conv-context-name">
                            {customNames[contextMenu.jid] || conv?.pushName || contextMenu.jid.replace('@s.whatsapp.net', '')}
                        </div>
                        <button
                            className="conv-context-btn"
                            onClick={() => renameChat(contextMenu.jid, customNames[contextMenu.jid] || conv?.pushName || '')}
                        >
                            <Edit2 size={15} />
                            Renombrar
                        </button>
                        <button
                            className={`conv-context-btn ${isLead ? 'conv-context-btn-danger' : 'conv-context-btn-lead'}`}
                            onClick={() => toggleLead(contextMenu.jid)}
                        >
                            <Star size={15} />
                            {isLead ? 'Quitar de Leads' : 'Agregar a Leads'}
                        </button>
                        <button
                            className="conv-context-btn conv-context-btn-close"
                            onClick={() => setContextMenu(null)}
                        >
                            <X size={15} />
                            Cancelar
                        </button>
                    </div>
                );
            })()}
        </div>
    );
};

export default ConversationList;
