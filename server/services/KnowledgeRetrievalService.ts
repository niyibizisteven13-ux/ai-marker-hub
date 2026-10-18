import { prisma } from '../db.js';
import { EmbeddingService } from './EmbeddingService.js';
import { buildKnowledgeAccessWhere } from './ai/dataScope.js';
import logger from '../utils/logger.js';

const embeddingService = EmbeddingService.getInstance();

/**
 * Stop words are stored WITHOUT accents, because tokens are accent-folded
 * before they are checked (see foldText).
 *
 * NOTE: the Kinyarwanda list is a conservative starter set of common function
 * words (conjunctions, demonstratives, negation). Have a native speaker review
 * and extend it using real queries from your logs.
 */
const STOP_WORDS = new Set([
  // English
  'about', 'after', 'again', 'against', 'also', 'among', 'and', 'any', 'are', 'because', 'been',
  'before', 'being', 'between', 'both', 'but', 'can', 'could', 'did', 'does', 'doing', 'down',
  'each', 'for', 'from', 'had', 'has', 'have', 'here', 'how', 'into', 'its', 'just', 'more',
  'most', 'now', 'off', 'once', 'only', 'other', 'our', 'out', 'over', 'same', 'should',
  'some', 'such', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they',
  'this', 'those', 'through', 'too', 'under', 'very', 'was', 'were', 'what', 'when', 'where',
  'which', 'while', 'who', 'why', 'will', 'with', 'would', 'you', 'your',
  // French (Rwanda is bilingual; many official documents are in French)
  'les', 'des', 'est', 'une', 'pour', 'dans', 'que', 'qui', 'pas', 'sur', 'avec', 'par', 'aux',
  'ces', 'ses', 'mais', 'sont', 'plus', 'ont', 'ete', 'etre', 'cette', 'comme', 'tout', 'tous',
  'leur', 'leurs', 'nous', 'vous', 'elle', 'ils', 'elles', 'aussi', 'donc', 'car', 'dont',
  'sans', 'sous', 'entre', 'fait', 'etait', 'avoir',
  // Kinyarwanda (starter set, needs native review)
  'kandi', 'cyangwa', 'ariko', 'kuko', 'ngo', 'niba', 'nka', 'iyo', 'uyu', 'uwo', 'iki', 'icyo',
  'aho', 'ntabwo', 'nta', 'byose', 'bose', 'yose', 'muri', 'kuri', 'ibyo', 'iyi', 'izo', 'abo',
  'aba', 'ubu', 'ubwo', 'ibi', 'iryo', 'ayo', 'noneho', 'rero', 'naho', 'none',
]);

const SYNONYM_GROUPS: Record<string, string[]> = {
  growth: ['growth', 'grow', 'grew', 'growing', 'increase', 'increased', 'increasing', 'rise', 'rose', 'rising'],
  economy: ['economy', 'economic', 'gdp', 'production', 'income'],
  education: ['education', 'school', 'student', 'students', 'enrollment', 'admission'],
  health: ['health', 'clinic', 'hospital', 'medical', 'wellbeing'],
};

function expandTerm(term: string): string[] {
  const normalized = foldText(term);
  const expansions = new Set<string>([normalized]);
  for (const [groupName, values] of Object.entries(SYNONYM_GROUPS)) {
    if (values.includes(normalized)) {
      for (const value of values) expansions.add(value);
      expansions.add(groupName);
    }
  }
  if (/^(grow|growth|grew|increase|increased|rise|rose|rising)$/.test(normalized)) {
    expansions.add('growth');
  }
  if (/^(econom|gdp|production|income)$/.test(normalized)) {
    expansions.add('economy');
  }
  return [...expansions];
}

export interface RankedKnowledgeChunk<T> {
  chunk: T;
  score: number;
  matchedTerms: number;
  semanticScore?: number;
  rerankScore?: number;
  retrievalMethod?: 'keyword' | 'semantic' | 'hybrid';
}

