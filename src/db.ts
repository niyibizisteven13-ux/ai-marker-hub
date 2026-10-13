import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

// 1. Initialize the client using your saved Amplify settings
const client = new DynamoDBClient({ region: process.env.APP_AWS_REGION || import.meta.env?.VITE_APP_AWS_REGION || "us-east-1" });
const docClient = DynamoDBDocumentClient.from(client);
const tableName = process.env.APP_DYNAMODB_TABLE_NAME || import.meta.env?.VITE_APP_DYNAMODB_TABLE_NAME || "ai-markers";

/**
 * Saves a new map marker or location item to DynamoDB
 */
export async function saveMarker(id: string, markerName: string, latitude: number | string, longitude: number | string) {
  const command = new PutCommand({
    TableName: tableName,
    Item: {
      id: id,                     // Required Partition Key
      name: markerName,
      lat: typeof latitude === 'string' ? parseFloat(latitude) : latitude,
      lng: typeof longitude === 'string' ? parseFloat(longitude) : longitude,
      createdAt: new Date().toISOString()
    },
  });
  return await docClient.send(command);
}

/**
 * Fetches all records from your DynamoDB table
 */
export async function getAllMarkers() {
  const command = new ScanCommand({ TableName: tableName });
  const response = await docClient.send(command);
  return response.Items || [];
}
