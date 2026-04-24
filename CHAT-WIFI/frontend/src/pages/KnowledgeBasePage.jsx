import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
    Upload, FileText, Search, Plus, Trash2, RefreshCw,
    Download, X, AlertCircle, CheckCircle, Clock, Loader,
    BookOpen, ChevronRight, Pencil, Check
} from 'lucide-react';
import useKnowledgeStore from '../features/knowledge-base/store/useKnowledgeStore';
import api from '../services/api';

const KnowledgeBasePage = () => {
    const {
        documents, loading, uploading, error: docError,
        fetchDocuments, uploadDocument, reprocessDocument, deleteDocument, clearError
    } = useKnowledgeStore();

    // ── Local state ─────────────────────────────────────────
    const [dragActive, setDragActive] = useState(false);
    const [manualEntries, setManualEntries] = useState([]);

    // Modal
    const [modalOpen, setModalOpen] = useState(false);
    const [modalTitle, setModalTitle] = useState('');
    const [modalContent, setModalContent] = useState('');
    const [modalEditingId, setModalEditingId] = useState(null);
    const [savingManual, setSavingManual] = useState(false);

    // RAG search
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResult, setSearchResult] = useState('');
    const [searching, setSearching] = useState(false);

    const fileInputRef = useRef(null);

    // ── Fetch data ──────────────────────────────────────────
    useEffect(() => {
        fetchDocuments();
        loadManualEntries();
        const interval = setInterval(fetchDocuments, 5000);
        return () => clearInterval(interval);
    }, []);

    const loadManualEntries = async () => {
        try {
            const { data } = await api.get('/api/knowledge-base/manual-knowledge');
            if (data.success) setManualEntries(data.entries || []);
        } catch {}
    };

    // ── Upload handlers ─────────────────────────────────────
    const handleDrop = useCallback((e) => {
        e.preventDefault();
        setDragActive(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFileUpload(file);
    }, []);

    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        if (file) handleFileUpload(file);
        e.target.value = '';
    };

    const handleFileUpload = async (file) => {
        const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];
        if (!['.pdf', '.txt'].includes(ext)) { alert('Solo PDF y TXT'); return; }
        await uploadDocument(file);
    };

    // ── Manual knowledge ────────────────────────────────────
    const openNewModal = () => {
        setModalEditingId(null);
        setModalTitle('');
        setModalContent('');
        setModalOpen(true);
    };

    const openEditModal = (entry) => {
        setModalEditingId(entry.id);
        setModalTitle(entry.title);
        setModalContent(entry.content);
        setModalOpen(true);
    };

    const closeModal = () => {
        setModalOpen(false);
        setModalTitle('');
        setModalContent('');
        setModalEditingId(null);
    };

    const handleModalSave = async () => {
        if (!modalTitle.trim() || !modalContent.trim()) return;
        setSavingManual(true);
        try {
            if (modalEditingId) {
                await api.put(`/api/knowledge-base/manual-knowledge/${modalEditingId}`, {
                    title: modalTitle, content: modalContent
                });
            } else {
                await api.post('/api/knowledge-base/manual-knowledge', {
                    title: modalTitle, content: modalContent
                });
            }
            closeModal();
            await loadManualEntries();
        } catch { alert('Error al guardar'); }
        setSavingManual(false);
    };

    const handleDeleteManual = async (id) => {
        if (!confirm('¿Eliminar esta entrada?')) return;
        try {
            await api.delete(`/api/knowledge-base/manual-knowledge/${id}`);
            await loadManualEntries();
        } catch { alert('Error al eliminar'); }
    };

    const handleReprocessManual = async () => {
        try {
            await api.post('/api/knowledge-base/manual-knowledge/reprocess');
            alert('Re-vectorización completada');
        } catch { alert('Error al re-vectorizar'); }
    };

    // ── RAG search ──────────────────────────────────────────
    const handleSearch = async (e) => {
        e.preventDefault();
        if (!searchQuery.trim()) return;
        setSearching(true);
        setSearchResult('');
        try {
            const { data } = await api.post('/api/knowledge-base/search', { query: searchQuery });
            setSearchResult(data.context || 'Sin resultados');
        } catch { setSearchResult('Error en la búsqueda'); }
        setSearching(false);
    };

    // ── Status badge ────────────────────────────────────────
    const renderStatus = (status, chunkCount) => {
        switch (status) {
            case 'processed':
                return <span className="kb-status-badge kb-status-success"><CheckCircle size={11} /> {chunkCount} chunks</span>;
            case 'processing':
                return <span className="kb-status-badge kb-status-processing"><Loader size={11} className="spin" /> Procesando</span>;
            case 'error':
                return <span className="kb-status-badge kb-status-error"><AlertCircle size={11} /> Error</span>;
            default:
                return <span className="kb-status-badge kb-status-pending"><Clock size={11} /> En cola</span>;
        }
    };

    // Unify and sort entries (newest first)
    const unifiedEntries = [
        ...manualEntries.map(e => ({ ...e, _itemType: 'manual', _sortDate: new Date(e.createdAt || 0).getTime() })),
        ...documents.map(d => ({ ...d, _itemType: 'document', title: d.name, _sortDate: new Date(d.createdAt || 0).getTime() }))
    ].sort((a, b) => b._sortDate - a._sortDate);

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
                <div style={{ padding: '0.85rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <BookOpen size={22} style={{ color: '#00ff00' }} />
                    <h1 style={{ fontSize: '1.3rem', fontWeight: 800, margin: 0, color: '#e9edef' }}>
                        Base de Conocimiento
                    </h1>
                </div>
            </div>

            <div
                className={`kb-page-container ${dragActive ? 'kb-drag-active-global' : ''}`}
                onDragOver={e => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
                style={{ position: 'relative', padding: '0.85rem 1rem' }}
            >
                {/* Global drag overlay */}
                {dragActive && (
                    <div style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                        background: 'rgba(0,10,0,0.9)',
                        backdropFilter: 'blur(4px)',
                        zIndex: 9999,
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center',
                        border: '3px dashed rgba(0,255,0,0.5)',
                        pointerEvents: 'none'
                    }}>
                        <Upload size={48} style={{ marginBottom: '1rem', color: '#00ff00' }} />
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#e9edef', margin: 0 }}>
                            Suelta tus documentos aquí
                        </h2>
                        <p style={{ marginTop: '0.5rem', color: 'rgba(255,255,255,0.5)' }}>Soportamos archivos PDF y TXT</p>
                    </div>
                )}

                {/* Error banner */}
                {docError && (
                    <div className="kb-error-banner">
                        <AlertCircle size={16} /><span>{docError}</span>
                        <button onClick={clearError}><X size={14} /></button>
                    </div>
                )}

                {/* ── RAG SEARCH ── */}
                <div className="kb-search-container" style={{ marginBottom: '0.75rem' }}>
                    <form className="kb-search-form-inline" onSubmit={handleSearch}>
                        <Search size={15} className="kb-search-icon" />
                        <input
                            type="text" className="kb-search-input"
                            placeholder="Probar RAG: escribe una pregunta para ver qué respondería el chatbot..."
                            value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                        />
                        <button type="submit" className="kb-search-btn" disabled={searching || !searchQuery.trim()}>
                            {searching ? <Loader size={13} className="spin" /> : <ChevronRight size={13} />}
                        </button>
                    </form>
                    {searchResult && (
                        <div className="kb-search-result-preview">
                            <span className="kb-search-result-label">Respuesta del chatbot:</span>
                            <p>{searchResult}</p>
                        </div>
                    )}
                </div>

                {/* ── MAIN CARD ── */}
                <div className="premium-card kb-main-card">
                    {/* Hidden file input */}
                    <input ref={fileInputRef} type="file" accept=".pdf,.txt"
                        onChange={handleFileSelect} style={{ display: 'none' }} />

                    {/* Topbar */}
                    <div className="kb-entries-topbar">
                        <div className="kb-entries-title">
                            <FileText size={14} />
                            <span>
                                {unifiedEntries.length > 0
                                    ? `Documentos (${unifiedEntries.length})`
                                    : 'Sin contenido aún'}
                            </span>
                        </div>
                        <div className="kb-entries-topbar-actions">
                            <button className="kb-btn-sec kb-btn-outline" onClick={handleReprocessManual}
                                title="Re-vectorizar contenido">
                                <RefreshCw size={13} />
                            </button>
                            <button className="kb-btn-sec kb-btn-outline" onClick={openNewModal}>
                                <Plus size={13} /> Agregar texto
                            </button>
                            <button className="kb-btn-pri" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                                {uploading ? <Loader size={13} className="spin" /> : <Upload size={13} />}
                                {uploading ? 'Subiendo...' : 'Subir archivo'}
                            </button>
                        </div>
                    </div>

                    {/* Unified entries list */}
                    {unifiedEntries.length > 0 ? (
                        <div className="kb-entries-list-compact">
                            {unifiedEntries.map((entry, idx) => (
                                <div key={entry.id || idx} className="kb-entry-row">
                                    <span className="kb-type-badge">
                                        {entry._itemType === 'document' ? entry.type?.toUpperCase() : 'TEXTO'}
                                    </span>

                                    <div className="kb-entry-row-info" style={{ flex: 1 }}>
                                        <span className="kb-entry-row-title">{entry.title}</span>
                                    </div>

                                    <div className="kb-entry-row-status" style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                                        {entry._itemType === 'document' ? (
                                            renderStatus(entry.status, entry.chunkCount)
                                        ) : (
                                            <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>
                                                {new Date(entry.updatedAt || entry.createdAt || entry._sortDate)
                                                    .toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                                            </span>
                                        )}
                                    </div>

                                    {entry._itemType === 'document' && (
                                        <div style={{
                                            marginRight: '1rem',
                                            fontSize: '0.75rem',
                                            color: 'rgba(255,255,255,0.4)',
                                            fontWeight: 500,
                                            whiteSpace: 'nowrap'
                                        }}>
                                            {new Date(entry.updatedAt || entry.createdAt || entry._sortDate)
                                                .toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                                        </div>
                                    )}

                                    <div className="kb-entry-row-actions">
                                        {entry._itemType === 'document' ? (
                                            <>
                                                {entry.status === 'error' && (
                                                    <button className="kb-icon-btn" title="Reintentar"
                                                        onClick={() => reprocessDocument(entry.id)}>
                                                        <RefreshCw size={13} />
                                                    </button>
                                                )}
                                                <button className="kb-icon-btn" title="Descargar"
                                                    onClick={() => window.open(`${api.defaults.baseURL}/api/knowledge-base/documents/${entry.id}/download`, '_blank')}>
                                                    <Download size={13} />
                                                </button>
                                                <button className="kb-icon-btn kb-icon-btn-danger" title="Eliminar"
                                                    onClick={() => deleteDocument(entry.id)}>
                                                    <Trash2 size={13} />
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                <button className="kb-icon-btn" onClick={() => openEditModal(entry)} title="Editar texto">
                                                    <Pencil size={13} />
                                                </button>
                                                <button className="kb-icon-btn kb-icon-btn-danger"
                                                    onClick={() => handleDeleteManual(entry.id)} title="Eliminar">
                                                    <Trash2 size={13} />
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="kb-empty-state" style={{ paddingTop: '2.5rem' }}>
                            <FileText size={40} style={{ opacity: 0.25 }} />
                            <h2>Sin documentos</h2>
                            <p>Sube archivos PDF/TXT o escribe contenido manualmente para empezar</p>
                        </div>
                    )}
                </div>
            </div>

            {/* ── MODAL ── */}
            {modalOpen && (
                <div className="kb-modal-overlay" onClick={closeModal}>
                    <div className="kb-modal" onClick={e => e.stopPropagation()}>
                        <div className="kb-modal-header">
                            <h3>{modalEditingId ? 'Editar contenido' : 'Nuevo contenido'}</h3>
                            <button className="kb-modal-close" onClick={closeModal}><X size={16} /></button>
                        </div>
                        <div className="kb-modal-body">
                            <input
                                type="text" className="form-input kb-modal-title-input"
                                placeholder="Título (ej: Planes de internet WiFi)"
                                value={modalTitle} onChange={e => setModalTitle(e.target.value)}
                                autoFocus
                            />
                            <textarea
                                className="form-input kb-modal-textarea"
                                placeholder={"Escribe el conocimiento aquí...\n\nEjemplo:\n¿Cuánto cuesta el plan básico?\nEl plan básico cuesta $X al mes e incluye..."}
                                value={modalContent} onChange={e => setModalContent(e.target.value)}
                                rows={10}
                            />
                        </div>
                        <div className="kb-modal-footer">
                            <button className="btn-premium danger" onClick={closeModal}>
                                <X size={13} /> Cancelar
                            </button>
                            <button
                                className="btn-premium primary"
                                onClick={handleModalSave}
                                disabled={savingManual || !modalTitle.trim() || !modalContent.trim()}
                            >
                                {savingManual ? <Loader size={13} className="spin" /> : <CheckCircle size={13} />}
                                {modalEditingId ? 'Guardar cambios' : 'Guardar y vectorizar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default KnowledgeBasePage;
