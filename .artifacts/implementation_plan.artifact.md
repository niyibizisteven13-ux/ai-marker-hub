# AWS Amplify Gen 2 Serverless Express Integration Plan

Migrate the backend API from a standalone Node/Express server (`server.ts`) to AWS Amplify Gen 2 Serverless Functions using `serverless-http` to wrap the existing Express app without rewriting route handlers.

## User Review Required

> [!IMPORTANT]
> - We are building a Vite + React SPA (Single Page Application), not Next.js.
> - We will use `serverless-http` to wrap our existing Express application (`server.ts`) inside an AWS Lambda function handler (`amplify/functions/api-handler/handler.ts`). This allows all 50+ Express routes (`/api/auth/refresh`, `/api/ai/chat`, `/api/studio/projects/workspace`, etc.) to run natively on AWS Lambda without manual rewriting.

## Open Questions

- None.

## Proposed Changes

### Configuration & Infrastructure
#### [NEW] [package.json modification / dependencies](file:///C:/Users/niyib/Downloads/ai-marker-hub/package.json)
- Add `@aws-amplify/backend`, `@aws-amplify/backend-cli`, and `serverless-http` to dependencies/devDependencies.

#### [NEW] [amplify/backend.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/amplify/backend.ts)
- Define Amplify backend configuration linking `apiHandler`.

#### [NEW] [amplify/functions/api-handler/resource.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/amplify/functions/api-handler/resource.ts)
- Define Amplify Gen 2 serverless function resource with 30s timeout and environment variables.

#### [NEW] [amplify/functions/api-handler/handler.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/amplify/functions/api-handler/handler.ts)
- Import the Express application from `server.ts` (or export/wrap it) and wrap it using `serverless-http` to handle incoming API Gateway proxy events.

## Verification Plan

### Automated Tests
- Run `npm run build` to verify TypeScript compilation and bundle generation.

### Manual Verification
- Commit and push to GitHub to test deployment on AWS Amplify Gen 2.
