import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

type GlobalWithDynamo = typeof globalThis & {
  _dynamoDocClient?: DynamoDBDocumentClient;
};

const g = global as GlobalWithDynamo;

function createDocClient(): DynamoDBDocumentClient {
  const region = process.env.AWS_REGION || process.env.AWS_BEDROCK_REGION || "us-east-1";
  const raw = new DynamoDBClient({ region });
  return DynamoDBDocumentClient.from(raw, {
    marshallOptions: { removeUndefinedValues: true },
  });
}

function getDocClient(): DynamoDBDocumentClient {
  if (process.env.NODE_ENV === "development") {
    if (!g._dynamoDocClient) {
      g._dynamoDocClient = createDocClient();
    }
    return g._dynamoDocClient;
  }
  return createDocClient();
}

export const dynamoClient = getDocClient();

export const SESSIONS_TABLE =
  process.env.DYNAMODB_TABLE_NAME || "SentinelQA";

export const NEXTAUTH_TABLE =
  process.env.DYNAMODB_NEXTAUTH_TABLE_NAME || "SentinelQA-NextAuth";
