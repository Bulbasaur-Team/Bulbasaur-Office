import { PROLOGUE_QUEST } from "./prologue";
import { FRIDGE_QUEST } from "./quests";
import { PACKAGE_QUEST } from "./packageQuest";

export type PhoneContactId =
  | "hr"
  | "bulbov"
  | "bulbikov"
  | "bulbul"
  | "bulbatech"
  | "accountant"
  | "driver"
  | "cat"
  | "claude"
  | "cursor";

export interface PhoneContact {
  id: PhoneContactId;
  name: string;
  role: string;
  photo: string;
  /** Показывать только после того, как игрок открыл ноут. */
  requiresLaptop?: boolean;
  letter?: string;
}

export const PHONE_CONTACTS: PhoneContact[] = [
  { id: "hr", name: PROLOGUE_QUEST.caller.name, role: "HR", photo: PROLOGUE_QUEST.caller.photo },
  { id: "bulbov", name: FRIDGE_QUEST.caller.name, role: "Генеральный директор", photo: FRIDGE_QUEST.caller.photo },
  { id: "bulbikov", name: PACKAGE_QUEST.caller.name, role: "Директор по логистике", photo: PACKAGE_QUEST.caller.photo },
  { id: "bulbul", name: "Бульбуль М.А.", role: "Директор по развитию", photo: "assets/ui/bulbatalk/boss-3.png" },
  { id: "bulbatech", name: "Бульба С.В.", role: "Технический директор", photo: "assets/ui/bulbatalk/boss-4.png" },
  { id: "accountant", name: "Бульбакоинова И.А.", role: "Бухгалтерия", photo: "assets/ui/bulbatalk/avatar-accountant.png" },
  { id: "driver", name: "Бульруль А.А.", role: "Водитель", photo: "assets/ui/bulbatalk/avatar-driver.png" },
  { id: "cat", name: "Бульба Кот", role: "Хранитель знаний", photo: "assets/characters/bulba-cat.png" },
  {
    id: "claude",
    name: "Claude",
    role: "Корпоративная модель",
    photo: "assets/ui/bulbatalk/avatar-claude.png",
    requiresLaptop: true,
    letter: "C",
  },
  {
    id: "cursor",
    name: "Cursor",
    role: "Корпоративная модель",
    photo: "assets/ui/bulbatalk/avatar-cursor.png",
    requiresLaptop: true,
    letter: "A",
  },
];

export function contactById(id: PhoneContactId): PhoneContact {
  const found = PHONE_CONTACTS.find((c) => c.id === id);
  if (!found) throw new Error(`Нет контакта ${id}`);
  return found;
}

export function callerOf(id: PhoneContactId): { name: string; photo: string } {
  const c = contactById(id);
  return { name: c.name, photo: c.photo };
}
