import { useLocation } from "wouter";
import { Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROMANEIO_ROTA } from "@/components/romaneio-frame";

// Abre o Romaneio dentro do próprio app (rota #/romaneio).
export function RomaneioButton() {
  const [, setLocation] = useLocation();

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={() => setLocation(ROMANEIO_ROTA)}
      className="h-10 w-10 border-indigo-800 bg-indigo-700 text-white hover:bg-indigo-800 hover:text-white"
      title="Romaneio"
      aria-label="Romaneio"
      data-testid="button-romaneio"
    >
      <Truck className="w-5 h-5" />
    </Button>
  );
}
