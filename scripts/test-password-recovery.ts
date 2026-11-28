import assert from "node:assert/strict";
import { adminRecoveryLink, readRecoveryAddress } from "../lib/password-recovery";

const link = new URL(adminRecoveryLink("https://sito.test", "abc123"));
assert.equal(link.pathname, "/accesso/nuova-password");
assert.equal(link.search, "", "il codice non deve arrivare al server");
assert.deepEqual(readRecoveryAddress(link.search, link.hash), { kind: "token", tokenHash: "abc123" });
assert.deepEqual(
  readRecoveryAddress("", "#access_token=a&refresh_token=r&type=recovery"),
  { kind: "session", accessToken: "a", refreshToken: "r" },
);
assert.equal(readRecoveryAddress("", "#error=access_denied&error_code=otp_expired").kind, "error");
assert.equal(readRecoveryAddress("?code=xyz", "").kind, "code");
assert.equal(readRecoveryAddress("?next=%2Fjoin%3Fcode%3DABC", "").kind, "none");
assert.equal(readRecoveryAddress("", "").kind, "none");

// Un controllo fallito ferma lo script prima di questa riga.
console.log("PASSED 8/8");
