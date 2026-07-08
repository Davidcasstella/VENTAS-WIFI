import React, { useState } from 'react';
import ChatInterface from '../features/chat/components/ChatInterface';
import PendingAlertsPanel from '../components/ui/PendingAlertsPanel';
import FollowUpPage from './FollowUpPage';
import AIRulesPage from './AIRulesPage';
import { MessageSquare, AlertTriangle, Clock, ScrollText } from 'lucide-react';
import '../styles/cyber-neon.css';

const DashboardPage = () => {
    const [dashboardTab, setDashboardTab] = useState('users');

    return (
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
                    className={`dashboard-tab-btn ${dashboardTab === 'followup' ? 'active' : ''}`}
                    onClick={() => setDashboardTab('followup')}
                >
                    <Clock size={18} />
                    <span>Seguimiento</span>
                </button>
                <button
                    className={`dashboard-tab-btn ${dashboardTab === 'alerts' ? 'active' : ''}`}
                    onClick={() => setDashboardTab('alerts')}
                >
                    <AlertTriangle size={18} />
                    <span>Alertas Pendientes</span>
                </button>
                <button
                    className={`dashboard-tab-btn ${dashboardTab === 'ai-rules' ? 'active' : ''}`}
                    onClick={() => setDashboardTab('ai-rules')}
                >
                    <ScrollText size={18} />
                    <span>Reglas IA</span>
                </button>
            </div>

            <div className="dashboard-tab-content">
                <div style={{ display: dashboardTab === 'users' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
                    <ChatInterface setDashboardTab={setDashboardTab} />
                </div>
                <div style={{ display: dashboardTab === 'followup' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
                    <FollowUpPage setDashboardTab={setDashboardTab} />
                </div>
                <div style={{ display: dashboardTab === 'alerts' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
                    <PendingAlertsPanel className="card-warn" setDashboardTab={setDashboardTab} />
                </div>
                <div style={{ display: dashboardTab === 'ai-rules' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column', overflowY: 'auto' }}>
                    <AIRulesPage />
                </div>
            </div>
        </div>
    );
};

export default DashboardPage;
