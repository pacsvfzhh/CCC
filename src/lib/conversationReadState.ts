const STORAGE_KEY = 'admin-service-conversation-read-at';

type ReadAtMap = Record<string, string>;

let readAtMap: ReadAtMap = loadReadAtMap();

function loadReadAtMap(): ReadAtMap {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => typeof value === 'string'),
    ) as ReadAtMap;
  } catch {
    return {};
  }
}

function persistReadAtMap() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(readAtMap));
  } catch {
    return;
  }
}

function getConversationKey(sourceType: string, customerId: string, employeeId: string) {
  return `${sourceType}:${customerId}:${employeeId}`;
}

export function markConversationRead(
  sourceType: string,
  customerId: string,
  employeeId: string,
  readAt = new Date().toISOString(),
) {
  readAtMap[getConversationKey(sourceType, customerId, employeeId)] = readAt;
  persistReadAtMap();
}

export function clearConversationRead(sourceType: string, customerId: string, employeeId: string) {
  delete readAtMap[getConversationKey(sourceType, customerId, employeeId)];
  persistReadAtMap();
}

export function isConversationReadThrough(
  sourceType: string,
  customerId: string,
  employeeId: string,
  messageTime?: string | null,
) {
  const readAt = readAtMap[getConversationKey(sourceType, customerId, employeeId)];
  if (!readAt) return false;
  if (!messageTime) return true;

  return new Date(messageTime).getTime() <= new Date(readAt).getTime();
}
