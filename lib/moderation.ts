import { inflateSync } from "node:zlib";
import { decode as decodeJpeg } from "jpeg-js";

const BANNED = [
  "cazzo", "cazzi", "minchia", "minchie", "vaffanculo", "fanculo", "fottiti", "fottere",
  "stronzo", "stronza", "stronzi", "merda", "merde", "troia", "troie", "puttana", "puttane",
  "mignotta", "bocchino", "sborra", "sborro", "pompino", "scopare", "scopata", "inculare",
  "coglione", "coglioni", "porcodio", "diocane", "diocane", "madonnacane", "vaffanculo",
  "fuck", "fucking", "shit", "bitch", "cunt", "nigger", "nigga", "faggot",
  "porn", "porno", "xxx", "nudo", "nuda", "nudi", "nude", "sexy", "sesso", "pene", "vagina",
  "tette", "figa", "fica", "culo",
];

export function moderateText(value: string): string | null {
  const folded = fold(value);
  const tokens = folded.split(/[^a-z]+/).filter((token) => token.length >= 3);
  const squeezed = tokens.map(squeeze);
  const blob = squeeze(folded.replace(/[^a-z]/g, ""));
  for (const word of BANNED) {
    if (tokens.includes(word) || squeezed.includes(word)) return "Il testo non è accettato: contiene un termine non ammesso.";
    if (word.length >= 6 && (blob.includes(word) || tokens.some((token) => token.startsWith(word)))) {
      return "Il testo non è accettato: contiene un termine non ammesso.";
    }
  }
  return null;
}

export function moderateImage(bytes: Buffer, mime: string): string | null {
  const text = moderateText(readableText(bytes));
  if (text) return "L'immagine non è accettata: il file contiene un termine non ammesso.";
  let pixels: Uint8Array;
  let width = 0;
  let height = 0;
  try {
    if (mime === "image/png") {
      const png = decodePng(bytes);
      pixels = png.rgba;
      width = png.width;
      height = png.height;
    } else if (mime === "image/jpeg") {
      const jpeg = decodeJpeg(bytes, { useTArray: true, maxMemoryUsageInMB: 32 });
      pixels = jpeg.data;
      width = jpeg.width;
      height = jpeg.height;
    } else {
      return "Per il controllo del contenuto carica un PNG o un JPEG.";
    }
  } catch {
    return "Immagine non leggibile. Carica un PNG o un JPEG valido.";
  }
  if (width < 16 || height < 16 || width > 4000 || height > 4000) return "L'immagine deve stare tra 16 e 4000 pixel per lato.";
  const ratio = skinRatio(pixels);
  if (ratio > 0.55) return "L'immagine non è accettata: sembra un contenuto esplicito.";
  return null;
}

function fold(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[@4]/g, "a")
    .replace(/3/g, "e")
    .replace(/[1!|]/g, "i")
    .replace(/0/g, "o")
    .replace(/[$5]/g, "s")
    .replace(/7/g, "t");
}

function squeeze(value: string) {
  return value.replace(/(.)\1{2,}/g, "$1$1");
}

function readableText(bytes: Buffer) {
  const sample = bytes.subarray(0, Math.min(bytes.length, 200_000)).toString("latin1");
  return sample.match(/[a-zA-ZÀ-ÿ]{4,}/g)?.join(" ") ?? "";
}

function skinRatio(rgba: Uint8Array) {
  let skin = 0;
  let seen = 0;
  for (let index = 0; index + 3 < rgba.length; index += 16) {
    const red = rgba[index];
    const green = rgba[index + 1];
    const blue = rgba[index + 2];
    seen += 1;
    if (red > 95 && green > 40 && blue > 20 && red > green && red > blue && Math.abs(red - green) > 15 && red - blue > 15) skin += 1;
  }
  return seen === 0 ? 0 : skin / seen;
}

function decodePng(bytes: Buffer) {
  if (bytes.length < 8 || bytes[0] !== 0x89) throw new Error("png");
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.length) throw new Error("png");
    if (type === "IHDR") {
      width = bytes.readUInt32BE(start);
      height = bytes.readUInt32BE(start + 4);
      bitDepth = bytes[start + 8];
      colorType = bytes[start + 9];
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(start, end));
    } else if (type === "IEND") break;
    offset = end + 4;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : colorType === 4 ? 2 : 0;
  if (bitDepth !== 8 || !channels || width < 1 || height < 1) throw new Error("png");
  const stride = width * channels;
  const inflated = inflateSync(Buffer.concat(idat));
  if (inflated.length < height * (stride + 1)) throw new Error("png");
  const rgba = new Uint8Array(width * height * 4);
  let src = 0;
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[src];
    src += 1;
    const raw = inflated.subarray(src, src + stride);
    src += stride;
    const cur = unfilter(filter, raw, prev, channels);
    for (let x = 0; x < width; x += 1) {
      const at = x * channels;
      const red = channels === 1 ? cur[at] : cur[at];
      const green = channels === 1 ? cur[at] : cur[at + 1];
      const blue = channels === 1 ? cur[at] : channels === 2 ? cur[at] : cur[at + 2];
      const alpha = channels === 4 ? cur[at + 3] : channels === 2 ? cur[at + 1] : 255;
      const pixel = (y * width + x) * 4;
      rgba[pixel] = red;
      rgba[pixel + 1] = green;
      rgba[pixel + 2] = blue;
      rgba[pixel + 3] = alpha;
    }
    prev = cur;
  }
  return { width, height, rgba };
}

function unfilter(filter: number, row: Uint8Array, prev: Uint8Array, channels: number) {
  const out = new Uint8Array(row.length);
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= channels ? out[index - channels] : 0;
    const up = prev[index] ?? 0;
    const upLeft = index >= channels ? prev[index - channels] ?? 0 : 0;
    const raw = row[index];
    if (filter === 0) out[index] = raw;
    else if (filter === 1) out[index] = (raw + left) & 255;
    else if (filter === 2) out[index] = (raw + up) & 255;
    else if (filter === 3) out[index] = (raw + Math.floor((left + up) / 2)) & 255;
    else if (filter === 4) out[index] = (raw + paeth(left, up, upLeft)) & 255;
    else throw new Error("png");
  }
  return out;
}

function paeth(left: number, up: number, upLeft: number) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}
