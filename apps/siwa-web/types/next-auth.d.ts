import NextAuth from "next-auth";

declare module "next-auth" {
  interface Session {
    role?: string;
    canAccessEval?: boolean;
    accessToken?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string;
    canAccessEval?: boolean;
    accessToken?: string;
  }
}
