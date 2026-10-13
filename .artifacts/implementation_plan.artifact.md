# DynamoDB Integration and Test Form Implementation Plan

Implement DynamoDB integration (`src/db.ts`) using `@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb`, and add a test form component (`src/components/DynamoDBTestForm.tsx`) to verify saving and fetching map markers to/from the `ai-markers` table.

## User Review Required

> [!IMPORTANT]
> - Ensure environment variables (`APP_AWS_REGION`, `APP_DYNAMODB_TABLE_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) are set in `.env` for local testing.
> - The DynamoDB table name configured in AWS Amplify environment variables is `ai-markers`.

## Open Questions

- None. The API structure (`saveMarker`, `getAllMarkers`) was specified by the deployment steps.

## Proposed Changes

### Database & SDK
#### [NEW] [db.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/src/db.ts)
- Initialize DynamoDB client with `process.env.APP_AWS_REGION` (or fallback to `import.meta.env.VITE_APP_AWS_REGION` / default region).
- Export `saveMarker(id, markerName, latitude, longitude)` and `getAllMarkers()`.

### Components
#### [NEW] [DynamoDBTestForm.tsx](file:///C:/Users/niyib/Downloads/ai-marker-hub/src/components/DynamoDBTestForm.tsx)
- Create a React test form to input marker name, latitude, longitude, and an ID (or generated via `uuid`).
- Call `saveMarker` on submit and display success/error messages.
- Fetch and display existing markers via `getAllMarkers()`.

#### [MODIFY] [App.tsx](file:///C:/Users/niyib/Downloads/ai-marker-hub/src/App.tsx)
- Optionally integrate `DynamoDBTestForm` into the workspace or settings for testing and verification.

## Verification Plan

### Automated Tests
- Run `npm run build` to ensure TypeScript compilation succeeds without errors.

### Manual Verification
- Render the test form, enter test marker details (e.g., name "Test Marker", lat "1.2921", lng "36.8219"), click "Save Marker", and verify successful write to DynamoDB and list retrieval.
