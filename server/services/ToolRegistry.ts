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
  }
};
