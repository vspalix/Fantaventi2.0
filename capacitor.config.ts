import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "it.fantaventi.app",
  appName: "FantaVenti",
  webDir: "public",
  server: {
    url: "https://fantaventi2-0.vercel.app",
    cleartext: false,
  },
};

export default config;
