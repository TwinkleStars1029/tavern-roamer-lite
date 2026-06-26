import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildChatEnvelope,
  extractChatFromEnvelope,
  formatUploadDate,
  makeDrivePath,
  normalizeSettings,
  parseVersionFileName,
  sanitizeDrivePathSegment,
  sortVersionsDescending,
  versionFromDriveFile,
} from '../core.js';

test('normalizeSettings validates browser settings', () => {
  assert.deepEqual(normalizeSettings({
    googleClientId: ' client ',
    autoSyncChat: false,
    keepLatestN: 20,
  }), {
    googleClientId: 'client',
    autoSyncChat: false,
    keepLatestN: 20,
  });
});

test('formatUploadDate creates filename-safe timestamp', () => {
  assert.match(formatUploadDate(new Date('2026-06-25T14:45:30.000Z')), /^2026-06-25T\d{2}-\d{2}-\d{2}[+-]\d{2}-\d{2}$/);
});

test('sanitizeDrivePathSegment removes unsafe characters', () => {
  assert.equal(sanitizeDrivePathSegment('佐助/chat:abc'), '佐助_chat_abc');
});

test('buildChatEnvelope and extractChatFromEnvelope round trip chat arrays', () => {
  const chat = [{ name: 'User', mes: 'hello', is_user: true }];
  const envelope = buildChatEnvelope({
    context: { roleName: 'Sasuke', chatId: 'chat_abc123' },
    chat,
    uploadDate: '2026-06-25T22-45-00+08-00',
  });

  assert.equal(envelope.item, 'chat');
  assert.deepEqual(extractChatFromEnvelope(envelope), chat);
});

test('extractChatFromEnvelope supports jsonl content fallback', () => {
  const chat = extractChatFromEnvelope({
    content: '{"name":"User","mes":"hello"}\n',
  });

  assert.equal(chat[0].mes, 'hello');
});

test('version parsing and sorting finds newest versions', () => {
  const oldVersion = versionFromDriveFile({ id: 'old', name: '2026-06-25T22-10-00+08-00.json' });
  const newVersion = versionFromDriveFile({ id: 'new', name: '2026-06-25T22-45-00+08-00.json', size: '42' });

  assert.equal(parseVersionFileName('notes.txt'), null);
  assert.equal(newVersion.size, 42);
  assert.equal(sortVersionsDescending([oldVersion, newVersion])[0].id, 'new');
});

test('makeDrivePath builds role/chat chat folder path', () => {
  assert.deepEqual(makeDrivePath({
    roleName: '佐助/chat',
    chatId: 'chat:abc123',
  }), ['SillyTavernSync', '佐助_chat', 'chat_abc123', 'chat']);
});
