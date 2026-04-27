import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Search, MessageSquare, Trash2, Check, CheckCheck, Star, X, Users, Edit2, Plus, Tag, FolderOpen, Clock, XCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../../../services/api';

// Persist leads in localStorage so they survive page reloads
const LEADS_KEY = 'chatwifi_leads';
const CATEGORIES_KEY = 'chatwifi_categories';
const CATEGORY_MEMBERS_KEY = 'chatwifi_category_members';
const TAB_LABELS_KEY = 'chatwifi_tab_labels';

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

// Custom categories persistence
const loadCategories = () => {
    try {
        const raw = localStorage.getItem(CATEGORIES_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
};

const saveCategories = (cats) => {
    try {
        localStorage.setItem(CATEGORIES_KEY, JSON.stringify(cats));
    } catch { /* noop */ }
};

const loadCategoryMembers = () => {
    try {
        const raw = localStorage.getItem(CATEGORY_MEMBERS_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
};

const saveCategoryMembers = (members) => {
    try {
        localStorage.setItem(CATEGORY_MEMBERS_KEY, JSON.stringify(members));
    } catch { /* noop */ }
};

// Built-in filter tab definitions (default labels)
const DEFAULT_TAB_LABELS = {
    todos: 'Todos',
    leads: '⭐ Leads',
    seguimiento: '🔄 Seguimiento',
};

// Tabs that can be renamed (all except 'todos')
const RENAMEABLE_BUILTIN = new Set(['leads', 'seguimiento']);

const loadTabLabels = () => {
    try {
        const raw = localStorage.getItem(TAB_LABELS_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
};

const saveTabLabels = (labels) => {
    try {
        localStorage.setItem(TAB_LABELS_KEY, JSON.stringify(labels));
    } catch { /* noop */ }
};

const ConversationList = ({ conversations, activeJid, onSelect, onDelete, searchTerm, onSearchChange, customNames, setCustomNames, setDashboardTab }) => {
    const [confirmDelete, setConfirmDelete]   = useState(null);
    const [activeTab, setActiveTab]           = useState('todos');
    const [leads, setLeads]                   = useState(loadLeads);
    const [contextMenu, setContextMenu]       = useState(null); // { jid, x, y }
    const [followUpJids, setFollowUpJids]     = useState(new Set()); // JIDs with active follow-up

    // Custom categories state
    const [categories, setCategories]         = useState(loadCategories);       // [{ id, label }]
    const [categoryMembers, setCategoryMembers] = useState(loadCategoryMembers); // { catId: [jid1, jid2...] }
    const [showAddCategory, setShowAddCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [tabContextMenu, setTabContextMenu]   = useState(null); // { catId, x, y, isBuiltIn }
    const [editingTabId, setEditingTabId]       = useState(null);
    const [editingTabName, setEditingTabName]   = useState('');
    const [tabLabels, setTabLabels]             = useState(loadTabLabels); // { 'leads': 'Custom Name', ... }

    // Long-press detection
    const pressTimer  = useRef(null);
    const pressTarget = useRef(null);
    const newCatInputRef = useRef(null);
    const editCatInputRef = useRef(null);

    // Persist leads whenever they change
    useEffect(() => { saveLeads(leads); }, [leads]);

    // Load follow-up states from API
    const loadFollowUpStates = useCallback(async () => {
        try {
            const res = await api.get('/api/follow-up/states');
            const states = res.data.states || [];
            setFollowUpJids(new Set(states.map(s => s.jid)));
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        loadFollowUpStates();
        // Refresh every 30 seconds
        const interval = setInterval(loadFollowUpStates, 30000);
        return () => clearInterval(interval);
    }, [loadFollowUpStates]);

    // Persist categories
    useEffect(() => { saveCategories(categories); }, [categories]);
    useEffect(() => { saveCategoryMembers(categoryMembers); }, [categoryMembers]);
    useEffect(() => { saveTabLabels(tabLabels); }, [tabLabels]);

    // Focus the new category input when shown
    useEffect(() => {
        if (showAddCategory && newCatInputRef.current) {
            newCatInputRef.current.focus();
        }
    }, [showAddCategory]);

    // Focus the edit input
    useEffect(() => {
        if (editingTabId && editCatInputRef.current) {
            editCatInputRef.current.focus();
            editCatInputRef.current.select();
        }
    }, [editingTabId]);

    // Close context menu on outside click
    useEffect(() => {
        if (!contextMenu && !tabContextMenu) return;
        const close = () => {
            setContextMenu(null);
            setTabContextMenu(null);
        };
        window.addEventListener('pointerdown', close);
        return () => window.removeEventListener('pointerdown', close);
    }, [contextMenu, tabContextMenu]);

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

    // ── Category actions ─────────────────────────────────────────────
    const addCategory = () => {
        const name = newCategoryName.trim();
        if (!name) return;
        const id = 'cat_' + Date.now();
        setCategories(prev => [...prev, { id, label: name }]);
        setCategoryMembers(prev => ({ ...prev, [id]: [] }));
        setNewCategoryName('');
        setShowAddCategory(false);
    };

    const deleteCategory = (catId) => {
        setCategories(prev => prev.filter(c => c.id !== catId));
        setCategoryMembers(prev => {
            const next = { ...prev };
            delete next[catId];
            return next;
        });
        if (activeTab === catId) setActiveTab('todos');
        setTabContextMenu(null);
    };

    const startEditCategory = (catId) => {
        // Check if it's a renameable built-in tab
        if (RENAMEABLE_BUILTIN.has(catId)) {
            const currentLabel = tabLabels[catId] || DEFAULT_TAB_LABELS[catId];
            setEditingTabId(catId);
            setEditingTabName(currentLabel);
            setTabContextMenu(null);
            return;
        }
        const cat = categories.find(c => c.id === catId);
        if (!cat) return;
        setEditingTabId(catId);
        setEditingTabName(cat.label);
        setTabContextMenu(null);
    };

    const saveEditCategory = () => {
        const name = editingTabName.trim();
        if (!name || !editingTabId) {
            setEditingTabId(null);
            return;
        }
        // If editing a built-in tab, save to tabLabels
        if (RENAMEABLE_BUILTIN.has(editingTabId)) {
            setTabLabels(prev => ({ ...prev, [editingTabId]: name }));
        } else {
            setCategories(prev => prev.map(c =>
                c.id === editingTabId ? { ...c, label: name } : c
            ));
        }
        setEditingTabId(null);
        setEditingTabName('');
    };

    const toggleChatInCategory = (jid, catId) => {
        setCategoryMembers(prev => {
            const members = prev[catId] || [];
            const exists = members.includes(jid);
            return {
                ...prev,
                [catId]: exists ? members.filter(m => m !== jid) : [...members, jid]
            };
        });
    };

    // ── Dashboard Navigation ───────────────────────────────────────────────
    const prevDashboard = () => {
        if (setDashboardTab) setDashboardTab('alerts');
    };

    const nextDashboard = () => {
        if (setDashboardTab) setDashboardTab('followup');
    };


    // ── Follow-up actions ────────────────────────────────────────────
    const cancelFollowUp = async (jid) => {
        try {
            await api.post(`/api/follow-up/cancel/${encodeURIComponent(jid)}`);
            setFollowUpJids(prev => {
                const next = new Set(prev);
                next.delete(jid);
                return next;
            });
        } catch { /* ignore */ }
        setContextMenu(null);
    };

    // ── Filtering ────────────────────────────────────────────────────
    const filtered = conversations.filter(c => {
        if (activeTab === 'seguimiento') return followUpJids.has(c.jid);
        if (activeTab === 'leads')    return leads.has(c.jid);
        if (activeTab === 'todos')    return true;
        // Custom category
        const members = categoryMembers[activeTab] || [];
        return members.includes(c.jid);
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

    const seguimientoCount = followUpJids.size;
    const leadsCount = leads.size;

    // Build built-in tabs with potentially custom labels
    const builtInTabs = [
        { id: 'todos',       label: tabLabels['todos'] || DEFAULT_TAB_LABELS['todos'],             builtIn: true },
        { id: 'leads',       label: tabLabels['leads'] || DEFAULT_TAB_LABELS['leads'],             builtIn: true },
        { id: 'seguimiento', label: tabLabels['seguimiento'] || DEFAULT_TAB_LABELS['seguimiento'], builtIn: true },
    ];

    // Merge built-in + custom tabs
    const allTabs = [
        ...builtInTabs,
        ...categories.map(c => ({ ...c, builtIn: false }))
    ];

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

            {/* ── Search & Dashboard Navigation ── */}
            <div className="conv-search-wrapper" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                    <Search size={14} className="conv-search-icon" />
                    <input
                        type="text"
                        className="conv-search-input"
                        placeholder="Buscar chat..."
                        value={searchTerm}
                        onChange={e => onSearchChange(e.target.value)}
                    />
                </div>
                <div className="conv-tab-nav" style={{ display: 'flex', gap: '4px' }}>
                    <button className="conv-tab-nav-btn" onClick={prevDashboard} title="Alertas Pendientes">
                        <ChevronLeft size={18} />
                    </button>
                    <button className="conv-tab-nav-btn" onClick={nextDashboard} title="Seguimiento">
                        <ChevronRight size={18} />
                    </button>
                </div>
            </div>

            {/* ── Filter tabs (built-in + custom + add button) ── */}
            <div className="conv-filter-tabs">
                {allTabs.map(tab => (
                    editingTabId === tab.id ? (
                        <div key={tab.id} className="conv-filter-tab conv-filter-tab-active conv-tab-editing">
                            <input
                                ref={editCatInputRef}
                                type="text"
                                className="conv-tab-edit-input"
                                value={editingTabName}
                                onChange={e => setEditingTabName(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') saveEditCategory();
                                    if (e.key === 'Escape') setEditingTabId(null);
                                }}
                                onBlur={saveEditCategory}
                            />
                        </div>
                    ) : (
                        <button
                            key={tab.id}
                            className={`conv-filter-tab ${activeTab === tab.id ? 'conv-filter-tab-active' : ''}`}
                            onClick={() => setActiveTab(tab.id)}
                            onContextMenu={e => {
                                e.preventDefault();
                                // Allow context menu for custom tabs AND renameable built-in tabs
                                if (!tab.builtIn || RENAMEABLE_BUILTIN.has(tab.id)) {
                                    setTabContextMenu({ catId: tab.id, x: e.clientX, y: e.clientY, isBuiltIn: tab.builtIn });
                                }
                            }}
                        >
                            {!tab.builtIn && <Tag size={11} />}
                            {tab.label}
                            {tab.id === 'seguimiento' && seguimientoCount > 0 && (
                                <span className="conv-tab-badge conv-tab-badge-follow">{seguimientoCount}</span>
                            )}
                            {tab.id === 'leads' && leadsCount > 0 && (
                                <span className="conv-tab-badge conv-tab-badge-lead">{leadsCount}</span>
                            )}
                            {!tab.builtIn && (categoryMembers[tab.id]?.length || 0) > 0 && (
                                <span className="conv-tab-badge conv-tab-badge-cat">{categoryMembers[tab.id].length}</span>
                            )}
                        </button>
                    )
                ))}

                {/* Add category button or inline input */}
                {showAddCategory ? (
                    <div className="conv-tab-add-form">
                        <input
                            ref={newCatInputRef}
                            type="text"
                            className="conv-tab-add-input"
                            placeholder="Nombre..."
                            value={newCategoryName}
                            onChange={e => setNewCategoryName(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') addCategory();
                                if (e.key === 'Escape') { setShowAddCategory(false); setNewCategoryName(''); }
                            }}
                            onBlur={() => {
                                if (!newCategoryName.trim()) setShowAddCategory(false);
                            }}
                        />
                        <button className="conv-tab-add-confirm" onClick={addCategory} title="Crear categoría">
                            <Check size={13} />
                        </button>
                        <button
                            className="conv-tab-add-cancel"
                            onClick={() => { setShowAddCategory(false); setNewCategoryName(''); }}
                            title="Cancelar"
                        >
                            <X size={13} />
                        </button>
                    </div>
                ) : (
                    <button
                        className="conv-filter-tab conv-tab-add-btn"
                        onClick={() => setShowAddCategory(true)}
                        title="Añadir categoría"
                    >
                        <Plus size={13} />
                    </button>
                )}
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
                        ) : activeTab === 'seguimiento' ? (
                            <>
                                <Clock size={32} />
                                <p>No hay seguimientos activos</p>
                            </>
                        ) : !(activeTab in DEFAULT_TAB_LABELS) ? (
                            <>
                                <FolderOpen size={32} />
                                <p>Mantén presionado un chat<br/>para agregarlo a esta categoría</p>
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
                            className={`conv-item ${conv.jid === activeJid ? 'conv-item-active' : ''} ${leads.has(conv.jid) ? 'conv-item-lead' : ''} ${followUpJids.has(conv.jid) ? 'conv-item-followup' : ''}`}
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
                                {/* Follow-up indicator on avatar */}
                                {followUpJids.has(conv.jid) && !leads.has(conv.jid) && (
                                    <span className="conv-avatar-followup-dot" title="Seguimiento activo">🔄</span>
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

            {/* ── Context menu (long-press on chat) ── */}
            {contextMenu && (() => {
                const isLead = leads.has(contextMenu.jid);
                const conv   = conversations.find(c => c.jid === contextMenu.jid);
                return (
                    <div
                        className="conv-context-menu"
                        style={{
                            top:  Math.min(contextMenu.y, window.innerHeight - 300),
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

                        {/* Follow-up cancel option */}
                        {followUpJids.has(contextMenu.jid) && (
                            <button
                                className="conv-context-btn conv-context-btn-danger"
                                onClick={() => cancelFollowUp(contextMenu.jid)}
                            >
                                <XCircle size={15} />
                                Quitar seguimiento
                            </button>
                        )}
                        {!followUpJids.has(contextMenu.jid) && (
                            <button
                                className="conv-context-btn conv-context-btn-muted"
                                disabled
                            >
                                <Clock size={15} />
                                Sin seguimiento activo
                            </button>
                        )}
                        {/* Custom category assignments */}
                        {categories.length > 0 && (
                            <div className="conv-context-divider" />
                        )}
                        {categories.map(cat => {
                            const isMember = (categoryMembers[cat.id] || []).includes(contextMenu.jid);
                            return (
                                <button
                                    key={cat.id}
                                    className={`conv-context-btn ${isMember ? 'conv-context-btn-active-cat' : ''}`}
                                    onClick={() => {
                                        toggleChatInCategory(contextMenu.jid, cat.id);
                                    }}
                                >
                                    <Tag size={15} />
                                    {isMember ? `✓ ${cat.label}` : cat.label}
                                </button>
                            );
                        })}

                        <button
                            className="conv-context-btn conv-context-btn-close"
                            onClick={() => setContextMenu(null)}
                        >
                            <X size={15} />
                            Cerrar
                        </button>
                    </div>
                );
            })()}

            {/* ── Tab context menu (right-click on any editable tab) ── */}
            {tabContextMenu && (() => {
                const isBuiltIn = tabContextMenu.isBuiltIn;
                const cat = isBuiltIn ? null : categories.find(c => c.id === tabContextMenu.catId);
                // For custom tabs, must find the category; for built-in, always show
                if (!isBuiltIn && !cat) return null;
                const displayLabel = isBuiltIn
                    ? (tabLabels[tabContextMenu.catId] || DEFAULT_TAB_LABELS[tabContextMenu.catId])
                    : cat.label;
                return (
                    <div
                        className="conv-context-menu conv-tab-context-menu"
                        style={{
                            top:  Math.min(tabContextMenu.y, window.innerHeight - 160),
                            left: Math.min(tabContextMenu.x, window.innerWidth  - 220),
                        }}
                        onPointerDown={e => e.stopPropagation()}
                    >
                        <div className="conv-context-name">
                            <Tag size={12} /> {displayLabel}
                        </div>
                        <button
                            className="conv-context-btn"
                            onClick={() => startEditCategory(tabContextMenu.catId)}
                        >
                            <Edit2 size={15} />
                            Renombrar
                        </button>
                        {/* Only show delete for custom categories, not built-in */}
                        {!isBuiltIn && (
                            <button
                                className="conv-context-btn conv-context-btn-danger"
                                onClick={() => deleteCategory(tabContextMenu.catId)}
                            >
                                <Trash2 size={15} />
                                Eliminar categoría
                            </button>
                        )}
                        <button
                            className="conv-context-btn conv-context-btn-close"
                            onClick={() => setTabContextMenu(null)}
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
