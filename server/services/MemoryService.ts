import { PrismaClient } from '@prisma/client';
import { AiService } from './AiService.js';
import { EmbeddingService } from './EmbeddingService.js';
import logger from '../utils/logger.js';

const prisma = new PrismaClient();

export class MemoryService {
  private static instance: MemoryService;
  private embeddingService = EmbeddingService.getInstance();

  private constructor() {}

  public static getInstance(): MemoryService {
    if (!MemoryService.instance) {
      MemoryService.instance = new MemoryService();
    }
    return MemoryService.instance;
  }

  /**
   * Fetches relevant memory for a user to ground the AI.
   * Now uses semantic vector search for higher accuracy.
   */
  private philosophyCache = new Map<string, { value: string, expires: number }>();

  public async getLongTermContext(userId: string, currentQuery?: string): Promise<string> {
    const settings = await prisma.userSettings.findUnique({ where: { userId } });
    if (!settings?.longTermMemory) return '';

    let contextData = "";

    if (currentQuery) {
       contextData = await this.searchMemory(userId, currentQuery);
    } else {
      // Optimized: Fetch only recent meaningful interactions
      const memories = await (prisma as any).memoryVector.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 3
      });
      contextData = memories.map((m: any) => `[RECENT]: ${m.content}`).join('\n');
    }

    // CROSS-SENSORY PERCEPTION GROUNDING: Group ingested multi-modal file records
    const files = await prisma.fileRecord.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 5
    });
    const fileContext = files.map(f => `[FILE INGESTED]: ${f.name} (${f.mimeType}). Text Snippet: ${f.extractedText?.slice(0, 200)}`).join('\n');

    // Pedagogical Style Extraction (Oracle tier)
    const philosophy = await this.getTeachingPhilosophy(userId);

    // User Preferences Extraction
    const preferences = await this.getUserPreferences(userId);

    return `
## LONG-TERM MEMORY (Bwenge Brain)
${contextData}

## MULTI-MODAL PERCEPTION SPACE
${fileContext}

## USER PREFERENCES & STYLE
${preferences}

## TEACHING PHILOSOPHY & DIRECTIVES
${philosophy}
    `.trim();
  }

  private async getUserPreferences(userId: string): Promise<string> {
    const settings = await prisma.userSettings.findUnique({ where: { userId } });
    if (!settings) return "No specific style preferences set.";
    return `Preferred Language: ${settings.language || 'English'}. Communication Style: ${settings.communicationStyle || 'Professional'}.`;
  }

  private async getTeachingPhilosophy(userId: string): Promise<string> {
    const cached = this.philosophyCache.get(userId);
    if (cached && cached.expires > Date.now()) return cached.value;

    const logs = await prisma.executionLog.findMany({
      where: { session: { userId }, actionType: 'VALIDATION' },
      take: 20,
      orderBy: { createdAt: 'desc' }
    });

    if (logs.length === 0) return "Persona: Collaborative Academic Partner.";

    const aiService = AiService.getInstance();
    const logSummary = logs.map(l => l.summary).join('\n');

    try {
      const summary = await aiService.sendClaudeChat(
        `Analyze these teacher validation logs and summarize the pedagogical style, tone, and specific marking preferences. Keep it under 100 words.\n\nLOGS:\n${logSummary}`,
        { system: "You are an expert educational psychologist. Extract teacher persona and preferences." }
      );

      const philosophy = summary.text;
      this.philosophyCache.set(userId, { value: philosophy, expires: Date.now() + 30 * 60 * 1000 }); // 30 min cache
      return philosophy;
    } catch (e) {
      logger.warn('Failed to extract LLM philosophy, using fallback');
      return "Persona: Professional Marker. Tone: Objective.";
    }
  }

  /**
   * Performs semantic search using cosine similarity on stored embeddings.
   */
  public async searchMemory(userId: string, query: string): Promise<string> {
    const queryVector = await this.embeddingService.getEmbedding(query);
    if (queryVector.length === 0) return "No semantic context found.";

    // PERFORMANCE: In a production app, we would use a vector database (Pinecone/pgvector).
    // For now, we fetch all and calculate in-memory, but we'll add a count limit.
    const allMemories = await (prisma as any).memoryVector.findMany({
      where: { userId },
      take: 500 // Safety cap for performance
    });

    const matches = allMemories
      .map((m: any) => ({
        content: m.content,
        similarity: this.embeddingService.cosineSimilarity(queryVector, JSON.parse(m.embedding))
      }))
      .filter((m: any) => m.similarity > 0.7) // Strict threshold for high-quality RAG
      .sort((a: any, b: any) => b.similarity - a.similarity)
      .slice(0, 5);

    if (matches.length === 0) return `No specific institutional memory for "${query}".`;

    return matches.map((m: any) => `[RECALL]: ${m.content}`).join('\n');
  }

  private async extractTeachingPhilosophy(userId: string): Promise<string> {
    const logs = await prisma.executionLog.findMany({
      where: { session: { userId }, actionType: 'VALIDATION' },
      take: 20
    });

    if (logs.length === 0) return "Persona: Collaborative Academic Partner.";

    const hasStrict = logs.some(l => l.summary?.toLowerCase().includes('strict'));
    const hasSocratic = logs.some(l => l.summary?.toLowerCase().includes('question'));

    return `Adopted Persona: ${hasStrict ? 'Strict IB Evaluator' : 'Supportive Pedagogical Guide'}.
Tone: ${hasSocratic ? 'Socratic (ask more, tell less)' : 'Direct & Authoritative'}.`;
  }

  /**
   * Stores a new interaction into vector memory.
   */
  public async addMemory(userId: string, content: string, metadata: any = {}) {
    const embedding = await this.embeddingService.getEmbedding(content);
    if (embedding.length === 0) return;

    await (prisma as any).memoryVector.create({
      data: {
        userId,
        content,
        embedding: JSON.stringify(embedding),
        metadata: JSON.stringify(metadata)
      }
    });
  }

  /**
   * Stores a summary of the current session into the memory.
   */
  public async consolidateSession(sessionId: string) {
    const session = await prisma.agentSession.findUnique({
      where: { id: sessionId },
      include: { logs: true }
    });

    if (!session || !session.logs.length) return;

    logger.info(`Consolidating memory for session ${sessionId}`);

    const aiService = AiService.getInstance();
    const logTape = session.logs.map(l => `[${l.actionType}]: ${l.summary}`).join('\n');

    try {
      const consolidation = await aiService.sendClaudeChat(
        `Summarize the key outcomes, specific rubric adjustments, and student performance patterns from this session logs. Format for long-term memory retrieval.\n\nLOGS:\n${logTape}`,
        { system: "You are the Bwenge Consolidation Engine. Extract permanent institutional knowledge." }
      );

      if (consolidation.text) {
        await this.addMemory(session.userId, consolidation.text, { sessionId, consolidated: true });
        logger.info(`Session ${sessionId} consolidated into Bwenge Brain.`);
      }
    } catch (e) {
      logger.error('Failed to consolidate session memory', e);
    }
  }
}
