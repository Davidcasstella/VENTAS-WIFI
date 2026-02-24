import { create } from 'zustand';
import api from '../../../services/api';

const useKnowledgeStore = create((set) => ({
    documents: [],
    loading: false,
    uploading: false,
    error: null,

    fetchDocuments: async () => {
        set({ loading: true, error: null });
        try {
            const response = await api.get('/api/knowledge-base/documents');
            if (response.data.success) {
                set({ documents: response.data.documents, loading: false });
            }
        } catch (error) {
            set({ error: error.response?.data?.message || 'Error al cargar documentos', loading: false });
        }
    },

    uploadDocument: async (file) => {
        set({ uploading: true, error: null });
        try {
            const formData = new FormData();
            formData.append('file', file);
            const response = await api.post('/api/knowledge-base/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            if (response.data.success) {
                // Refresh documents list
                const listResponse = await api.get('/api/knowledge-base/documents');
                if (listResponse.data.success) {
                    set({ documents: listResponse.data.documents, uploading: false });
                }
                return true;
            }
        } catch (error) {
            set({ error: error.response?.data?.message || 'Error al subir documento', uploading: false });
            return false;
        }
    },

    reprocessDocument: async (id) => {
        set({ loading: true, error: null });
        try {
            await api.post(`/api/knowledge-base/documents/${id}/reprocess`);
            // Refresh documents list
            const response = await api.get('/api/knowledge-base/documents');
            if (response.data.success) {
                set({ documents: response.data.documents, loading: false });
            }
            return true;
        } catch (error) {
            set({ error: error.response?.data?.message || 'Error al reprocesar', loading: false });
            return false;
        }
    },

    deleteDocument: async (id) => {
        if (!window.confirm('¿Estás seguro de eliminar este documento y toda su información?')) return false;
        set({ loading: true, error: null });
        try {
            await api.delete(`/api/knowledge-base/documents/${id}`);
            const response = await api.get('/api/knowledge-base/documents');
            if (response.data.success) {
                set({ documents: response.data.documents, loading: false });
            }
            return true;
        } catch (error) {
            set({ error: error.response?.data?.message || 'Error al eliminar', loading: false });
            return false;
        }
    },

    clearError: () => set({ error: null })
}));

export default useKnowledgeStore;
