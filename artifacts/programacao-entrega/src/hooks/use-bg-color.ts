import { useState, useEffect } from "react";

const KEY = "app-bg-color";
const DEFAULT = "#f8fafc";

export function useBgColor() {
  const [color, setColor] = useState<string>(() => {
    try { return localStorage.getItem(KEY) ?? DEFAULT; } catch { return DEFAULT; }
  });

  useEffect(() => {
    try { localStorage.setItem(KEY, color); } catch { /* ignore */ }
  }, [color]);

  const reset = () => setColor(DEFAULT);

  return { color, setColor, reset };
}
