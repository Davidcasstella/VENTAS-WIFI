import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LogIn, Mail, Lock, Loader2, Zap } from 'lucide-react';
import logo from '../Logo/logo.png';
import './LoginPage.css';

const LoginPage = () => {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const { login } = useAuth();
    const [loading, setLoading] = useState(false);

    // Remember user: load saved email from localStorage on mount
    const [rememberUser, setRememberUser] = useState(() => {
        return !!localStorage.getItem('rememberedUser');
    });

    useEffect(() => {
        const savedEmail = localStorage.getItem('rememberedUser');
        if (savedEmail) {
            setEmail(savedEmail);
        }
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        const result = await login(email, password);
        if (result.success) {
            // Remember user: save or clear email in localStorage
            if (rememberUser) {
                localStorage.setItem('rememberedUser', email);
            } else {
                localStorage.removeItem('rememberedUser');
            }
            navigate('/', { replace: true });
        } else {
            setError(result.message);
            setLoading(false);
        }
    };

    return (
        <div className="login-wrapper">
            <div className="login-card premium-card glow-blue">
                <div className="login-header">
                    <img src={logo} alt="CHAT WIFI Logo" className="login-logo-img" />
                    <p>Login Administrativo</p>
                </div>

                <form onSubmit={handleSubmit} className="login-form">
                    <div className="input-field">
                        <Mail size={18} />
                        <input
                            type="email"
                            placeholder="Email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>
                    <div className="input-field">
                        <Lock size={18} />
                        <input
                            type="password"
                            placeholder="Contraseña"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                    </div>

                    {error && <p className="error-msg">{error}</p>}

                    {/* Remember user checkbox */}
                    <div className="remember-user">
                        <input
                            type="checkbox"
                            id="rememberUser"
                            checked={rememberUser}
                            onChange={(e) => setRememberUser(e.target.checked)}
                        />
                        <label htmlFor="rememberUser">Recordar usuario</label>
                    </div>

                    <button type="submit" className="login-btn" disabled={loading}>
                        {loading ? <Loader2 className="spin" /> : 'Ingresar'}
                    </button>
                </form>

                <div className="login-footer">
                    <a href="#">¿Olvidaste tu contraseña?</a>
                    <span className="version">Chat WiFi v1.0</span>
                </div>
            </div>
        </div>
    );
};

export default LoginPage;
