import { useRef, useState } from "react";
import { Image, Layers2, Palette, RotateCcw, Trash2, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { BgColorSettings } from "@/hooks/use-bg-color";

const PRESETS: { label: string; color: string }[] = [
  // Neutros claros
  { label: "Branco",        color: "#ffffff" },
  { label: "Gelo",          color: "#f8fafc" },
  { label: "Cinza claro",   color: "#f1f5f9" },
  { label: "Cinza médio",   color: "#e2e8f0" },
  { label: "Pedra",         color: "#f5f5f4" },
  { label: "Zinc",          color: "#fafafa" },
  // Azuis
  { label: "Azul gelo",     color: "#eff6ff" },
  { label: "Azul claro",    color: "#dbeafe" },
  { label: "Azul pastel",   color: "#bfdbfe" },
  { label: "Azul médio",    color: "#93c5fd" },
  // Verdes
  { label: "Verde gelo",    color: "#f0fdf4" },
  { label: "Verde claro",   color: "#dcfce7" },
  { label: "Verde pastel",  color: "#bbf7d0" },
  // Quentes
  { label: "Laranja gelo",  color: "#fff7ed" },
  { label: "Amarelo gelo",  color: "#fefce8" },
  { label: "Rosa gelo",     color: "#fdf2f8" },
  { label: "Lilás gelo",    color: "#faf5ff" },
  { label: "Vermelho gelo", color: "#fff1f2" },
  // Escuros
  { label: "Azul escuro",   color: "#1e293b" },
  { label: "Quase preto",   color: "#0f172a" },
];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  settings: BgColorSettings;
}

export function BgColorModal({ open, onOpenChange, settings }: Props) {
  const {
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
  } = settings;
  const customRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleImageChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
      setActionError("Escolha uma imagem PNG, JPG, WEBP ou GIF.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setActionError("A imagem deve ter no máximo 10 MB.");
      return;
    }

    try {
      await setImage(file);
      setActionError(null);
    } catch (error) {
      console.error("[BgColorModal] Não foi possível salvar a imagem de fundo:", error);
      setActionError("Não foi possível salvar a imagem neste dispositivo.");
    }
  };

  const handleClearImage = async () => {
    try {
      await clearImage();
      setActionError(null);
    } catch (error) {
      console.error("[BgColorModal] Não foi possível remover a imagem de fundo:", error);
      setActionError("Não foi possível remover a imagem salva.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Palette className="w-4 h-4 text-blue-600" />
            Plano de fundo
          </DialogTitle>
        </DialogHeader>

        {/* Paleta de presets */}
        <div className="grid grid-cols-5 gap-2 py-1">
          {PRESETS.map((p) => (
            <button
              key={p.color}
              title={p.label}
              onClick={() => setColor(p.color)}
              className="relative w-10 h-10 rounded-md border-2 transition-all hover:scale-110 focus:outline-none"
              style={{
                background: p.color,
                borderColor: color === p.color ? "#2563eb" : "#cbd5e1",
                boxShadow: color === p.color ? "0 0 0 2px #93c5fd" : undefined,
              }}
            >
              {color === p.color && (
                <span className="absolute inset-0 flex items-center justify-center text-blue-600 font-bold text-lg">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Cor personalizada */}
        <div className="flex items-center gap-3 border-t pt-3">
          <span className="text-sm text-slate-600">Personalizada:</span>
          <div
            className="relative w-10 h-10 rounded-md border-2 border-slate-300 overflow-hidden cursor-pointer hover:scale-110 transition-transform"
            style={{ background: color }}
            title="Escolher cor personalizada"
            onClick={() => customRef.current?.click()}
          >
            <input
              ref={customRef}
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
            />
          </div>
          <code className="text-xs text-slate-500 font-mono">{color}</code>

          <Button
            variant="ghost"
            size="sm"
            onClick={reset}
            className="ml-auto gap-1.5 text-slate-500 hover:text-slate-700"
            title="Restaurar padrão"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Padrão
          </Button>
        </div>

        <div className="space-y-2 border-t pt-3">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <Image className="h-4 w-4" />
            Imagem de fundo
          </div>
          <input
            ref={imageRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={handleImageChange}
            className="hidden"
          />
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => imageRef.current?.click()} className="gap-2">
              <Upload className="h-4 w-4" />
              Escolher imagem
            </Button>
            {imageUrl && (
              <Button type="button" variant="ghost" size="sm" onClick={handleClearImage} className="gap-1.5 text-red-600 hover:text-red-700">
                <Trash2 className="h-4 w-4" />
                Remover
              </Button>
            )}
          </div>
          <p className="text-xs text-slate-500">A imagem fica salva somente neste dispositivo (máximo 10 MB).</p>
          {(actionError || imageError) && (
            <p role="alert" className="text-xs text-red-600">{actionError || imageError}</p>
          )}
        </div>

        <div className="space-y-3 border-t pt-3">
          <label className="flex cursor-pointer items-start gap-2.5">
            <Checkbox checked={themeRows} onCheckedChange={(checked) => setThemeRows(checked === true)} className="mt-0.5" />
            <span className="space-y-0.5">
              <span className="block text-sm font-medium text-slate-700">Aplicar a cor do tema às linhas das cargas</span>
              <span className="block text-xs text-slate-500">As linhas acompanham a cor escolhida acima.</span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-2.5">
            <Checkbox checked={acrylic} onCheckedChange={(checked) => setAcrylic(checked === true)} className="mt-0.5" />
            <span className="space-y-0.5">
              <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                <Layers2 className="h-4 w-4" />
                Efeito transparente acrílico
              </span>
              <span className="block text-xs text-slate-500">Deixa barra, tabela e painéis translúcidos com desfoque.</span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-2.5">
            <Checkbox checked={roundedCorners} onCheckedChange={(checked) => setRoundedCorners(checked === true)} className="mt-0.5" />
            <span className="space-y-0.5">
              <span className="block text-sm font-medium text-slate-700">Cantos arredondados em todo o aplicativo</span>
              <span className="block text-xs text-slate-500">Arredonda botões, cards, calendário, tabelas e modais.</span>
            </span>
          </label>
        </div>
      </DialogContent>
    </Dialog>
  );
}
