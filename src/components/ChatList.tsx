import React, { useState } from 'react';
import { ChatSession } from '../types';
import { Search, Pin, Trash2, Edit2, MessageSquare } from 'lucide-react';

interface ChatListProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, newTitle: string) => void;
  onPinSession?: (id: string) => void;
  isGuest?: boolean;
}

export const ChatList: React.FC<ChatListProps> = ({
  sessions = [],
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  onPinSession,
  isGuest = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  if (isGuest) {
    return (
      <div className="p-4 text-center text-xs text-[var(--muted)]">
        Sign in to keep your chats and results.
      </div>
    );
  }

  const filtered = sessions.filter((s) =>
    (s.title || 'Untitled chat').toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="p-3 border-b border-[var(--border)]">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-[var(--muted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search chats (Ctrl+K)..."
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] pl-9 pr-3 py-2 text-xs text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--teal)]"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-xs text-[var(--muted)]">
            Your chats will appear here.
          </div>
        ) : (
          filtered.map((session) => {
            const isActive = session.id === activeSessionId;
            const isEditing = session.id === editingId;

            return (
              <div
                key={session.id}
                className={`group relative flex items-center justify-between px-3 py-2.5 rounded-xl text-xs transition-colors ${
                  isActive
                    ? 'bg-[var(--surface-2)] text-[var(--text)] font-bold border border-[var(--border)]'
                    : 'text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectSession(session.id)}
                  className="flex items-center gap-2.5 truncate flex-1 text-left"
                >
                  <MessageSquare className="w-4 h-4 shrink-0 text-[var(--teal)]" />
                  {isEditing ? (
                    <input
                      type="text"
                      autoFocus
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={() => {
                        if (editTitle.trim()) onRenameSession(session.id, editTitle.trim());
                        setEditingId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (editTitle.trim()) onRenameSession(session.id, editTitle.trim());
                          setEditingId(null);
                        }
                      }}
                      className="bg-[var(--surface)] border border-[var(--border)] px-2 py-0.5 rounded text-xs text-[var(--text)] w-full"
                    />
                  ) : (
                    <span className="truncate">{session.title || 'Untitled chat'}</span>
                  )}
                </button>

                <div className="hidden group-hover:flex items-center gap-1 shrink-0 ml-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(session.id);
                      setEditTitle(session.title || '');
                    }}
                    className="p-1 rounded hover:bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--text)]"
                    title="Rename"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteSession(session.id)}
                    className="p-1 rounded hover:bg-[var(--surface)] text-[var(--danger)]"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
