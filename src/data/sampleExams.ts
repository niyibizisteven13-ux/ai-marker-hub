import { ExamPaper, StudentScript } from '../types';

export const INITIAL_HIGHLIGHTS = [
  {
    id: 'hl-1',
    docId: 'exam-ib-physics',
    docTitle: 'IB Physics HL - Classical Mechanics',
    text: 'Newton\'s Second Law states that force is equal to the rate of change of momentum (F = dp/dt).',
    color: 'terracotta' as const,
    createdAt: '10 mins ago',
    note: 'Core formula for impulse derivation',
    category: 'Physics Principle'
  },
  {
    id: 'hl-2',
    docId: 'exam-ib-physics',
    docTitle: 'IB Physics HL - Classical Mechanics',
    text: 'Kinetic energy after = 144,000 J. Kinetic energy is not conserved (inelastic collision).',
    color: 'sage' as const,
    createdAt: '25 mins ago',
    note: 'Inelastic collision key evidence',
    category: 'Calculation Rule'
  },
  {
    id: 'hl-3',
    docId: 'exam-cs101',
    docTitle: 'CS101 - Algorithms & Recursion',
    text: 'Naive recursive Fibonacci is O(2^n) time due to overlapping subproblems tree.',
    color: 'yellow' as const,
    createdAt: '1 hour ago',
    note: 'Important complexity distinction for exams',
    category: 'CS Algorithm'
  }
];

export const INITIAL_DECKS = [
  {
    id: 'deck-physics',
    title: 'Physics HL - Momentum & Collisions',
    cardsCount: 12,
    description: 'Newtonian mechanics, conservation equations, impulse integral proofs',
    updatedAt: 'Today'
  },
  {
    id: 'deck-cs',
    title: 'Computer Science - Complexity & Recursion',
    cardsCount: 8,
    description: 'Big-O notation, recursion base cases, dynamic programming memoization',
    updatedAt: 'Yesterday'
  },
  {
    id: 'deck-rubrics',
    title: 'Marking Criteria & Model Answer Anchors',
    cardsCount: 15,
    description: 'Rubric criteria anchors for high-scoring student essay answers',
    updatedAt: '2 days ago'
  }
];

export const INITIAL_FLASHCARDS = [
  {
    id: 'fc-1',
    deckId: 'deck-physics',
    front: 'What is the formal calculus expression for Newton\'s Second Law?',
    back: 'F = dp/dt (Force is equal to the rate of change of momentum with respect to time).',
    sourceDocTitle: 'IB Physics HL - Classical Mechanics',
    createdAt: '10 mins ago'
  },
  {
    id: 'fc-2',
    deckId: 'deck-physics',
    front: 'How is Impulse (J) related to a Force-Time graph?',
    back: 'Impulse J = ∫ F dt, which corresponds exactly to the area beneath the Force-Time curve.',
    sourceDocTitle: 'IB Physics HL - Classical Mechanics',
    createdAt: '20 mins ago'
  },
  {
    id: 'fc-3',
    deckId: 'deck-cs',
    front: 'What is the time and space complexity of naive recursive Fibonacci?',
    back: 'Time complexity: O(2^n) due to redundant tree evaluations. Space complexity: O(n) call stack depth.',
    sourceDocTitle: 'CS101 - Algorithms & Recursion',
    createdAt: '1 hour ago'
  }
];

export const INITIAL_AI_CARDS = [
  {
    id: 'ai-card-1',
    type: 'summary' as const,
    title: 'Key Concept Summary',
    content: 'Newton\'s Second Law directly establishes that Force equals the time derivative of momentum (F = dp/dt). Integrating force over time yields the Impulse-Momentum Theorem (J = Δp).',
    sourceText: 'Newton\'s Second Law states that force is equal to the rate of change of momentum (F = dp/dt).',
    timestamp: 'Just now'
  }
];