/** Lowercase and strip combining accents: "Développement" -> "developpement". */
function foldText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

/**
 * Unicode-aware tokenizer. The old /[a-z0-9]+/ pattern split French words at
 * every accented letter ("développement" -> "d", "veloppement"). Apostrophes
 * act as separators, which suits Kinyarwanda forms such as "bw'ibigori".
 * Pass fold=false to get raw lowercase tokens (used for the SQL pre-filter).
 */
function tokenize(value: string, fold = true): string[] {
  const text = fold ? foldText(value) : value.toLowerCase();
  const tokens = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  const expanded = new Set<string>();

  for (const token of tokens) {
    const folded = fold ? token : foldText(token);
    if ((folded.length < 3 && !/^\d{2,}$/.test(folded)) || STOP_WORDS.has(folded)) continue;
    for (const expandedToken of expandTerm(folded)) {
      if (expandedToken.length >= 2 || /^\d{2,}$/.test(expandedToken)) {
        expanded.add(expandedToken);
      }
    }
  }

  return [...expanded];
}

/**
 * Bantu-friendly fuzzy matching.
 *
 * Kinyarwanda attaches noun-class and verb prefixes ("ubuhinzi", "abahinzi",
 * "umuhinzi" all share the stem "hinzi"), so exact-token matching misses
 * obvious variants. We compare 5-character substrings that start at index >= 2
 * (so a bare prefix like "ubuhi" is never counted as a stem match). A fuzzy
 * match earns FUZZY_WEIGHT of the term's full weight. This also acts as a
 * cheap stemmer for English/French ("agriculture" ~ "agricultural").
 *
 * These constants are heuristics: tune them against your evaluation set.
 */
const FUZZY_GRAM_SIZE = 5;
const FUZZY_START_INDEX = 2;
const FUZZY_WEIGHT = 0.5;

function stemGrams(term: string): string[] {
  const grams: string[] = [];
  for (let i = FUZZY_START_INDEX; i + FUZZY_GRAM_SIZE <= term.length; i++) {
    grams.push(term.slice(i, i + FUZZY_GRAM_SIZE));
  }
  return grams;
}

export function rankKnowledgeChunks<T extends { text?: string | null }>(
  chunks: T[],
  query: string,
  options: { limit?: number; threshold?: number } = {},
): RankedKnowledgeChunk<T>[] {
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0 || chunks.length === 0) return [];

  const documents = chunks.map((chunk) => tokenize(String(chunk.text || '')));
  const documentFrequency = new Map<string, number>();
  for (const terms of documents) {
    for (const term of new Set(terms)) {
      documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
    }
  }

  const termWeights = queryTerms.map((term) =>
    Math.log(1 + (chunks.length - (documentFrequency.get(term) || 0) + 0.5) /
      ((documentFrequency.get(term) || 0) + 0.5)),
  );
  const totalWeight = termWeights.reduce((sum, weight) => sum + weight, 0);
  const threshold = options.threshold ?? 0.16;

  const queryGrams = queryTerms.map(stemGrams);
  // Built lazily: only chunks with unmatched query terms need their gram sets.
  const documentGrams: (Set<string> | undefined)[] = new Array(chunks.length);
  const getDocumentGrams = (index: number): Set<string> => {
    let grams = documentGrams[index];
    if (!grams) {
      grams = new Set<string>();
      for (const term of new Set(documents[index])) {
        for (const gram of stemGrams(term)) grams.add(gram);
      }
      documentGrams[index] = grams;
    }
    return grams;
  };

  return chunks
    .map((chunk, index) => {
      const frequencies = new Map<string, number>();
      for (const term of documents[index]) frequencies.set(term, (frequencies.get(term) || 0) + 1);
      let matchedWeight = 0;
      let matchedTerms = 0;
      for (let termIndex = 0; termIndex < queryTerms.length; termIndex++) {
        if (frequencies.has(queryTerms[termIndex])) {
          matchedWeight += termWeights[termIndex];
          matchedTerms++;
        } else if (queryGrams[termIndex].length > 0) {
          const grams = getDocumentGrams(index);
          if (queryGrams[termIndex].some((gram) => grams.has(gram))) {
            matchedWeight += FUZZY_WEIGHT * termWeights[termIndex];
            matchedTerms++;
          }
        }
      }
      const coverage = totalWeight > 0 ? matchedWeight / totalWeight : 0;
      const score = Number(coverage.toFixed(4));
      return { chunk, score, matchedTerms };
    })
    .filter((result) => result.matchedTerms > 0 && result.score >= threshold)
    .sort((a, b) => b.score - a.score || b.matchedTerms - a.matchedTerms)
    .slice(0, options.limit ?? 5);
}

