import Anthropic from '@anthropic-ai/sdk';

export interface ToolDefinition {
    metadata: Anthropic.Tool;
    instructions: string;
    preferredProvider?: 'nvidianim' | 'anthropic';
    subScripts?: string[];
}

export const ToolRegistry: Record<string, ToolDefinition> = {
  analyze_data_with_python: {
    metadata: {
        name: 'analyze_data_with_python',
        description: 'Executes Python code in a safe sandbox to perform data analysis, solve equations, or generate charts.',
        input_schema: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'The Python code to execute.' },
            explanation: { type: 'string', description: 'What this code is intended to calculate.' }
          },
          required: ['code']
        }
    },
    instructions: "Use this for high-precision math. Libraries available: pandas, numpy, matplotlib, scipy. Always print the final result.",
    preferredProvider: 'nvidianim' // NVIDIA is faster for code execution
  },
  build_form: {
    metadata: {
        name: 'build_form',
        description: 'Generates an assessment form schema based on instructions.',
        input_schema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            subject: { type: 'string' },
            topic: { type: 'string' },
            questions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  number: { type: 'string' },
                  text: { type: 'string' },
                  type: { type: 'string', enum: ['short_answer', 'essay', 'mcq'] },
                  maxMarks: { type: 'number' }
                }
              }
            }
          },
          required: ['title', 'questions']
        }
    },
    instructions: "Always ensure the form schema matches the DynamicForm.tsx expectation. Wrap output in <form_schema> tags.",
    preferredProvider: 'anthropic' // Claude is better at creative UI design
  },
  research_memory: {
    metadata: {
        name: 'research_memory',
        description: 'Search the user\'s long-term memory for specific past interactions.',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string' }
          },
          required: ['query']
        }
    },
    instructions: "Use semantic query terms. If no exact match is found, try broadening the search.",
    preferredProvider: 'nvidianim' // NVIDIA is faster for high-volume retrieval
  },
  cross_curriculum_check: {
    metadata: {
        name: 'cross_curriculum_check',
        description: 'Compares a rubric or assessment with standards from another subject.',
        input_schema: {
          type: 'object',
          properties: {
            source_subject: { type: 'string' },
            target_subject: { type: 'string' },
            rubric_content: { type: 'string' }
          },
          required: ['source_subject', 'target_subject', 'rubric_content']
        }
    },
    instructions: "Identify overlapping standards and suggest adjustments for interdisciplinary alignment.",
    preferredProvider: 'anthropic'
  },
  research_curriculum_standards: {
    metadata: {
        name: 'research_curriculum_standards',
        description: 'Fetches external academic standards (e.g., IB, GCSE, Common Core).',
        input_schema: {
          type: 'object',
          properties: {
            curriculum: { type: 'string' },
            topic: { type: 'string' }
          },
          required: ['curriculum', 'topic']
        }
    },
    instructions: "Focus on exact marking criteria and required learning outcomes.",
    preferredProvider: 'nvidianim'
  },
  generate_browser_extension: {
    metadata: {
        name: 'generate_browser_extension',
        description: 'Generates a ready-to-load Chrome/Edge extension folder that blocks specific domains using Manifest V3 and declarativeNetRequest.',
        input_schema: {
          type: 'object',
          properties: {
            extension_name: { type: 'string', description: 'Friendly name for the extension folder.' },
            blocked_domains: {
              type: 'array',
              items: { type: 'string', description: 'Domain to block (e.g. tiktok.com)' },
              description: 'List of domains to restrict access to.'
            }
          },
          required: ['extension_name', 'blocked_domains']
        }
    },
    instructions: "Creates manifest.json and rules.json. Use standard urlFilter syntax (e.g. ||domain.com^). Return the local path to the folder.",
    preferredProvider: 'anthropic'
  },
  web_search: {
    metadata: {
      name: 'web_search',
      description: 'Search the internet for up-to-date information, news, and facts.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query.' },
          search_depth: { type: 'string', enum: ['basic', 'advanced'], description: 'Level of search depth.' }
        },
        required: ['query']
      }
    },
    instructions: "Use for facts past your training cutoff or current events. Synthesize results from multiple sources.",
    preferredProvider: 'nvidianim'
  },
  read_document: {
    metadata: {
      name: 'read_document',
      description: 'Parses and extracts content from various document types like PDF, Word (DOCX), or Excel (XLSX).',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the document file.' }
        },
        required: ['path']
      }
    },
    instructions: "Returns structured text or data from the file. Use for deep analysis of uploaded documents.",
    preferredProvider: 'anthropic'
  },
  export_report: {
    metadata: {
      name: 'export_report',
      description: 'Generates a downloadable report in PDF or Excel format.',
      input_schema: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['pdf', 'xlsx'] },
          content: { type: 'string', description: 'Markdown or structured data to include.' },
          filename: { type: 'string' }
        },
        required: ['format', 'content', 'filename']
      }
    },
    instructions: "Converts text/data into a professional document. Return the download URL/path.",
    preferredProvider: 'anthropic'
  },
  visualize_data: {
    metadata: {
      name: 'visualize_data',
      description: 'Generates Mermaid diagrams or charts based on data.',
      input_schema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['mermaid', 'chart'] },
          definition: { type: 'string', description: 'The Mermaid code or data array for charting.' }
        },
        required: ['type', 'definition']
      }
    },
    instructions: "Use mermaid for flowcharts/sequences. For charts, provide a JSON array of data.",
    preferredProvider: 'anthropic'
  },
  manage_files: {
    metadata: {
      name: 'manage_files',
      description: 'Performs file system operations like list, read, write, or search within the project.',
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'read', 'write', 'search'] },
          path: { type: 'string' },
          content: { type: 'string', description: 'Required for write action.' },
          pattern: { type: 'string', description: 'Required for search action.' }
        },
        required: ['action']
      }
    },
    instructions: "Use with caution. Allows reading and modifying project files for development assistance.",
    preferredProvider: 'nvidianim'
  },

  // ── NEW FRONTIER-LEVEL TOOLS (Gonka Router powered) ──────────────────────

  fact_check: {
    metadata: {
      name: 'fact_check',
      description: 'Verifies a specific factual claim by searching the web and synthesizing a verdict. Returns TRUE/FALSE/PARTIALLY_TRUE/UNVERIFIABLE with sources and a confidence score. Use proactively for any claim you are less than 70% confident in.',
      input_schema: {
        type: 'object',
        properties: {
          claim: { type: 'string', description: 'The specific factual claim to verify. Be precise and specific.' }
        },
        required: ['claim']
      }
    },
    instructions: 'Use whenever stating a statistic, date, named entity, or any fact that could be hallucinated. Returns verdict, confidence, explanation, and sources. Always cite sources in your response.',
    preferredProvider: 'nvidianim'
  },

  plan_task: {
    metadata: {
      name: 'plan_task',
      description: 'Decomposes a complex high-level goal into a structured plan of concrete micro-tasks with dependencies. Use when the user has a multi-step objective like "Plan a 5-day trip", "Create a curriculum", or "Analyze this data and produce a report".',
      input_schema: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: 'The high-level goal to decompose into tasks.' },
          execute: { type: 'boolean', description: 'If true, execute the plan immediately. If false, just return the plan for user review.' }
        },
        required: ['goal']
      }
    },
    instructions: 'Use for any goal requiring 3+ steps. If execute=false, show the plan to the user and ask for approval before executing. Stream progress of each task as it runs.',
    preferredProvider: 'nvidianim'
  },

  save_memory: {
    metadata: {
      name: 'save_memory',
      description: 'Saves an important fact, preference, or correction to the user\'s long-term memory so it is remembered in future conversations. Use when the user states a preference, corrects you, or shares key context about themselves or their work.',
      input_schema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The fact or preference to remember. Be specific and self-contained.' },
          category: { type: 'string', enum: ['preference', 'correction', 'fact', 'project_context'], description: 'Category of the memory.' }
        },
        required: ['content', 'category']
      }
    },
    instructions: 'Call this automatically when: (1) the user corrects you, (2) the user states a strong preference, (3) the user shares important project context. Always confirm to the user that you have saved the memory.',
    preferredProvider: 'nvidianim'
  },

  detect_sentiment: {
    metadata: {
      name: 'detect_sentiment',
      description: 'Analyzes the emotional tone of a text message. Returns tone (neutral/frustrated/confused/excited/stressed/sad/grateful/angry), intensity (0-1), and suggested response persona. Use internally when the emotional context of a message is unclear.',
      input_schema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The text to analyze for emotional tone.' }
        },
        required: ['text']
      }
    },
    instructions: 'Use internally to calibrate empathy level. After detecting sentiment, silently adjust your tone — do not explicitly tell the user "I detected you are frustrated."',
    preferredProvider: 'nvidianim'
  },

  estimate_confidence: {
    metadata: {
      name: 'estimate_confidence',
      description: 'Self-evaluates the confidence of an AI-generated response and identifies uncertain claims. Returns a score (0-100), confidence level (HIGH/MEDIUM/LOW), and a list of claims that may be hallucinations. Use after generating complex factual responses.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The original user question.' },
          response: { type: 'string', description: 'The AI response to evaluate.' }
        },
        required: ['query', 'response']
      }
    },
    instructions: 'Use after generating responses with multiple factual claims, statistics, or technical details. If confidence is MEDIUM or LOW, offer to fact-check the uncertain claims.',
    preferredProvider: 'nvidianim'
  },

  run_code: {
    metadata: {
      name: 'run_code',
      description: 'Executes code in a secure sandbox environment and returns the output. Supports Python, JavaScript, and shell commands. Use for calculations, data processing, file operations, and testing code.',
      input_schema: {
        type: 'object',
        properties: {
          language: { type: 'string', enum: ['python', 'javascript', 'shell'], description: 'Programming language.' },
          code: { type: 'string', description: 'The code to execute.' },
          explanation: { type: 'string', description: 'What this code is intended to do.' }
        },
        required: ['language', 'code']
      }
    },
    instructions: 'Use for precise calculations, data analysis, and code testing. Always show the code to the user before running it. Python supports: pandas, numpy, matplotlib, scipy.',
    preferredProvider: 'nvidianim'
  },

  discover_dataset_patterns: {
    metadata: {
      name: 'discover_dataset_patterns',
      description: 'Discovers latent statistical, structural, and semantic patterns in large datasets and optimizes user prompts (aligned with generativeai.net taxonomy).',
      input_schema: {
        type: 'object',
        properties: {
          dataset_summary: { type: 'string', description: 'Raw data, table excerpt, or description of the dataset.' },
          user_prompt: { type: 'string', description: 'Optional user prompt to analyze and optimize for maximum generative fidelity.' }
        },
        required: ['dataset_summary']
      }
    },
    instructions: 'Extracts correlations, clusters, anomalies, and prompt optimizations, returning a structured dataset pattern artifact.',
    preferredProvider: 'nvidianim'
  },

  generate_image_graphic: {
    metadata: {
      name: 'generate_image_graphic',
      description: 'Generates images, digital paintings, logos, graphic design layouts, and marketing assets via GonkaRouter Visual (Nano Banana Pro).',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          prompt: { type: 'string', description: 'Detailed visual description of the image, logo, or layout.' },
          style: { type: 'string', description: 'Art style (e.g. Photorealistic, Vector Logo, Digital Painting, Marketing Poster).' },
          aspect_ratio: { type: 'string', enum: ['16:9', '1:1', '4:3', '9:16'] }
        },
        required: ['title', 'prompt']
      }
    },
    instructions: 'Produces a renderable high-resolution vector graphic / layout artifact.',
    preferredProvider: 'nvidianim'
  },

  generate_video_animation: {
    metadata: {
      name: 'generate_video_animation',
      description: 'Generates animated scenes, talking characters, and short-form video ads or clips via GonkaRouter Motion (Flow Engine).',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          concept: { type: 'string', description: 'Concept or script for the animated video clip or talking character.' },
          motion_type: { type: 'string', enum: ['talking_character', 'orbit', 'wave', 'particles', 'zoom'] }
        },
        required: ['title', 'concept']
      }
    },
    instructions: 'Produces a playable multi-scene HTML5 animation artifact with narration.',
    preferredProvider: 'nvidianim'
  },

  generate_audio_speech: {
    metadata: {
      name: 'generate_audio_speech',
      description: 'Generates natural-sounding voiceovers, musical tracks, sound effects, and multi-host audio podcasts from text or notes.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          audio_type: { type: 'string', enum: ['podcast', 'voiceover', 'music', 'sfx'] },
          script_or_notes: { type: 'string', description: 'Written text, notes, or musical mood to convert into audio.' }
        },
        required: ['title', 'audio_type', 'script_or_notes']
      }
    },
    instructions: 'Produces a playable Web Speech & Web Audio studio artifact.',
    preferredProvider: 'nvidianim'
  },

  generate_workflow_automation: {
    metadata: {
      name: 'generate_workflow_automation',
      description: 'Generates structured spreadsheets, business process flows, document synthesis, and automated email or scheduling sequences.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          objective: { type: 'string', description: 'The workflow, spreadsheet, or email/scheduling automation goal.' }
        },
        required: ['title', 'objective']
      }
    },
    instructions: 'Produces an interactive workflow DAG, spreadsheet, and automation sequence artifact.',
    preferredProvider: 'nvidianim'
  },
};

