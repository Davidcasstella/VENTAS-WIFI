import React, { useEffect, useState, useRef } from 'react';
import {
    Upload, FileText, Trash2, RefreshCw, Search,
    CheckCircle, AlertCircle, Clock, BookOpen, File, X,
    Plus, Save, Edit3, BookMarked
} from 'lucide-react';
import useKnowledgeStore from '../features/knowledge-base/store/useKnowledgeStore';
import api from '../services/api';

const KnowledgeBasePage = () => {
    const {
        documents, loading, uploading, error,
        fetchDocuments, uploadDocument, reprocessDocument, deleteDocument, clearError
    } = useKnowledgeStore();

    const [dragActive, setDragActive] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResult, setSearchResult] = useState(null);
    const [searching, setSearching] = useState(false);
    const fileInputRef = useRef(null);

    // ── Tab state ────────────────────────────────────────────────────
    const [activeTab, setActiveTab] = useState('text');

    // ── Toast state ───────────────────────────────────────────────────
    const [toast, setToast] = useState(null);

    // ── Manual Knowledge state ────────────────────────────────────────
    const [mkEntries, setMkEntries] = useState([]);
    const [mkLoading, setMkLoading] = useState(false);
    const [newMkTitle, setNewMkTitle] = useState('');
    const [newMkContent, setNewMkContent] = useState('');
    const [addingMK, setAddingMK] = useState(false);
    const [showMkForm, setShowMkForm] = useState(false);
    const [editingMkId, setEditingMkId] = useState(null);
    const [editMkTitle, setEditMkTitle] = useState('');
    const [editMkContent, setEditMkContent] = useState('');
    const [reprocessingMK, setReprocessingMK] = useState(false);

    useEffect(() => {
        fetchDocuments();
        loadManualKnowledge();
        const interval = setInterval(fetchDocuments, 5000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (error) {
            const timer = setTimeout(clearError, 5000);
            return () => clearTimeout(timer);
        }
    }, [error]);

    // ── Toast helper ──────────────────────────────────────────────────
    const showToast = (type, msg) => {
        setToast({ type, msg });
        setTimeout(() => setToast(null), 3500);
    };

    // ── Manual Knowledge Helpers ──────────────────────────────────────
    const loadManualKnowledge = async () => {
        setMkLoading(true);
        try {
            const { data } = await api.get('/api/knowledge-base/manual-knowledge');
            setMkEntries(data.entries || []);
        } catch {
            console.error('Error loading manual knowledge');
        } finally {
            setMkLoading(false);
        }
    };

    const handleAddMK = async () => {
        if (!newMkTitle.trim() || !newMkContent.trim()) return;
        setAddingMK(true);
        try {
            await api.post('/api/knowledge-base/manual-knowledge', { title: newMkTitle, content: newMkContent });
            setNewMkTitle('');
            setNewMkContent('');
            setShowMkForm(false);
            showToast('success', 'Conocimiento añadido y vectorizado ✨');
            loadManualKnowledge();
        } catch {
            showToast('error', 'Error al añadir conocimiento');
        } finally {
            setAddingMK(false);
        }
    };

    const handleUpdateMK = async (id) => {
        if (!editMkTitle.trim() || !editMkContent.trim()) return;
        try {
            await api.put(`/api/knowledge-base/manual-knowledge/${id}`, { title: editMkTitle, content: editMkContent });
            setEditingMkId(null);
            showToast('success', 'Conocimiento actualizado y re-vectorizado ✨');
            loadManualKnowledge();
        } catch {
            showToast('error', 'Error al actualizar');
        }
    };

    const handleDeleteMK = async (id) => {
        try {
            await api.delete(`/api/knowledge-base/manual-knowledge/${id}`);
            showToast('success', 'Conocimiento eliminado');
            loadManualKnowledge();
        } catch (err) {
            console.error('Delete error:', err);
            showToast('error', 'Error al eliminar');
        }
    };

    const handleReprocessMK = async () => {
        setReprocessingMK(true);
        try {
            const { data } = await api.post('/api/knowledge-base/manual-knowledge/reprocess');
            showToast('success', `${data.count} conocimientos re-vectorizados ✨`);
        } catch {
            showToast('error', 'Error al re-vectorizar');
        } finally {
            setReprocessingMK(false);
        }
    };

    const startEditingMK = (entry) => {
        setEditingMkId(entry.id);
        setEditMkTitle(entry.title);
        setEditMkContent(entry.content);
    };

    // ── Document Handlers ────────────────────────────────────────────
    const handleDrag = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setDragActive(true);
        } else if (e.type === 'dragleave') {
            setDragActive(false);
        }
    };

    const handleDrop = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            await uploadDocument(e.dataTransfer.files[0]);
        }
    };

    const handleFileSelect = async (e) => {
        if (e.target.files && e.target.files[0]) {
            await uploadDocument(e.target.files[0]);
            e.target.value = '';
        }
    };

    const handleSearch = async (e) => {
        e.preventDefault();
        if (!searchQuery.trim()) return;
        setSearching(true);
        try {
            const response = await api.post('/api/knowledge-base/search', { query: searchQuery });
            setSearchResult(response.data);
        } catch (err) {
            setSearchResult({ success: false, context: 'Error al buscar' });
        }
        setSearching(false);
    };

    const getStatusBadge = (status) => {
        switch (status) {
            case 'processed':
                return <span className="kb-status-badge kb-status-success"><CheckCircle size={14} /> Procesado</span>;
            case 'processing':
                return <span className="kb-status-badge kb-status-processing"><RefreshCw size={14} className="spin" /> Procesando</span>;
            case 'error':
                return <span className="kb-status-badge kb-status-error"><AlertCircle size={14} /> Error</span>;
            case 'uploaded':
                return <span className="kb-status-badge kb-status-pending"><Clock size={14} /> En cola</span>;
            default:
                return <span className="kb-status-badge">{status}</span>;
        }
    };

    const formatFileSize = (bytes) => {
        if (!bytes) return '—';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '—';
        return new Date(dateStr).toLocaleDateString('es-ES', {
            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    };

    return (
        <div className="ai-providers-container">
            {error && (
                <div className="kb-error-banner">
                    <AlertCircle size={18} />
                    <span>{error}</span>
                    <button onClick={clearError}><X size={16} /></button>
                </div>
            )}

            {/* Toast notifications */}
            {toast && (
                <div className={`wa-toast ${toast.type === 'success' ? 'wa-toast-ok' : 'wa-toast-err'}`}>
                    {toast.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                    {toast.msg}
                </div>
            )}

            {/* ═══════════════════════════════════════════════════════════════
                SEARCH TEST AREA — Quick RAG test
                ═══════════════════════════════════════════════════════════════ */}
            <div className="kb-search-section premium-card">
                <div className="kb-section-header">
                    <Search size={20} />
                    <h3>Probar Búsqueda RAG</h3>
                </div>
                <form onSubmit={handleSearch} className="kb-search-form">
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Escribe una pregunta para probar la búsqueda..."
                        className="form-input"
                    />
                    <button type="submit" className="btn-submit" disabled={searching || !searchQuery.trim()}>
                        {searching ? <RefreshCw className="spin" size={18} /> : <Search size={18} />}
                    </button>
                </form>
                {searchResult && (
                    <div className="kb-search-results">
                        <h4>{searchResult.hasResults ? '✅ Contexto encontrado:' : '❌ Sin resultados'}</h4>
                        <pre className="kb-context-preview">{searchResult.context}</pre>
                    </div>
                )}
            </div>

            {/* ═══════════════════════════════════════════════════════════════
                TABBED KNOWLEDGE SECTION
                ═══════════════════════════════════════════════════════════════ */}
            <div className="kb-documents-section premium-card">
                {/* ── Tab Bar ── */}
                <div className="kb-tabs-bar">
                    <button
                        className={`kb-tab ${activeTab === 'text' ? 'active' : ''}`}
                        onClick={() => setActiveTab('text')}
                    >
                        <Edit3 size={16} />
                        Editor de texto
                    </button>
                    <button
                        className={`kb-tab ${activeTab === 'upload' ? 'active' : ''}`}
                        onClick={() => setActiveTab('upload')}
                    >
                        <Upload size={16} />
                        Subir documentos
                    </button>
                </div>

                {/* ── Tab Content ── */}
                <div className="kb-tab-content">

                    {/* ════════════════════════════════════════════════════════
                        TAB 1 — TEXT EDITOR
                        ════════════════════════════════════════════════════════ */}
                    {activeTab === 'text' && (
                        <div className="kb-text-editor-tab">
                            {/* Header with action buttons */}
                            <div className="kb-tab-header">
                                <p className="text-muted" style={{ margin: 0 }}>
                                    Escribe o pega información extensa. El sistema la dividirá en fragmentos y la vectorizará automáticamente.
                                </p>
                                <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                                    {mkEntries.length > 0 && (
                                        <button
                                            className="btn-icon-text ghost-blue"
                                            onClick={handleReprocessMK}
                                            disabled={reprocessingMK}
                                            title="Re-vectorizar todos los conocimientos"
                                        >
                                            <RefreshCw size={14} className={reprocessingMK ? 'spin' : ''} />
                                            {reprocessingMK ? 'Vectorizando...' : 'Re-vectorizar'}
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Editor form — always visible */}
                            <div className="kb-editor-form">
                                <div className="kb-editor-field">
                                    <label className="kb-editor-label">Título</label>
                                    <input
                                        type="text"
                                        value={newMkTitle}
                                        onChange={e => setNewMkTitle(e.target.value)}
                                        placeholder="Ej: Información de planes WiFi, Horarios de atención..."
                                        className="form-input kb-title-input"
                                    />
                                </div>
                                <div className="kb-editor-field">
                                    <label className="kb-editor-label">Contenido</label>
                                    <textarea
                                        value={newMkContent}
                                        onChange={e => setNewMkContent(e.target.value)}
                                        placeholder="Pega o escribe aquí toda la información que quieras agregar como conocimiento del sistema..."
                                        className="form-input kb-content-textarea"
                                        rows={12}
                                    />
                                </div>
                                <div className="kb-editor-actions">
                                    <button
                                        className="btn-submit"
                                        onClick={handleAddMK}
                                        disabled={addingMK || !newMkTitle.trim() || !newMkContent.trim()}
                                    >
                                        {addingMK ? <RefreshCw className="spin" size={16} /> : <Save size={16} />}
                                        {addingMK ? 'Guardando y vectorizando...' : 'Guardar'}
                                    </button>
                                    <button
                                        className="btn-icon-text ghost-red"
                                        onClick={() => { setNewMkTitle(''); setNewMkContent(''); }}
                                        disabled={!newMkTitle && !newMkContent}
                                    >
                                        <X size={14} />
                                        Cancelar
                                    </button>
                                </div>
                            </div>

                            {/* Existing entries list */}
                            {mkEntries.length > 0 && (
                                <div className="kb-entries-divider">
                                    <BookMarked size={16} style={{ color: '#00ff00' }} />
                                    <span>Conocimientos guardados ({mkEntries.length})</span>
                                </div>
                            )}

                            {mkLoading && <p className="text-muted" style={{ textAlign: 'center', padding: '1rem' }}>Cargando...</p>}

                            {!mkLoading && mkEntries.length === 0 && (
                                <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)' }}>
                                    <BookMarked size={40} style={{ opacity: 0.3, marginBottom: 8 }} />
                                    <p>No hay conocimientos manuales todavía. ¡Escribe el primero arriba!</p>
                                </div>
                            )}

                            {!mkLoading && mkEntries.map(entry => (
                                <div key={entry.id} className="kb-entry-card">
                                    {editingMkId === entry.id ? (
                                        /* Edit mode */
                                        <>
                                            <input
                                                type="text"
                                                value={editMkTitle}
                                                onChange={e => setEditMkTitle(e.target.value)}
                                                className="form-input"
                                                style={{ marginBottom: '0.75rem' }}
                                            />
                                            <textarea
                                                value={editMkContent}
                                                onChange={e => setEditMkContent(e.target.value)}
                                                className="form-input kb-content-textarea"
                                                rows={8}
                                            />
                                            <div className="kb-editor-actions" style={{ marginTop: '0.75rem' }}>
                                                <button
                                                    className="btn-submit"
                                                    onClick={() => handleUpdateMK(entry.id)}
                                                >
                                                    <Save size={14} /> Guardar
                                                </button>
                                                <button
                                                    className="btn-icon-text ghost-red"
                                                    onClick={() => setEditingMkId(null)}
                                                >
                                                    Cancelar
                                                </button>
                                            </div>
                                        </>
                                    ) : (
                                        /* View mode */
                                        <>
                                            <div style={{ marginBottom: '0.5rem' }}>
                                                <span className="kb-editor-label" style={{ fontSize: '0.75rem' }}>Título</span>
                                                <p style={{ margin: '0.25rem 0 0', fontWeight: 500 }}>{entry.title}</p>
                                            </div>
                                            <div style={{ marginBottom: '0.75rem' }}>
                                                <span className="kb-editor-label" style={{ fontSize: '0.75rem' }}>Contenido</span>
                                                <p style={{
                                                    margin: '0.25rem 0 0',
                                                    color: 'var(--text-muted)',
                                                    whiteSpace: 'pre-wrap',
                                                    maxHeight: '150px',
                                                    overflow: 'auto',
                                                    fontSize: '0.85rem',
                                                    lineHeight: '1.5'
                                                }}>
                                                    {entry.content}
                                                </p>
                                            </div>
                                            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', opacity: 0.6 }}>
                                                    {entry.updatedAt ? `Actualizado: ${new Date(entry.updatedAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}
                                                </span>
                                                <div style={{ display: 'flex', gap: '0.75rem' }}>
                                                    <button
                                                        className="btn-icon-text ghost-blue"
                                                        onClick={() => startEditingMK(entry)}
                                                        title="Editar"
                                                    >
                                                        <Edit3 size={14} /> Editar
                                                    </button>
                                                    <button
                                                        className="btn-icon-text ghost-red"
                                                        onClick={() => handleDeleteMK(entry.id)}
                                                        title="Eliminar"
                                                    >
                                                        <Trash2 size={14} /> Eliminar
                                                    </button>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* ════════════════════════════════════════════════════════
                        TAB 2 — UPLOAD DOCUMENTS
                        ════════════════════════════════════════════════════════ */}
                    {activeTab === 'upload' && (
                        <div className="kb-upload-tab">
                            {/* Upload zone */}
                            <div
                                className={`kb-upload-zone ${dragActive ? 'kb-drag-active' : ''}`}
                                onDragEnter={handleDrag}
                                onDragOver={handleDrag}
                                onDragLeave={handleDrag}
                                onDrop={handleDrop}
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".pdf,.txt"
                                    onChange={handleFileSelect}
                                    style={{ display: 'none' }}
                                />
                                {uploading ? (
                                    <div className="kb-upload-content">
                                        <RefreshCw size={40} className="spin" style={{ color: 'var(--primary-color)' }} />
                                        <h3>Subiendo documento...</h3>
                                        <p className="text-muted">Procesamiento iniciará automáticamente</p>
                                    </div>
                                ) : (
                                    <div className="kb-upload-content">
                                        <Upload size={40} style={{ color: 'var(--primary-color)' }} />
                                        <h3>Arrastra tu archivo aquí o haz clic</h3>
                                        <p className="text-muted">Soporta archivos PDF y TXT — Máximo 20MB</p>
                                    </div>
                                )}
                            </div>

                            {/* Documents table */}
                            {documents.length > 0 && (
                                <div className="kb-docs-list-section">
                                    <div className="kb-entries-divider">
                                        <BookOpen size={16} />
                                        <span>Documentos subidos ({documents.length})</span>
                                    </div>
                                    <div className="kb-table-wrapper">
                                        <table className="kb-table">
                                            <thead>
                                                <tr>
                                                    <th>Nombre</th>
                                                    <th>Tipo</th>
                                                    <th>Tamaño</th>
                                                    <th>Chunks</th>
                                                    <th>Estado</th>
                                                    <th>Fecha</th>
                                                    <th>Acciones</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {documents.map(doc => (
                                                    <tr key={doc.id}>
                                                        <td className="kb-doc-name">
                                                            <FileText size={16} />
                                                            <span>{doc.name}</span>
                                                        </td>
                                                        <td>
                                                            <span className="kb-type-badge">{doc.type?.toUpperCase()}</span>
                                                        </td>
                                                        <td>{formatFileSize(doc.size)}</td>
                                                        <td>{doc.chunkCount || '—'}</td>
                                                        <td>{getStatusBadge(doc.status)}</td>
                                                        <td>{formatDate(doc.createdAt)}</td>
                                                        <td className="kb-actions">
                                                            <button
                                                                className="kb-action-btn kb-reprocess"
                                                                onClick={() => reprocessDocument(doc.id)}
                                                                title="Reprocesar"
                                                                disabled={doc.status === 'processing'}
                                                            >
                                                                <RefreshCw size={16} />
                                                            </button>
                                                            <button
                                                                className="kb-action-btn kb-delete"
                                                                onClick={() => deleteDocument(doc.id)}
                                                                title="Eliminar"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {documents.length === 0 && !loading && (
                                <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--text-muted)' }}>
                                    <BookOpen size={48} style={{ opacity: 0.3, marginBottom: 12 }} />
                                    <p>No hay documentos subidos todavía.</p>
                                    <p style={{ fontSize: '0.8rem', opacity: 0.6 }}>Arrastra un archivo PDF o TXT a la zona de arriba.</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default KnowledgeBasePage;
