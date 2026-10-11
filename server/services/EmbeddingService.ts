import { GoogleGenAI } from '@google/genai';
import logger from '../utils/logger.js';

export class EmbeddingService {
  private static instance: EmbeddingService;
  private client: GoogleGenAI | null;
  private readonly model = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2-preview';

  private constructor() {
    this.client = process.env.GEMINI_API_KEY
      ? new GoogleGenAI({
          apiKey: process.env.GEMINI_API_KEY,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            },
          },
        })
      : null;
  }

  public static getInstance(): EmbeddingService {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService();
    }
    return EmbeddingService.instance;
  }

  /**
   * Reports whether semantic retrieval can generate vectors in this environment.
   */
  public isAvailable(): boolean {
    return this.client !== null;
  }

  public getModelName(): string {
    return this.model;
  }

  /**
   * Generates embeddings in batches to avoid one provider request per chunk.
   */
  public async getEmbeddings(texts: string[], taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' = 'RETRIEVAL_DOCUMENT'): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (!this.client) throw new Error('GEMINI_API_KEY is required for semantic embeddings.');

    const vectors: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += 32) {
      const batch = texts.slice(offset, offset + 32);
      const result = await this.client.models.embedContent({
        model: this.model,
        contents: batch,
        config: { taskType },
      });
      const batchVectors = result.embeddings?.map((embedding) => embedding.values || []) || [];
      if (
        batchVectors.length !== batch.length ||
        batchVectors.some((vector) => vector.length === 0 || vector.some((value) => !Number.isFinite(value)))
      ) {
        throw new Error(`Embedding provider returned incomplete vectors for batch ${Math.floor(offset / 32) + 1}.`);
      }
      vectors.push(...batchVectors);
    }
    return vectors;
  }

  /**
   * Generates a vector embedding for a piece of text.
   */
  public async getEmbedding(text: string): Promise<number[]> {
    if (!this.isAvailable()) return [];
    try {
      return (await this.getEmbeddings([text]))[0] || [];
    } catch (err: any) {
      logger.error('Embedding generation failed:', err.message);
      return [];
    }
  }

  /**
   * Calculates cosine similarity between two vectors.
   */
  public cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length === 0 || vecA.length !== vecB.length) return 0;
    const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
    if (magnitudeA === 0 || magnitudeB === 0) return 0;
    return dotProduct / (magnitudeA * magnitudeB);
  }
}
