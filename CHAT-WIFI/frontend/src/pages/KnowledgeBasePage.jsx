import React, { useEffect, useState, useRef } from 'react';
import {
    Upload, FileText, Trash2, RefreshCw, Search,
    CheckCircle, AlertCircle, Clock, BookOpen, File, X,
    Plus, Save, Edit3, MessageCircle
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

    // ── Q&A Pairs state ──────────────────────────────────────────────────
    const [qaPairs, setQaPairs] = useState([]);
    const [qaLoading, setQaLoading] = useState(false);
    const [newQ, setNewQ] = useState('');
    const [newA, setNewA] = useState('');
    const [addingQA, setAddingQA] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [editQ, setEditQ] = useState('');
    const [editA, setEditA] = useState('');
    const [qaToast, setQaToast] = useState(null);
    const [reprocessingQA, setReprocessingQA] = useState(false);

    useEffect(() => {
        fetchDocuments();
        loadQAPairs();
        const interval = setInterval(fetchDocuments, 5000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (error) {
            const timer = setTimeout(clearError, 5000);
            return () => clearTimeout(timer);
        }
    }, [error]);

    // ── Q&A Helpers ──────────────────────────────────────────────────────
    const showQaToast = (type, msg) => {
        setQaToast({ type, msg });
        setTimeout(() => setQaToast(null), 3500);
    };

    const loadQAPairs = async () => {
        setQaLoading(true);
        try {
            const { data } = await api.get('/api/knowledge-base/qa-pairs');
            setQaPairs(data.pairs || []);
        } catch {
            console.error('Error loading Q&A pairs');
        } finally {
            setQaLoading(false);
        }
    };

    const handleAddQA = async () => {
        if (!newQ.trim() || !newA.trim()) return;
        setAddingQA(true);
        try {
            await api.post('/api/knowledge-base/qa-pairs', { question: newQ, answer: newA });
            setNewQ('');
            setNewA('');
            showQaToast('success', 'Pregunta añadida y vectorizada ✨');
            loadQAPairs();
        } catch {
            showQaToast('error', 'Error al añadir');
        } finally {
            setAddingQA(false);
        }
    };

    const handleUpdateQA = async (id) => {
        if (!editQ.trim() || !editA.trim()) return;
        try {
            await api.put(`/api/knowledge-base/qa-pairs/${id}`, { question: editQ, answer: editA });
            setEditingId(null);
            showQaToast('success', 'Actualizado y re-vectorizado ✨');
            loadQAPairs();
        } catch {
            showQaToast('error', 'Error al actualizar');
        }
    };

    const handleDeleteQA = async (id) => {
        if (!window.confirm('¿Eliminar esta pregunta y respuesta?')) return;
        try {
            await api.delete(`/api/knowledge-base/qa-pairs/${id}`);
            showQaToast('success', 'Eliminado correctamente');
            loadQAPairs();
        } catch {
            showQaToast('error', 'Error al eliminar');
        }
    };

    const handleReprocessQA = async () => {
        setReprocessingQA(true);
        try {
            const { data } = await api.post('/api/knowledge-base/qa-pairs/reprocess');
            showQaToast('success', `${data.count} Q&A re-vectorizadas ✨`);
        } catch {
            showQaToast('error', 'Error al re-vectorizar');
        } finally {
            setReprocessingQA(false);
        }
    };

    const startEditing = (pair) => {
        setEditingId(pair.id);
        setEditQ(pair.question);
        setEditA(pair.answer);
    };

    // ── Document Handlers ────────────────────────────────────────────────
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
            <header className="page-header">
                <div>
                    <h1>Base de Conocimiento</h1>
                    <p className="text-muted">Sube documentos PDF/TXT y añade preguntas y respuestas para entrenar el chatbot.</p>
                </div>
            </header>

            {error && (
                <div className="kb-error-banner">
                    <AlertCircle size={18} />
                    <span>{error}</span>
                    <button onClick={clearError}><X size={16} /></button>
                </div>
            )}

            {/* Q&A Toast */}
            {qaToast && (
                <div className={`wa-toast ${qaToast.type === 'success' ? 'wa-toast-ok' : 'wa-toast-err'}`}>
                    {qaToast.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                    {qaToast.msg}
                </div>
            )}

            {/* ═══════════════════════════════════════════════════════════════
                Q&A PAIRS MANAGEMENT — FIRST SECTION
                ═══════════════════════════════════════════════════════════════ */}
            <div className="kb-documents-section premium-card">
                <div className="kb-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <MessageCircle size={20} style={{ color: '#00ff00' }} />
                        <h3>Preguntas y Respuestas ({qaPairs.length})</h3>
                    </div>
                    {qaPairs.length > 0 && (
                        <button
                            className="btn-icon-text ghost-blue"
                            onClick={handleReprocessQA}
                            disabled={reprocessingQA}
                            title="Re-vectorizar todas las Q&A"
                        >
                            <RefreshCw size={14} className={reprocessingQA ? 'spin' : ''} />
                            {reprocessingQA ? 'Vectorizando...' : 'Re-vectorizar'}
                        </button>
                    )}
                </div>
                <p className="text-muted" style={{ margin: '0 0 1rem', padding: '0 0.5rem' }}>
                    Añade preguntas frecuentes y sus respuestas. La IA usará esta información como prioridad al responder.
                </p>

                {/* Add new Q&A */}
                <div style={{
                    background: 'var(--bg-secondary)',
                    borderRadius: 12,
                    padding: '1rem',
                    marginBottom: '1rem',
                    border: '1px solid var(--border-light)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                        <Plus size={18} style={{ color: '#00ff00' }} />
                        <strong style={{ fontSize: '0.9rem' }}>Añadir nueva pregunta</strong>
                    </div>
                    <input
                        type="text"
                        value={newQ}
                        onChange={e => setNewQ(e.target.value)}
                        placeholder="Pregunta: ej. ¿Cuánto cuesta el servicio?"
                        className="form-input"
                        style={{ marginBottom: '0.5rem' }}
                    />
                    <textarea
                        value={newA}
                        onChange={e => setNewA(e.target.value)}
                        placeholder="Respuesta: ej. Nuestro servicio cuesta $50.000 mensuales..."
                        className="form-input"
                        rows={3}
                        style={{ marginBottom: '0.75rem', resize: 'vertical' }}
                    />
                    <button
                        className="btn-submit"
                        onClick={handleAddQA}
                        disabled={addingQA || !newQ.trim() || !newA.trim()}
                        style={{ width: '100%' }}
                    >
                        {addingQA ? <RefreshCw className="spin" size={16} /> : <Plus size={16} />}
                        {addingQA ? 'Añadiendo...' : 'Añadir pregunta y respuesta'}
                    </button>
                </div>

                {/* Q&A Pairs list */}
                {qaLoading && <p className="text-muted" style={{ textAlign: 'center', padding: '1rem' }}>Cargando...</p>}

                {!qaLoading && qaPairs.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)' }}>
                        <MessageCircle size={40} style={{ opacity: 0.3, marginBottom: 8 }} />
                        <p>No hay preguntas y respuestas todavía. ¡Añade la primera!</p>
                    </div>
                )}

                {!qaLoading && qaPairs.map(pair => (
                    <div key={pair.id} style={{
                        background: 'var(--bg-secondary)',
                        borderRadius: 12,
                        padding: '1rem',
                        marginBottom: '0.75rem',
                        border: '1px solid var(--border-light)',
                        transition: 'border-color 0.2s'
                    }}>
                        {editingId === pair.id ? (
                            /* Edit mode */
                            <>
                                <input
                                    type="text"
                                    value={editQ}
                                    onChange={e => setEditQ(e.target.value)}
                                    className="form-input"
                                    style={{ marginBottom: '0.5rem' }}
                                />
                                <textarea
                                    value={editA}
                                    onChange={e => setEditA(e.target.value)}
                                    className="form-input"
                                    rows={3}
                                    style={{ marginBottom: '0.5rem', resize: 'vertical' }}
                                />
                                <div style={{ display: 'flex', gap: '0.75rem' }}>
                                    <button
                                        className="btn-submit"
                                        onClick={() => handleUpdateQA(pair.id)}
                                        style={{ flex: 1 }}
                                    >
                                        <Save size={14} /> Guardar
                                    </button>
                                    <button
                                        className="btn-icon-text ghost-red"
                                        onClick={() => setEditingId(null)}
                                        style={{ flex: 0.3 }}
                                    >
                                        Cancelar
                                    </button>
                                </div>
                            </>
                        ) : (
                            /* View mode */
                            <>
                                <div style={{ marginBottom: '0.5rem' }}>
                                    <span style={{ color: '#00ff00', fontWeight: 600, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: 1 }}>
                                        Pregunta
                                    </span>
                                    <p style={{ margin: '0.25rem 0 0', fontWeight: 500 }}>{pair.question}</p>
                                </div>
                                <div style={{ marginBottom: '0.75rem' }}>
                                    <span style={{ color: '#00ff00', fontWeight: 600, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: 1 }}>
                                        Respuesta
                                    </span>
                                    <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>{pair.answer}</p>
                                </div>
                                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                                    <button
                                        className="btn-icon-text ghost-blue"
                                        onClick={() => startEditing(pair)}
                                        title="Editar"
                                    >
                                        <Edit3 size={14} /> Editar
                                    </button>
                                    <button
                                        className="btn-icon-text ghost-red"
                                        onClick={() => handleDeleteQA(pair.id)}
                                        title="Eliminar"
                                    >
                                        <Trash2 size={14} /> Eliminar
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                ))}
            </div>

            {/* Upload Zone */}
            <div
                className={`kb-upload-zone premium-card ${dragActive ? 'kb-drag-active' : ''}`}
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

            {/* Documents Table */}
            {documents.length > 0 && (
                <div className="kb-documents-section premium-card">
                    <div className="kb-section-header">
                        <BookOpen size={20} />
                        <h3>Documentos ({documents.length})</h3>
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
                <div className="kb-empty-state premium-card">
                    <BookOpen size={64} className="text-muted" />
                    <h2>Sin documentos</h2>
                    <p>Sube tu primer documento para crear la base de conocimiento del chatbot.</p>
                </div>
            )}

            {/* Search Test Area */}
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
        </div>
    );
};

export default KnowledgeBasePage;
