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
                        pushName: jid.replace('@s.whatsapp.net', ''),
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

    const loadConversations = async () => {
        try {
            const { data } = await api.get('/api/chat/conversations');
            setConversations(data.data || []);
        } catch (err) {
            console.error('Error loading conversations:', err);
        }
    };

    const selectConversation = useCallback(async (jid) => {
        setActiveJid(jid);
        setLoading(true);
        try {
            const { data } = await api.get(`/api/chat/messages/${encodeURIComponent(jid)}`);
            setMessages(data.data?.messages || []);
            // Mark as read
            await api.post(`/api/chat/mark-read/${encodeURIComponent(jid)}`);
            setConversations(prev =>
                prev.map(c => c.jid === jid ? { ...c, unreadCount: 0 } : c)
            );
        } catch (err) {
            console.error('Error loading messages:', err);
        } finally {
            setLoading(false);
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

    const goBack = () => setActiveJid(null);

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
                        pushName={customNames[activeJid] || activeConversation?.pushName || activeJid.replace('@s.whatsapp.net', '')}
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
