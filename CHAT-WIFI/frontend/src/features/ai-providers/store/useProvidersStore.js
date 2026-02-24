import { create } from 'zustand';
import api from '../../../services/api';

const useProvidersStore = create((set, get) => ({
    providers: [],
    loading: false,
    error: null,

    fetchProviders: async () => {
        set({ loading: true, error: null });
        try {
            const response = await api.get('/api/ai-providers');
            if (response.data.success) {
                set({ providers: response.data.providers, loading: false });
            }
        } catch (error) {
            set({ error: error.response?.data?.message || 'Error al cargar proveedores', loading: false });
        }
    },

    saveProvider: async (providerData) => {
        set({ loading: true, error: null });
        try {
            const response = await api.post('/api/ai-providers', providerData);
            if (response.data.success) {
                set({ providers: response.data.providers, loading: false });
                return true;
            }
        } catch (error) {
            set({ error: error.response?.data?.message || 'Error al guardar proveedor', loading: false });
            return false;
        }
    },

    deleteProvider: async (id) => {
        if (!window.confirm('¿Estás seguro de eliminar este proveedor?')) return;
        set({ loading: true, error: null });
        try {
            const response = await api.delete(`/api/ai-providers/${id}`);
            if (response.data.success) {
                set({ providers: response.data.providers, loading: false });
            }
        } catch (error) {
            set({ error: error.response?.data?.message || 'Error al eliminar proveedor', loading: false });
        }
    },

    activateProvider: async (id) => {
        set({ loading: true, error: null });
        try {
            const response = await api.put(`/api/ai-providers/${id}/activate`);
            if (response.data.success) {
                set({ providers: response.data.providers, loading: false });
            }
        } catch (error) {
            set({ error: error.response?.data?.message || 'Error al activar proveedor', loading: false });
        }
    },

    testProvider: async (id) => {
        try {
            const response = await api.post(`/api/ai-providers/${id}/test`);
            return {
                success: response.data.success,
                message: response.data.message
            };
        } catch (error) {
            return {
                success: false,
                message: error.response?.data?.message || 'Error de conexión'
            };
        }
    }
}));

export default useProvidersStore;
