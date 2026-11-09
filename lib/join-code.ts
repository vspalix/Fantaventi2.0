import { randomInt } from "crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createJoinCode(length = 8): string {
  let code = "";
  for (let index = 0; index < length; index += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}
