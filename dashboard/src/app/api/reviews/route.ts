import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const session = await auth();
        if (!session?.user || !(session.user as any).login) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const username = (session.user as any).login;

        const reviews = await prisma.review.findMany({
            where: {
                status: "COMPLETED",
                repository: { fullName: { startsWith: `${username}/` } }
            },
            orderBy: { createdAt: "desc" },
            take: 20,
            include: {
                repository: {
                    select: { fullName: true },
                },
                _count: {
                    select: { comments: true },
                },
            },
        });

        const formatted = reviews.map((r) => {
            const severities = r.issuesBySeverity as Record<string, number> | null;
            return {
                id: r.id,
                repo: r.repository.fullName,
                prNumber: r.prNumber,
                verdict: r.verdict,
                issueCount: r._count.comments,
                criticalCount: severities?.critical ?? 0,
                highCount: severities?.high ?? 0,
                mediumCount: severities?.medium ?? 0,
                lowCount: severities?.low ?? 0,
                filesReviewed: r.filesReviewed,
                durationMs: r.durationMs,
                headSha: r.headSha,
                triggeredBy: r.triggeredBy,
                summary: r.summary,
                createdAt: r.createdAt.toISOString(),
            };
        });

        return NextResponse.json(formatted);
    } catch (error) {
        console.error("Reviews API error:", error);
        return NextResponse.json(
            { error: "Failed to fetch reviews" },
            { status: 500 }
        );
    }
}
