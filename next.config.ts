import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    qualities: [75, 92]
  },
  experimental: {
    serverActions: {
      allowedOrigins: ["mypiu.austin.kim"],
    },
  },
};

export default nextConfig;
