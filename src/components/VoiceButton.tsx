import React from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';
import { useVoiceInput, VoiceState } from '../hooks/useVoiceInput';

interface VoiceButtonProps {
  onTranscription: (text: string) => void;
  disabled?: boolean;
}

export const VoiceButton: React.FC<VoiceButtonProps> = ({ onTranscription, disabled = false }) => {
  const { state, errorMessage, startRecording, stopRecording, cancelRecording } = useVoiceInput(onTranscription);

  if (state === 'recording') {
    return (
      <div className="flex items-center gap-2 bg-[var(--surface-2)] border border-[var(--border)] rounded-full px-3 py-1 animate-pulse">
        <span className="w-2.5 h-2.5 rounded-full bg-[var(--danger)] animate-ping" />
        <span className="text-xs font-bold text-[var(--text)]">Listening...</span>
        <button
          type="button"
          onClick={stopRecording}
          className="p-1 rounded-full bg-[var(--accent)] text-[var(--on-accent)] hover:opacity-90"
          title="Stop recording"
        >
          <Square className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  if (state === 'transcribing') {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1 text-xs text-[var(--muted)]">
        <Loader2 className="w-4 h-4 animate-spin text-[var(--teal)]" /> Transcribing...
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={startRecording}
      className="p-2 rounded-xl text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover)] transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center disabled:opacity-40"
      title="Record voice prompt"
      aria-label="Record voice prompt"
    >
      <Mic className="w-5 h-5" />
    </button>
  );
};
