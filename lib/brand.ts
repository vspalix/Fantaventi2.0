export const DEFAULT_ICON_192 = "/icons/icon-192.png";
export const DEFAULT_ICON_512 = "/icons/icon-512.png";
export const DEFAULT_BRAND_ACCENT = "#d8b66a";
const DARK_INK = "#1b1406";
const LIGHT_INK = "#ffffff";

function luminance(hex: string) {
  const channel = (start: number) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

/** Colore della scritta sopra il colore principale: scuro o bianco, quello che si legge meglio. */
export function accentInk(accent: string) {
  const color = accentOrDefault(accent);
  return contrast(color, DARK_INK) >= contrast(color, LIGHT_INK) ? DARK_INK : LIGHT_INK;
}

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
