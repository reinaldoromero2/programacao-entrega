import { useState, useEffect } from "react";
import { del, get, set } from "idb-keyval";
import bundledBeachImage from "@/assets/beach-background.png";

const KEY = "app-bg-color";
const DEFAULT = "#f8fafc";
const IMAGE_KEY = "app-bg-image";
const IMAGE_SOURCE_KEY = "app-bg-image-source";
const THEME_ROWS_KEY = "app-bg-theme-rows";
const ACRYLIC_KEY = "app-acrylic-appearance";
const ACRYLIC_MODALS_KEY = "app-acrylic-modals";
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
  acrylicModals: boolean;
  setAcrylicModals: (enabled: boolean) => void;
  roundedCorners: boolean;
  setRoundedCorners: (enabled: boolean) => void;
  imageUrl: string | null;
  imageSource: "custom" | "bundled" | null;
  bundledImageUrl: string;
  setImage: (file: File) => Promise<void>;
  setBundledImage: () => void;
  clearImage: () => Promise<void>;
  imageError: string | null;
}

export function useBgColor(): BgColorSettings {
  const [color, setColorState] = useState<string>(() => {
    try { return localStorage.getItem(KEY) ?? DEFAULT; } catch { return DEFAULT; }
  });
  const [themeRows, setThemeRows] = useState(() => readBooleanSetting(THEME_ROWS_KEY, false));
  const [acrylic, setAcrylic] = useState(() => readBooleanSetting(ACRYLIC_KEY, false));
  const [acrylicModals, setAcrylicModals] = useState(() => readBooleanSetting(ACRYLIC_MODALS_KEY, false));
  const [roundedCorners, setRoundedCorners] = useState(() => readBooleanSetting(ROUNDED_CORNERS_KEY, false));
  const [imageSource, setImageSource] = useState<"custom" | "bundled" | null>(() => {
    try {
      const source = localStorage.getItem(IMAGE_SOURCE_KEY);
      return source === "custom" || source === "bundled" ? source : null;
    } catch {
      return null;
    }
  });
  const [imageUrl, setImageUrl] = useState<string | null>(() => imageSource === "bundled" ? bundledBeachImage : null);
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
    try { localStorage.setItem(ACRYLIC_MODALS_KEY, String(acrylicModals)); } catch { /* ignore */ }
    document.documentElement.classList.toggle("app-acrylic-modals", acrylicModals);
  }, [acrylicModals]);

  useEffect(() => {
    try { localStorage.setItem(ROUNDED_CORNERS_KEY, String(roundedCorners)); } catch { /* ignore */ }
    document.documentElement.classList.toggle("app-rounded-corners", roundedCorners);
  }, [roundedCorners]);

  useEffect(() => {
    let active = true;
    if (imageSource === "bundled") return () => { active = false; };

    get<Blob>(IMAGE_KEY)
      .then((image) => {
        if (active && image && localStorage.getItem(IMAGE_SOURCE_KEY) !== "bundled") {
          setImageSource("custom");
          setImageUrl(URL.createObjectURL(image));
        }
      })
      .catch((error: unknown) => {
        console.error("[useBgColor] Não foi possível carregar a imagem de fundo:", error);
        if (active) setImageError("Não foi possível carregar a imagem salva neste dispositivo.");
      });

    return () => { active = false; };
  }, [imageSource]);

  useEffect(() => {
    if (!imageUrl?.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(imageUrl);
  }, [imageUrl]);

  const setColor = (nextColor: string) => setColorState(nextColor);
  const reset = () => setColor(DEFAULT);
  const setImage = async (file: File) => {
    await set(IMAGE_KEY, file);
    localStorage.setItem(IMAGE_SOURCE_KEY, "custom");
    setImageSource("custom");
    setImageUrl(URL.createObjectURL(file));
    setImageError(null);
  };
  const setBundledImage = () => {
    localStorage.setItem(IMAGE_SOURCE_KEY, "bundled");
    setImageSource("bundled");
    setImageUrl(bundledBeachImage);
    setImageError(null);
  };
  const clearImage = async () => {
    await del(IMAGE_KEY);
    localStorage.removeItem(IMAGE_SOURCE_KEY);
    setImageSource(null);
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
    acrylicModals,
    setAcrylicModals,
    roundedCorners,
    setRoundedCorners,
    imageUrl,
    imageSource,
    bundledImageUrl: bundledBeachImage,
    setImage,
    setBundledImage,
    clearImage,
    imageError,
  };
}