export const INITIAL_PEN_STATE = {
  connected: true,
  batteryPercent: 88,
  bluetoothVersion: '5.3 LE',
  streaming: true,
  activePenModel: 'AI Marker Pen Pro v2',
  lastOCRText: 'F = dp/dt = m*a (Newton\'s Second Law)',
  lastSyncTime: 'Live Active'
};

export const SAMPLE_EXAMS: ExamPaper[] = [
  {
    id: 'exam-ib-physics',
    title: 'IB Physics HL - Classical Mechanics & Conservation Laws',
    subject: 'Physics',
    topic: 'Mechanics & Momentum',
    gradeLevel: 'Grade 12 (IB Diploma)',
    difficulty: 'IB/AP Standard',
    totalMarks: 30,
    durationMinutes: 45,
    createdAt: new Date().toISOString(),
    questions: [
      {
        id: 'q1',
        number: 'Q1',
        questionText: 'State Newton\'s Second Law of Motion in terms of momentum and write down its mathematical equation.',
        maxMarks: 5,
        questionType: 'short_answer',
        modelAnswer: 'Newton\'s Second Law states that the net force acting on an object is equal to the rate of change of momentum of the object (F = dp/dt = m*a when mass is constant).'
      },
      {
        id: 'q2',
        number: 'Q2',
        questionText: 'A 1200 kg car travelling at 20 m/s collides with a stationary 800 kg cart and sticks to it. Calculate the velocity of the combined mass after collision and determine if energy was conserved.',
        maxMarks: 10,
        questionType: 'calculation',
        modelAnswer: 'Using conservation of momentum: m1*v1 + m2*v2 = (m1+m2)*v_final => (1200*20) + 0 = 2000 * v_final => v_final = 12 m/s. Kinetic energy before = 0.5*1200*400 = 240,000 J. Kinetic energy after = 0.5*2000*144 = 144,000 J. Kinetic energy is not conserved (inelastic collision).'
      },
      {
        id: 'q3',
        number: 'Q3',
        questionText: 'Explain why impulse is equal to the area under a Force-time graph and derive the Impulse-Momentum theorem.',
        maxMarks: 15,
        questionType: 'essay',
        modelAnswer: 'Impulse J is defined as the integral of Force over time: J = ∫ F dt. Since F = dp/dt, substituting yields J = ∫ (dp/dt) dt = Δp. On a Force-time graph, integration corresponds to the area beneath the curve.'
      }
    ],
    rubrics: [
      {
        questionId: 'q1',
        questionNumber: 'Q1',
        maxMarks: 5,
        criteria: [
          { id: 'q1-c1', criterion: 'States Newton\'s 2nd Law in terms of rate of change of momentum', marksAvailable: 3, description: 'Must mention rate of change or derivative dp/dt' },
          { id: 'q1-c2', criterion: 'Correct formula written (F = dp/dt or F = ma with constant mass noted)', marksAvailable: 2, description: 'Clear symbols defined' }
        ]
      },
      {
        questionId: 'q2',
        questionNumber: 'Q2',
        maxMarks: 10,
        criteria: [
          { id: 'q2-c1', criterion: 'Applies conservation of linear momentum equation correctly', marksAvailable: 3, description: 'Correct formula setup m1v1 = (m1+m2)v2' },
          { id: 'q2-c2', criterion: 'Calculates correct final velocity (12 m/s) with proper units', marksAvailable: 3, description: 'Numerical accuracy and units' },
          { id: 'q2-c3', criterion: 'Calculates initial and final kinetic energies correctly', marksAvailable: 2, description: '240 kJ before, 144 kJ after' },
          { id: 'q2-c4', criterion: 'Concludes correctly that energy is lost and collision is inelastic', marksAvailable: 2, description: 'Clear qualitative explanation' }
        ]
      },
      {
        questionId: 'q3',
        questionNumber: 'Q3',
        maxMarks: 15,
        criteria: [
          { id: 'q3-c1', criterion: 'Defines impulse J = ∫ F dt or F * Δt', marksAvailable: 4, description: 'Formal definition' },
          { id: 'q3-c2', criterion: 'Explains graph relationship (integration = area under F-t graph)', marksAvailable: 4, description: 'Graphical proof connection' },
          { id: 'q3-c3', criterion: 'Mathematical derivation of Δp theorem starting from Newton 2nd Law', marksAvailable: 5, description: 'Step-by-step mathematical logic' },
          { id: 'q3-c4', criterion: 'Clarity, terminology, and physical notation', marksAvailable: 2, description: 'Proper physical vector or calculus notation' }
        ]
      }
    ]
  },
  {
    id: 'exam-cs101',
    title: 'University CS101 - Algorithms & Recursion',
    subject: 'Computer Science',
    topic: 'Data Structures & Recursion',
    gradeLevel: 'Undergraduate Year 1',
    difficulty: 'Intermediate',
    totalMarks: 25,
    durationMinutes: 30,
    createdAt: new Date().toISOString(),
    questions: [
      {
        id: 'q1',
        number: 'Q1',
        questionText: 'Define the base case and recursive case in a recursive function and explain what happens if the base case is missing.',
        maxMarks: 10,
        questionType: 'short_answer',
        modelAnswer: 'Base case is the terminating condition that stops recursion. Recursive case breaks problem into smaller subproblems. Missing base case leads to infinite recursion and StackOverflow error.'
      },
      {
        id: 'q2',
        number: 'Q2',
        questionText: 'Analyze the Big-O time and space complexity of the recursive Fibonacci algorithm vs an iterative dynamic programming approach.',
        maxMarks: 15,
        questionType: 'essay',
        modelAnswer: 'Naive recursive Fibonacci is O(2^n) time due to overlapping subproblems tree and O(n) space (call stack depth). Iterative DP approach is O(n) time and O(1) space using two variables.'
      }
    ],
    rubrics: [
      {
        questionId: 'q1',
        questionNumber: 'Q1',
        maxMarks: 10,
        criteria: [
          { id: 'cs-q1-c1', criterion: 'Accurately defines base case and recursive case', marksAvailable: 4 },
          { id: 'cs-q1-c2', criterion: 'Explains call stack exhaustion / StackOverflow risk', marksAvailable: 4 },
          { id: 'cs-q1-c3', criterion: 'Uses appropriate technical terminology', marksAvailable: 2 }
        ]
      },
      {
        questionId: 'q2',
        questionNumber: 'Q2',
        maxMarks: 15,
        criteria: [
          { id: 'cs-q2-c1', criterion: 'States correct recursive complexity: O(2^n) time, O(n) space', marksAvailable: 5 },
          { id: 'cs-q2-c2', criterion: 'States correct iterative DP complexity: O(n) time, O(1) space', marksAvailable: 5 },
          { id: 'cs-q2-c3', criterion: 'Explains recursion tree overlap vs table storage reasoning', marksAvailable: 5 }
        ]
      }
    ]
  }
];