/**
 * Cosine similarity cut-off for a semantic match. The right value depends on
 * the embedding model (multilingual models such as bge-m3 and e5 score
 * differently from English-only ones), so it can be overridden with
 * RAG_MIN_SEMANTIC_SIMILARITY. Calibrate it on your evaluation set.
 */
function defaultMinimumSemanticSimilarity(): number {
  const fromEnv = Number(process.env.RAG_MIN_SEMANTIC_SIMILARITY);
  return Number.isFinite(fromEnv) && fromEnv > 0 && fromEnv < 1 ? fromEnv : 0.55;
}

export function rankHybridKnowledgeChunks<T extends { text?: string | null; embedding?: string | number[] | null; metadata?: string | null }>(
  chunks: T[],
  query: string,
  queryEmbedding: number[] | null,
  options: { limit?: number; threshold?: number; minimumSemanticSimilarity?: number } = {},
): RankedKnowledgeChunk<T>[] {
  const limit = options.limit ?? 5;
  const threshold = options.threshold ?? 0.16;
  const minimumSemanticSimilarity = options.minimumSemanticSimilarity ?? defaultMinimumSemanticSimilarity();
  const lexical = rankKnowledgeChunks(chunks, query, { limit: chunks.length, threshold: 0 });
  const lexicalScores = new Map(lexical.map((result) => [result.chunk, result]));

  return chunks
    .map((chunk): RankedKnowledgeChunk<T> | null => {
      const lexicalResult = lexicalScores.get(chunk);
      let vector: number[] | null = null;
      if (Array.isArray(chunk.embedding)) {
        vector = chunk.embedding;
      } else if (typeof chunk.embedding === 'string') {
        try {
          const parsed: unknown = JSON.parse(chunk.embedding);
          if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'number' && Number.isFinite(value))) {
            vector = parsed;
          }
        } catch {
          vector = null;
        }
      }
      if (typeof chunk.metadata === 'string') {
        try {
          const metadata: unknown = JSON.parse(chunk.metadata);
          if (
            metadata &&
            typeof metadata === 'object' &&
            'embeddingModel' in metadata &&
            metadata.embeddingModel !== embeddingService.getModelName()
          ) {
            vector = null;
          }
        } catch {
          vector = null;
        }
      }

      const semanticScore =
        queryEmbedding && vector && queryEmbedding.length === vector.length
          ? embeddingService.cosineSimilarity(queryEmbedding, vector)
          : undefined;
      const hasSemanticMatch = semanticScore !== undefined && semanticScore >= minimumSemanticSimilarity;
      const hasLexicalMatch = Boolean(lexicalResult?.matchedTerms);
      if (!hasSemanticMatch && !hasLexicalMatch) return null;

      const score = hasSemanticMatch
        ? Number((0.65 * Math.max(0, semanticScore!) + 0.35 * (lexicalResult?.score || 0)).toFixed(4))
        : lexicalResult!.score;
      return {
        chunk,
        score,
        matchedTerms: lexicalResult?.matchedTerms || 0,
        semanticScore: semanticScore === undefined ? undefined : Number(semanticScore.toFixed(4)),
        retrievalMethod: hasSemanticMatch ? (hasLexicalMatch ? 'hybrid' as const : 'semantic' as const) : 'keyword' as const,
      };
    })
    .filter((result): result is RankedKnowledgeChunk<T> => result !== null && result.score >= threshold)
    .sort((a, b) => b.score - a.score || b.matchedTerms - a.matchedTerms)
    .slice(0, limit);
}

