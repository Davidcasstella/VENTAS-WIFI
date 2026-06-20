import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LayoutDashboard, LogOut, QrCode, BrainCircuit, BookOpen, ShieldBan, BellRing, ScrollText, Mail, HardDrive } from 'lucide-react';
import api from '../services/api';
import logo from '../Logo/logo.png';
import Header from '../components/ui/Header';
import './Layout.css';

const DashboardLayout = () => {
    const { logout, user } = useAuth();
    const navigate = useNavigate();
    const [blockedCount, setBlockedCount] = useState(0);

    useEffect(() => {
        api.get('/api/blocked-numbers')
            .then(({ data }) => setBlockedCount(data.count || 0))
            .catch(() => { });
    }, []);

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    // On mobile: add body class when on the chat/dashboard route
    // so we can hide the header and reclaim that vertical space
    const location = useLocation();
    useEffect(() => {
        const isChatRoute = location.pathname === '/';
        if (isChatRoute) {
            document.body.classList.add('mobile-on-chat');
        } else {
            document.body.classList.remove('mobile-on-chat');
        }
        return () => document.body.classList.remove('mobile-on-chat');
    }, [location.pathname]);

    return (
        <div className="layout-container">
            <aside className="sidebar">
                <div className="sidebar-header">
                    <img src={logo} alt="CHAT WIFI Logo" className="logo-img-sidebar" />
                </div>

                <nav className="sidebar-nav">
                    <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} end>
                        <LayoutDashboard size={18} />
                        <span>Dashboard</span>
                    </NavLink>

                    <NavLink to="/welcome-automation" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <BellRing size={18} />
                        <span>Bienvenida 24H</span>
                    </NavLink>

                    <NavLink to="/knowledge-base" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <BookOpen size={18} />
                        <span>Conocimiento</span>
                    </NavLink>

                    <NavLink to="/whatsapp" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <QrCode size={18} />
                        <span>WhatsApp</span>
                    </NavLink>

                    <NavLink to="/ai-providers" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <BrainCircuit size={18} />
                        <span>IA Providers</span>
                    </NavLink>

                    <NavLink to="/blocked-numbers" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <ShieldBan size={18} />
                        <span>Bloqueados</span>
                        {blockedCount > 0 && (
                            <span className="bn-sidebar-badge">{blockedCount}</span>
                        )}
                    </NavLink>

                    <NavLink to="/ai-rules" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <ScrollText size={18} />
                        <span>Reglas de IA</span>
                    </NavLink>

                    <NavLink to="/course-access" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <Mail size={18} />
                        <span>Acceso Cursos</span>
                    </NavLink>

                    <NavLink to="/emails" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <HardDrive size={18} />
                        <span>Correos y Drive</span>
                    </NavLink>


                    <button onClick={handleLogout} className="nav-item logout-nav-link" style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                        <LogOut size={18} />
                        <span>Salir</span>
                    </button>
                </nav>

                <div className="sidebar-footer">
                    <div className="user-info-side">
                        <div className="user-details">
                            <span className="user-name">Admin</span>
                        </div>
                    </div>
                </div>
            </aside>

            <div className="content-wrapper">
                <Header />
                <main className="main-content">
                    <Outlet />
                </main>
            </div>

            {/* Mobile Bottom Navigation - Only visible via CSS on < 768px */}
            <nav className="mobile-bottom-nav">
                <NavLink to="/" className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`} end>
                    <LayoutDashboard size={20} />
                    <span>Inicio</span>
                </NavLink>

                <NavLink to="/welcome-automation" className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}>
                    <BellRing size={20} />
                    <span>24H</span>
                </NavLink>

                <NavLink to="/knowledge-base" className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}>
                    <BookOpen size={20} />
                    <span>Base</span>
                </NavLink>

                <NavLink to="/whatsapp" className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}>
                    <QrCode size={20} />
                    <span>WhatsApp</span>
                </NavLink>

                <NavLink to="/ai-providers" className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}>
                    <BrainCircuit size={20} />
                    <span>IA</span>
                </NavLink>

                <NavLink to="/blocked-numbers" className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}>
                    <ShieldBan size={20} />
                    <span>Bloqueados</span>
                </NavLink>

                <NavLink to="/ai-rules" className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}>
                    <ScrollText size={20} />
                    <span>Reglas IA</span>
                </NavLink>

                <NavLink to="/course-access" className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}>
                    <Mail size={20} />
                    <span>Acceso</span>
                </NavLink>

                <NavLink to="/emails" className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}>
                    <HardDrive size={20} />
                    <span>Drive</span>
                </NavLink>


                <button onClick={handleLogout} className="mobile-nav-item" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                    <LogOut size={20} />
                    <span>Salir</span>
                </button>
            </nav>
        </div>
    );
};

export default DashboardLayout;
