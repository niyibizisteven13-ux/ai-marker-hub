import React from 'react';
import { Database, GraduationCap, Sprout, Languages, LucideIcon } from 'lucide-react';

interface StarterCardItem {
  id: string;
  icon: LucideIcon;
  title: string;
  description: string;
  prompt: string;
  action?: 'chat' | 'marking';
}

interface StarterCardsProps {
  onSelectPrompt: (prompt: string, action?: 'chat' | 'marking') => void;
  lang?: 'en' | 'rw' | 'fr';
}

export const StarterCards: React.FC<StarterCardsProps> = ({ onSelectPrompt, lang = 'en' }) => {
  const cards: StarterCardItem[] = [
    {
      id: 'card1',
      icon: Database,
      title: lang === 'rw' ? "Baza ku makuru y'u Rwanda" : lang === 'fr' ? "Interroger les données du Rwanda" : "Ask about Rwanda's data",
      description: lang === 'rw' ? "Raporo n'imbonerahamwe, bifite inkomoko" : lang === 'fr' ? "Rapports et tableaux, avec sources" : "Reports and tables, with sources",
      prompt: "What does the latest national statistical report say about economic growth and agricultural yields?",
      action: 'chat',
    },
    {
      id: 'card2',
      icon: GraduationCap,
      title: lang === 'rw' ? "Kosora ikizamini" : lang === 'fr' ? "Corriger un examen" : "Mark an exam",
      description: lang === 'rw' ? "Shyiramo impapuro, ubone amanota" : lang === 'fr' ? "Importez les copies, obtenez les notes" : "Upload papers, get marks",
      prompt: "Mark this student exam script against the rubric and provide detailed grading feedback.",
      action: 'marking',
    },
    {
      id: 'card3',
      icon: Sprout,
      title: lang === 'rw' ? "Inama z'ubuhinzi" : lang === 'fr' ? "Conseils agricoles" : "Farming advice",
      description: lang === 'rw' ? "Ibihingwa, udukoko, ibihe" : lang === 'fr' ? "Cultures, ravageurs, saisons" : "Crops, pests, seasons",
      prompt: "What are the recommended pest management practices for maize during the Season A rains in Rwanda?",
      action: 'chat',
    },
    {
      id: 'card4',
      icon: Languages,
      title: lang === 'rw' ? "Andika cyangwa uhindure" : lang === 'fr' ? "Rédiger ou traduire" : "Write or translate",
      description: lang === 'rw' ? "Kinyarwanda, Icyongereza, Igifaransa" : lang === 'fr' ? "Kinyarwanda, anglais, français" : "Kinyarwanda, English, French",
      prompt: "Draft a professional policy memo in Kinyarwanda and English regarding digital education standards.",
      action: 'chat',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl mx-auto my-4">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelectPrompt(c.prompt, c.action)}
            className="flex items-start gap-3.5 p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--hover)] transition-all text-left group min-h-[52px] focus:outline-none focus:ring-2 focus:ring-[var(--teal)]"
          >
            <div className="p-2.5 rounded-xl bg-[var(--surface-2)] text-[var(--accent)] shrink-0 group-hover:scale-105 transition-transform">
              <Icon className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-bold text-[var(--text)] truncate">{c.title}</h4>
              <p className="text-xs text-[var(--muted)] mt-0.5 line-clamp-1">{c.description}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
};
