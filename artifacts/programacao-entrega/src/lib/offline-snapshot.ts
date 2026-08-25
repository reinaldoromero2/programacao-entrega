import type { Entrega } from "@workspace/api-client-react";

export interface OfflineSnapshot {
  version: number;
  generatedAt: string;
  entregas: Entrega[];
  motoristas: Array<{ id: number; nome: string; placa: string; frete?: "RIPACK" | "TRANSPORTADORA" | "3º" | "COLETA" }>;
  motivos: Array<{ id: number; motivo: string }>;
  clientes: Array<{ id: number; nome: string }>;
  faturamentoDiario: unknown[];
  faturamentoMeta: unknown[];
}

const SNAPSHOT_KEY = "programacao-entrega-snapshot";

export function saveOfflineSnapshot(snapshot: OfflineSnapshot) {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
    snapshot.entregas.forEach((delivery) => {
      const key = `entregas-cache-${delivery.date}`;
      const current = JSON.parse(localStorage.getItem(key) || "[]") as Entrega[];
      if (!current.some((item) => item.id === delivery.id)) {
        localStorage.setItem(key, JSON.stringify([...current, delivery]));
      }
    });
  } catch {}
}

export function getOfflineSnapshot(): OfflineSnapshot | undefined {
  try {
    const snapshot = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "null");
    return snapshot?.entregas && snapshot?.motoristas ? snapshot as OfflineSnapshot : undefined;
  } catch {
    return undefined;
  }
}

export function getOfflineSnapshotDate() {
  return getOfflineSnapshot()?.generatedAt;
}
