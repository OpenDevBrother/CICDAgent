import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  UpdateTimeToLiveCommand,
  ResourceInUseException,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";

const region = process.env.AWS_REGION || process.env.AWS_BEDROCK_REGION || "us-east-1";
const client = new DynamoDBClient({ region });

const NEXTAUTH_TABLE = process.env.DYNAMODB_NEXTAUTH_TABLE_NAME || "SentinelQA-NextAuth";
const SESSIONS_TABLE = process.env.DYNAMODB_TABLE_NAME || "SentinelQA";

async function tableExists(name: string): Promise<boolean> {
  try {
    await client.send(new DescribeTableCommand({ TableName: name }));
    return true;
  } catch {
    return false;
  }
}

async function createNextAuthTable() {
  if (await tableExists(NEXTAUTH_TABLE)) {
    console.log(`Table ${NEXTAUTH_TABLE} already exists — skipping`);
    return;
  }

  console.log(`Creating table ${NEXTAUTH_TABLE}...`);
  try {
    await client.send(
      new CreateTableCommand({
        TableName: NEXTAUTH_TABLE,
        KeySchema: [
          { AttributeName: "pk", KeyType: "HASH" },
          { AttributeName: "sk", KeyType: "RANGE" },
        ],
        AttributeDefinitions: [
          { AttributeName: "pk", AttributeType: "S" },
          { AttributeName: "sk", AttributeType: "S" },
          { AttributeName: "GSI1PK", AttributeType: "S" },
          { AttributeName: "GSI1SK", AttributeType: "S" },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: "GSI1",
            KeySchema: [
              { AttributeName: "GSI1PK", KeyType: "HASH" },
              { AttributeName: "GSI1SK", KeyType: "RANGE" },
            ],
            Projection: { ProjectionType: "ALL" },
          },
        ],
        BillingMode: "PAY_PER_REQUEST",
      })
    );
    await waitUntilTableExists({ client, maxWaitTime: 120 }, { TableName: NEXTAUTH_TABLE });
    console.log(`Table ${NEXTAUTH_TABLE} created`);
  } catch (e) {
    if (e instanceof ResourceInUseException) {
      console.log(`Table ${NEXTAUTH_TABLE} already exists`);
    } else {
      throw e;
    }
  }
}

async function createSessionsTable() {
  if (await tableExists(SESSIONS_TABLE)) {
    console.log(`Table ${SESSIONS_TABLE} already exists — skipping`);
    return;
  }

  console.log(`Creating table ${SESSIONS_TABLE}...`);
  try {
    await client.send(
      new CreateTableCommand({
        TableName: SESSIONS_TABLE,
        KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
        AttributeDefinitions: [
          { AttributeName: "id", AttributeType: "S" },
          { AttributeName: "status", AttributeType: "S" },
          { AttributeName: "created_at", AttributeType: "S" },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: "StatusIndex",
            KeySchema: [
              { AttributeName: "status", KeyType: "HASH" },
              { AttributeName: "created_at", KeyType: "RANGE" },
            ],
            Projection: { ProjectionType: "ALL" },
          },
        ],
        BillingMode: "PAY_PER_REQUEST",
      })
    );
    await waitUntilTableExists({ client, maxWaitTime: 120 }, { TableName: SESSIONS_TABLE });
    console.log(`Table ${SESSIONS_TABLE} created`);

    console.log(`Enabling TTL on ${SESSIONS_TABLE}.ttl ...`);
    await client.send(
      new UpdateTimeToLiveCommand({
        TableName: SESSIONS_TABLE,
        TimeToLiveSpecification: {
          AttributeName: "ttl",
          Enabled: true,
        },
      })
    );
    console.log("TTL enabled");
  } catch (e) {
    if (e instanceof ResourceInUseException) {
      console.log(`Table ${SESSIONS_TABLE} already exists`);
    } else {
      throw e;
    }
  }
}

async function main() {
  console.log(`Region: ${region}`);
  console.log("---");
  await createNextAuthTable();
  await createSessionsTable();
  console.log("---");
  console.log("Done. Both tables ready.");
}

main().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
