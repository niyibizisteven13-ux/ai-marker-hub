import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const DB_FILE = path.resolve(process.cwd(), 'exports', 'local-db.json');

// Persistent Redis & Database Store backed by exports/local-db.json
const redisStore = new Map<string, any>();
const memoryTables = new Map<string, Map<string, any>>();

function loadFromDisk() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      if (parsed.redis && typeof parsed.redis === 'object') {
        for (const [k, v] of Object.entries(parsed.redis)) {
          redisStore.set(k, v);
        }
      }
      if (parsed.tables && typeof parsed.tables === 'object') {
        for (const [tableName, rows] of Object.entries(parsed.tables)) {
          const tableMap = new Map<string, any>();
          for (const [id, rec] of Object.entries(rows as Record<string, any>)) {
            tableMap.set(id, rec);
          }
          memoryTables.set(tableName, tableMap);
        }
      }
    }
  } catch (err) {
    console.warn('[Local DB] Could not load persisted state:', err);
  }
}

function saveToDisk() {
  try {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    const tablesObj: Record<string, Record<string, any>> = {};
    for (const [tableName, tableMap] of memoryTables.entries()) {
      tablesObj[tableName] = Object.fromEntries(tableMap.entries());
    }
    const payload = {
      redis: Object.fromEntries(redisStore.entries()),
      tables: tablesObj,
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Local DB] Could not save state to disk:', err);
  }
}

loadFromDisk();

export const redis = {
  get: async (k: string) => redisStore.get(k) ?? null,
  set: async (k: string, v: any) => { redisStore.set(k, v); saveToDisk(); return 'OK'; },
  setex: async (k: string, _ttl: number, v: any) => { redisStore.set(k, v); saveToDisk(); return 'OK'; },
  del: async (k: string) => { const ok = redisStore.delete(k); saveToDisk(); return ok; },
  incr: async (k: string) => { const n = (redisStore.get(k) || 0) + 1; redisStore.set(k, n); saveToDisk(); return n; },
  quit: async () => 'OK',
};

function getTable(name: string): Map<string, any> {
  if (!memoryTables.has(name)) {
    memoryTables.set(name, new Map<string, any>());
  }
  return memoryTables.get(name)!;
}

function matchesWhere(record: any, where: any): boolean {
  if (!where || typeof where !== 'object') return true;
  for (const [key, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    if (key === 'OR' && Array.isArray(cond)) {
      if (!cond.some((sub) => matchesWhere(record, sub))) return false;
      continue;
    }
    if (key === 'AND' && Array.isArray(cond)) {
      if (!cond.every((sub) => matchesWhere(record, sub))) return false;
      continue;
    }
    // Handle composite unique keys like userId_service: { userId, service }
    if (
      cond &&
      typeof cond === 'object' &&
      !Array.isArray(cond) &&
      !('in' in cond) &&
      !('notIn' in cond) &&
      !('not' in cond) &&
      !('contains' in cond) &&
      !('startsWith' in cond) &&
      !('endsWith' in cond) &&
      !('lt' in cond) &&
      !('gt' in cond) &&
      !('gte' in cond) &&
      !('lte' in cond) &&
      !(cond instanceof Date) &&
      key.includes('_')
    ) {
      for (const [subKey, subVal] of Object.entries(cond)) {
        if (record[subKey] !== subVal) return false;
      }
      continue;
    }
    const val = record[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as any;
      const caseInsensitive = c.mode === 'insensitive';
      const strVal = val === null || val === undefined ? '' : caseInsensitive ? String(val).toLowerCase() : String(val);

      if ('not' in c) {
        if (val === c.not) return false;
      }
      if ('in' in c && Array.isArray(c.in)) {
        if (!c.in.includes(val)) return false;
      }
      if ('notIn' in c && Array.isArray(c.notIn)) {
        if (c.notIn.includes(val)) return false;
      }
      if ('contains' in c) {
        const needle = caseInsensitive ? String(c.contains).toLowerCase() : String(c.contains);
        if (!strVal.includes(needle)) return false;
      }
      if ('startsWith' in c) {
        const needle = caseInsensitive ? String(c.startsWith).toLowerCase() : String(c.startsWith);
        if (!strVal.startsWith(needle)) return false;
      }
      if ('endsWith' in c) {
        const needle = caseInsensitive ? String(c.endsWith).toLowerCase() : String(c.endsWith);
        if (!strVal.endsWith(needle)) return false;
      }
      const compareVal = val instanceof Date ? val.getTime() : typeof val === 'string' && !Number.isNaN(Date.parse(val)) && (c.lt instanceof Date || c.lte instanceof Date || c.gt instanceof Date || c.gte instanceof Date) ? Date.parse(val) : val;
      const toComparable = (bound: any) => (bound instanceof Date ? bound.getTime() : bound);
      if ('lt' in c && !(compareVal < toComparable(c.lt))) return false;
      if ('lte' in c && !(compareVal <= toComparable(c.lte))) return false;
      if ('gt' in c && !(compareVal > toComparable(c.gt))) return false;
      if ('gte' in c && !(compareVal >= toComparable(c.gte))) return false;
    } else if (val !== cond) {
      return false;
    }
  }
  return true;
}

function sortRecords(records: any[], orderBy?: any): any[] {
  if (!orderBy) return records;
  const orders = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...records].sort((a, b) => {
    for (const ord of orders) {
      if (!ord || typeof ord !== 'object') continue;
      const [field, dir] = Object.entries(ord)[0] || [];
      if (!field) continue;
      const av = a?.[field];
      const bv = b?.[field];
      const aComparable = av instanceof Date ? av.getTime() : typeof av === 'string' && !Number.isNaN(Date.parse(av)) ? Date.parse(av) : av ?? '';
      const bComparable = bv instanceof Date ? bv.getTime() : typeof bv === 'string' && !Number.isNaN(Date.parse(bv)) ? Date.parse(bv) : bv ?? '';
      if (aComparable < bComparable) return dir === 'desc' ? 1 : -1;
      if (aComparable > bComparable) return dir === 'desc' ? -1 : 1;
    }
    return 0;
  });
}

