/**
 * ClienteAutocomplete
 *
 * Drop-in replacement for the CLIENTE <input> in delivery-table.tsx.
 * Supports:
 *   - Only registered clients are accepted (validated on blur)
 *   - Suggestions from the registered clients list
 *   - Multi-client via "+" separator: autocomplete works on the LAST segment
 *   - Parenthetical observations: "(obs)" after a client name — NOT interrupted
 *     by autocomplete when the cursor is inside parens.
 *   - Red border while the current segment doesn't match any registered client
 */
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useClientesCadastro } from "@/components/clientes-cadastro-modal";

interface DropdownPos { top: number; left: number; width: number; openUp: boolean; }

interface ClienteAutocompleteProps {
  value: string;
  onChange: (val: string) => void;
  /** Called with the validated value after blur (invalid segments are stripped). */
  onBlur: (validatedValue: string) => void;
  className?: string;
  "data-testid"?: string;
  placeholder?: string;
}

/**
 * Split by "+" only when outside parentheses.
 * e.g. "INGREDION (025 + 015) + SIEMENS" → ["INGREDION (025 + 015) ", " SIEMENS"]
 */
function splitByPlusOutsideParens(value: string): string[] {
  const segments: string[] = [];
  let current = "";
  let depth = 0;
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "+" && depth === 0) {
      segments.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  segments.push(current);
  return segments;
}

/** Returns the segment after the last "+" (outside parens) for matching purposes */
function getCurrentSegment(value: string): string {
  const parts = splitByPlusOutsideParens(value);
  return (parts[parts.length - 1] ?? "").trimStart();
}

/** True when segment contains an open parenthesis that hasn't been closed */
function isInsideParens(segment: string): boolean {
  const open = (segment.match(/\(/g) ?? []).length;
  const close = (segment.match(/\)/g) ?? []).length;
  return open > close;
}

/** Replace the last segment (outside parens) of the value with the selected client name */
function replaceLastSegment(value: string, selected: string): string {
  const segments = splitByPlusOutsideParens(value);
  if (segments.length <= 1) return selected;
  return segments.slice(0, -1).join("+") + "+ " + selected;
}

/** Strip parenthetical content and trim — used for matching */
function bareSegment(seg: string): string {
  return seg.replace(/\([^)]*\)/g, "").trim().toUpperCase();
}

/** Keep only segments that match a registered client. Returns cleaned value. */
function validateValue(value: string, clienteNames: Set<string>): string {
  if (!value.trim()) return "";
  const segments = splitByPlusOutsideParens(value);
  const valid = segments
    .map((seg) => {
      const bare = bareSegment(seg);
      if (!bare) return null;
      return clienteNames.has(bare) ? seg.trim() : null;
    })
    .filter((s): s is string => s !== null);
  return valid.join(" + ");
}

export function ClienteAutocomplete({
  value,
  onChange,
  onBlur,
  className,
  placeholder,
  ...rest
}: ClienteAutocompleteProps) {
  const { data: clientes = [] } = useClientesCadastro();
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<DropdownPos | null>(null);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const clienteNames = useMemo(
    () => new Set(clientes.map((c) => c.nome.toUpperCase())),
    [clientes]
  );

  const segment = getCurrentSegment(value);
  const inParens = isInsideParens(segment);

  const filtered =
    !inParens && segment.trim().length > 0
      ? clientes.filter((c) =>
          c.nome.toLowerCase().includes(segment.trim().toLowerCase())
        )
      : !inParens && segment.trim().length === 0
      ? clientes
      : [];

  const shouldShow = open && filtered.length > 0;

  /** Current segment is non-empty but doesn't match any registered client */
  const isInvalid =
    !inParens &&
    segment.trim().length > 0 &&
    !clienteNames.has(bareSegment(segment));

  const updatePos = useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    const maxH = 220;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUp = spaceBelow < maxH + 8 && spaceAbove > spaceBelow;
    setDropdownPos({
      top: openUp
        ? rect.top + window.scrollY - maxH - 2
        : rect.bottom + window.scrollY + 2,
      left: rect.left + window.scrollX,
      width: Math.max(rect.width, 200),
      openUp,
    });
  }, []);

  useEffect(() => {
    if (!shouldShow) return;
    const onScroll = () => updatePos();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [shouldShow, updatePos]);

  const handleFocus = () => {
    updatePos();
    setOpen(true);
    setActiveIdx(-1);
  };

  const handleBlur = () => {
    setTimeout(() => {
      setOpen(false);
      const validated = validateValue(value, clienteNames);
      onChange(validated);
      onBlur(validated);
    }, 150);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    setActiveIdx(-1);
    if (!open) { updatePos(); setOpen(true); }
  };

  const handleSelect = (nome: string) => {
    const next = replaceLastSegment(value, nome);
    onChange(next);
    setOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!shouldShow) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      handleSelect(filtered[activeIdx]!.nome);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const inputClass = [
    className ?? "",
    isInvalid
      ? "ring-2 ring-red-400 bg-red-50"
      : "",
  ].join(" ").trim();

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={inputClass}
        placeholder={placeholder}
        autoComplete="off"
        {...(rest["data-testid"] ? { "data-testid": rest["data-testid"] } : {})}
      />
      {shouldShow &&
        dropdownPos &&
        createPortal(
          <ul
            className="fixed z-[9999] bg-white border border-slate-200 rounded-md shadow-lg py-1 overflow-y-auto"
            style={{
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: dropdownPos.width,
              maxHeight: 220,
            }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {filtered.map((c, i) => (
              <li
                key={c.id}
                onMouseDown={() => handleSelect(c.nome)}
                className={`px-3 py-1.5 text-sm cursor-pointer truncate ${
                  i === activeIdx
                    ? "bg-blue-600 text-white"
                    : "text-slate-800 hover:bg-blue-50"
                }`}
              >
                {c.nome}
              </li>
            ))}
          </ul>,
          document.body
        )}
    </>
  );
}
