import React, { useState } from 'react';
import { ShieldCheck, ShieldAlert, Trash2, Power, Zap, RefreshCw } from 'lucide-react';
import useProvidersStore from '../store/useProvidersStore';
import api from '../../../services/api';

const ProviderCard = ({ provider }) => {
    const { activateProvider, testProvider } = useProvidersStore();
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState(null);
    const [deleting, setDeleting] = useState(false);

    const handleTest = async () => {
        setTesting(true);
        setTestResult(null);
        const result = await testProvider(provider.id);
        setTestResult(result);
        setTesting(false);
        if (result.success) {
            setTimeout(() => setTestResult(null), 5000);
        }
    };

    // Direct delete — NO confirmation dialog, just delete and reload
    const handleDelete = async () => {
        if (deleting) return;
        setDeleting(true);
        try {
            await api.delete(`/api/ai-providers/${provider.id}`);
            window.location.reload();
        } catch (error) {
            console.error('Delete failed:', error);
            setDeleting(false);
        }
    };

    return (
        <div className={`provider-card premium-card ${provider.isActive ? 'active' : ''}`}>
            <div className="provider-card-header">
                <div className="provider-info">
                    <div className="provider-icon-wrapper">
                        {provider.name.toLowerCase().includes('openai') ? (
                            <Zap size={24} className="text-primary" />
                        ) : (
                            <Zap size={24} className="text-secondary" />
                        )}
                    </div>
                    <div>
                        <h3 className="provider-name">{provider.name}</h3>
                        <p className="provider-key">{provider.apiKey}</p>
                    </div>
                </div>
                <div className={`status-badge ${provider.isActive ? 'active' : ''}`}>
                    {provider.isActive ? 'Activo' : 'Inactivo'}
                </div>
            </div>

            <div className="provider-card-footer">
                <div className="provider-actions">
                    <button
                        className="btn-icon-text ghost-blue"
                        onClick={handleTest}
                        disabled={testing}
                        title="Probar conexión"
                    >
                        {testing ? <RefreshCw className="spin" size={18} /> : <Zap size={18} />}
                        <span>Probar</span>
                    </button>

                    {!provider.isActive && (
                        <button
                            className="btn-icon-text ghost-green"
                            onClick={() => activateProvider(provider.id)}
                            title="Activar"
                        >
                            <Power size={18} />
                            <span>Activar</span>
                        </button>
                    )}

                    <button
                        className="btn-icon-text ghost-red"
                        onClick={handleDelete}
                        disabled={deleting}
                        title="Eliminar"
                    >
                        {deleting ? <RefreshCw className="spin" size={18} /> : <Trash2 size={18} />}
                        <span>{deleting ? 'Eliminando...' : 'Eliminar'}</span>
                    </button>
                </div>
            </div>

            {testResult && (
                <div className={`test-feedback ${testResult.success ? 'success' : 'error'}`}>
                    {testResult.success ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
                    <span>{testResult.message}</span>
                </div>
            )}
        </div>
    );
};

export default ProviderCard;
