import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@ai/db",
    "@ai/auth",
    "@ai/shared",
    "@ai/integrations",
    "@ai/realtime",
  ],
};

export default nextConfig;
