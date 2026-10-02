export interface Reminder {
  id: string;
  date: string;
  text: string;
}

const REMINDERS_KEY = "programacao-entrega-reminders";

export function parseReminders(value: unknown): Reminder[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): Reminder[] => {
    if (
      !item
      || typeof item !== "object"
      || !(typeof item.id === "string" || typeof item.id === "number")
      || typeof item.date !== "string"
      || typeof item.text !== "string"
    ) return [];
    return [{ id: String(item.id), date: item.date, text: item.text }];
  });
}

export function getReminders(): Reminder[] {
  try {
    return parseReminders(JSON.parse(localStorage.getItem(REMINDERS_KEY) || "[]"));
  } catch {
    return [];
  }
}

export function saveReminders(reminders: Reminder[]) {
  try {
    localStorage.setItem(REMINDERS_KEY, JSON.stringify(reminders));
  } catch {}
}