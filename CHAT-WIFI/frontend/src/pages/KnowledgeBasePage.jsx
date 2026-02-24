import React, { useEffect, useState, useRef } from 'react';
import {
    Upload, FileText, Trash2, RefreshCw, Search,
    CheckCircle, AlertCircle, Clock, BookOpen, File, X
} from 'lucide-react';
import useKnowledgeStore from '../features/knowledge-base/store/useKnowledgeStore';

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

    useEffect(() => {
        fetchDocuments();
        // Poll for status updates every 5 seconds
        const interval = setInterval(fetchDocuments, 5000);
        return () => clearInterval(interval);
    }, []);

    // Auto-dismiss error after 5 seconds
    useEffect(() => {
        if (error) {
            const timer = setTimeout(clearError, 5000);
            return () => clearTimeout(timer);
        }
    }, [error]);

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
            e.target.value = ''; // Reset input
        }
    };

    const handleSearch = async (e) => {
        e.preventDefault();
        if (!searchQuery.trim()) return;
        setSearching(true);
        try {
            const api = (await import('../services/api')).default;
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
                    <p className="text-muted">Sube documentos PDF o TXT para entrenar el chatbot con tu información.</p>
                </div>
            </header>

            {error && (
                <div className="kb-error-banner">
                    <AlertCircle size={18} />
                    <span>{error}</span>
                    <button onClick={clearError}><X size={16} /></button>
                </div>
            )}

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
