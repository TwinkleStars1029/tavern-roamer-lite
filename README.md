# Tavern Roamer Lite

純前端 SillyTavern 擴充功能，用於透過 Google Drive 同步目前聊天。

## 功能

* 可作為一般 GitHub 可安裝的 SillyTavern UI 擴充功能執行。
* 不需要伺服器端外掛。
* 透過 Google Identity Services，在瀏覽器中連接 Google Drive。
* 上傳目前的 `SillyTavern.getContext().chat` 陣列。
* 版本會儲存在：

```text
SillyTavernSync/{role_name}/{chat_id}/chat/{upload_date}.json
```

* 檢查目前角色／聊天 ID 對應的雲端版本。
* 下載選定的雲端版本。
* 嘗試將下載的聊天套用到前端可變動的 `context.chat`。
* 在套用前，會先於瀏覽器端使用 `localStorage` 保留備份。
* 上傳後，會依照設定的保留數量，修剪較舊的雲端聊天版本。

## 限制

* 此 Lite 版本只同步聊天內容。
* 不會同步角色卡、世界書、使用者人格、預設、正則或素材。
* 無法建立真正的檔案系統層級備份。
* 如果你的 SillyTavern 前端沒有暴露儲存函式，此擴充功能可以在記憶體中修改目前聊天，但可能仍需要手動儲存或重新載入處理。
* 存取權杖是瀏覽器 OAuth 權杖，可能會過期；需要時請重新連線。

## Google OAuth 設定

在 Google Cloud Console 建立 OAuth 用戶端：

* 啟用該專案的 Google Drive API。
* 應用程式類型：Web application
* 已授權的 JavaScript 來源：

```text
http://localhost:8000
https://your-cloud-tavern-host
```

瀏覽器中不會使用 client secret。

將 OAuth Client ID 複製到 Tavern Roamer Lite 面板中。

## 安裝

將此資料夾放在 GitHub repo 根目錄，然後在 SillyTavern 中：

```text
Extensions -> Install Extension -> Git repository URL
```

repo 根目錄必須包含：

* `manifest.json`
* `index.js`
* `core.js`
* `style.css`

## 測試

1. 安裝擴充功能。
2. 填入 Google OAuth Client ID。
3. 點擊 `儲存設定`。
4. 點擊 `連線 Google Drive`。
5. 開啟一個聊天。
6. 點擊 `上傳目前聊天`。
7. 點擊 `檢查雲端版本`。
8. 選擇一個版本，並點擊 `下載並套用`。
