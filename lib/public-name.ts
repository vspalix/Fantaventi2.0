const HANDLE = /^[A-Za-z0-9_.-]{3,20}$/;

export function isPublicHandle(value: string) {
  return HANDLE.test(value);
}

export function publicHandle(value: string | null | undefined) {
  const name = (value ?? "").trim();
  return isPublicHandle(name) ? name : "";
}
