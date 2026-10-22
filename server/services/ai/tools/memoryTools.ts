import type { Tool, ToolServices } from '../types.js';
import { err, untrusted } from './helpers.js';

/** Memory across chats: the assistant saves lasting facts and preferences, looks them up, and forgets on request. */
export function memoryTools(services: ToolServices): Tool[] {
  const mem = services.memory;
  if (!mem) return [];
  const remember: Tool = {
    definition: {
      name: 'remember',
      description: 'Save a lasting fact or preference about the user to their memory across chats (name, role, school, subjects, levels, projects, preferred style or language). Save only what will matter in future chats, in one short third-person sentence. Never save passwords, codes, card numbers or health details.',
      parameters: { type: 'object', required: ['content'], properties: { content: { type: 'string', maxLength: 500 }, kind: { type: 'string', enum: ['fact', 'preference', 'note'], default: 'fact' } } },
    },
    async execute(input, ctx) {
      try { return { text: await mem.remember(ctx.userId, String(input.content), input.kind ?? 'fact') }; } catch (e: any) { return err(String(e?.message ?? e).slice(0, 240)); }
    },
  };
  const recall: Tool = {
    definition: {
      name: 'recall_memory',
      description: 'Search the user\'s memory from earlier chats (facts, preferences, notes, past topics). Use it when the user refers to something from before ("as I told you", "last week", "my class").',
      parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } },
    },
    async execute(input, ctx) {
      try {
        const hits = await mem.recall(ctx.userId, String(input.query));
        if (!hits.length) return { text: 'Nothing in memory matches. Ask the user instead of guessing.' };
        return { text: untrusted('MEMORY', hits.map((h) => `- (${h.kind}, ${h.createdAt.slice(0, 10)}) ${h.content}`).join('\n')) };
      } catch (e: any) { return err(String(e?.message ?? e).slice(0, 240)); }
    },
  };
  const forget: Tool = {
    definition: {
      name: 'forget_memory',
      description: 'Delete memories that match what the user asks you to forget.',
      parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } },
    },
    async execute(input, ctx) {
      try { const n = await mem.forget(ctx.userId, String(input.query)); return { text: n ? `Deleted ${n} memor${n > 1 ? 'ies' : 'y'}.` : 'No matching memory was found.' }; } catch (e: any) { return err(String(e?.message ?? e).slice(0, 240)); }
    },
  };
  return [remember, recall, forget];
}
