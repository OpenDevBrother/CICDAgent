import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { dynamoClient, SESSIONS_TABLE } from "../dynamodb";
import type { TestPlanInput, TestRunOutput, SessionStatus } from "./types";

export interface PersistedSession {
  id: string;
  status: SessionStatus;
  input: TestPlanInput;
  output?: TestRunOutput;
  created_at: string;
  completed_at?: string;
  error?: string;
  agents?: Record<string, { status: string; updated_at: string }>;
  checkpoint_data?: unknown;
  courier_result?: { type: "pr" | "issue"; url?: string; number?: number };
}

const TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export class SessionManager {
  async createSession(input: TestPlanInput): Promise<PersistedSession> {
    const now = new Date();
    const session: PersistedSession = {
      id: input.session_id,
      status: "pending",
      input,
      created_at: now.toISOString(),
    };

    try {
      await dynamoClient.send(
        new PutCommand({
          TableName: SESSIONS_TABLE,
          Item: {
            ...session,
            ttl: Math.floor(now.getTime() / 1000) + TTL_SECONDS,
          },
          ConditionExpression: "attribute_not_exists(id)",
        })
      );
    } catch (e: unknown) {
      if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
        const existing = await this.getSession(input.session_id);
        if (existing) return existing;
      } else {
        throw e;
      }
    }

    console.log(`[Session Manager] Created session ${session.id}`);
    return session;
  }

  async getSession(id: string): Promise<PersistedSession | null> {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: SESSIONS_TABLE,
        Key: { id },
      })
    );
    if (!result.Item) return null;
    return this.stripInternal(result.Item);
  }

  async updateStatus(id: string, status: SessionStatus, error?: string): Promise<void> {
    const sets = ["#status = :status"];
    const names: Record<string, string> = { "#status": "status" };
    const values: Record<string, unknown> = { ":status": status };

    if (error) {
      sets.push("#error = :error");
      names["#error"] = "error";
      values[":error"] = error;
    }
    if (status === "completed" || status === "failed") {
      sets.push("completed_at = :completed_at");
      values[":completed_at"] = new Date().toISOString();
    }

    await dynamoClient.send(
      new UpdateCommand({
        TableName: SESSIONS_TABLE,
        Key: { id },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      })
    );
  }

  async setOutput(id: string, output: TestRunOutput): Promise<void> {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: SESSIONS_TABLE,
        Key: { id },
        UpdateExpression: "SET #output = :output, #status = :status, completed_at = :completed_at",
        ExpressionAttributeNames: { "#output": "output", "#status": "status" },
        ExpressionAttributeValues: {
          ":output": output,
          ":status": output.failed > 0 ? "failed" : "completed",
          ":completed_at": new Date().toISOString(),
        },
      })
    );
  }

  async updateAgentStatus(sessionId: string, agentName: string, status: string): Promise<void> {
    const val = { status, updated_at: new Date().toISOString() };

    try {
      await dynamoClient.send(
        new UpdateCommand({
          TableName: SESSIONS_TABLE,
          Key: { id: sessionId },
          UpdateExpression: "SET agents.#agent = :val",
          ExpressionAttributeNames: { "#agent": agentName },
          ExpressionAttributeValues: { ":val": val },
          ConditionExpression: "attribute_exists(agents)",
        })
      );
    } catch (e: unknown) {
      if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
        await dynamoClient.send(
          new UpdateCommand({
            TableName: SESSIONS_TABLE,
            Key: { id: sessionId },
            UpdateExpression: "SET agents = :agents",
            ExpressionAttributeValues: { ":agents": { [agentName]: val } },
          })
        );
      } else {
        throw e;
      }
    }
  }

  async setCourierResult(
    sessionId: string,
    result: { type: "pr" | "issue"; url?: string; number?: number }
  ): Promise<void> {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: SESSIONS_TABLE,
        Key: { id: sessionId },
        UpdateExpression: "SET courier_result = :r",
        ExpressionAttributeValues: { ":r": result },
      })
    );
  }

  async setCheckpoint(sessionId: string, data: unknown): Promise<void> {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: SESSIONS_TABLE,
        Key: { id: sessionId },
        UpdateExpression: "SET checkpoint_data = :d",
        ExpressionAttributeValues: { ":d": data },
      })
    );
  }

  async listSessions(statusFilter?: SessionStatus): Promise<PersistedSession[]> {
    if (statusFilter) {
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: SESSIONS_TABLE,
          IndexName: "StatusIndex",
          KeyConditionExpression: "#status = :status",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":status": statusFilter },
          ScanIndexForward: false,
          Limit: 50,
        })
      );
      return (result.Items || []).map((i) => this.stripInternal(i));
    }

    const result = await dynamoClient.send(
      new ScanCommand({
        TableName: SESSIONS_TABLE,
        Limit: 50,
      })
    );
    const items = (result.Items || []).map((i) => this.stripInternal(i));
    items.sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
    return items;
  }

  async deleteSession(id: string): Promise<boolean> {
    const result = await dynamoClient.send(
      new DeleteCommand({
        TableName: SESSIONS_TABLE,
        Key: { id },
        ReturnValues: "ALL_OLD",
      })
    );
    return !!result.Attributes;
  }

  async clearAll(): Promise<void> {
    let lastKey: Record<string, unknown> | undefined;
    do {
      const scan = await dynamoClient.send(
        new ScanCommand({
          TableName: SESSIONS_TABLE,
          ProjectionExpression: "id",
          ExclusiveStartKey: lastKey,
        })
      );
      const items = scan.Items || [];
      lastKey = scan.LastEvaluatedKey;

      for (let i = 0; i < items.length; i += 25) {
        const batch = items.slice(i, i + 25).map((item) => ({
          DeleteRequest: { Key: { id: item.id } },
        }));
        await dynamoClient.send(
          new BatchWriteCommand({
            RequestItems: { [SESSIONS_TABLE]: batch },
          })
        );
      }
    } while (lastKey);
  }

  private stripInternal(item: Record<string, unknown>): PersistedSession {
    const { ttl: _ttl, ...rest } = item;
    return rest as unknown as PersistedSession;
  }
}

export const sessionManager = new SessionManager();