export const SAMPLE_STUDENT_SCRIPTS: StudentScript[] = [
  {
    id: 'script-1',
    studentName: 'Alex Chen',
    studentId: 'ST-2026-001',
    submittedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    status: 'pending',
    answers: [
      {
        questionId: 'q1',
        questionNumber: 'Q1',
        answerText: "Newton's Second Law states that force is proportional to the rate of change of momentum. Mathematically, F = dp/dt. When mass stays constant, F = m*(dv/dt) = m*a."
      },
      {
        questionId: 'q2',
        questionNumber: 'Q2',
        answerText: "By conservation of momentum:\nInitial momentum p_i = (1200 kg * 20 m/s) + 0 = 24,000 kg·m/s.\nFinal mass = 1200 + 800 = 2000 kg.\nSo 2000 * v_f = 24,000 => v_f = 12 m/s.\nKE before = 0.5 * 1200 * (20)^2 = 240,000 J.\nKE after = 0.5 * 2000 * (12)^2 = 144,000 J.\nSince KE after < KE before, kinetic energy is NOT conserved (lost 96,000 J as thermal/sound energy). Collision is inelastic."
      },
      {
        questionId: 'q3',
        questionNumber: 'Q3',
        answerText: "Impulse is defined as force applied over time, J = ∫ F dt. Graphically, the integral represents the area under the Force vs Time curve. Starting from Newton's second law F = dp/dt, we integrate both sides with respect to time: ∫ F dt = ∫ (dp/dt) dt = p_final - p_initial = Δp. Hence, impulse equals the change in momentum."
      }
    ]
  },
  {
    id: 'script-2',
    studentName: 'Sarah Jenkins',
    studentId: 'ST-2026-002',
    submittedAt: new Date(Date.now() - 3600000 * 1.5).toISOString(),
    status: 'pending',
    answers: [
      {
        questionId: 'q1',
        questionNumber: 'Q1',
        answerText: "Newton's second law is F = m*a. It says acceleration happens when force is applied to a mass."
      },
      {
        questionId: 'q2',
        questionNumber: 'Q2',
        answerText: "Momentum = 1200 * 20 = 24000. New velocity = 24000 / 800 = 30 m/s. Energy is conserved because momentum is conserved."
      },
      {
        questionId: 'q3',
        questionNumber: 'Q3',
        answerText: "Impulse is Force times time. So J = F*t. Area under graph is height times base which is force times time. Change in momentum is Δp."
      }
    ]
  },
  {
    id: 'script-3',
    studentName: 'Marcus Vance',
    studentId: 'ST-2026-003',
    submittedAt: new Date(Date.now() - 3600000 * 1).toISOString(),
    status: 'pending',
    answers: [
      {
        questionId: 'q1',
        questionNumber: 'Q1',
        answerText: "Physics is cool. F = ma is used everywhere in everyday life."
      },
      {
        questionId: 'q2',
        questionNumber: 'Q2',
        answerText: "I don't know how to calculate collision for carts."
      },
      {
        questionId: 'q3',
        questionNumber: 'Q3',
        answerText: "Refer to textbook chapter 4 page 92."
      }
    ]
  },
  {
    id: 'script-4',
    studentName: 'Elena Rostova',
    studentId: 'ST-2026-004',
    submittedAt: new Date(Date.now() - 1800000).toISOString(),
    status: 'pending',
    answers: [
      {
        questionId: 'q1',
        questionNumber: 'Q1',
        answerText: "[BLANK SCRIPT]"
      },
      {
        questionId: 'q2',
        questionNumber: 'Q2',
        answerText: "[BLANK SCRIPT]"
      },
      {
        questionId: 'q3',
        questionNumber: 'Q3',
        answerText: "[BLANK SCRIPT]"
      }
    ]
  },
  {
    id: 'script-5',
    studentName: 'David K. (Plagiarism Alert Sample)',
    studentId: 'ST-2026-005',
    submittedAt: new Date(Date.now() - 900000).toISOString(),
    status: 'pending',
    answers: [
      {
        questionId: 'q1',
        questionNumber: 'Q1',
        answerText: "Newton's Second Law states that the net force acting on an object is equal to the rate of change of momentum of the object (F = dp/dt = m*a when mass is constant)."
      },
      {
        questionId: 'q2',
        questionNumber: 'Q2',
        answerText: "Using conservation of momentum: m1*v1 + m2*v2 = (m1+m2)*v_final => (1200*20) + 0 = 2000 * v_final => v_final = 12 m/s. Kinetic energy before = 0.5*1200*400 = 240,000 J. Kinetic energy after = 0.5*2000*144 = 144,000 J. Kinetic energy is not conserved (inelastic collision)."
      },
      {
        questionId: 'q3',
        questionNumber: 'Q3',
        answerText: "Impulse J is defined as the integral of Force over time: J = ∫ F dt. Since F = dp/dt, substituting yields J = ∫ (dp/dt) dt = Δp. On a Force-time graph, integration corresponds to the area beneath the curve."
      }
    ]
  }
];
