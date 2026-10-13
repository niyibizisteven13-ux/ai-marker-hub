# Walkthrough - AWS Amplify Gen 2 Serverless Backend with Express Wrapper

Integrated AWS Amplify Gen 2 Serverless Functions (`serverless-http`) to wrap the existing Express backend (`server.ts`), eliminating 404 Not Found errors on API routes without requiring manual rewrites.

## Changes

### Backend & Serverless Configuration
#### [NEW] [amplify/backend.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/amplify/backend.ts)
- Defined the Amplify Gen 2 backend linking `apiHandler`.

#### [NEW] [amplify/functions/api-handler/resource.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/amplify/functions/api-handler/resource.ts)
- Configured the serverless function definition with 30-second timeout and required environment variables (`DATABASE_URL`, `JWT_SECRET`, AI provider API keys).

#### [NEW] [amplify/functions/api-handler/handler.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/amplify/functions/api-handler/handler.ts)
- Wrapped the Express app using `serverless-http` to translate AWS Lambda API Gateway proxy events into Express requests and responses.

#### [MODIFY] [server.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/server.ts)
- Exported `app` so it can be imported and wrapped by the serverless handler.

#### [MODIFY] [package.json](file:///C:/Users/niyib/Downloads/ai-marker-hub/package.json)
- Added `@aws-amplify/backend`, `@aws-amplify/backend-cli`, `serverless-http`, and `@types/aws-lambda`.

## Verification Results

### Automated Tests
- Ran `npm run build` successfully. TypeScript compilation and Vite bundle production build passed with exit code 0.

### GitHub Deployment
- Committed and pushed all changes to `origin main` (`1793d98..d82c913`). AWS Amplify Gen 2 will automatically build and compile the serverless lambda backend on the next deploy.
