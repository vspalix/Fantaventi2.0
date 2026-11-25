export const DEFAULT_ICON_192 = "/icons/icon-192.png";
export const DEFAULT_ICON_512 = "/icons/icon-512.png";
export const DEFAULT_BRAND_ACCENT = "#c6f531";

export type BrandSettings = {
  logoUrl: string;
  icon192Url: string;
  icon512Url: string;
  accentColor: string;
  ready: boolean;
};

export function accentOrDefault(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : DEFAULT_BRAND_ACCENT;
}

export function iconSrc(url: string, fallback: string) {
  const trimmed = url.trim();
  return trimmed || fallback;
}
