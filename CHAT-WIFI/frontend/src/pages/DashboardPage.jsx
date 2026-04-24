import React, { useState } from 'react';
import ChatInterface from '../features/chat/components/ChatInterface';
import PendingAlertsPanel from '../components/ui/PendingAlertsPanel';
import { MessageSquare, AlertTriangle } from 'lucide-react';
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
    );
};

export default DashboardPage;
