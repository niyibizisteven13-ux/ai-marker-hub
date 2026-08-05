import React from 'react';

interface UserProfileButtonProps {
  user?: {
    name?: string;
    email?: string;
    avatarUrl?: string;
  } | null;
  onClick?: () => void;
}

export default function UserProfileButton({ user, onClick }: UserProfileButtonProps) {
  const getInitials = (name?: string) => {
    if (!name) return null;
    const parts = name.trim().split(' ').filter(Boolean);
    if (parts.length === 0) return null;
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const initials = getInitials(user?.name);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex items-center gap-3 p-1.5 pr-3 rounded-full bg-slate-900/90 hover:bg-slate-800 border border-slate-700/60 transition-all duration-200 shadow-md active:scale-95"
      title={user ? `${user.name || 'User Profile'}` : 'Click to Sign In'}
    >
      <div className="relative w-9 h-9 rounded-full overflow-hidden bg-gradient-to-br from-slate-700 to-slate-900 border border-slate-600/80 flex items-center justify-center shrink-0 shadow-inner">
        {user?.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt={user.name || 'User Profile'}
            className="w-full h-full object-cover"
          />
        ) : initials ? (
          <span className="text-xs font-bold text-orange-400 tracking-wider">
            {initials}
          </span>
        ) : (
          <svg
            className="w-5 h-5 text-slate-400 group-hover:text-slate-200 transition-colors"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
          </svg>
        )}

        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-[#0A0D14]" />
      </div>

      <div className="flex flex-col text-left min-w-0 pr-1">
        <span className="text-xs font-semibold text-slate-200 group-hover:text-orange-400 transition-colors truncate max-w-[110px]">
          {user?.name || 'Guest User'}
        </span>
        <span className="text-[10px] text-slate-400 font-medium truncate max-w-[110px]">
          {user ? 'Logged In' : 'Sign In / Account'}
        </span>
      </div>

      <span className="text-[10px] text-slate-500 group-hover:text-slate-300 transition-colors ml-auto">
        ▼
      </span>
    </button>
  );
}
