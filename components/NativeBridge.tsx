"use client";

import { useEffect } from "react";
import { registerNativePush } from "@/lib/native/bridge";

export function NativeBridge() {
  useEffect(() => {
    void registerNativePush();
  }, []);
  return null;
}
