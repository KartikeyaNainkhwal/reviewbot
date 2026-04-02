import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow importing from parent directory (monorepo Prisma client)
  serverExternalPackages: ["@prisma/client"],
};

export default nextConfig;