function createModelMock(modelName: string) {
  const table = getTable(modelName);

  const enrichRecord = (rec: any, args?: any) => {
    if (!rec) return null;
    const copy = { ...rec };

    // Real dynamic relational counts
    if (args?.include?._count) {
      const docTable = getTable('document');
      const chunkTable = getTable('documentChunk');
      const exampleTable = getTable('datasetExample');
      const submissionTable = getTable('formSubmission');
      const resultTable = getTable('batchJobResult');

      const documentsCount = Array.from(docTable.values()).filter((d) => d.knowledgeBaseId === copy.id).length;
      const chunksCount = Array.from(chunkTable.values()).filter(
        (c) => c.knowledgeBaseId === copy.id || c.documentId === copy.id
      ).length;
      const examplesCount = Array.from(exampleTable.values()).filter((e) => e.datasetId === copy.id).length;
      const submissionsCount = Array.from(submissionTable.values()).filter((s) => s.formId === copy.id).length;
      const resultsCount = Array.from(resultTable.values()).filter((r) => r.jobId === copy.id).length;

      copy._count = {
        submissions: submissionsCount,
        results: resultsCount,
        chunks: chunksCount,
        documents: documentsCount,
        examples: examplesCount,
      };
    }

    if (args?.include?.knowledgeBase && copy.knowledgeBaseId) {
      const kb = getTable('knowledgeBase').get(String(copy.knowledgeBaseId));
      copy.knowledgeBase = kb ? { ...kb } : { id: copy.knowledgeBaseId, name: 'General Knowledge Base' };
    }
    if (args?.include?.dataset && copy.datasetId) {
      const ds = getTable('dataset').get(String(copy.datasetId));
      copy.dataset = ds ? { ...ds } : null;
    }
    if (args?.include?.jobs) {
      copy.jobs = Array.from(getTable('processingJob').values()).filter((j) => j.documentId === copy.id);
    }
    if (args?.include?.chunks) {
      copy.chunks = Array.from(getTable('documentChunk').values()).filter(
        (c) => c.documentId === copy.id || c.knowledgeBaseId === copy.id
      );
    }
    if (args?.include?.examples) {
      copy.examples = Array.from(getTable('datasetExample').values()).filter((e) => e.datasetId === copy.id);
    }
    if (args?.include?.submissions) {
      const rawSubs = Array.from(getTable('formSubmission').values()).filter((s) => s.formId === copy.id);
      const insightTable = getTable('extractedInsight');
      copy.submissions = rawSubs.map((s) => {
        const insight = Array.from(insightTable.values()).find((i) => i.submissionId === s.id) || null;
        return { ...s, extractedInsights: insight };
      });
    }
    if (args?.include?.extractedInsights) {
      const insightTable = getTable('extractedInsight');
      copy.extractedInsights =
        Array.from(insightTable.values()).find((i) => i.submissionId === copy.id) || copy.extractedInsights || null;
    }
    if (args?.include?.form && copy.formId) {
      const formRec = getTable('applicationForm').get(String(copy.formId));
      copy.form = formRec ? { ...formRec } : null;
    }
    if (args?.include?.submission && copy.submissionId) {
      const subRec = getTable('formSubmission').get(String(copy.submissionId));
      copy.submission = subRec ? { ...subRec } : null;
    }
    if (args?.include?.results) {
      copy.results = Array.from(getTable('batchJobResult').values()).filter((r) => r.jobId === copy.id);
    }
    if (args?.include?.logs && !Array.isArray(copy.logs)) {
      copy.logs = Array.from(getTable('executionLog').values()).filter((l) => l.sessionId === copy.id);
    }
    if (args?.include?.versions) {
      const versionRows = Array.from(getTable('promptVersion').values()).filter((v) => v.promptId === copy.id);
      if (versionRows.length > 0) {
        copy.versions = sortRecords(versionRows, { version: 'desc' });
      } else if (!Array.isArray(copy.versions)) {
        copy.versions = [];
      }
    }
    if (args?.include?.members) {
      copy.members = Array.from(getTable('organizationMember').values()).filter((m) => m.organizationId === copy.id);
    }
    if (args?.include?.settings && copy.settings === undefined) {
      copy.settings = {
        id: `settings-${copy.id || 'default'}`,
        userId: copy.id,
        defaultStrictness: 'STANDARD',
        autoSummarize: true,
        preferredLanguage: 'en',
        theme: 'dark',
        longTermMemory: false,
        agentTone: 'PROFESSIONAL',
        customInstructions: null,
      };
    }
    return copy;
  };

  return {
    findMany: async (args?: any) => {
      const filtered = Array.from(table.values()).filter((r) => matchesWhere(r, args?.where));
      const sorted = sortRecords(filtered, args?.orderBy);
      const sliced = typeof args?.take === 'number' ? sorted.slice(0, args.take) : sorted;
      return sliced.map((r) => enrichRecord(r, args));
    },
    findFirst: async (args?: any) => {
      const filtered = Array.from(table.values()).filter((r) => matchesWhere(r, args?.where));
      const sorted = sortRecords(filtered, args?.orderBy);
      return sorted.length > 0 ? enrichRecord(sorted[0], args) : null;
    },
    findUnique: async (args?: any) => {
      if (!args?.where) return null;
      if (typeof args.where.id === 'string' && table.has(args.where.id)) {
        return enrichRecord(table.get(args.where.id), args);
      }
      for (const r of table.values()) {
        if (matchesWhere(r, args.where)) return enrichRecord(r, args);
      }
      return null;
    },
    create: async (args?: any) => {
      const now = new Date();
      const rawData = { ...(args?.data || {}) };
      const id = rawData.id || rawData.userId || rawData.environment || crypto.randomUUID();
      if (rawData.settings?.create) {
        rawData.settings = {
          id: crypto.randomUUID(),
          defaultStrictness: 'STANDARD',
          autoSummarize: true,
          preferredLanguage: 'en',
          theme: 'dark',
          longTermMemory: false,
          agentTone: 'PROFESSIONAL',
          customInstructions: null,
          ...rawData.settings.create,
        };
      }
      if (rawData.versions?.create) {
        const verItems = Array.isArray(rawData.versions.create) ? rawData.versions.create : [rawData.versions.create];
        const verTable = getTable('promptVersion');
        const createdVersions = verItems.map((v: any) => {
          const verId = v.id || crypto.randomUUID();
          const verRec = {
            id: verId,
            promptId: String(id),
            version: v.version ?? 1,
            environment: v.environment || 'draft',
            active: Boolean(v.active),
            text: v.text || '',
            createdAt: now,
          };
          verTable.set(String(verId), verRec);
          return verRec;
        });
        rawData.versions = createdVersions;
      }
      const record = {
        id,
        createdAt: now,
        updatedAt: now,
        ...rawData,
      };
      table.set(String(id), record);
      saveToDisk();
      return enrichRecord(record, args);
    },
    update: async (args?: any) => {
      let existing: any = null;
      for (const r of table.values()) {
        if (matchesWhere(r, args?.where)) {
          existing = r;
          break;
        }
      }
      const now = new Date();
      const updates = { ...(args?.data || {}) };
      for (const [k, v] of Object.entries(updates)) {
        if (v && typeof v === 'object' && 'increment' in (v as any) && existing) {
          updates[k] = (Number(existing[k]) || 0) + Number((v as any).increment);
        } else if (v && typeof v === 'object' && 'decrement' in (v as any) && existing) {
          updates[k] = (Number(existing[k]) || 0) - Number((v as any).decrement);
        }
      }
      const updated = {
        ...(existing || { id: args?.where?.id || crypto.randomUUID(), createdAt: now }),
        ...updates,
        updatedAt: now,
      };
      table.set(String(updated.id), updated);
      saveToDisk();
      return enrichRecord(updated, args);
    },
    updateMany: async (args?: any) => {
      let count = 0;
      const now = new Date();
      for (const [id, r] of table.entries()) {
        if (matchesWhere(r, args?.where)) {
          table.set(id, { ...r, ...(args?.data || {}), updatedAt: now });
          count++;
        }
      }
      saveToDisk();
      return { count };
    },
    upsert: async (args?: any) => {
      for (const r of table.values()) {
        if (matchesWhere(r, args?.where)) {
          const updated = { ...r, ...(args?.update || {}), updatedAt: new Date() };
          table.set(String(updated.id), updated);
          saveToDisk();
          return enrichRecord(updated, args);
        }
      }
      const now = new Date();
      const rawCreate = { ...(args?.create || {}) };
      const id = rawCreate.id || rawCreate.userId || rawCreate.environment || rawCreate.provider || crypto.randomUUID();
      const created = { id, createdAt: now, updatedAt: now, ...rawCreate };
      table.set(String(id), created);
      saveToDisk();
      return enrichRecord(created, args);
    },
    delete: async (args?: any) => {
      for (const [id, r] of table.entries()) {
        if (matchesWhere(r, args?.where)) {
          table.delete(id);
          saveToDisk();
          return r;
        }
      }
      return {};
    },
    deleteMany: async (args?: any) => {
      let count = 0;
      for (const [id, r] of table.entries()) {
        if (matchesWhere(r, args?.where)) {
          table.delete(id);
          count++;
        }
      }
      saveToDisk();
      return { count };
    },
    count: async (args?: any) => {
      return Array.from(table.values()).filter((r) => matchesWhere(r, args?.where)).length;
    },
    aggregate: async (args?: any) => {
      const rows = Array.from(table.values()).filter((r) => matchesWhere(r, args?.where));
      const sumObj: Record<string, number> = {};
      if (args?._sum) {
        for (const k of Object.keys(args._sum)) {
          sumObj[k] = rows.reduce((acc, r) => acc + (Number(r?.[k]) || 0), 0);
        }
      }
      const avgObj: Record<string, number> = {};
      if (args?._avg) {
        for (const k of Object.keys(args._avg)) {
          avgObj[k] = rows.length > 0 ? rows.reduce((acc, r) => acc + (Number(r?.[k]) || 0), 0) / rows.length : 0;
        }
      }
      let countRes: any = rows.length;
      if (args?._count && typeof args._count === 'object') {
        countRes = {};
        for (const k of Object.keys(args._count)) {
          countRes[k] = rows.length;
        }
      }
      return { _sum: sumObj, _avg: avgObj, _count: countRes };
    },
  };
}

