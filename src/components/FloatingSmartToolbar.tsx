import React, { useState } from 'react';
import { 
  Highlighter, 
  Sparkles, 
  Globe, 
  Layers, 
  FileCode2, 
  Check, 
  ChevronDown, 
  X,
  Copy
} from 'lucide-react';
import { HighlightColor } from '../types';

interface FloatingSmartToolbarProps {
  selectedText: string;
  position: { top: number; left: number } | null;
  onHighlight: (color: HighlightColor) => void;
  onSummarize: (text: string) => void;
  onTranslate: (text: string, lang: string) => void;
  onCaptureFlashcard: (text: string) => void;
  onExportMarkdown: (text: string) => void;
  onClose: () => void;
}

const LANGUAGES = [
  'Spanish', 'French', 'German', 'Mandarin Chinese', 'Japanese', 
  'Korean', 'Italian', 'Portuguese', 'Arabic', 'Russian', 
  'Hindi', 'Dutch', 'Swedish', 'Polish', 'Greek', 'Turkish',
  'Vietnamese', 'Thai', 'Indonesian', 'Hebrew', 'Ukrainian', 'Danish'
];

export const FloatingSmartToolbar: React.FC<FloatingSmartToolbarProps> = ({
  selectedText,
  position,
  onHighlight,
  onSummarize,
  onTranslate,
  onCaptureFlashcard,
  onExportMarkdown,
  onClose,
}) => {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!selectedText || !position) return null;

  const colorOptions: { color: HighlightColor; hex: string; name: string }[] = [
    { color: 'terracotta', hex: '#D97757', name: 'Terracotta' },
    { color: 'yellow', hex: '#F5D061', name: 'Warm Yellow' },
    { color: 'sage', hex: '#88B04B', name: 'Soft Sage' },
    { color: 'blue', hex: '#5B92E5', name: 'Ocean Blue' },
    { color: 'lilac', hex: '#B388FF', name: 'Soft Lilac' },
  ];

  return (
    <div
      style={{
        top: `${Math.max(10, position.top - 60)}px`,
        left: `${Math.min(window.innerWidth - 340, Math.max(20, position.left - 150))}px`,
      }}
      className="fixed z-50 animate-in fade-in zoom-in-95 duration-150 select-none"
    >
      <div className="relative flex items-center space-x-1 p-1.5 rounded-2xl bg-[#FFFFFF]/95 dark:bg-[#202024]/95 border border-[#E8E4DC] dark:border-[#2D2D32] shadow-xl backdrop-blur-md text-xs font-sans text-[#191919] dark:text-[#F3F3F3]">
        {/* 1. Highlight Color Selector */}
        <div className="relative">
          <button
            onClick={() => {
              setShowColorPicker(!showColorPicker);
              setShowLangPicker(false);
            }}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl hover:bg-[#F4F0E8] dark:hover:bg-[#2A2A2F] transition-all cursor-pointer text-[#191919] dark:text-[#F3F3F3]"
            title="Highlight Color"
          >
            <Highlighter className="w-3.5 h-3.5 text-[#D97757]" />
            <span className="font-semibold text-[11px] hidden sm:inline">Highlight</span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>

          {showColorPicker && (
            <div className="absolute top-full left-0 mt-2 p-2 rounded-xl bg-[#FFFFFF] dark:bg-[#202024] border border-[#E8E4DC] dark:border-[#2D2D32] shadow-xl flex items-center space-x-1.5 z-50">
              {colorOptions.map((item) => (
                <button
                  key={item.color}
                  onClick={() => {
                    onHighlight(item.color);
                    setShowColorPicker(false);
                  }}
                  style={{ backgroundColor: item.hex }}
                  className="w-5 h-5 rounded-full hover:scale-110 transition-transform cursor-pointer border border-black/10"
                  title={item.name}
                />
              ))}
            </div>
          )}
        </div>

        <div className="h-4 w-px bg-[#E8E4DC] dark:bg-[#2D2D32]" />

        {/* 2. Sparkle Icon (Summarize) */}
        <button
          onClick={() => {
            onSummarize(selectedText);
            setShowColorPicker(false);
            setShowLangPicker(false);
          }}
          className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl hover:bg-[#F4F0E8] dark:hover:bg-[#2A2A2F] transition-all cursor-pointer text-[#191919] dark:text-[#F3F3F3]"
          title="Summarize text into key insight"
        >
          <Sparkles className="w-3.5 h-3.5 text-[#D97757]" />
          <span className="font-semibold text-[11px] hidden sm:inline">Summarize</span>
        </button>

        <div className="h-4 w-px bg-[#E8E4DC] dark:bg-[#2D2D32]" />

        {/* 3. Globe Icon (Translate Dropdown) */}
        <div className="relative">
          <button
            onClick={() => {
              setShowLangPicker(!showLangPicker);
              setShowColorPicker(false);
            }}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl hover:bg-[#F4F0E8] dark:hover:bg-[#2A2A2F] transition-all cursor-pointer text-[#191919] dark:text-[#F3F3F3]"
            title="Translate to 30+ languages"
          >
            <Globe className="w-3.5 h-3.5 text-[#5B92E5]" />
            <span className="font-semibold text-[11px] hidden sm:inline">Translate</span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>

          {showLangPicker && (
            <div className="absolute top-full left-0 mt-2 w-48 max-h-52 overflow-y-auto p-1.5 rounded-xl bg-[#FFFFFF] dark:bg-[#202024] border border-[#E8E4DC] dark:border-[#2D2D32] shadow-xl z-50 space-y-0.5">
              <div className="px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider text-[#858075]">
                Select Language
              </div>
              {LANGUAGES.map((lang) => (
                <button
                  key={lang}
                  onClick={() => {
                    onTranslate(selectedText, lang);
                    setShowLangPicker(false);
                  }}
                  className="w-full text-left px-2.5 py-1 rounded-lg hover:bg-[#F4F0E8] dark:hover:bg-[#2D2D32] text-xs transition-colors cursor-pointer"
                >
                  {lang}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="h-4 w-px bg-[#E8E4DC] dark:bg-[#2D2D32]" />

        {/* 4. Flashcard Icon (Capture to Deck) */}
        <button
          onClick={() => {
            onCaptureFlashcard(selectedText);
            setShowColorPicker(false);
            setShowLangPicker(false);
          }}
          className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl hover:bg-[#F4F0E8] dark:hover:bg-[#2A2A2F] transition-all cursor-pointer text-[#191919] dark:text-[#F3F3F3]"
          title="Capture to Study Deck Flashcards"
        >
          <Layers className="w-3.5 h-3.5 text-[#88B04B]" />
          <span className="font-semibold text-[11px] hidden sm:inline">To Deck</span>
        </button>

        <div className="h-4 w-px bg-[#E8E4DC] dark:bg-[#2D2D32]" />

        {/* 5. Notion/Markdown Icon (Export) */}
        <button
          onClick={() => {
            onExportMarkdown(selectedText);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl hover:bg-[#F4F0E8] dark:hover:bg-[#2A2A2F] transition-all cursor-pointer text-[#191919] dark:text-[#F3F3F3]"
          title="Export as Markdown / Notion"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <FileCode2 className="w-3.5 h-3.5 text-[#B388FF]" />}
          <span className="font-semibold text-[11px] hidden sm:inline">{copied ? 'Copied!' : 'Export'}</span>
        </button>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="p-1 rounded-full hover:bg-[#E8E4DC] dark:hover:bg-[#2D2D32] text-[#858075] ml-1 transition-colors cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
