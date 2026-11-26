import type { MetadataRoute } from "next";
import { DEFAULT_ICON_192, DEFAULT_ICON_512, iconSrc } from "@/lib/brand";
import { readBrand } from "@/lib/server/brand";

export const dynamic = "force-dynamic";

function iconType(src: string) {
  if (src.endsWith(".svg")) return "image/svg+xml";
  if (src.endsWith(".webp")) return "image/webp";
  return "image/png";
}

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const brand = await readBrand();
  const icon192 = iconSrc(brand.icon192Url, DEFAULT_ICON_192);
  const icon512 = iconSrc(brand.icon512Url, DEFAULT_ICON_512);
  return {
    name: "FantaVenti",
    short_name: "FantaVenti",
    description: "Fantacalcio gratuito, senza scommesse né premi in denaro.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0f0e0c",
    theme_color: "#0f0e0c",
    icons: [
      { src: icon192, sizes: "192x192", type: iconType(icon192), purpose: "any" },
      { src: icon512, sizes: "512x512", type: iconType(icon512), purpose: "any" },
    ],
  };
}
