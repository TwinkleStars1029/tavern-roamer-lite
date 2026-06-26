import {
  DRIVE_SCOPE,
  LOCAL_BACKUP_KEY,
  buildChatEnvelope,
  buildDriveQuery,
  escapeDriveQueryValue,
  extractChatFromEnvelope,
  formatUploadDate,
  loadSettings,
  makeDrivePath,
  saveSettings,
  sortVersionsDescending,
  versionFromDriveFile,
} from './core.js';

const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

let state = {
  settings: loadSettings(),
  tokenClient: null,
  accessToken: '',
  versions: [],
  selectedVersionId: '',
  busy: false,
  status: '尚未連線',
};

function getContext() {
  return globalThis.SillyTavern?.getContext?.() || globalThis.getContext?.() || {};
}

function getRoleName(context) {
  return context.character?.name
    || context.name2
    || context.chara?.name
    || context.group?.name
    || context.groupId
    || 'unknown-role';
}

function getChatId(context) {
  return context.chatId
    || context.chat?.[0]?.chat_id
    || context.chatMetadata?.chat_id
    || context.this_chid
    || 'current-chat';
}

function getChatContext() {
  const context = getContext();

  return {
    context,
    roleName: getRoleName(context),
    chatId: getChatId(context),
    chat: context.chat,
  };
}

function requireChatContext() {
  const current = getChatContext();
  if (!Array.isArray(current.chat)) {
    throw new Error('找不到目前聊天陣列，請先開啟一個聊天。');
  }

  return current;
}

function setStatus(status) {
  state = { ...state, status };
  render();
}

function setBusy(busy) {
  state = { ...state, busy };
  render();
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      if (globalThis.google?.accounts?.oauth2) resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Google Identity Services 載入失敗。'));
    document.head.append(script);
  });
}

async function ensureTokenClient() {
  const settings = loadSettings();
  if (!settings.googleClientId) {
    throw new Error('請先填入 Google OAuth Client ID。');
  }

  await loadScriptOnce(GIS_SCRIPT_URL);

  if (!state.tokenClient) {
    state.tokenClient = globalThis.google.accounts.oauth2.initTokenClient({
      client_id: settings.googleClientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response.error) {
          setStatus(`Google 授權失敗：${response.error}`);
          return;
        }
        state = { ...state, accessToken: response.access_token };
        setStatus('已連線 Google Drive');
      },
    });
  }

  return state.tokenClient;
}

async function connectGoogleDrive() {
  const tokenClient = await ensureTokenClient();

  await new Promise((resolve, reject) => {
    tokenClient.callback = (response) => {
      if (response.error) {
        reject(new Error(`Google 授權失敗：${response.error}`));
        return;
      }

      state = { ...state, accessToken: response.access_token };
      resolve();
    };
    tokenClient.requestAccessToken({ prompt: state.accessToken ? '' : 'consent' });
  });

  setStatus('已連線 Google Drive');
}

async function driveFetch(url, options = {}) {
  if (!state.accessToken) {
    await connectGoogleDrive();
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${state.accessToken}`,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Drive API 失敗 (${response.status})：${text}`);
  }

  return response;
}

async function driveJson(url, options = {}) {
  const response = await driveFetch(url, options);
  return response.json();
}

async function findFolder(name, parentId) {
  const query = buildDriveQuery([
    `name='${escapeDriveQueryValue(name)}'`,
    "mimeType='application/vnd.google-apps.folder'",
    'trashed=false',
    parentId ? `'${escapeDriveQueryValue(parentId)}' in parents` : null,
  ]);

  const params = new URLSearchParams({
    q: query,
    fields: 'files(id,name)',
    pageSize: '1',
  });

  const result = await driveJson(`${DRIVE_FILES_URL}?${params}`);
  return result.files?.[0] || null;
}

async function createFolder(name, parentId) {
  return driveJson(DRIVE_FILES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined,
    }),
  });
}

async function ensureFolderPath(pathParts) {
  let parentId = null;

  for (const part of pathParts) {
    const folder = await findFolder(part, parentId) || await createFolder(part, parentId);
    parentId = folder.id;
  }

  return parentId;
}

async function uploadJson(folderId, fileName, value) {
  const boundary = `tavern_roamer_lite_${Date.now()}`;
  const metadata = {
    name: fileName,
    mimeType: 'application/json',
    parents: [folderId],
  };
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(value, null, 2),
    `--${boundary}--`,
    '',
  ].join('\r\n');

  return driveJson(`${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,name,size,modifiedTime`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
}

