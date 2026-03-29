import React, { useState, useEffect } from 'react';
import api from '../services/api';
import socket from '../services/socket';
import AIStatusModule from '../components/ui/AIStatusModule';
import ChatInterface from '../features/chat/components/ChatInterface';
import PendingAlertsPanel from '../components/ui/PendingAlertsPanel';
import ClientsMetricCard from '../components/ui/ClientsMetricCard';
import ActivityChart from '../components/ui/ActivityChart';
import TokenUsageModule from '../components/ui/TokenUsageModule';
import CostControlModule from '../components/ui/CostControlModule';
import { MessageSquare, AlertTriangle } from 'lucide-react';

const DashboardPage = () => {
    // AI master switch state — kept identical to the original logic
    const [aiEnabled, setAiEnabled] = useState(true);
    const [aiLoading, setAiLoading] = useState(false);
    const [dashboardTab, setDashboardTab] = useState('users');

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

            {/* ── Tabbed panels — Users / Alerts (TOP) ── */}
            <div className="dashboard-tabs-section">
                <div className="dashboard-tabs">
                    <button
                        className={`dashboard-tab-btn ${dashboardTab === 'users' ? 'active' : ''}`}
                        onClick={() => setDashboardTab('users')}
                    >
                        <MessageSquare size={18} />
                        <span>Chats</span>
                    </button>
                    <button
                        className={`dashboard-tab-btn ${dashboardTab === 'alerts' ? 'active' : ''}`}
                        onClick={() => setDashboardTab('alerts')}
                    >
                        <AlertTriangle size={18} />
                        <span>Alertas Pendientes</span>
                    </button>
                </div>

                <div className="dashboard-tab-content">
                    {dashboardTab === 'users' && <ChatInterface />}
                    {dashboardTab === 'alerts' && <PendingAlertsPanel className="card-warn" />}
                </div>
            </div>

            <div className="metrics-grid">
                <div className="metric-card-wrapper">
                    <ClientsMetricCard className="card-blue" />
                </div>
                <div className="metric-card-wrapper">
                    <AIStatusModule
                        aiEnabled={aiEnabled}
                        aiLoading={aiLoading}
                        onToggle={toggleAI}
                    />
                </div>
            </div>

            <div className="stats-row">
                <div className="stat-card-container">
                    <TokenUsageModule className="card-blue" />
                </div>
                <div className="stat-card-container">
                    <CostControlModule className="card-blue" />
                </div>
            </div>

            {/* ── Activity Chart (full width) ── */}
            <ActivityChart />
        </div>
    );
};

export default DashboardPage;
