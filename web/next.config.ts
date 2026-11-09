import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Tauri loads a static bundle, so the app must export to ./out */
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
