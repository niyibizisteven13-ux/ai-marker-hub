import React from 'react';
import { GraduationCap, Languages, Store, TrendingUp, LucideIcon } from 'lucide-react';

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
  const L = <T,>(en: T, rw: T, fr: T): T => (lang === 'rw' ? rw : lang === 'fr' ? fr : en);
  // What people mostly do here: run and grow a business by chatting, mark and run exams, and write or translate in three languages.
  const cards: StarterCardItem[] = [
    {
      id: 'card1',
      icon: Store,
      title: L('Run my business', 'Kuyobora ubucuruzi bwanjye', 'Gérer mon commerce'),
      description: L('Tell me today\'s sales and costs, I keep the books', 'Mbwira ibyo wacuruje n\'ibyo watanze, nanditse', 'Dites-moi vos ventes et dépenses, je tiens les comptes'),
      prompt: 'How is my business doing today? Show my sales, costs, profit, low stock and any pending orders.',
      action: 'chat',
    },
    {
      id: 'card2',
      icon: TrendingUp,
      title: L('Grow my business', 'Guteza imbere ubucuruzi', 'Développer mon commerce'),
      description: L('Posts, offers and a page customers can order from', 'Ibyo gutangaza, ibishya n\'urupapuro abakiriya bategeraho', 'Publications, offres et une page où commander'),
      prompt: 'Help me grow my business: look at my numbers, suggest one promotion for this week and write a short update to post on my page.',
      action: 'chat',
    },
    {
      id: 'card3',
      icon: GraduationCap,
      title: L('Mark an exam', 'Kosora ikizamini', 'Corriger un examen'),
      description: L('Scan or add the scripts, watch the red pen', 'Shyiramo impapuro, ubone amanota', 'Importez les copies, obtenez les notes'),
      prompt: 'Mark this student exam script against the rubric and provide detailed grading feedback.',
      action: 'marking',
    },
    {
      id: 'card4',
      icon: Languages,
      title: L('Write or translate', 'Andika cyangwa uhindure', 'Rédiger ou traduire'),
      description: L('English, French & Kinyarwanda, or turn my page into Kinyarwanda', 'Icyongereza, Igifaransa, Kinyarwanda, cyangwa uhindure urupapuro rwanjye', 'Anglais, français, kinyarwanda, ou traduire ma page'),
      prompt: 'Translate my business page into Kinyarwanda.',
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
