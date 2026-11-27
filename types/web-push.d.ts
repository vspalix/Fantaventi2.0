declare module "web-push" {
  const webpush: {
    setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
    sendNotification(
      subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
      payload: string,
      options?: { TTL?: number; urgency?: "very-low" | "low" | "normal" | "high" },
    ): Promise<unknown>;
  };
  export default webpush;
}
