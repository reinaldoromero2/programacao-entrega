import { useCallback, useEffect, useState } from "react";

export type ConnectionStatus = "checking" | "ok" | "error";

const API_BASE = (import.meta.env.VITE_API_URL || "https://programa-odeentrega.onrender.com").replace(/\/+$/, "");
const CHECK_INTERVAL = 30_000;

async function checkUrl(url: string, signal: AbortSignal) {
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

export function useConnectionStatus() {
  const [status, setStatus] = useState<ConnectionStatus>("checking");

  const checkConnections = useCallback(async () => {
    if (!navigator.onLine) {
      setStatus("error");
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8_000);

    try {
      const checks = [checkUrl(`${API_BASE}/api/ping`, controller.signal)];
      if (window.location.protocol === "http:" || window.location.protocol === "https:") {
        checks.push(checkUrl(window.location.origin, controller.signal));
      }
      await Promise.all(checks);
      setStatus("ok");
    } catch {
      setStatus("error");
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    void checkConnections();
    const interval = window.setInterval(() => void checkConnections(), CHECK_INTERVAL);
    window.addEventListener("online", checkConnections);
    window.addEventListener("offline", checkConnections);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", checkConnections);
      window.removeEventListener("offline", checkConnections);
    };
  }, [checkConnections]);

  return status;
}
