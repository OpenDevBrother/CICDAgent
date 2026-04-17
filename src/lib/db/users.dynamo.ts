import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { dynamoClient, NEXTAUTH_TABLE } from "@/lib/dynamodb";

export interface DBUser {
  id: string;
  name: string | null;
  email: string;
  emailVerified: Date | null;
  image: string | null;
  password?: string;
  provider?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicUser {
  id: string;
  name: string | null;
  email: string;
  emailVerified: Date | null;
  image: string | null;
  provider?: string;
  createdAt: Date;
}

function itemToUser(item: Record<string, unknown>): DBUser {
  return {
    id: String(item.id ?? ""),
    name: (item.name as string) ?? null,
    email: String(item.email ?? ""),
    emailVerified: item.emailVerified ? new Date(item.emailVerified as string) : null,
    image: (item.image as string) ?? null,
    password: item.password as string | undefined,
    provider: item.provider as string | undefined,
    createdAt: item.createdAt ? new Date(item.createdAt as string) : new Date(),
    updatedAt: item.updatedAt ? new Date(item.updatedAt as string) : new Date(),
  };
}

export async function findUserByEmail(email: string): Promise<DBUser | null> {
  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: NEXTAUTH_TABLE,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk AND GSI1SK = :sk",
      ExpressionAttributeValues: {
        ":pk": `USER#${email.toLowerCase()}`,
        ":sk": `USER#${email.toLowerCase()}`,
      },
    })
  );
  if (!result.Items?.length) return null;
  return itemToUser(result.Items[0]);
}

export async function findUserById(id: string): Promise<DBUser | null> {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: NEXTAUTH_TABLE,
      Key: { pk: `USER#${id}`, sk: `USER#${id}` },
    })
  );
  if (!result.Item) return null;
  return itemToUser(result.Item);
}

export async function createUser(data: {
  name: string;
  email: string;
  password: string;
}): Promise<DBUser> {
  const id = crypto.randomUUID();
  const now = new Date();
  const emailLower = data.email.toLowerCase();

  const item = {
    pk: `USER#${id}`,
    sk: `USER#${id}`,
    GSI1PK: `USER#${emailLower}`,
    GSI1SK: `USER#${emailLower}`,
    type: "USER",
    id,
    name: data.name,
    email: emailLower,
    emailVerified: null,
    image: null,
    password: data.password,
    provider: "credentials",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  await dynamoClient.send(new PutCommand({ TableName: NEXTAUTH_TABLE, Item: item }));

  return {
    id,
    name: data.name,
    email: emailLower,
    emailVerified: null,
    image: null,
    password: data.password,
    provider: "credentials",
    createdAt: now,
    updatedAt: now,
  };
}

export async function updateUser(
  id: string,
  data: Partial<Pick<DBUser, "name" | "image">>
): Promise<DBUser | null> {
  const sets: string[] = ["#updatedAt = :updatedAt"];
  const names: Record<string, string> = { "#updatedAt": "updatedAt" };
  const values: Record<string, unknown> = { ":updatedAt": new Date().toISOString() };

  if (data.name !== undefined) {
    sets.push("#name = :name");
    names["#name"] = "name";
    values[":name"] = data.name;
  }
  if (data.image !== undefined) {
    sets.push("#image = :image");
    names["#image"] = "image";
    values[":image"] = data.image;
  }

  const result = await dynamoClient.send(
    new UpdateCommand({
      TableName: NEXTAUTH_TABLE,
      Key: { pk: `USER#${id}`, sk: `USER#${id}` },
      UpdateExpression: `SET ${sets.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: "ALL_NEW",
    })
  );

  if (!result.Attributes) return null;
  return itemToUser(result.Attributes);
}

export async function deleteUserById(id: string): Promise<boolean> {
  const result = await dynamoClient.send(
    new DeleteCommand({
      TableName: NEXTAUTH_TABLE,
      Key: { pk: `USER#${id}`, sk: `USER#${id}` },
      ReturnValues: "ALL_OLD",
    })
  );
  return !!result.Attributes;
}

export function sanitizeUser(user: DBUser): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    image: user.image,
    provider: user.provider,
    createdAt: user.createdAt,
  };
}
