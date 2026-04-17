import type { AuthOptions } from "next-auth";

const useDynamo = process.env.DB_PROVIDER === "dynamodb";

/* eslint-disable */
const impl = useDynamo
  ? require("./auth.dynamo")
  : require("./auth");

export const authOptions: AuthOptions = impl.authOptions;
