import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

export const { handlers, signIn, signOut, auth } = NextAuth({
    providers: [
        GitHub({
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
            authorization: { params: { scope: "read:user user:email" } }
        }),
    ],
    callbacks: {
        async jwt({ token, account, profile }: any) {
            if (account) {
                token.accessToken = account.access_token;
            }
            if (profile?.login) {
                token.githubUsername = profile.login;
            }
            return token;
        },
        async session({ session, token }: any) {
            (session.user as any).login = token.githubUsername;
            return session;
        }
    }
});
