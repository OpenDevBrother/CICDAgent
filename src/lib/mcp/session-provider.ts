const useDynamo = process.env.DB_PROVIDER === "dynamodb";

/* eslint-disable */
const impl = useDynamo
  ? require("./session-manager.dynamo")
  : require("./session-manager");

export const sessionManager = impl.sessionManager;
export const SessionManager = impl.SessionManager;
export type { PersistedSession } from "./session-manager";