async function listVersionsForCurrentChat() {
  const { roleName, chatId } = requireChatContext();
  const folderId = await ensureFolderPath(makeDrivePath({ roleName, chatId }));
  const query = buildDriveQuery([
    `'${escapeDriveQueryValue(folderId)}' in parents`,
    "mimeType!='application/vnd.google-apps.folder'",
    'trashed=false',
  ]);
  const params = new URLSearchParams({
    q: query,
    fields: 'files(id,name,size,modifiedTime)',
    pageSize: '100',
    orderBy: 'name desc',
  });
  const result = await driveJson(`${DRIVE_FILES_URL}?${params}`);

  return sortVersionsDescending((result.files || [])
    .map(versionFromDriveFile)
    .filter((version) => version.uploadDate));
}

async function deleteDriveFile(fileId) {
  await driveFetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
}

async function pruneOldVersions(versions) {
  const keepLatestN = state.settings.keepLatestN;
  const oldVersions = sortVersionsDescending(versions).slice(keepLatestN);

  await Promise.all(oldVersions.map((version) => deleteDriveFile(version.id)));
}

async function uploadCurrentChat({ silent = false } = {}) {
  const { roleName, chatId, chat } = requireChatContext();
  setBusy(true);

  try {
    const uploadDate = formatUploadDate();
    const folderId = await ensureFolderPath(makeDrivePath({ roleName, chatId }));
    await uploadJson(folderId, `${uploadDate}.json`, buildChatEnvelope({
      context: { roleName, chatId },
      chat,
      uploadDate,
    }));
    const versions = await listVersionsForCurrentChat();
    await pruneOldVersions(versions);
    state = {
      ...state,
      versions: sortVersionsDescending(versions).slice(0, state.settings.keepLatestN),
      selectedVersionId: versions[0]?.id || '',
    };
    if (!silent) setStatus(`已上傳目前聊天：${uploadDate}`);
  } finally {
    setBusy(false);
  }
}

async function refreshVersions() {
  setBusy(true);

  try {
    const versions = await listVersionsForCurrentChat();
    state = {
      ...state,
      versions,
      selectedVersionId: state.selectedVersionId || versions[0]?.id || '',
    };
    setStatus(`找到 ${versions.length} 個雲端版本`);
  } finally {
    setBusy(false);
  }
}

