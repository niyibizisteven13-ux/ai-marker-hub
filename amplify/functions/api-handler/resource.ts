import { defineFunction } from '@aws-amplify/backend';

export const apiHandler = defineFunction({
  name: 'api-handler',
  entry: './handler.ts',
  environment: {
    DATABASE_URL: process.env.APP_DATABASE_URL || process.env.DATABASE_URL || '',
    JWT_SECRET: process.env.APP_JWT_SECRET || process.env.JWT_SECRET || '',
    GONKA_API_KEY: process.env.APP_GONKA_API_KEY || process.env.GONKA_API_KEY || '',
    GEMINI_API_KEY: process.env.APP_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '',
    ANTHROPIC_API_KEY: process.env.APP_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '',
    OPENAI_API_KEY: process.env.APP_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '',
    NVIDIA_NIM_API_KEY: process.env.APP_NVIDIA_NIM_API_KEY || process.env.NVIDIA_NIM_API_KEY || '',
    AI_PROVIDER: 'gonkarouter'
  },
  timeoutSeconds: 30
});