let realPrisma: PrismaClient | null = null;
let dbAvailable = Boolean(process.env.DATABASE_URL);

if (dbAvailable) {
  try {
    realPrisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  } catch {
    console.warn('[AI Studio] Database not connected — using mock');
    dbAvailable = false;
  }
} else {
  console.warn('[AI Studio] Database not connected — using mock');
}

const mockClient: any = new Proxy(
  {
    $connect: async () => {},
    $disconnect: async () => {},
    $queryRaw: async () => [{ 1: 1 }],
    $executeRaw: async () => 0,
    $transaction: async (arg: any) => {
      if (typeof arg === 'function') return arg(mockClient);
      if (Array.isArray(arg)) return Promise.all(arg);
      return [];
    },
  },
  {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return createModelMock(prop);
    },
  }
);

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop: string) {
    if (!dbAvailable || !realPrisma) {
      return mockClient[prop];
    }
    const realProp = (realPrisma as any)[prop];
    if (typeof realProp === 'function') {
      return async (...args: any[]) => {
        try {
          return await realProp.apply(realPrisma, args);
        } catch {
          dbAvailable = false;
          console.warn('[AI Studio] Database not connected — using mock');
          return mockClient[prop](...args);
        }
      };
    }
    if (realProp && typeof realProp === 'object') {
      return new Proxy(realProp, {
        get(modelTarget, method: string) {
          const origMethod = modelTarget[method];
          if (typeof origMethod !== 'function') return origMethod;
          return async (...args: any[]) => {
            if (!dbAvailable) return mockClient[prop][method](...args);
            try {
              return await origMethod.apply(modelTarget, args);
            } catch {
              dbAvailable = false;
              console.warn('[AI Studio] Database not connected — using mock');
              return mockClient[prop][method](...args);
            }
          };
        },
      });
    }
    return mockClient[prop];
  },
});