async function downloadVersion(fileId) {
  return driveJson(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?alt=media`);
}

async function persistChat(context) {
  if (typeof context.saveChatConditional === 'function') {
    await context.saveChatConditional();
    return;
  }

  if (typeof context.saveChat === 'function') {
    await context.saveChat();
    return;
  }

  if (typeof context.saveChatDebounced === 'function') {
    context.saveChatDebounced();
  }
}

async function applySelectedVersion() {
  if (!state.selectedVersionId) {
    throw new Error('請先選擇一個雲端版本。');
  }

  const { context, chat } = requireChatContext();
  setBusy(true);

  try {
    const downloaded = await downloadVersion(state.selectedVersionId);
    const nextChat = extractChatFromEnvelope(downloaded);

    localStorage?.setItem(LOCAL_BACKUP_KEY, JSON.stringify({
      backupDate: new Date().toISOString(),
      chat,
    }));

    chat.splice(0, chat.length, ...nextChat);
    await persistChat(context);
    context.eventSource?.emit?.(context.event_types?.CHAT_CHANGED);
    setStatus(`已套用雲端版本，共 ${nextChat.length} 則訊息`);
  } finally {
    setBusy(false);
  }
}

async function restoreBrowserBackup() {
  const backup = JSON.parse(localStorage?.getItem(LOCAL_BACKUP_KEY) || 'null');
  if (!backup?.chat) {
    throw new Error('瀏覽器中沒有可還原的本機備份。');
  }

  const { context, chat } = requireChatContext();
  chat.splice(0, chat.length, ...backup.chat);
  await persistChat(context);
  context.eventSource?.emit?.(context.event_types?.CHAT_CHANGED);
  setStatus(`已還原瀏覽器備份：${backup.backupDate || '未知時間'}`);
}

async function runAction(action) {
  try {
    await action();
  } catch (error) {
    console.error('[Tavern Roamer Lite]', error);
    setStatus(error.message || String(error));
  }
}

function saveSettingsFromForm(form) {
  state = {
    ...state,
    settings: saveSettings({
      googleClientId: form.googleClientId.value,
      autoSyncChat: form.autoSyncChat.checked,
      keepLatestN: form.keepLatestN.value,
    }),
    tokenClient: null,
    accessToken: '',
  };
  setStatus('設定已儲存');
}

function versionLabel(version) {
  const size = version.size ? ` / ${(version.size / 1024).toFixed(1)} KB` : '';
  return `${version.uploadDate}${size}`;
}

function panelHtml() {
  const disabled = state.busy ? 'disabled' : '';
  const connectedClass = state.accessToken ? 'is-connected' : '';

  return `
    <div class="tavern-roamer-lite">
      <div class="tr-lite-header">
        <div>
          <div class="tr-lite-title">Tavern Roamer Lite</div>
          <div class="tr-lite-subtitle">Google Drive chat sync</div>
        </div>
        <span class="tr-lite-pill ${connectedClass}">${state.accessToken ? '已連線' : '未連線'}</span>
      </div>

      <form class="tr-lite-settings">
        <label class="tr-lite-field tr-lite-field-wide">
          <span class="tr-lite-label">Google OAuth Client ID</span>
          <input class="tr-lite-input" name="googleClientId" type="text" value="${escapeHtml(state.settings.googleClientId)}" autocomplete="off" />
        </label>
        <div class="tr-lite-row">
          <label class="tr-lite-check">
            <input class="tr-lite-checkbox" name="autoSyncChat" type="checkbox" ${state.settings.autoSyncChat ? 'checked' : ''} />
            <span>送出訊息後自動上傳</span>
          </label>
          <label class="tr-lite-field tr-lite-keep-field">
            <span class="tr-lite-label">保留版本</span>
            <input class="tr-lite-input" name="keepLatestN" type="number" min="1" max="100" value="${state.settings.keepLatestN}" />
          </label>
        </div>
        <button class="tr-lite-button tr-lite-primary" type="submit" ${disabled}>儲存設定</button>
      </form>

      <div class="tr-lite-actions">
        <button class="tr-lite-button" type="button" data-action="connect" ${disabled}>連線 Google Drive</button>
        <button class="tr-lite-button" type="button" data-action="upload" ${disabled}>上傳目前聊天</button>
        <button class="tr-lite-button" type="button" data-action="refresh" ${disabled}>檢查雲端版本</button>
      </div>

      <div class="tr-lite-versions">
        <select class="tr-lite-select" data-role="versions" ${disabled}>
          <option value="">${state.versions.length ? '選擇雲端版本' : '尚未載入版本'}</option>
          ${state.versions.map((version) => `
            <option value="${escapeHtml(version.id)}" ${state.selectedVersionId === version.id ? 'selected' : ''}>
              ${escapeHtml(versionLabel(version))}
            </option>
          `).join('')}
        </select>
        <button class="tr-lite-button" type="button" data-action="apply" ${disabled}>下載並套用</button>
        <button class="tr-lite-button" type="button" data-action="restore-local" ${disabled}>還原瀏覽器備份</button>
      </div>

      <div class="tr-lite-status">${escapeHtml(state.status)}</div>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function getContainer() {
  let container = document.querySelector('#tavern-roamer-lite');
  if (!container) {
    container = document.createElement('div');
    container.id = 'tavern-roamer-lite';
    const extensionsSettings = document.querySelector('#extensions_settings') || document.body;
    extensionsSettings.append(container);
  }
  return container;
}

function bindEvents(container) {
  container.querySelector('.tr-lite-settings')?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveSettingsFromForm(event.currentTarget);
  });

  container.querySelector('[data-action="connect"]')?.addEventListener('click', () => runAction(connectGoogleDrive));
  container.querySelector('[data-action="upload"]')?.addEventListener('click', () => runAction(uploadCurrentChat));
  container.querySelector('[data-action="refresh"]')?.addEventListener('click', () => runAction(refreshVersions));
  container.querySelector('[data-action="apply"]')?.addEventListener('click', () => runAction(applySelectedVersion));
  container.querySelector('[data-action="restore-local"]')?.addEventListener('click', () => runAction(restoreBrowserBackup));
  container.querySelector('[data-role="versions"]')?.addEventListener('change', (event) => {
    state = { ...state, selectedVersionId: event.currentTarget.value };
  });
}

function render() {
  if (typeof document === 'undefined') return;

  const container = getContainer();
  container.innerHTML = panelHtml();
  bindEvents(container);
}

function registerAutoSync() {
  const context = getContext();
  const eventSource = context.eventSource;
  const eventTypes = context.event_types;

  if (!eventSource?.on || !eventTypes?.MESSAGE_SENT) return;

  eventSource.on(eventTypes.MESSAGE_SENT, () => {
    if (!state.settings.autoSyncChat || !state.accessToken) return;
    runAction(() => uploadCurrentChat({ silent: true }));
  });
}

function mount() {
  render();
  registerAutoSync();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
}

export function onClean() {
  state = {
    ...state,
    tokenClient: null,
    accessToken: '',
  };
}
