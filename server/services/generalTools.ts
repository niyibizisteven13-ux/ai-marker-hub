import Anthropic from '@anthropic-ai/sdk';

/**
 * INITIAL MINIMAL TOOLS (Pillar 1: Progressive Disclosure)
 * Bwenge starts with these lightweight tools.
 * Heavy logic is loaded on-demand via load_specialized_tool.
 */
export const generalTools: Anthropic.Tool[] = [
  {
    name: 'load_specialized_tool',
    description: 'Dynamically pulls the full instruction schema and exact sub-scripts for a complex tool into the active context window.',
    input_schema: {
      type: 'object',
      properties: {
        tool_name: {
            type: 'string',
            enum: ['analyze_data_with_python', 'build_form', 'research_memory', 'delegate_task', 'cross_curriculum_check', 'research_curriculum_standards', 'generate_browser_extension']
        }
      },
      required: ['tool_name']
    }
  },
  {
    name: 'delegate_task',
    description: 'Spawns a specialized sub-agent. This is bi-directional; sub-agents can negotiate parameters.',
    input_schema: {
      type: 'object',
      properties: {
        agent_type: { type: 'string', enum: ['researcher', 'writer', 'reviewer', 'math_specialist'] },
        instructions: { type: 'string' },
        context_data: { type: 'string' }
      },
      required: ['agent_type', 'instructions']
    }
  },
  {
    name: 'store_session_variable',
    description: 'Pillar 4: RAM Storage. Holds volatile task data (loop counters, temp paths) outside the main context window.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        value: { type: 'string' }
      },
      required: ['key', 'value']
    }
  },
  {
    name: 'generate_visual_annotation',
    description: 'Suggests visual highlighting coordinates for the user interface.',
    input_schema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        label: { type: 'string' },
        reason: { type: 'string', description: 'Brief explanation of why this highlight was generated.' },
        type: { type: 'string', enum: ['error', 'evidence', 'stamp'] },
        coordinates: {
            type: 'object',
            properties: {
                x: { type: 'number' },
                y: { type: 'number' },
                width: { type: 'number' },
                height: { type: 'number' }
            }
        }
      },
      required: ['x', 'y', 'label']
    }
  },
  {
    name: 'cross_reference_visuals',
    description: 'Instructs the Bwenge Vision Engine to re-examine the visual attachments (images/PDFs) with high focus on specific details or coordinates. Use this when OCR text is ambiguous or handwriting is unclear.',
    input_schema: {
      type: 'object',
      properties: {
        focus_area: { type: 'string', description: 'Describe what detail needs verification (e.g. "Question 4 marks", "Student handwriting in margin")' },
        coordinates: {
            type: 'object',
            properties: {
                x: { type: 'number' },
                y: { type: 'number' },
                width: { type: 'number' },
                height: { type: 'number' }
            }
        }
      },
      required: ['focus_area']
    }
  }
];
