import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../../services/api';
import socket from '../../../services/socket';
import ConversationList from './ConversationList';
import ChatWindow from './ChatWindow';
import './ChatInterface.css';

const CUSTOM_NAMES_KEY = 'chatwifi_custom_names';

const loadCustomNames = () => {
    try {
        const raw = localStorage.getItem(CUSTOM_NAMES_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
};

const saveCustomNames = (namesObj) => {
    try {
        localStorage.setItem(CUSTOM_NAMES_KEY, JSON.stringify(namesObj));
    } catch { /* noop */ }
};

const ChatInterface = ({ setDashboardTab }) => {
    const [conversations, setConversations] = useState([]);
    const [activeJid, setActiveJid] = useState(null);
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [customNames, setCustomNames] = useState(loadCustomNames);

    // Ref to track activeJid without re-creating socket listener
    const activeJidRef = useRef(null);
    useEffect(() => {
        activeJidRef.current = activeJid;
    }, [activeJid]);

    // Abort controllers for cancelling stale requests
    const conversationsAbortRef = useRef(null);
    const messagesAbortRef = useRef(null);
    // Track mount state to avoid setting state on unmounted component
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            // Cancel any pending requests on unmount
            if (conversationsAbortRef.current) conversationsAbortRef.current.abort();
            if (messagesAbortRef.current) messagesAbortRef.current.abort();
        };
    }, []);

    // Persist custom names
    useEffect(() => {
        saveCustomNames(customNames);
    }, [customNames]);

    // Add/remove body class so CSS can hide the mobile bottom nav
    useEffect(() => {
        if (activeJid) {
            document.body.classList.add('mobile-chat-open');
        } else {
            document.body.classList.remove('mobile-chat-open');
        }
        // Cleanup on unmount
        return () => document.body.classList.remove('mobile-chat-open');
    }, [activeJid]);

    // ── Mobile back button support ─────────────────────────────────────
    // When a chat is opened, push a history entry so the browser/phone
    // back button returns to the conversation list instead of leaving.
    useEffect(() => {
        const handlePopState = (e) => {
            if (activeJidRef.current) {
                setActiveJid(null);
            }
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);


    // Load conversations on mount
    useEffect(() => {
        loadConversations();
    }, []);

    // Socket.io real-time message listener — mounted ONCE, uses ref for activeJid
    useEffect(() => {
        const handleNewMessage = ({ jid, message }) => {
            // Update conversations list (move to top)
            setConversations(prev => {
                const exists = prev.find(c => c.jid === jid);
                if (exists) {
                    return prev.map(c =>
                        c.jid === jid
                            ? {
                                ...c,
                                lastMessage: message.text,
                                lastMessageTime: message.timestamp,
                                lastMessageFromMe: message.fromMe,
                                unreadCount: c.jid === activeJidRef.current ? 0 : c.unreadCount + (message.fromMe ? 0 : 1)
                            }
                            : c
                    ).sort((a, b) => {
                        const aTime = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0;
                        const bTime = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0;
                        return bTime - aTime;
                    });
                } else {
                    // New conversation
                    return [{
                        jid,
                        pushName: jid.replace(/@.*$/, ''),
                        lastMessage: message.text,
                        lastMessageTime: message.timestamp,
                        lastMessageFromMe: message.fromMe,
                        messageCount: 1,
                        unreadCount: message.fromMe ? 0 : 1
                    }, ...prev];
                }
            });

            // Add message to active chat if it matches — with deduplication by ID
            if (jid === activeJidRef.current) {
                setMessages(prev => {
                    // Deduplicate: skip if message with same ID already exists
                    if (message.id && prev.some(m => m.id === message.id)) {
                        return prev;
                    }
                    return [...prev, message];
                });
            }
        };

        socket.on('chat:message', handleNewMessage);
        return () => socket.off('chat:message', handleNewMessage);
    }, []); // Empty deps: listener is stable, uses refs

    const loadConversations = async (retryCount = 0) => {
        // Cancel any previous in-flight request
        if (conversationsAbortRef.current) {
            conversationsAbortRef.current.abort();
        }
        const abortController = new AbortController();
        conversationsAbortRef.current = abortController;

        try {
            const { data } = await api.get('/api/chat/conversations', {
                signal: abortController.signal
            });
            // Ignore if component unmounted or request was cancelled
            if (!mountedRef.current || abortController.signal.aborted) return;

            const convos = data.data || [];
            setConversations(convos);

            // If we got an empty result and haven't retried yet, wait a moment and retry
            // This handles the edge case where the backend hasn't fully loaded yet
            if (convos.length === 0 && retryCount < 2) {
                setTimeout(() => {
                    if (mountedRef.current) {
                        loadConversations(retryCount + 1);
                    }
                }, 1500);
            }
        } catch (err) {
            // Ignore aborted requests (user navigated away)
            if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return;
            if (!mountedRef.current) return;

            console.error('Error loading conversations:', err);
            // Auto-retry once on network error
            if (retryCount < 1) {
                setTimeout(() => {
                    if (mountedRef.current) {
                        loadConversations(retryCount + 1);
                    }
                }, 2000);
            }
        }
    };

    const selectConversation = useCallback(async (jid) => {
        // Cancel any previous message load
        if (messagesAbortRef.current) {
            messagesAbortRef.current.abort();
        }
        const abortController = new AbortController();
        messagesAbortRef.current = abortController;

        setActiveJid(jid);
        
        // Push state for mobile back button support if not already in chat state
        if (!window.history.state?.chatOpen) {
            window.history.pushState({ chatOpen: true }, '');
        }
        
        setLoading(true);
        try {
            const { data } = await api.get(`/api/chat/messages/${encodeURIComponent(jid)}`, {
                signal: abortController.signal
            });
            // Ignore if this request was superseded by another
            if (abortController.signal.aborted) return;

            setMessages(data.data?.messages || []);
            // Mark as read
            await api.post(`/api/chat/mark-read/${encodeURIComponent(jid)}`);
            setConversations(prev =>
                prev.map(c => c.jid === jid ? { ...c, unreadCount: 0 } : c)
            );
        } catch (err) {
            if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return;
            console.error('Error loading messages:', err);
        } finally {
            if (!abortController.signal.aborted) {
                setLoading(false);
            }
        }
    }, []);

    const sendMessage = useCallback(async (text) => {
        if (!activeJid || !text.trim()) return;
        try {
            await api.post('/api/chat/send', { jid: activeJid, text });
        } catch (err) {
            console.error('Error sending message:', err);
        }
    }, [activeJid]);

    const goBack = () => {
        // Use history.back() so it pops the state we pushed when opening the chat
        if (window.history.state?.chatOpen) {
            window.history.back();
        } else {
            setActiveJid(null);
        }
    };

    const handleDeleteConversation = async (jid) => {
        try {
            await api.delete(`/api/chat/${encodeURIComponent(jid)}`);
            setConversations(prev => prev.filter(c => c.jid !== jid));
            if (activeJid === jid) {
                setActiveJid(null);
                setMessages([]);
            }
        } catch (err) {
            console.error('Error deleting chat:', err);
            alert('Error al eliminar chat');
        }
    };

    const activeConversation = conversations.find(c => c.jid === activeJid);

    const filteredConversations = conversations.filter(c => {
        if (!searchTerm) return true;
        const term = searchTerm.toLowerCase();
        return c.pushName.toLowerCase().includes(term) ||
            c.jid.toLowerCase().includes(term) ||
            (c.lastMessage && c.lastMessage.toLowerCase().includes(term));
    });

    return (
        <div className={`chat-interface ${activeJid ? 'chat-active' : ''}`}>
            <div className="chat-sidebar">
                <ConversationList
                    conversations={filteredConversations}
                    activeJid={activeJid}
                    onSelect={selectConversation}
                    onDelete={handleDeleteConversation}
                    searchTerm={searchTerm}
                    onSearchChange={setSearchTerm}
                    customNames={customNames}
                    setCustomNames={setCustomNames}
                    setDashboardTab={setDashboardTab}
                />
            </div>
            <div className="chat-main">
                {activeJid ? (
                    <ChatWindow
                        jid={activeJid}
                        pushName={customNames[activeJid] || activeConversation?.pushName || activeJid.replace(/@.*$/, '')}
                        messages={messages}
                        loading={loading}
                        onSend={sendMessage}
                        onBack={goBack}
                    />
                ) : (
                    <div className="chat-empty-state">
                        <div className="chat-empty-icon">💬</div>
                        <h3>Selecciona un chat</h3>
                        <p>Elige una conversación para ver los mensajes y responder</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ChatInterface;

