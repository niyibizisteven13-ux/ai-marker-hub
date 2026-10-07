import { Queue, Worker, Job } from 'bullmq';
import net from 'net';
import Redis from 'ioredis';

export class QueueService {
  private static instance: QueueService;
  private gradingQueue: Queue | null = null;
  private isRedisAvailable: boolean = false;
  private redisConnection = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
  };
  private connection: Redis | null = null;

  private constructor() {}

  public static getInstance(): QueueService {
    if (!QueueService.instance) {
      QueueService.instance = new QueueService();
    }
    return QueueService.instance;
  }

  public async initialize() {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true, connectTimeout: 5000 });
      try {
        await this.connection.connect();
        this.isRedisAvailable = true;
      } catch (error) {
        this.isRedisAvailable = false;
        if (process.env.NODE_ENV === 'production') throw new Error(`REDIS_URL is configured but Redis is unreachable: ${error instanceof Error ? error.message : 'connection failed'}`);
      }
    } else {
      this.isRedisAvailable = await this.checkRedisAvailability();
    }

    if (process.env.NODE_ENV === 'production' && !this.isRedisAvailable) {
      throw new Error('Redis is required in production for durable background jobs. Configure REDIS_URL.');
    }

    if (!this.isRedisAvailable) {
      console.warn('Redis is not available. Batch grading queue is disabled.');
      return;
    }

    try {
      this.gradingQueue = new Queue('exam-grading-queue', { connection: this.connection || this.redisConnection });
    } catch (error) {
      this.isRedisAvailable = false;
      console.error('Failed to initialize BullMQ queue:', error);
      if (process.env.NODE_ENV === 'production') throw error;
    }
  }

  private async checkRedisAvailability(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.createConnection(this.redisConnection);
      socket.setTimeout(1000);
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('timeout', () => { socket.destroy(); resolve(false); });
      socket.once('error', () => { socket.destroy(); resolve(false); });
    });
  }

  public getQueue() {
    return this.gradingQueue;
  }

  public getIsRedisAvailable() {
    return this.isRedisAvailable;
  }

  public async addJob(name: string, data: any) {
    if (!this.gradingQueue) throw new Error('Queue is not initialized or Redis is unavailable.');
    return this.gradingQueue.add(name, data);
  }

  public async getJob(jobId: string) {
    if (!this.gradingQueue) return null;
    return this.gradingQueue.getJob(jobId);
  }

  public async close() {
    await this.gradingQueue?.close();
    await this.connection?.quit().catch(() => undefined);
    this.gradingQueue = null;
    this.connection = null;
  }
}
