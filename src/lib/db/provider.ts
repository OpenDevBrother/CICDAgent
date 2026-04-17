import type { PublicUser } from "./users";

const useDynamo = process.env.DB_PROVIDER === "dynamodb";

/* eslint-disable */
const impl = useDynamo
  ? require("./users.dynamo")
  : require("./users");

export const findUserByEmail = impl.findUserByEmail as (email: string) => Promise<any>;
export const findUserById = impl.findUserById as (id: string) => Promise<any>;
export const createUser = impl.createUser as (data: {
  name: string;
  email: string;
  password: string;
}) => Promise<any>;
export const updateUser = impl.updateUser as (
  id: string,
  data: Partial<{ name: string; image: string }>
) => Promise<any>;
export const deleteUserById = impl.deleteUserById as (id: string) => Promise<boolean>;
export const sanitizeUser = impl.sanitizeUser as (user: any) => PublicUser;

export type { PublicUser };
