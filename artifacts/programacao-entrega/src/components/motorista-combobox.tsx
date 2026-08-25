import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useListMotoristas } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

interface MotoristaCombboxProps {
  motorista: string;
  placa: string;
  onSelect: (motorista: string, placa: string, frete: string | null) => void;
  onMotoristaChange: (value: string) => void;
  onMotoristaBlur: () => void;
  onPlacaChange: (value: string) => void;
  onPlacaBlur: () => void;
  motoristaTestId?: string;
  placaTestId?: string;
}

interface DropdownPos {
  top: number;
  left: number;
  width: number;
}

export function MotoristaCombobox({
  motorista,
  placa,
  onSelect,
  onMotoristaChange,
  onMotoristaBlur,
  onPlacaChange,
  onPlacaBlur,
  motoristaTestId,
  placaTestId,
}: MotoristaCombboxProps) {
  const { data: motoristas = [] } = useListMotoristas();
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<DropdownPos | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = motoristas.filter(
    (m) =>
      motorista.trim() === "" ||
      m.nome.toLowerCase().includes(motorista.toLowerCase()) ||
      m.placa.toLowerCase().includes(motorista.toLowerCase())
  );

  const updatePos = useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setDropdownPos({
      top: rect.bottom + window.scrollY + 2,
      left: rect.left + window.scrollX,
      width: Math.max(rect.width, 240),
    });
  }, []);

  const handleFocus = () => {
    updatePos();
    setOpen(true);
  };

  const handleBlur = () => {
    setTimeout(() => setOpen(false), 150);
    onMotoristaBlur();
  };

  // Reposition on scroll/resize
  useEffect(() => {
    if (!open) return;
    const onScroll = () => updatePos();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, updatePos]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={containerRef} className="flex gap-1 items-center w-full">
      {/* Motorista input */}
      <input
        ref={inputRef}
        type="text"
        value={motorista}
        placeholder="Motorista"
        onChange={(e) => {
          onMotoristaChange(e.target.value);
          updatePos();
          setOpen(true);
        }}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className={cn(
          "min-w-0 flex-1 px-2 py-1.5 text-sm font-medium text-slate-700 bg-transparent border-0 outline-none rounded",
          "focus:ring-2 focus:ring-blue-500 focus:bg-white"
        )}
        data-testid={motoristaTestId}
      />
      <span className="text-slate-400 font-bold flex-shrink-0">•</span>
      {/* Placa input */}
      <input
        type="text"
        value={placa}
        placeholder="Placa"
        onChange={(e) => onPlacaChange(e.target.value)}
        onBlur={onPlacaBlur}
        className={cn(
          "min-w-0 w-[90px] flex-shrink-0 px-2 py-1.5 text-sm font-mono text-slate-600 bg-transparent border-0 outline-none rounded uppercase",
          "focus:ring-2 focus:ring-blue-500 focus:bg-white"
        )}
        data-testid={placaTestId}
      />

      {/* Dropdown rendered in portal to escape overflow clipping */}
      {open && filtered.length > 0 && dropdownPos &&
        createPortal(
          <div
            style={{
              position: "absolute",
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: dropdownPos.width,
              zIndex: 9999,
            }}
            className="bg-white border border-slate-200 rounded-md shadow-lg overflow-hidden"
          >
            {filtered.map((m) => (
              <button
                key={m.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(m.nome, m.placa, m.frete ?? null);
                  setOpen(false);
                }}
                className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-blue-50 text-left transition-colors"
              >
                <span className="font-medium text-slate-800 truncate">
                  {m.nome}
                </span>
                <span className="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded ml-2 flex-shrink-0">
                  {m.placa}
                </span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
