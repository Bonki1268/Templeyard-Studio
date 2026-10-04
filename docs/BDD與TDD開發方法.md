# BDD 與 TDD 開發方法

## 1. 測試分層

| 層 | 測什麼 | 工具 | 位置 | 執行 |
| --- | --- | --- | --- | --- |
| 單元 | 純函式與單一模組：寺廟資料清理與紀年換算、搜尋比對、成本記帳、步驟狀態機、腳本驗證、字幕檔產生、PNG 產生 | `node:test` | `app/test/unit/*.test.js` | `cd app && npm test` |
| 整合 | 透過 HTTP 呼叫真的伺服器（隨機埠、暫存資料夾、假 AI 服務）：API 行為、檔案寫入、ffmpeg 遮蔽與合成、prompt 組裝與生成紀錄 | `node:test` + `fetch` | `app/test/integration/*.test.js` | `cd app && npm test` |
| 端對端 | 用瀏覽器操作網頁，從建立系列走完 6 步並下載成品 | `@playwright/test`（本機 Chromium） | `app/e2e/*.spec.js` | `cd app && npm run e2e` |
| prompt-studio | 既有的 8 項 API 測試，不可破壞 | `node:test` | `prompt-studio/test/` | `cd prompt-studio && npm test` |

原則：

- 每個測試使用自己的暫存資料夾（`fs.mkdtemp`），測試之間不共用狀態，也不會改到 `app/data/` 或 `prompt-studio/prompts/`。
- 會用到 ffmpeg 的整合測試輸出小尺寸（例如 320×180），只有「輸出規格」測試用正式的 1920×1080，讓閘門維持在一兩分鐘內。
- 時間、亂數、外部服務都透過參數注入（`createApp({ clock, providers, ... })`），測試結果固定。

## 2. 外部 AI 服務的假實作設計

所有付費服務都隔在 `app/src/ai/` 的轉接層後面，業務邏輯只認得介面：

```
text.generate({ request })            → { text, json?, model, usage }
image.generate({ request, refs })     → { file, model }        // refs：參考圖（去識別後的照片、定裝圖）
video.generate({ request, firstFrame, lastFrame?, seconds }) → { file, model, hasVoice }
voice.synthesize({ text, speaker })   → { file, seconds }
music.track(id, seconds)              → { file }
```

`request` 一律是 prompt-studio `render` 組出的內容（含 `promptId`、`promptVersion`），轉接層不自己寫提示詞。

假實作（`app/src/ai/fake/`）：

- **結果固定**：輸出只由輸入決定。文字以輸入的 hash 決定措辭；腳本依秒數切出固定的分鏡；圖片是由 hash 決定顏色的 PNG；影片、語音、音樂用 ffmpeg 的測試訊號源在本機產生。同樣的輸入永遠得到同樣的輸出。
- **不花錢、不連網**：假實作不會呼叫 `fetch`。整合測試另外把全域 `fetch` 換成會丟錯的版本，確保沒有任何程式偷偷連外。
- **可觀察**：假實作記下每次被呼叫的參數（`calls`），測試可以檢查「送出的是去識別後的照片」「帶入了系列風格」等規則。
- **可製造失敗**：可設定第 N 次呼叫失敗，用來測試「失敗時退回預留金額」。

換成真實服務時只換一層：`app/src/ai/index.js` 依環境變數 `AI_PROVIDER`（預設 `fake`）選擇實作；真實實作（例如 Higgsfield）只要符合同一組介面，業務邏輯與測試都不用改。真實實作的單元測試使用注入的假 `fetch`，同樣不會花錢。

## 3. BDD 情境如何對應到測試

- 每個開發步驟有一個 `features/<編號>-<名稱>.feature`，開頭註明對應的規格書章節，例如 `# 規格書：功能規格 2. 新增影片`。
- 情境用繁中 Gherkin（`# language: zh-TW`，關鍵字：功能、場景、假設、當、那麼、而且）。
- **對照規則**：每個 `場景: <標題>` 必須有一個測試的名稱包含 `<標題>`，例如：

  ```gherkin
  場景: 已廢止的寺廟預設不出現在搜尋結果
  ```

  ```js
  test('場景：已廢止的寺廟預設不出現在搜尋結果', async () => { ... });
  ```

- `scripts/check-features.js` 掃描所有 `.feature` 與測試檔，任何情境找不到對應測試就失敗；它是驗證閘門的第一關。

## 4. 紅燈 → 綠燈 → 重構 實際操作

1. **寫情境**：在 `features/` 新增或更新該步驟的 `.feature`。
2. **紅燈**：依情境寫測試，執行 `cd app && npm test`（或只跑單一檔 `node --test test/unit/xxx.test.js`），確認失敗訊息是「功能還沒做」（例如 404、函式不存在、斷言不符），而不是語法錯誤或測試本身寫錯。
3. **綠燈**：寫最少的程式讓這些測試通過。
4. **重構**：整理命名、抽出重複，測試保持全綠。
5. **閘門**：`bash scripts/gate.sh`，依序執行：情境對照檢查 → prompt-studio 測試 → app 單元與整合測試 → 端對端測試。全部通過才 commit（「步驟 N：名稱」）並 push。
