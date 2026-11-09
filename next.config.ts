import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

const devCacheDir = path.join("C:\\Temp", "FantaVenti_cache");
const isDev = process.argv.includes("dev");

if (isDev) fs.mkdirSync(devCacheDir, { recursive: true });

const nextConfig: NextConfig = {
  distDir: isDev ? path.relative(process.cwd(), devCacheDir) : ".next",
  serverExternalPackages: ["exceljs", "docx", "postgres"],
  webpack: (config, { dev }) => {
    if (dev && config.cache && typeof config.cache === "object") {
      config.cache = {
        ...config.cache,
        cacheDirectory: path.join(devCacheDir, "webpack"),
      };
    }
    return config;
  },
};

export default nextConfig;
