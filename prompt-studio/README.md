# Prompt Studio

廟埕影室（Templeyard Studio）每個生成節點都有自己的 AI 指令（prompt），每個指令是 `prompts/` 裡的一個 JSON 檔。
這個工具提供編輯頁與 API：在頁面上修改、儲存，就會直接更新對應的 JSON 檔；系統生成時呼叫 API，由 API 依 JSON 檔與輸入資料組出送給 AI 的內容。

## 啟動

需要 Node.js 18 以上，不需安裝套件。

```bash
node server.js          # 開啟 http://localhost:3300
PORT=4000 node server.js
npm test                # 執行 API 測試（使用暫存複本，不會改到 prompts/）
```

## 節點與檔案

| 步驟 | 檔案 | 用途 | 類型 |
| --- | --- | --- | --- |
| 2 | `copy-polish.json` | 故事文案潤飾 | 文字 |
| 3 | `story-script.json` | 故事與分鏡腳本（輸出 JSON） | 文字 |
| 3 | `storyboard-image.json` | 分鏡圖 | 圖片 |
| 4 | `character-sheet.json` | 角色三視圖與定裝圖 | 圖片 |
| 5 | `refined-frame.json` | 精緻圖 | 圖片 |
| 6 | `shot-video.json` | 分鏡影片 | 影片 |

## Prompt 檔格式

```json
{
  "id": "story-script",
  "step": 3,
  "name": "故事與分鏡腳本",
  "description": "說明",
  "version": 3,
  "updatedAt": "2026-10-03T01:00:00.000Z",
  "target": { "kind": "text", "model": "", "aspectRatio": "9:16" },
  "system": "AI 的角色與規則，可用 {{變數}}",
  "template": "指令內容，用 {{temple.name}} 這樣的標記插入資料",
  "variables": [
    { "name": "temple.name", "label": "廟名", "required": true, "example": "鄞山寺" }
  ],
  "output": { "format": "json", "schema": { "type": "object" } }
}
```

- `target.kind`：`text`、`image` 或 `video`；`model` 空白代表用系統預設模型。
- 變數名稱可用點號表示巢狀資料，例如 `temple.name` 對應 `{ "temple": { "name": "…" } }`。物件或陣列會轉成 JSON 文字插入。
- 指令裡用到但未宣告的變數，儲存時會被拒絕；必填變數缺少時，組裝會被拒絕。
- `version` 與 `updatedAt` 由伺服器在儲存時自動更新，舊版本保存在 `prompts/.history/<id>/v<版本>.json`。

## API

| 方法 | 路徑 | 用途 |
| --- | --- | --- |
| GET | `/api/prompts` | 列出所有 prompt |
| GET | `/api/prompts/:id` | 讀取一個 prompt |
| PUT | `/api/prompts/:id` | 儲存，body：`{ prompt, expectedVersion }`；版本不符回 409，驗證失敗回 422 |
| GET | `/api/prompts/:id/history` | 歷史版本清單 |
| GET | `/api/prompts/:id/history/:version` | 讀取某個歷史版本 |
| POST | `/api/prompts/:id/render` | 組裝送給 AI 的內容，body：`{ variables }` |

`render` 的回應：

```json
{
  "request": {
    "promptId": "story-script", "promptVersion": 3, "step": 3,
    "target": { "kind": "text", "model": "" },
    "system": "…已帶入變數的 system 指令…",
    "messages": [{ "role": "user", "content": "…已帶入變數的指令內容…" }],
    "output": { "format": "json", "schema": {} }
  },
  "missing": [],
  "compiled": "export function build(input) { … }"
}
```

`request` 就是後端要轉送給文字、圖片或影片模型的內容；`promptId` 與 `promptVersion` 應寫進生成紀錄，方便追溯每次生成用的是哪一版指令。
`compiled` 是同一個 prompt 轉成的 JavaScript 函式原始碼，只供檢視插入點，伺服器不會執行它。

## 尚未包含

- 實際呼叫 AI 模型（`render` 只負責組出內容）。
- 登入與權限：目前任何能開啟頁面的人都能修改指令，只應在本機或內部網路使用。
