export const ACTIVE_ROOM_KEY = 'noughtline_active_room';
export const ACTIVE_ROOM_MAX_AGE_MS = 30 * 60 * 1000;

const ROOM_ID_PATTERN = /^[A-Z0-9_-]{4,32}$/;

export function normalizeRoomId(value) {
  if (typeof value !== 'string') return null;
  let candidate = value.trim();
  if (!candidate) return null;

  try {
    if (/^https?:\/\//i.test(candidate)) candidate = new URL(candidate).pathname;
  } catch {
    return null;
  }

  const inviteMatch = candidate.match(/^\/join\/([^/?#]+)\/?$/i);
  if (inviteMatch) candidate = inviteMatch[1];

  try {
    candidate = decodeURIComponent(candidate).trim().toUpperCase();
  } catch {
    return null;
  }
  return ROOM_ID_PATTERN.test(candidate) ? candidate : null;
}

export function getInviteRoomId(pathname) {
  if (typeof pathname !== 'string') return null;
  const match = pathname.match(/^\/join\/([^/?#]+)\/?$/i);
  return match ? normalizeRoomId(match[1]) : null;
}

export function createInviteUrl(roomId, origin) {
  const normalized = normalizeRoomId(roomId);
  if (!normalized) throw new Error('Invalid room ID');
  return new URL(`/join/${encodeURIComponent(normalized)}`, origin).toString();
}

export function saveActiveRoom(storage, roomId, now = Date.now()) {
  const normalized = normalizeRoomId(roomId);
  if (!normalized) return false;
  storage.setItem(ACTIVE_ROOM_KEY, JSON.stringify({ roomId: normalized, savedAt: now }));
  return true;
}

export function readActiveRoom(storage, now = Date.now()) {
  try {
    const parsed = JSON.parse(storage.getItem(ACTIVE_ROOM_KEY));
    const roomId = normalizeRoomId(parsed?.roomId);
    const savedAt = Number(parsed?.savedAt);
    if (!roomId || !Number.isFinite(savedAt) || now - savedAt > ACTIVE_ROOM_MAX_AGE_MS || savedAt > now + 60_000) {
      clearActiveRoom(storage);
      return null;
    }
    return { roomId, savedAt };
  } catch {
    clearActiveRoom(storage);
    return null;
  }
}

export function clearActiveRoom(storage) {
  storage.removeItem(ACTIVE_ROOM_KEY);
}
