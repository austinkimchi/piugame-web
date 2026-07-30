import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: ["mypiu.austin.kim"],
    },
  },
};

export default nextConfig;
