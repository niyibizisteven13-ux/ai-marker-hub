import React from 'react';
import { WorkflowStep } from '../types';
import { Upload, FileText, Inbox, Bot, CheckSquare } from 'lucide-react';

interface ProgressBarProps {
  currentStep: WorkflowStep;
  setStep: (step: WorkflowStep) => void;
  examLoaded: boolean;
  scriptsCount: number;
  markedCount: number;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  currentStep,
  setStep,
  examLoaded,
  scriptsCount,
  markedCount,
}) => {
  const steps: { id: WorkflowStep; label: string; icon: React.ReactNode; disabled: boolean; badge?: string }[] = [
    {
      id: 1,
      label: 'Create / Upload',
      icon: <Upload className="w-3.5 h-3.5" />,
      disabled: false,
    },
    {
      id: 2,
      label: 'Rubric',
      icon: <FileText className="w-3.5 h-3.5" />,
      disabled: !examLoaded,
    },
    {
      id: 3,
      label: 'Submit Answers',
      icon: <Inbox className="w-3.5 h-3.5" />,
      disabled: !examLoaded,
      badge: scriptsCount > 0 ? `${scriptsCount}` : undefined,
    },
    {
      id: 4,
      label: 'AI Marks',
      icon: <Bot className="w-3.5 h-3.5" />,
      disabled: scriptsCount === 0,
      badge: markedCount > 0 ? `${markedCount}/${scriptsCount}` : undefined,
    },
    {
      id: 5,
      label: 'Review & Export',
      icon: <CheckSquare className="w-3.5 h-3.5" />,
      disabled: markedCount === 0,
    },
  ];

  return (
    <div className="w-full bg-[#FFFFFF] dark:bg-[#202024] border-b border-[#E8E4DC] dark:border-[#2D2D32] py-3.5 px-4 sm:px-6 shadow-2xs">
      <div className="max-w-5xl mx-auto">
        <nav aria-label="Progress">
          <ol className="flex items-center justify-between w-full">
            {steps.map((s, idx) => {
              const isCurrent = currentStep === s.id;
              const isCompleted = currentStep > s.id;

              return (
                <React.Fragment key={s.id}>
                  {/* Step Button */}
                  <li className="relative flex flex-col items-center group">
                    <button
                      onClick={() => !s.disabled && setStep(s.id)}
                      disabled={s.disabled}
                      className={`flex items-center space-x-2 px-3 py-1.5 rounded-xl transition-all duration-200 cursor-pointer ${
                        isCurrent
                          ? 'bg-[#D97757] text-white font-bold text-xs shadow-xs'
                          : isCompleted
                          ? 'bg-[#D97757]/15 text-[#D97757] font-semibold text-xs hover:bg-[#D97757]/25'
                          : s.disabled
                          ? 'opacity-40 cursor-not-allowed text-[#858075] dark:text-[#66635B] text-xs'
                          : 'text-[#66635B] dark:text-[#A0A0AA] hover:bg-[#F4F0E8] dark:hover:bg-[#2D2D32] text-xs font-semibold'
                      }`}
                    >
                      <div className="relative flex items-center justify-center">
                        <span className="font-mono text-[10px] opacity-80 mr-1.5">0{s.id}</span>
                        {s.icon}
                        {s.badge && (
                          <span className="absolute -top-2.5 -right-2.5 px-1.5 py-0.5 text-[9px] font-extrabold rounded-full bg-[#D97757] text-white font-mono shadow-xs">
                            {s.badge}
                          </span>
                        )}
                      </div>
                      <span className="hidden md:inline font-sans font-bold">
                        {s.label}
                      </span>
                    </button>
                  </li>

                  {/* Connecting line */}
                  {idx < steps.length - 1 && (
                    <div
                      className={`flex-1 h-0.5 mx-2 sm:mx-3 transition-colors duration-300 ${
                        currentStep > s.id
                          ? 'bg-[#D97757]'
                          : 'bg-[#E8E4DC] dark:bg-[#2D2D32]'
                      }`}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </ol>
        </nav>
      </div>
    </div>
  );
};