type BenchmarkChunk = {
  id: string;
  text?: string | null;
  embedding?: string | number[] | null;
  metadata?: string | null;
};

export interface RetrievalBenchmarkCase<T extends BenchmarkChunk> {
  query: string;
  chunks: T[];
  relevantChunkIds: string[];
  /**
   * Optional precomputed query embedding. When supplied, the benchmark runs the
   * SAME hybrid ranker that production uses; otherwise it is keyword-only.
   * The old benchmark only exercised the keyword ranker, so it could not tell
   * you whether embeddings or a model swap helped.
   */
  queryEmbedding?: number[] | null;
}

export function evaluateRetrievalBenchmark<T extends BenchmarkChunk>(
  cases: RetrievalBenchmarkCase<T>[],
  limit = 5,
) {
  let relevantFound = 0;
  let relevantTotal = 0;
  let reciprocalRankTotal = 0;
  let casesWithHit = 0;
  let hybridCases = 0;

  for (const benchmarkCase of cases) {
    const relevantIds = new Set(benchmarkCase.relevantChunkIds);
    const useHybrid = Boolean(benchmarkCase.queryEmbedding);
    if (useHybrid) hybridCases++;
    const ranked = useHybrid
      ? rankHybridKnowledgeChunks(benchmarkCase.chunks, benchmarkCase.query, benchmarkCase.queryEmbedding ?? null, {
          limit,
          threshold: 0,
        })
      : rankKnowledgeChunks(benchmarkCase.chunks, benchmarkCase.query, { limit, threshold: 0 });
    const firstRelevantIndex = ranked.findIndex(({ chunk }) => relevantIds.has(chunk.id));
    const found = ranked.filter(({ chunk }) => relevantIds.has(chunk.id)).length;
    relevantFound += found;
    relevantTotal += relevantIds.size;
    if (found > 0) casesWithHit++;
    if (firstRelevantIndex >= 0) reciprocalRankTotal += 1 / (firstRelevantIndex + 1);
  }

  return {
    recallAtK: relevantTotal ? relevantFound / relevantTotal : 0,
    precisionAtK: cases.length && limit > 0 ? relevantFound / (cases.length * limit) : 0,
    /** Share of questions where at least one correct chunk was retrieved: the easiest number to explain. */
    hitRateAtK: cases.length ? casesWithHit / cases.length : 0,
    meanReciprocalRank: cases.length ? reciprocalRankTotal / cases.length : 0,
    caseCount: cases.length,
    hybridCaseCount: hybridCases,
    limit,
  };
}

/**
 * Optional second-stage reranker (for example a cross-encoder such as
 * bge-reranker-v2-m3 served from your Python service). It receives the query
 * and candidate passages and must return one relevance score per passage, in
 * the same order. If it throws or returns bad data, retrieval falls back to the
 * hybrid ranking.
 */
export type KnowledgeReranker = (query: string, passages: string[]) => Promise<number[]>;

