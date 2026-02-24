import React, { useState } from 'react';
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

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        const result = await login(email, password);
        if (result.success) {
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
