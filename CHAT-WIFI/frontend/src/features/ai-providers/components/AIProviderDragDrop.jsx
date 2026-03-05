import React, { useState, useRef } from 'react';
import { GripVertical, ArrowRight, Zap, Target, Layers } from 'lucide-react';
import useProvidersStore from '../store/useProvidersStore';
import './AIProviderDragDrop.css';

/**
 * Returns a CSS class for the provider icon based on the provider name.
 */
const getProviderIconClass = (name) => {
    const n = name.toLowerCase();
    if (n.includes('openai') || n.includes('chatgpt')) return 'dnd-icon-openai';
    if (n.includes('gemini') || n.includes('google')) return 'dnd-icon-gemini';
    if (n.includes('groq') || n.includes('grog')) return 'dnd-icon-groq';
    if (n.includes('grok') || n.includes('xai')) return 'dnd-icon-grok';
    if (n.includes('z.ia') || n.includes('propio')) return 'dnd-icon-zia';
    return 'dnd-icon-default';
};

/**
 * Returns a short label for the provider icon.
 */
const getProviderLabel = (name) => {
    const n = name.toLowerCase();
    if (n.includes('openai') || n.includes('chatgpt')) return 'GPT';
    if (n.includes('gemini') || n.includes('google')) return 'GEM';
    if (n.includes('groq') || n.includes('grog')) return 'GRQ';
    if (n.includes('grok') || n.includes('xai')) return 'GRK';
    if (n.includes('z.ia')) return 'Z.ia';
    return 'AI';
};

const AIProviderDragDrop = () => {
    const { providers, activateProvider } = useProvidersStore();
    const [dragOverActive, setDragOverActive] = useState(false);
    const [draggingId, setDraggingId] = useState(null);
    const dropRef = useRef(null);

    const activeProvider = providers.find(p => p.isActive) || null;
    const inactiveProviders = providers.filter(p => !p.isActive);

    // ── Drag handlers ──

    const handleDragStart = (e, provider) => {
        e.dataTransfer.setData('text/plain', provider.id);
        e.dataTransfer.effectAllowed = 'move';
        setDraggingId(provider.id);
    };

    const handleDragEnd = () => {
        setDraggingId(null);
        setDragOverActive(false);
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverActive(true);
    };

    const handleDragLeave = (e) => {
        // Only reset if leaving the drop zone entirely (not entering a child)
        if (dropRef.current && !dropRef.current.contains(e.relatedTarget)) {
            setDragOverActive(false);
        }
    };

    const handleDrop = async (e) => {
        e.preventDefault();
        setDragOverActive(false);
        setDraggingId(null);

        const providerId = e.dataTransfer.getData('text/plain');
        if (providerId && providerId !== activeProvider?.id) {
            await activateProvider(providerId);
        }
    };

    // If no providers exist at all, don't render
    if (providers.length === 0) return null;

    return (
        <div className="dnd-container premium-card" style={{ padding: '1.25rem' }}>
            <div className="dnd-title-row">
                <Layers size={18} />
                <h3>Selector de IA — Drag & Drop</h3>
            </div>

            <div className="dnd-layout">
                {/* LEFT: Available providers */}
                <div className="dnd-section dnd-section-available">
                    <div className="dnd-section-label">
                        <Zap size={12} />
                        <span>IAs Disponibles</span>
                    </div>

                    {inactiveProviders.length === 0 ? (
                        <div className="dnd-available-empty">
                            Todas las IAs están inactivas o solo hay una registrada.
                        </div>
                    ) : (
                        inactiveProviders.map(provider => (
                            <div
                                key={provider.id}
                                className={`dnd-card ${draggingId === provider.id ? 'dragging' : ''}`}
                                draggable
                                onDragStart={(e) => handleDragStart(e, provider)}
                                onDragEnd={handleDragEnd}
                            >
                                <div className={`dnd-card-icon ${getProviderIconClass(provider.name)}`}>
                                    {getProviderLabel(provider.name)}
                                </div>
                                <div className="dnd-card-info">
                                    <span className="dnd-card-name">{provider.name}</span>
                                    <span className="dnd-card-key">{provider.apiKey}</span>
                                </div>
                                <GripVertical size={16} className="dnd-card-grip" />
                            </div>
                        ))
                    )}
                </div>

                {/* RIGHT: Active drop zone */}
                <div
                    ref={dropRef}
                    className={`dnd-section dnd-section-active ${dragOverActive ? 'drag-over' : ''}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    <div className="dnd-section-label">
                        <Target size={12} />
                        <span>IA Activa</span>
                    </div>

                    {activeProvider ? (
                        <div className="dnd-active-card">
                            <div className={`dnd-card-icon ${getProviderIconClass(activeProvider.name)}`}>
                                {getProviderLabel(activeProvider.name)}
                            </div>
                            <div className="dnd-card-info">
                                <span className="dnd-card-name">{activeProvider.name}</span>
                                <span className="dnd-card-key">{activeProvider.apiKey}</span>
                            </div>
                            <div className="dnd-active-badge">
                                <span className="dnd-active-pulse" />
                                LIVE
                            </div>
                        </div>
                    ) : (
                        <div className="dnd-drop-empty">
                            <ArrowRight size={28} />
                            <span>Arrastra una IA aquí para activarla</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AIProviderDragDrop;
