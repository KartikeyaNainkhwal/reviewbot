import { auth, signIn, signOut } from "@/auth";

export async function AuthButton() {
    const session = await auth();

    if (session) {
        return (
            <div className="flex items-center gap-4">
                <span className="text-sm font-medium text-foreground">
                    Welcome, {session.user?.name || session.user?.email}
                </span>
                <form
                    action={async () => {
                        "use server";
                        await signOut();
                    }}
                >
                    <button
                        type="submit"
                        className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
                    >
                        Sign Out
                    </button>
                </form>
            </div>
        );
    }

    return (
        <form
            action={async () => {
                "use server";
                await signIn("github");
            }}
        >
            <button
                type="submit"
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-gray-800 rounded-md hover:bg-gray-900"
            >
                <span className="text-lg">🐙</span>
                Sign in with GitHub
            </button>
        </form>
    );
}
