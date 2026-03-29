import { Search, MessageSquare, Trash2 } from 'lucide-react';

const ConversationList = ({ conversations, activeJid, onSelect, onDelete, searchTerm, onSearchChange }) => {

    const formatTime = (isoStr) => {
        if (!isoStr) return '';
        const d = new Date(isoStr);
        const now = new Date();
        const isToday = d.toDateString() === now.toDateString();
        if (isToday) {
            return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        }
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (d.toDateString() === yesterday.toDateString()) {
            return 'Ayer';
        }
        return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
    };

    const getInitial = (name) => {
        return (name || '?').charAt(0).toUpperCase();
    };

    const getAvatarColor = (jid) => {
        const colors = ['#00aa55', '#0088cc', '#aa5500', '#cc0044', '#6600cc', '#00aaaa'];
        let hash = 0;
        for (let i = 0; i < jid.length; i++) hash = jid.charCodeAt(i) + ((hash << 5) - hash);
        return colors[Math.abs(hash) % colors.length];
    };

    return (
        <div className="conv-list">
            <div className="conv-list-header">
                <h3 className="conv-list-title">
                    <MessageSquare size={18} />
                    Chats
                </h3>
                <span className="conv-list-count">{conversations.length}</span>
            </div>

            <div className="conv-search-wrapper">
                <Search size={14} className="conv-search-icon" />
                <input
                    type="text"
                    className="conv-search-input"
                    placeholder="Buscar chat..."
                    value={searchTerm}
                    onChange={e => onSearchChange(e.target.value)}
                />
            </div>

            <div className="conv-list-items">
                {conversations.length === 0 ? (
                    <div className="conv-empty">
                        <MessageSquare size={32} />
                        <p>{searchTerm ? 'Sin resultados' : 'No hay chats aún'}</p>
                    </div>
                ) : (
                    conversations.map(conv => (
                        <div
                            key={conv.jid}
                            className={`conv-item ${conv.jid === activeJid ? 'conv-item-active' : ''}`}
                            onClick={() => onSelect(conv.jid)}
                        >
                            <div
                                className="conv-avatar"
                                style={{ backgroundColor: getAvatarColor(conv.jid) }}
                            >
                                {getInitial(conv.pushName)}
                            </div>
                            <div className="conv-info">
                                <div className="conv-info-top">
                                    <span className="conv-name">{conv.pushName}</span>
                                    <span className={`conv-time ${conv.unreadCount > 0 ? 'conv-time-unread' : ''}`}>
                                        {formatTime(conv.lastMessageTime)}
                                    </span>
                                </div>
                                <div className="conv-info-bottom">
                                    <span className="conv-last-msg">
                                        {conv.lastMessageFromMe && <span className="conv-check">✓ </span>}
                                        {conv.lastMessage
                                            ? (conv.lastMessage.length > 45
                                                ? conv.lastMessage.substring(0, 45) + '...'
                                                : conv.lastMessage)
                                            : 'Sin mensajes'
                                        }
                                    </span>
                                    {conv.unreadCount > 0 && (
                                        <span className="conv-unread-badge">{conv.unreadCount}</span>
                                    )}
                                    <button
                                        className="conv-delete-btn"
                                        title="Eliminar chat"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onDelete(conv.jid);
                                        }}
                                    >
                                        <Trash2 size={13} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default ConversationList;
