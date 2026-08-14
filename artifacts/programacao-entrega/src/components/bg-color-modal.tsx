import { useRef } from "react";
import { Palette, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useBgColor } from "@/hooks/use-bg-color";

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
}

export function BgColorModal({ open, onOpenChange }: Props) {
  const { color, setColor, reset } = useBgColor();
  const customRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Palette className="w-4 h-4 text-blue-600" />
            Cor do plano de fundo
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
      </DialogContent>
    </Dialog>
  );
}
