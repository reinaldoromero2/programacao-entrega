import type { EntregaInput } from "@workspace/api-client-react";

const QUEUE_KEY = "entregas-pendentes-sync";

export interface PendingDelivery {
  temporaryId: number;
  data: EntregaInput;
}

export function getPendingDeliveries(): PendingDelivery[] {
  try {
    const value = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
    return Array.isArray(value) ? value as PendingDelivery[] : [];
  } catch {
    return [];
  }
}

export function queueDelivery(item: PendingDelivery) {
  const queue = getPendingDeliveries().filter((pending) => pending.temporaryId !== item.temporaryId);
  localStorage.setItem(QUEUE_KEY, JSON.stringify([...queue, item]));
}

export function removePendingDelivery(temporaryId: number) {
  const queue = getPendingDeliveries().filter((pending) => pending.temporaryId !== temporaryId);
  if (queue.length > 0) localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  else localStorage.removeItem(QUEUE_KEY);
}
