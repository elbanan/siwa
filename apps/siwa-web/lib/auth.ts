/**
 * NextAuth configuration (Credentials provider).
 * Calls local FastAPI endpoints.
 */

import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import api from "./api";

const authOptions = {
  providers: [
    CredentialsProvider({
      name: "Local",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials: any) {
        if (!credentials?.email || !credentials?.password) return null;

        // Login to FastAPI and get token
        const loginRes = await api.post("/auth/login", {
          email: credentials.email,
          password: credentials.password
        });

        const token = loginRes.data.access_token;

        // Fetch user profile
        const meRes = await api.get("/auth/me", {
          headers: { Authorization: `Bearer ${token}` }
        });

        return {
          id: meRes.data.id,
          email: meRes.data.email,
          name: meRes.data.name,
          role: meRes.data.role,
          canAccessEval: meRes.data.can_access_eval,
          accessToken: token
        };
      }
    })
  ],
  session: { strategy: "jwt" as const },
  callbacks: {
    async jwt({ token, user }: any) {
        if (user) {
          token.accessToken = user.accessToken;
          token.role = user.role;
          token.id = user.id;
          token.canAccessEval = user.canAccessEval;
        }
        return token;
      },
      async session({ session, token }: any) {
        (session as any).accessToken = token.accessToken;
        (session as any).role = token.role;
        (session as any).id = token.id;
        (session as any).canAccessEval = token.canAccessEval ?? false;
        return session;
    }
  },
  pages: { signIn: "/login" }
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
