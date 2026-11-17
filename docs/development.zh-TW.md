# 開發 httpdog-house

[English](development.md) | 繁體中文 · 回到 [README](../README.zh-TW.md)

## 在本機試跑

需要 [Bun](https://bun.sh)。這裡的步驟都不會碰到 Cloudflare。

```bash
bun install
make dev-init                    # 本機的 secret 與本機資料庫
make admin-local NAME=you        # 會問你密碼
make dev                         # 介面在 http://localhost:3000,接收端在 http://localhost:8788
```

登入後打開 **keys**(金鑰)頁面,建立一把登記了 instance `web-01` 的金鑰,複製它的 secret。然後送點東西進來:

```bash
# 一則已簽章的測試告警
make test-alert SECRET=<那組 secret> INSTANCE=web-01

# 或者由 httpdog 本身送 3 則真的,在 httpdog 的工作目錄裡執行
HTTPDOG_WEBHOOK_URL=http://127.0.0.1:8788/alerts HTTPDOG_WEBHOOK_SECRET=<那組 secret> \
  httpdog --stdin --config rules.example.yaml < sample.log
```

幾秒內告警頁面就會出現它們,不用重新整理。用錯的 secret 送一則,它會出現在 **rejected**(被拒絕)頁面,並附上原因。

`make` 會列出所有指令。`make preview` 會 build 介面並用 wrangler 執行,也就是 Cloudflare 實際執行它的方式。

## 檔案位置

| 路徑 | 內容 |
|---|---|
| `ingest/src/receiver.ts` | 整個接收端:驗證、儲存、記錄拒絕、每日清理 |
| `ingest/wrangler.jsonc` | 接收端的 Worker:資料庫、設定、每日排程 |
| `server/api/` | 介面的 API。`auth/` 是登入,`admin/` 需要 admin |
| `server/middleware/guard.ts` | 誰可以呼叫什麼 |
| `server/plugins/page-headers.ts` | 頁面的 Content-Security-Policy |
| `server/utils/` | Session、密碼、輸入檢查 |
| `shared/` | 兩個 Worker 共用的程式:`crypto.ts`、`instances.ts`,以及 `api.ts` 裡的型別 |
| `app/pages/` | 一個頁面一個檔案 |
| `app/components/` | `AlertDetail`、`KeySetup`、頁首、對話框、程式碼區塊 |
| `app/content/en.ts`、`zh-tw.ts` | 介面上所有的文字,一種語言一個檔案,結構相同。改其中一份就要改另一份 |
| `app/assets/css/main.css` | 兩種主題的顏色、字型與共用的 class。深色外觀沿用 httpdog 的網站 |
| `migrations/` | 資料庫結構 |
| `scripts/` | `setup.ts`(第一次部署)、`deploy-config.ts`(產生部署用的設定檔)、`create-admin.ts` 與 `send-test-alert.ts` |
| `deploy.local.env.example` | 每一套部署不一樣的值。你自己的那份 `deploy.local.env` 不會進版本控制 |
| `docs/` | 部署、運作方式,以及這份文件,各有英文與繁體中文兩個版本 |
| `.github/workflows/` | `check.yml`(每次 push 與 pull request 都跑 `make check` 與 `make dry-run`)、`fuzz.yml`(push 時用更多輸入,每週一次用多得多的輸入)、`codeql.yml` 與 `scorecard.yml`(兩者要等 repository 公開後才會執行) |
| `.github/dependabot.yml` | 每週為套件與 action 的新版本開 pull request |
| `SECURITY.md`、`LICENSE` | 如何回報漏洞;MIT License |
| `test/` | 單元測試,以及 `fuzz.test.ts`:用產生出來的輸入去試所有接受外部輸入的地方。`d1.ts` 用記憶體內的 SQLite 加上真的資料表結構來代替 D1 |
| `wrangler.jsonc` | 介面的 Worker,裡面是範例值。`nuxt build` 會把它合併到 `.output/server/wrangler.json` |

給修改這個專案的人:

- **要與 httpdog 保持一致。** 請求內容、標頭與簽章是 httpdog 的對外介面(`docs/webhook.md`、`src/notify.rs`)。`test/shared.test.ts` 用 httpdog 自己測試用的同一組向量檢查簽章。
- **更新 wrangler。** 它的版本是釘住的,Dependabot 會提議新版本。`scripts/setup.ts` 倚賴它的四個行為,這些是在 4.163.0 的原始碼裡確認的,而測試用的是替身,不會測到:`d1 list --json` 會印出含 `uuid` 與 `name` 的清單;`d1 create --update-config=false` 不會去改 `wrangler.jsonc`;部署時會把 `type` 為 `deploy`、帶有 `targets` 的一行寫進 `WRANGLER_OUTPUT_FILE_PATH` 指定的檔案;沒有人登入時 `whoami --json` 會以錯誤結束。升級前請重新確認。
- **Workflow。** Action 一律釘在 commit SHA,每個 workflow 只要求它用得到的權限。它們都沒有 Cloudflare 的憑證,所以都不會部署。
- **wrangler 與產生出來的設定檔。** build 之後,不帶 `-c` 執行的 wrangler 會使用 Nitro 產生的設定檔。這對部署介面是對的,對其他事情都是錯的,所以 `Makefile` 一律帶 `-c`。
- **有進版本控制的設定檔裡不放真的值。** 真實部署的資料庫 id、網址或網域一律放在 `deploy.local.env`,不要寫進 `wrangler.jsonc`。要新增這類的值時,在 `deploy.local.env.example` 加一行,並由 `scripts/deploy-config.ts` 填進設定檔。
- **請求自己的網址。** 在 Workers 上,h3 的 `getRequestURL()` 會把 HTTPS 請求說成 `http://`。需要真正來源的程式,請用 `server/utils/http.ts` 的 `requestOrigin()`。
- **字型。** Ubuntu Mono,只載入 Latin 子集,由這個網站自己提供。中文會退回系統字型。
- **深色與淺色。** 所有顏色都來自 `main.css` 最上面的變數;`<html data-theme="light">` 會換成第二組數值。新增顏色時要做成變數,並為兩種主題各給一個值,不要在元件裡直接寫色碼。主題以瀏覽器裡選過的為準(頁首、登入頁或帳號頁都能切換),沒選過就跟隨系統;`nuxt.config.ts` 裡有一小段 inline script 會在畫面繪製前先設定好。
- **語言。** 介面預設是英文,切換到中文後會記在瀏覽器裡。
- **讀者先部署。** README 是寫給想把它跑起來的人:它是什麼、`make setup`、接上主機。解釋原理或延伸用法的內容放在 `docs/`。
- **兩種語言。** README 與 `docs/` 裡的每一份文件都有 `.zh-TW.md` 的版本。改其中一份就要改另一份。

## 驗證過的範圍

- `make check`:型別檢查,以及 84 個測試。其中 67 個是單元測試,涵蓋簽章(httpdog 自己的測試向量)、加密、密碼、樣式比對、用真的資料表結構測接收端(接受、重複送達、每一種拒絕原因,還有每日清理),從 `deploy.local.env` 產生的設定檔,以及 `make setup` 的每一步(對象是只存在於測試裡的帳號)。
- 用幾份虛構的 `deploy.*.env`(其中一份有 `NAME_SUFFIX`),`wrangler deploy --dry-run` 接受了兩個 Worker 產生出來的設定檔。
- 用不會動到任何東西的假 wrangler 與假 make,把 `make setup` 從頭跑到尾:第一次執行、第二次執行(發現一切都已就緒),以及沒有終端機可以詢問的情況。
- Fuzzing:另外 17 個測試是 `test/fuzz.test.ts` 裡的性質,在 `make check` 中每個用 200 組產生出來的輸入去試,在 `make fuzz` 中則是 20,000 組。涵蓋接收端(沒有簽章的請求不會被存下來,也不會得到錯誤回應;已簽章的告警不論欄位裡放什麼都只存一次;簽章後被改過的內容、沒有金鑰登記的 instance 都會被拒絕)、簽章、secret 的加密、instance 樣式、頁面上顯示的文字與語法上色,以及 `deploy.local.env`。最初幾次執行找到三個問題,都已修正:會反轉文字方向的 U+061C 原本會照原樣顯示;已簽章的告警裡像 `1e300` 這樣的數字原本會被當成時間存下來;寫進 `deploy.local.env` 的值,原本可能因為值裡的 `$` 或被取代那一行裡的 `\r` 而走樣。
- 在一台機器上(macOS、wrangler 4.163.0),兩個 Worker 都跑在 wrangler 的本機執行環境裡:真的 `httpdog` 執行檔重播 `sample.log`,3 則已簽章的告警都送達;改用錯的 secret 時,9 次嘗試全部被拒絕並留下紀錄。
- 用 headless Chrome 對 build 後的介面測試,HTTP 與 HTTPS 都跑過:登入、新告警即時出現、篩選、金鑰的建立、編輯、停用與刪除(每一步之後都檢查接收端的回應)、viewer 被擋在管理頁面與管理 API 之外、變更密碼,以及兩種語言、兩種主題在桌機與手機寬度下的頁面。
- 在 GitHub 的 Linux runner 上:`check.yml`(`make check` 與 `make dry-run`)與 `fuzz.yml`(每個性質 5,000 組輸入)第一次執行就通過。
- **沒有驗證:`codeql.yml` 與 `scorecard.yml`。** repository 還是 private 時它們會被略過,所以還沒有執行過。
- **沒有驗證:Cloudflare 上的任何東西。** 還沒有部署過,所以對真實帳號執行 `make setup`、真正的 D1、速率限制、每日排程,以及免費方案的 CPU 上限都沒有測過。
