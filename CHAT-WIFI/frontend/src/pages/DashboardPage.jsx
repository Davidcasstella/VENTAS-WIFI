import React, { useState, useEffect } from 'react';
import api from '../services/api';
import socket from '../services/socket';
import AIStatusModule from '../components/ui/AIStatusModule';
import ClientsMetricCard from '../components/ui/ClientsMetricCard';
import ActivityChart from '../components/ui/ActivityChart';
import TokenUsageModule from '../components/ui/TokenUsageModule';
import CostControlModule from '../components/ui/CostControlModule';

const DashboardPage = () => {
    // AI master switch state — kept identical to the original logic
    const [aiEnabled, setAiEnabled] = useState(true);
    const [aiLoading, setAiLoading] = useState(false);

    useEffect(() => {
        // Fetch current AI state on mount
        const fetchAiStatus = async () => {
            try {
                const { data } = await api.get('/api/ai/status');
                setAiEnabled(data.enabled);
            } catch (error) {
                console.error('Error fetching AI status:', error);
            }
        };

        fetchAiStatus();

        // Listen for real-time AI state changes (from other tabs or admin changes)
        socket.on('ai-status', (data) => {
            setAiEnabled(data.enabled);
        });

        return () => {
            socket.off('ai-status');
        };
    }, []);

    const toggleAI = async () => {
        if (aiLoading) return;
        setAiLoading(true);
        try {
            const { data } = await api.post('/api/ai/toggle');
            setAiEnabled(data.enabled);
        } catch (error) {
            console.error('Error toggling AI:', error);
        } finally {
            setAiLoading(false);
        }
    };

    return (
        <div className="dashboard-content analytics-dashboard">
            {/* ── Page Header ── */}
            <header className="analytics-page-header">
                <div>
                    <h1 className="analytics-page-title">Centro de Control IA</h1>
                    <p className="analytics-page-sub">
                        Panel analítico en tiempo real · {new Date().toLocaleDateString('es-ES', {
                            weekday: 'long', day: 'numeric', month: 'long'
                        })}
                    </p>
                </div>
                <div className="analytics-live-badge">
                    <span className="live-dot" />
                    LIVE
                </div>
            </header>

            {/* ── Row 1: AI Status (full width) ── */}
            <AIStatusModule
                aiEnabled={aiEnabled}
                aiLoading={aiLoading}
                onToggle={toggleAI}
            />

            {/* ── Row 2: Metrics grid (3 columns) ── */}
            <div className="analytics-metrics-grid">
                <ClientsMetricCard />
                <TokenUsageModule />
                <CostControlModule />
            </div>

            {/* ── Row 3: Activity Chart (full width) ── */}
            <ActivityChart />
        </div>
    );
};

export default DashboardPage;
