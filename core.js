export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const ROOT_FOLDER_NAME = 'SillyTavernSync';
export const SETTINGS_KEY = 'tavern-roamer-lite:settings';
export const LOCAL_BACKUP_KEY = 'tavern-roamer-lite:last-chat-backup';
export const ACCESS_TOKEN_KEY = 'tavern-roamer-lite:access-token';

export const DEFAULT_SETTINGS = Object.freeze({
  googleClientId: '',
  autoSyncChat: true,
  keepLatestN: 10,
});

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeSettings(value = {}) {
  const keepLatestN = Number(value.keepLatestN);

  return {
    googleClientId: typeof value.googleClientId === 'string' ? value.googleClientId.trim() : '',
    autoSyncChat: value.autoSyncChat !== false,
    keepLatestN: Number.isFinite(keepLatestN) && keepLatestN >= 1 && keepLatestN <= 100
      ? Math.trunc(keepLatestN)
      : DEFAULT_SETTINGS.keepLatestN,
  };
}

export function loadSettings(storage = globalThis.localStorage) {
  if (!storage) {
    return { ...DEFAULT_SETTINGS };
  }

  try {
    return normalizeSettings({
      ...DEFAULT_SETTINGS,
      ...JSON.parse(storage.getItem(SETTINGS_KEY) || '{}'),
    });
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings, storage = globalThis.localStorage) {
  const normalized = normalizeSettings(settings);
  storage?.setItem(SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}

export function formatUploadDate(date = new Date()) {
  const pad = (number) => String(number).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);

  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    'T',
    `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`,
    sign,
    `${pad(Math.floor(absoluteOffset / 60))}-${pad(absoluteOffset % 60)}`,
  ].join('');
}

export function sanitizeDrivePathSegment(value, fallback = 'unknown') {
  const cleaned = String(value || fallback)
    .replace(/[\\/:*?"<>|#%{}^~[\]`]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

  return cleaned || fallback;
}

export function makeDrivePath({ roleName, chatId }) {
  return [
    ROOT_FOLDER_NAME,
    sanitizeDrivePathSegment(roleName, 'unknown-role'),
    sanitizeDrivePathSegment(chatId, 'unknown-chat'),
    'chat',
  ];
}

export function buildChatEnvelope({ context, chat, uploadDate = formatUploadDate(), source = 'tavern-roamer-lite' }) {
  return {
    schema: 'tavern-roamer-lite/chat/v1',
    source,
    item: 'chat',
    uploadDate,
    context: {
      roleName: context.roleName,
      chatId: context.chatId,
    },
    chat: clone(chat),
  };
}

export function extractChatFromEnvelope(value) {
  if (Array.isArray(value)) {
    return clone(value);
  }

  if (Array.isArray(value?.chat)) {
    return clone(value.chat);
  }

  if (typeof value?.content === 'string') {
    return value.content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  throw new Error('下載內容不是可辨識的聊天格式');
}

export function parseVersionFileName(fileName) {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}[+-]\d{2}-\d{2})\.json$/.exec(fileName);
  return match?.[1] || null;
}

export function versionFromDriveFile(file) {
  const uploadDate = parseVersionFileName(file.name);

  return {
    id: file.id,
    name: file.name,
    uploadDate,
    modifiedTime: file.modifiedTime || '',
    size: Number(file.size || 0),
  };
}

export function sortVersionsDescending(versions) {
  return [...versions].sort((left, right) => {
    const leftKey = left.uploadDate || left.modifiedTime || left.name;
    const rightKey = right.uploadDate || right.modifiedTime || right.name;
    return rightKey.localeCompare(leftKey);
  });
}

export function escapeDriveQueryValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function buildDriveQuery(parts) {
  return parts.filter(Boolean).join(' and ');
}
