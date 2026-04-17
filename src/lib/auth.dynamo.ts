import { type NextAuthOptions } from "next-auth";
import GithubProvider from "next-auth/providers/github";
import GitLabProvider from "next-auth/providers/gitlab";
import { DynamoDBAdapter } from "@auth/dynamodb-adapter";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { NEXTAUTH_TABLE } from "@/lib/dynamodb";

const region = process.env.AWS_REGION || process.env.AWS_BEDROCK_REGION || "us-east-1";
const rawClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocument.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});

export const authOptions: NextAuthOptions = {
  adapter: DynamoDBAdapter(docClient, {
    tableName: NEXTAUTH_TABLE,
  }) as NextAuthOptions["adapter"],

  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },

  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_ID!,
      clientSecret: process.env.GITHUB_SECRET!,
    }),

    GitLabProvider({
      clientId: process.env.GITLAB_ID!,
      clientSecret: process.env.GITLAB_SECRET!,
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        (session.user as { id?: string }).id = token.id as string;
      }
      return session;
    },
  },

  pages: {
    signIn: "/auth",
    error: "/auth",
  },

  secret: process.env.NEXTAUTH_SECRET,
};
