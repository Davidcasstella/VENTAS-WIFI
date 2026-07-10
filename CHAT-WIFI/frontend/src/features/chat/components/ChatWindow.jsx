import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ArrowLeft, Send, Loader2, Power, RotateCcw, CheckCheck, Paperclip, Mic, X } from 'lucide-react';

import api from '../../../services/api';
import GrantAccessPanel from './GrantAccessPanel';

// Backend base URL — same logic as api.js
const BACKEND_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : window.location.origin;

const ChatWindow = ({ jid, pushName, messages, loading, onSend, onBack }) => {
    const [inputText, setInputText] = useState('');
    const [sending, setSending] = useState(false);
    const [aiEnabled, setAiEnabled] = useState(true);
    const [toggling, setToggling] = useState(null);
    const [toast, setToast] = useState(null);
    const messagesContainerRef = useRef(null);
    const inputRef = useRef(null);

    // Media upload state
    const [selectedFile, setSelectedFile] = useState(null);     // File object
    const [filePreview, setFilePreview] = useState(null);       // Preview URL
    const [caption, setCaption] = useState('');
    const [uploadingMedia, setUploadingMedia] = useState(false);
    const fileInputRef = useRef(null);

    // Audio recording state
    const [isRecording, setIsRecording] = useState(false);
    const [recordingDuration, setRecordingDuration] = useState(0);
    const mediaRecorderRef = useRef(null);
    const audioChunksRef = useRef([]);
    const recordingTimerRef = useRef(null);
    const streamRef = useRef(null);

    // Lightbox state
    const [lightboxSrc, setLightboxSrc] = useState(null);

    // Follow-up timer state
    const [followUpData, setFollowUpData] = useState(null);
    const [timeLeftStr, setTimeLeftStr] = useState('');

    // Load user state when JID changes
    useEffect(() => {
        if (!jid) return;
        const loadUserState = async () => {
            try {
                const { data } = await api.get('/api/welcome-automation/users');
                const users = data.data || [];
                const user = users.find(u => u.jid === jid);
                if (user) {
                    setAiEnabled(user.aiEnabled);
                }
            } catch (_) { }
        };
        loadUserState();
    }, [jid]);

    // Profile picture state
    const [profilePicUrl, setProfilePicUrl] = useState(null);

    useEffect(() => {
        if (!jid) return;
        setProfilePicUrl(null); // Reset when changing chat
        const fetchPic = async () => {
            try {
                const res = await fetch(`${BACKEND_URL}/api/chat/profile-pic/${encodeURIComponent(jid)}`);
                const data = await res.json();
                if (data.url) setProfilePicUrl(data.url);
            } catch (_) { /* ignore */ }
        };
        fetchPic();
    }, [jid]);

    // Load follow-up state for timer
    useEffect(() => {
        if (!jid) return;
        const loadFollowUpData = async () => {
            try {
                const [configRes, statesRes] = await Promise.all([
                    api.get('/api/follow-up/config'),
                    api.get('/api/follow-up/states')
                ]);
                const config = configRes.data.config;
                const state = statesRes.data.states?.find(s => s.jid === jid);

                if (config && state && state.status === 'active' && config.globalEnabled) {
                    const enabledSteps = config.steps.filter(s => s.enabled);
                    const stepIdx = state.currentStepIndex || 0;
                    if (stepIdx < enabledSteps.length) {
                        const step = enabledSteps[stepIdx];
                        const referenceTime = state.lastStepSentAt
                            ? new Date(state.lastStepSentAt).getTime()
                            : new Date(state.anchorAt || state.startedAt).getTime();
                        const targetTime = referenceTime + (step.delayMinutes * 60000);
                        setFollowUpData({ targetTime });
                    } else {
                        setFollowUpData(null);
                    }
                } else {
                    setFollowUpData(null);
                }
            } catch (err) {
                console.error('Error loading follow-up data:', err);
            }
        };
        loadFollowUpData();
    }, [jid]);

    // Timer updater
    useEffect(() => {
        if (!followUpData) {
            setTimeLeftStr('');
            return;
        }
        const updateTimer = () => {
            const now = Date.now();
            const diff = followUpData.targetTime - now;
            if (diff <= 0) {
                setTimeLeftStr('Enviando ahora...');
            } else {
                const minutes = Math.floor(diff / 60000);
                const hours = Math.floor(minutes / 60);
                const days = Math.floor(hours / 24);
                if (days > 0) {
                    setTimeLeftStr(`Próximo msg en ${days}d ${hours % 24}h`);
                } else if (hours > 0) {
                    setTimeLeftStr(`Próximo msg en ${hours}h ${minutes % 60}m`);
                } else {
                    setTimeLeftStr(`Próximo msg en ${minutes}m`);
                }
            }
        };
        updateTimer();
        const interval = setInterval(updateTimer, 60000); // update every minute
        return () => clearInterval(interval);
    }, [followUpData]);

    // Scroll helper — scrolls the messages container to the very bottom
    const scrollToBottom = useCallback(() => {
        if (messagesContainerRef.current) {
            messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
    }, []);

    // Scroll to bottom when a new chat is opened (jid changes) or loading finishes
    useEffect(() => {
        if (!jid || loading) return;
        scrollToBottom();
        requestAnimationFrame(scrollToBottom);
        const t1 = setTimeout(scrollToBottom, 150);
        const t2 = setTimeout(scrollToBottom, 400);
        return () => { clearTimeout(t1); clearTimeout(t2); };
    }, [jid, loading, scrollToBottom]);

    // Scroll to bottom when new messages arrive
    useEffect(() => {
        requestAnimationFrame(scrollToBottom);
        const t = setTimeout(scrollToBottom, 200);
        return () => clearTimeout(t);
    }, [messages, scrollToBottom]);

    // Scroll to bottom when file preview panel appears/disappears (it changes the layout height)
    useEffect(() => {
        const t = setTimeout(scrollToBottom, 50);
        return () => clearTimeout(t);
    }, [selectedFile, isRecording, scrollToBottom]);

    // Cleanup file preview URL on unmount or change
    useEffect(() => {
        return () => {
            if (filePreview) URL.revokeObjectURL(filePreview);
        };
    }, [filePreview]);

    // No auto-focus on chat open — prevents mobile keyboard from popping up

    const showToast = (type, msg) => {
        setToast({ type, msg });
        setTimeout(() => setToast(null), 3000);
    };

    // ── Text send ──
    const handleSend = async () => {
        if (!inputText.trim() || sending) return;
        const text = inputText.trim();
        setInputText('');
        setSending(true);
        try {
            await onSend(text);
        } finally {
            setSending(false);
            if (window.innerWidth > 768) {
                inputRef.current?.focus();
            }
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    // ── File selection ──
    const handleFileSelect = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate size (64MB)
        if (file.size > 64 * 1024 * 1024) {
            showToast('error', 'Archivo muy grande (máx 64MB)');
            return;
        }

        setSelectedFile(file);
        setCaption('');

        // Generate preview for images/videos
        if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
            const url = URL.createObjectURL(file);
            setFilePreview(url);
        } else {
            setFilePreview(null);
        }
    };

    const cancelFileSelection = () => {
        setSelectedFile(null);
        if (filePreview) URL.revokeObjectURL(filePreview);
        setFilePreview(null);
        setCaption('');
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const sendMedia = async () => {
        if (!selectedFile || uploadingMedia) return;
        setUploadingMedia(true);
        try {
            const formData = new FormData();
            formData.append('jid', jid);
            formData.append('file', selectedFile);
            if (caption.trim()) formData.append('caption', caption.trim());

            await api.post('/api/chat/send-media', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            showToast('success', 'Media enviado');
            cancelFileSelection();
        } catch (err) {
            console.error('Error sending media:', err);
            showToast('error', 'Error al enviar media');
        } finally {
            setUploadingMedia(false);
        }
    };

    // ── Audio recording ──
    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            audioChunksRef.current = [];

            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                    ? 'audio/webm;codecs=opus'
                    : 'audio/webm'
            });
            mediaRecorderRef.current = mediaRecorder;

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunksRef.current.push(e.data);
            };

            mediaRecorder.onstop = async () => {
                // Stop all tracks
                stream.getTracks().forEach(t => t.stop());
                streamRef.current = null;

                // Use the actual mimeType from the recorder for the Blob
                const recorderMime = mediaRecorder.mimeType || 'audio/webm';
                const audioBlob = new Blob(audioChunksRef.current, { type: recorderMime });
                if (audioBlob.size < 500) {
                    showToast('error', 'Audio muy corto');
                    return;
                }

                // Send the audio
                setUploadingMedia(true);
                try {
                    const formData = new FormData();
                    formData.append('jid', jid);
                    // Send as .webm — backend will handle format for WhatsApp
                    formData.append('file', audioBlob, 'voice-note.webm');

                    await api.post('/api/chat/send-media', formData, {
                        headers: { 'Content-Type': 'multipart/form-data' }
                    });
                    showToast('success', 'Audio enviado');
                } catch (err) {
                    console.error('Error sending audio:', err);
                    const errMsg = err.response?.data?.message || 'Error al enviar audio';
                    showToast('error', errMsg);
                } finally {
                    setUploadingMedia(false);
                }

            };

            mediaRecorder.start(250); // Collect data every 250ms
            setIsRecording(true);
            setRecordingDuration(0);

            // Duration timer
            recordingTimerRef.current = setInterval(() => {
                setRecordingDuration(prev => prev + 1);
            }, 1000);

        } catch (err) {
            console.error('Microphone access denied:', err);
            showToast('error', 'No se pudo acceder al micrófono');
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
        setIsRecording(false);
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
    };

    const cancelRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.ondataavailable = null; // Prevent data collection
            mediaRecorderRef.current.onstop = null; // Prevent send
            mediaRecorderRef.current.stop();
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        setIsRecording(false);
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
        audioChunksRef.current = [];
    };

    const formatDuration = (seconds) => {
        const m = Math.floor(seconds / 60).toString().padStart(2, '0');
        const s = (seconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };

    // ── User control actions ──
    const toggleAI = async () => {
        setToggling('ai');
        try {
            await api.put(`/api/welcome-automation/users/${encodeURIComponent(jid)}/ai`, {
                enabled: !aiEnabled
            });
            setAiEnabled(!aiEnabled);
            showToast('success', `IA ${!aiEnabled ? 'activada' : 'desactivada'}`);
        } catch {
            showToast('error', 'Error al cambiar IA');
        } finally {
            setToggling(null);
        }
    };

    const resetCooldown = async () => {
        setToggling('reset');
        try {
            await api.post('/api/welcome-automation/reset-user', { jid });
            showToast('success', 'Cooldown reseteado — bienvenida se enviará de nuevo');
        } catch {
            showToast('error', 'Error al resetear cooldown');
        } finally {
            setToggling(null);
        }
    };

    const formatTime = (isoStr) => {
        if (!isoStr) return '';
        return new Date(isoStr).toLocaleTimeString('es-ES', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const formatDateSeparator = (isoStr) => {
        const d = new Date(isoStr);
        const now = new Date();
        if (d.toDateString() === now.toDateString()) return 'Hoy';
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (d.toDateString() === yesterday.toDateString()) return 'Ayer';
        return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    };

    // Group messages by date
    const groupedMessages = [];
    let lastDate = '';
    messages.forEach(msg => {
        const msgDate = new Date(msg.timestamp).toDateString();
        if (msgDate !== lastDate) {
            groupedMessages.push({ type: 'date', date: msg.timestamp });
            lastDate = msgDate;
        }
        groupedMessages.push({ type: 'message', ...msg });
    });

    const isLid = jid && jid.includes('@lid');
    const rawNumber = jid ? jid.replace(/@.*$/, '').replace(/:\d+$/, '') : '';
    const displaySubtitle = isLid ? '' : `+${rawNumber}`;

    // Helper to build media URL pointing to the backend server
    const mediaUrl = (mediaId) => `${BACKEND_URL}/api/chat/media/${mediaId}`;

    // ── Render a media bubble ──
    const renderMediaContent = (item) => {
        if (!item.mediaId) return null;

        const url = mediaUrl(item.mediaId);

        if (item.mediaType === 'image') {
            return (
                <div className="chat-media-container">
                    <img
                        src={url}
                        alt="Imagen"
                        className="chat-media-image"
                        loading="lazy"
                        onClick={() => setLightboxSrc(url)}
                    />
                </div>
            );
        }

        if (item.mediaType === 'audio') {
            return (
                <div className="chat-media-container chat-media-audio">
                    <audio
                        controls
                        preload="metadata"
                        className="chat-audio-player"
                        src={url}
                        crossOrigin="anonymous"
                    >
                        Tu navegador no soporta audio.
                    </audio>
                </div>
            );
        }

        if (item.mediaType === 'video') {
            return (
                <div className="chat-media-container">
                    <video
                        controls
                        preload="metadata"
                        className="chat-media-video"
                        src={url}
                        crossOrigin="anonymous"
                    >
                        Tu navegador no soporta video.
                    </video>
                </div>
            );
        }


        return null;
    };

    return (
        <div className="chat-window">
            {/* Toast */}
            {toast && (
                <div className={`chat-toast ${toast.type === 'success' ? 'chat-toast-ok' : 'chat-toast-err'}`}>
                    {toast.msg}
                </div>
            )}

            {/* Lightbox */}
            {lightboxSrc && (
                <div className="chat-lightbox" onClick={() => setLightboxSrc(null)}>
                    <button className="chat-lightbox-close" onClick={() => setLightboxSrc(null)}>
                        <X size={24} />
                    </button>
                    <img src={lightboxSrc} alt="Vista completa" className="chat-lightbox-img" />
                </div>
            )}

            {/* Header */}
            <div className="chat-window-header">
                <button className="chat-back-btn" onClick={onBack}>
                    <ArrowLeft size={20} />
                </button>
                <div className="chat-header-avatar">
                    {profilePicUrl ? (
                        <img
                            src={profilePicUrl}
                            alt=""
                            className="chat-header-avatar-img"
                            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                        />
                    ) : null}
                    <span className="chat-header-avatar-initial" style={profilePicUrl ? { display: 'none' } : {}}>
                        {(pushName || '?').charAt(0).toUpperCase()}
                    </span>
                </div>
                <div className="chat-header-info">
                    <span className="chat-header-name">{pushName}</span>
                    <span className="chat-header-number">
                        {displaySubtitle}
                        {timeLeftStr && (
                            <span style={{ color: '#40d080', fontSize: '0.85em', marginLeft: '6px', fontWeight: '500' }}>
                                • ⏱️ {timeLeftStr}
                            </span>
                        )}
                    </span>
                </div>

                {/* User control buttons */}
                <div className="chat-header-controls">
                    <button
                        className={`chat-ctrl-btn ${aiEnabled ? 'chat-ctrl-on' : 'chat-ctrl-off'}`}
                        onClick={toggleAI}
                        disabled={toggling === 'ai'}
                        title={aiEnabled ? 'Desactivar IA' : 'Reactivar IA'}
                    >
                        <Power size={14} />
                        <span className="chat-ctrl-label">{aiEnabled ? 'IA ON' : 'IA OFF'}</span>
                    </button>

                    <button
                        className="chat-ctrl-btn chat-ctrl-reset"
                        onClick={resetCooldown}
                        disabled={toggling === 'reset'}
                        title="Resetear cooldown — reactivar bienvenida 24H"
                    >
                        <RotateCcw size={14} />
                        <span className="chat-ctrl-label">Reset</span>
                    </button>
                </div>
            </div>

            {/* Manual Grant Access Panel */}
            <GrantAccessPanel jid={jid} />

            {/* Messages area */}
            <div className="chat-messages" ref={messagesContainerRef}>
                {loading ? (
                    <div className="chat-loading">
                        <Loader2 size={24} className="chat-spin" />
                        <span>Cargando mensajes...</span>
                    </div>
                ) : groupedMessages.length === 0 ? (
                    <div className="chat-no-messages">
                        <p>No hay mensajes aún</p>
                    </div>
                ) : (
                    groupedMessages.map((item, i) => {
                        if (item.type === 'date') {
                            return (
                                <div key={`date-${i}`} className="chat-date-separator">
                                    <span>{formatDateSeparator(item.date)}</span>
                                </div>
                            );
                        }

                        const hasMedia = !!item.mediaId;
                        const hasText = item.text && item.text !== '[media]' && item.text !== `[${item.mediaType}]` && item.text !== '[image]' && item.text !== '[audio]' && item.text !== '[video]';

                        return (
                            <div
                                key={item.id || i}
                                className={`chat-bubble ${item.fromMe ? 'chat-bubble-out' : 'chat-bubble-in'} ${hasMedia ? 'chat-bubble-media' : ''}`}
                            >
                                {hasMedia && renderMediaContent(item)}
                                {hasText && <span className="chat-bubble-text">{item.text}</span>}
                                {!hasMedia && !hasText && <span className="chat-bubble-text">{item.text}</span>}
                                <span className="chat-bubble-time">
                                    {formatTime(item.timestamp)}
                                    {item.fromMe && <span className="chat-bubble-check"> <CheckCheck size={14} /></span>}
                                </span>
                            </div>
                        );
                    })
                )}
            </div>

            {/* File preview panel */}
            {selectedFile && (
                <div className="chat-file-preview">
                    <div className="chat-file-preview-header">
                        <span className="chat-file-preview-name">
                            <Paperclip size={14} />
                            {selectedFile.name}
                            <span className="chat-file-preview-size">
                                ({(selectedFile.size / 1024).toFixed(0)} KB)
                            </span>
                        </span>
                        <button className="chat-file-preview-close" onClick={cancelFileSelection}>
                            <X size={16} />
                        </button>
                    </div>
                    {filePreview && selectedFile.type.startsWith('image/') && (
                        <img src={filePreview} alt="Preview" className="chat-file-preview-img" />
                    )}
                    {filePreview && selectedFile.type.startsWith('video/') && (
                        <video src={filePreview} className="chat-file-preview-video" controls />
                    )}
                    <div className="chat-file-preview-actions">
                        <input
                            type="text"
                            className="chat-file-caption-input"
                            placeholder="Añadir descripción..."
                            value={caption}
                            onChange={e => setCaption(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') sendMedia(); }}
                        />
                        <button
                            className="chat-send-btn chat-send-media-btn"
                            onClick={sendMedia}
                            disabled={uploadingMedia}
                        >
                            {uploadingMedia ? <Loader2 size={18} className="chat-spin" /> : <Send size={18} />}
                        </button>
                    </div>
                </div>
            )}

            {/* Input area */}
            <div className="chat-input-bar">
                {/* Hidden file input */}
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,video/*"
                    style={{ display: 'none' }}
                    onChange={handleFileSelect}
                />

                {isRecording ? (
                    /* Recording mode */
                    <div className="chat-recording-bar">
                        <button className="chat-recording-cancel" onClick={cancelRecording} title="Cancelar">
                            <X size={18} />
                        </button>
                        <div className="chat-recording-indicator">
                            <span className="chat-recording-dot"></span>
                            <span className="chat-recording-time">{formatDuration(recordingDuration)}</span>
                        </div>
                        <button className="chat-recording-stop" onClick={stopRecording} title="Enviar audio">
                            <Send size={18} />
                        </button>
                    </div>
                ) : (
                    /* Normal mode */
                    <>
                        <button
                            className="chat-attach-btn"
                            onClick={() => fileInputRef.current?.click()}
                            title="Adjuntar imagen o video"
                            disabled={sending || uploadingMedia}
                        >
                            <Paperclip size={18} />
                        </button>

                        <input
                            ref={inputRef}
                            type="text"
                            className="chat-input"
                            placeholder="Escribe un mensaje..."
                            value={inputText}
                            onChange={e => setInputText(e.target.value)}
                            onKeyDown={handleKeyDown}
                            disabled={sending || uploadingMedia}
                        />

                        {inputText.trim() ? (
                            <button
                                className="chat-send-btn"
                                onClick={handleSend}
                                disabled={!inputText.trim() || sending}
                            >
                                {sending ? <Loader2 size={18} className="chat-spin" /> : <Send size={18} />}
                            </button>
                        ) : (
                            <button
                                className="chat-mic-btn"
                                onClick={startRecording}
                                disabled={uploadingMedia}
                                title="Grabar audio"
                            >
                                <Mic size={18} />
                            </button>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default ChatWindow;