export async function retrieveKnowledgeChunks(
  query: string,
  options: {
    userId: string;
    knowledgeBaseId?: string;
    limit?: number;
    threshold?: number;
    /** Which RetrievalSetting row to read. Previously hard-coded to 'production'. */
    environment?: string;
    minimumSemanticSimilarity?: number;
    reranker?: KnowledgeReranker;
  },
) {
  const queryTerms = [...new Set(tokenize(query))];
  if (!options.userId || queryTerms.length === 0) return [];

  const memberships = await prisma.organizationMember.findMany({
    where: { userId: options.userId },
    select: { organizationId: true },
  });
  const organizationIds = memberships.map(({ organizationId }) => organizationId);

  // SQL pre-filter uses RAW (accented) lowercase terms, because the database
  // text is not folded. For longer words we also match the part after a likely
  // 3-letter prefix, so "ubuhinzi" still pulls in chunks containing "abahinzi".
  const databaseTerms = [...new Set(tokenize(query, false).flatMap((term) =>
    term.length >= 7 ? [term, term.slice(3)] : [term],
  ))];

  const readyKnowledgeWhere: any = {
    text: { not: '' },
    document: { status: 'READY' },
    knowledgeBase: { state: 'active' },
    status: 'approved',
  };
  if (options.knowledgeBaseId) readyKnowledgeWhere.knowledgeBaseId = options.knowledgeBaseId;
  const where = {
    AND: [
      readyKnowledgeWhere,
      buildKnowledgeAccessWhere(options.userId, organizationIds),
      {
        OR: [
          { embedding: { not: null } },
          ...databaseTerms.map((term) => ({ text: { contains: term, mode: 'insensitive' } })),
        ],
      },
    ],
  };

  const setting = await prisma.retrievalSetting.findUnique({
    where: { environment: options.environment ?? 'production' },
  });
  const threshold = options.threshold ?? setting?.threshold ?? 0.16;
  const limit = options.limit ?? setting?.topK ?? 6;
  const candidates = await prisma.documentChunk.findMany({
    where,
    take: 5_000,
    orderBy: { createdAt: 'desc' },
    include: { knowledgeBase: { select: { name: true } } },
  });

  let queryEmbedding: number[] | null = null;
  const embeddedCandidateCount = candidates.filter((candidate: any) => Boolean(candidate.embedding)).length;
  if (embeddingService.isAvailable() && embeddedCandidateCount > 0) {
    try {
      queryEmbedding = await embeddingService.getEmbeddings([query], 'RETRIEVAL_QUERY').then((vectors) => vectors[0]);
    } catch (error) {
      logger.warn('Semantic knowledge retrieval unavailable; using keyword retrieval for this query.', error);
    }
  } else if (embeddingService.isAvailable()) {
    logger.warn('Semantic embeddings are configured, but no eligible knowledge chunks have embeddings.');
  }

  // With a reranker, over-fetch so the reranker has something to reorder.
  const poolSize = options.reranker ? Math.max(limit * 4, 20) : limit;
  let results = rankHybridKnowledgeChunks(candidates, query, queryEmbedding, {
    limit: poolSize,
    threshold,
    minimumSemanticSimilarity: options.minimumSemanticSimilarity,
  });

  let reranked = false;
  if (options.reranker && results.length > 1) {
    try {
      const scores = await options.reranker(
        query,
        results.map((result) => String(result.chunk.text || '')),
      );
      if (
        Array.isArray(scores) &&
        scores.length === results.length &&
        scores.every((value) => Number.isFinite(value))
      ) {
        results = results
          .map((result, index) => ({ ...result, rerankScore: Number(scores[index].toFixed(4)) }))
          .sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0));
        reranked = true;
      } else {
        logger.warn('Knowledge reranker returned an unexpected result; keeping hybrid ranking.');
      }
    } catch (error) {
      logger.warn('Knowledge reranker failed; keeping hybrid ranking.', error);
    }
  }
  results = results.slice(0, limit);

  logger.info('Knowledge retrieval completed', {
    method: queryEmbedding ? 'hybrid' : 'keyword',
    reranked,
    candidateCount: candidates.length,
    embeddedCandidateCount,
    resultCount: results.length,
    topScore: results[0]?.score ?? null,
  });
  if (candidates.length === 5_000) {
    logger.warn('Knowledge retrieval reached the candidate cap; older chunks may not have been considered.');
  }
  return results;
}