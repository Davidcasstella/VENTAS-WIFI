import React, { useState } from 'react';
import ChatInterface from '../features/chat/components/ChatInterface';
import PendingAlertsPanel from '../components/ui/PendingAlertsPanel';
import FollowUpPage from './FollowUpPage';
import { MessageSquare, AlertTriangle, Clock } from 'lucide-react';
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
            </div>

            <div className="dashboard-tab-content">
                {dashboardTab === 'users' && <ChatInterface setDashboardTab={setDashboardTab} />}
                {dashboardTab === 'followup' && <FollowUpPage setDashboardTab={setDashboardTab} />}
                {dashboardTab === 'alerts' && <PendingAlertsPanel className="card-warn" setDashboardTab={setDashboardTab} />}
            </div>
        </div>
    );
};

export default DashboardPage;
