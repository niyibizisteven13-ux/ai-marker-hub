import { GoogleGenAI } from '@google/genai';
import logger from '../utils/logger.js';

export class EmbeddingService {
  private static instance: EmbeddingService;
  private client: GoogleGenAI;

  private constructor() {
    this.client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
  }

  public static getInstance(): EmbeddingService {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService();
    }
    return EmbeddingService.instance;
  }

  /**
   * Generates a vector embedding for a piece of text.
   */
  public async getEmbedding(text: string): Promise<number[]> {
    try {
      const result = await (this.client as any).models.embedContent({
        model: 'text-embedding-004',
        contents: [{ role: 'user', parts: [{ text }] }]
      });
      return result.embedding.values;
    } catch (err: any) {
      logger.error('Embedding generation failed:', err.message);
      return [];
    }
  }

  /**
   * Calculates cosine similarity between two vectors.
   */
  public cosineSimilarity(vecA: number[], vecB: number[]): number {
    const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
    if (magnitudeA === 0 || magnitudeB === 0) return 0;
    return dotProduct / (magnitudeA * magnitudeB);
  }
}
