"use client";
import { useEffect } from "react";
export function SourceVisit({ token }: { token: string }) {
  useEffect(() => {
    void fetch("/api/acquisition-visit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => {});
  }, [token]);
  return null;
}
