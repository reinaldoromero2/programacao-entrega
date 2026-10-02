import { useState, useEffect } from "react";
import { del, get, set } from "idb-keyval";

const KEY = "app-bg-color";
const DEFAULT = "#f8fafc";
const IMAGE_KEY = "app-bg-image";
const THEME_ROWS_KEY = "app-bg-theme-rows";
const ACRYLIC_KEY = "app-acrylic-appearance";
const ROUNDED_CORNERS_KEY = "app-rounded-corners";

function readBooleanSetting(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

export interface BgColorSettings {
  color: string;
  setColor: (color: string) => void;
  reset: () => void;
  themeRows: boolean;
  setThemeRows: (enabled: boolean) => void;
  acrylic: boolean;
  setAcrylic: (enabled: boolean) => void;
  roundedCorners: boolean;
  setRoundedCorners: (enabled: boolean) => void;
  imageUrl: string | null;
  setImage: (file: File) => Promise<void>;
  clearImage: () => Promise<void>;
  imageError: string | null;
}

export function useBgColor(): BgColorSettings {
  const [color, setColorState] = useState<string>(() => {
    try { return localStorage.getItem(KEY) ?? DEFAULT; } catch { return DEFAULT; }
  });
  const [themeRows, setThemeRows] = useState(() => readBooleanSetting(THEME_ROWS_KEY, false));
  const [acrylic, setAcrylic] = useState(() => readBooleanSetting(ACRYLIC_KEY, false));
  const [roundedCorners, setRoundedCorners] = useState(() => readBooleanSetting(ROUNDED_CORNERS_KEY, false));
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  useEffect(() => {
    try { localStorage.setItem(KEY, color); } catch { /* ignore */ }
  }, [color]);

  useEffect(() => {
    try { localStorage.setItem(THEME_ROWS_KEY, String(themeRows)); } catch { /* ignore */ }
  }, [themeRows]);

  useEffect(() => {
    try { localStorage.setItem(ACRYLIC_KEY, String(acrylic)); } catch { /* ignore */ }
  }, [acrylic]);

  useEffect(() => {
    try { localStorage.setItem(ROUNDED_CORNERS_KEY, String(roundedCorners)); } catch { /* ignore */ }
    document.documentElement.classList.toggle("app-rounded-corners", roundedCorners);
  }, [roundedCorners]);

  useEffect(() => {
    let active = true;
    get<Blob>(IMAGE_KEY)
      .then((image) => {
        if (active && image) setImageUrl(URL.createObjectURL(image));
      })
      .catch((error: unknown) => {
        console.error("[useBgColor] Não foi possível carregar a imagem de fundo:", error);
        if (active) setImageError("Não foi possível carregar a imagem salva neste dispositivo.");
      });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!imageUrl) return;
    return () => URL.revokeObjectURL(imageUrl);
  }, [imageUrl]);

  const setColor = (nextColor: string) => setColorState(nextColor);
  const reset = () => setColor(DEFAULT);
  const setImage = async (file: File) => {
    await set(IMAGE_KEY, file);
    setImageUrl(URL.createObjectURL(file));
    setImageError(null);
  };
  const clearImage = async () => {
    await del(IMAGE_KEY);
    setImageUrl(null);
    setImageError(null);
  };

  return {
    color,
    setColor,
    reset,
    themeRows,
    setThemeRows,
    acrylic,
    setAcrylic,
    roundedCorners,
    setRoundedCorners,
    imageUrl,
    setImage,
    clearImage,
    imageError,
  };
}
