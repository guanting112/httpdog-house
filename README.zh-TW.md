# httpdog-house

[English](README.md) | 繁體中文

集中查看各個 [httpdog](https://github.com/guanting112/httpdog) instance 送來的告警。

httpdog 監看 access log,符合規則時把告警 POST 到你指定的網址。這個專案就是那個網址,再加上一個要登入才能用的介面:它接收所有 instance 的告警、逐一驗證簽章、存起來,並讓你搜尋與篩選。整套都跑在 Cloudflare 上:兩個 Worker 加一個 D1 資料庫。

```
httpdog (web-01) ──┐
httpdog (web-02) ──┼── POST /alerts ──▶  ingest Worker ──▶  D1  ◀── UI Worker ◀── 你的瀏覽器
httpdog (db-01)  ──┘   已簽章             驗證、儲存               頁面與 /api,需要登入
```

- [為什麼分成兩個 Worker](#為什麼分成兩個-worker)
- [在本機試跑](#在本機試跑)
- [部署到 Cloudflare](#部署到-cloudflare)
- [接上一台 httpdog](#接上一台-httpdog)
- [簽章金鑰與 instance](#簽章金鑰與-instance)
- [接收端的回應](#接收端的回應)
- [帳號](#帳號)
- [儲存的內容與保存期限](#儲存的內容與保存期限)
- [安全性說明](#安全性說明)
- [值得知道的 Cloudflare 限制](#值得知道的-cloudflare-限制)
- [檔案位置](#檔案位置)
- [驗證過的範圍](#驗證過的範圍)

## 為什麼分成兩個 Worker

| | ingest Worker(`ingest/`) | UI Worker(`app/`、`server/`) |
|---|---|---|
| 做什麼 | 接收 `POST /alerts`、驗證、寫入 D1 | 提供頁面與它們的 API;讀取 D1、管理金鑰與使用者 |
| 用什麼寫 | 純 TypeScript,沒有相依套件,gzip 後約 5 KB | Nuxt(頁面是靜態檔,Worker 只回應 `/api`) |
| 誰會連到它 | 你的 httpdog 主機 | 登入的人 |

分開的原因是兩者壞掉的方式不同,受信任的程度也不同:

- **沒被收下的告警就是掉了。** httpdog 會在幾秒內試 3 次,然後放棄。所以接收端應該是幾乎不會變動的那一塊。介面部署壞掉,不會讓告警進不來。
- **接收端必須對網際網路開放,介面不必。** 介面有自己的網域,就可以放在 Cloudflare Access 或 IP 規則後面,不影響主機送資料的網址。
- **接收端小到可以一次讀完。** 它做的所有事情都在 `ingest/src/receiver.ts`。

兩者使用同一個資料庫,並共用一小部分程式(`shared/`):簽章驗證、已儲存 secret 的加解密,以及 instance 的比對規則。

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

## 部署到 Cloudflare

所有東西都在你的機器上 build,再用 wrangler 上傳。每台機器先執行一次 `make login`。

1. **建立資料庫。** 執行 `make db-create`,把它印出的 `database_id` 填進 `wrangler.jsonc` 與 `ingest/wrangler.jsonc` **兩個檔案**。兩個 Worker 必須指向同一個資料庫;不一致時 `make check-config` 會擋下部署。
2. **部署。** `make deploy` 會跑檢查、建立資料表,並上傳兩個 Worker。兩者各有一個 `workers.dev` 網址;要用自己的網域,請看兩個 `wrangler.jsonc` 裡註解掉的 `routes`。
3. **給兩個 Worker 同一組 `SECRETS_KEY`。** `make secrets` 會產生一組並設定到兩邊。它是用來加密資料庫裡簽章 secret 的金鑰,不會存在其他地方,也沒有人需要知道它的內容。
4. **告訴介面接收端在哪裡。** 把 `wrangler.jsonc` 裡的 `INGEST_URL` 設成接收端的網址(結尾是 `/alerts`),再執行 `make deploy-ui`。金鑰頁面會把這個網址放進要複製到主機上的設定裡。
5. **建立第一個管理員。** `make admin NAME=you`。

之後 `make deploy` 就是完整的部署。`make deploy-ingest` 與 `make deploy-ui` 則各上傳一個 Worker。

接收端的設定在 `ingest/wrangler.jsonc`:

| 變數 | 預設值 | 意義 |
|---|---|---|
| `MAX_SKEW_SECS` | `300` | 請求的時間戳可以與接收端時鐘相差多少秒 |
| `RETENTION_DAYS` | `90` | 超過這個天數的告警每天刪除一次。`0` 代表永久保留 |

## 接上一台 httpdog

在 **keys** 頁面按「set up a host」,會顯示下面這些內容,並填好你的實際數值。

`/etc/httpdog/secrets.env`:

```
HTTPDOG_WEBHOOK_URL=https://<接收端>/alerts
HTTPDOG_WEBHOOK_SECRET=<登記了這個 instance 的金鑰的 secret>
```

規則檔:

```yaml
instance: web-01          # 金鑰接受的名稱

notifiers:
  ops:
    type: webhook
    url_env: HTTPDOG_WEBHOOK_URL
    secret_env: HTTPDOG_WEBHOOK_SECRET
```

然後執行 `sudo systemctl restart httpdog`。reload 不會重新讀取 `secrets.env`。

如果 httpdog 的 log 出現 `webhook attempt N failed` 而且是 401,請打開 **rejected** 頁面:那裡列出接收端拒絕了什麼、為什麼拒絕(secret 不對、名稱沒有金鑰登記、時鐘不準)。

## 簽章金鑰與 instance

一把**金鑰**就是一組 HMAC secret,加上可以使用它的 instance 清單。

- **請求怎麼驗證。** 接收端從請求內容讀出 `instance`,找出所有登記了這個名稱、而且啟用中的金鑰,只要簽章符合其中一把就接受。先讀名稱不會讓偽造者得到任何好處:名稱只決定簽章要對上哪一組 secret。
- **名稱與樣式。** 金鑰上登記的名稱,寫法與規則檔裡 `instance:` 後面的完全相同。`*` 代表任意一串字元:`web-*` 涵蓋 `web-01` 與 `web-02`,只寫 `*` 的一行則接受任何名稱。一組 secret 給一群主機用,或每台主機各一組,兩種都可以。
- **沒有金鑰登記的 instance 會被拒絕**,即使它帶著別把金鑰的有效簽章也一樣。
- **更換 secret 而不掉告警。** 為同一批 instance 新增第二把金鑰,把主機逐台換成新的 secret,最後刪掉舊金鑰。兩把都在的期間,任一組 secret 都會被接受。
- **指紋。** 每把金鑰會顯示 SHA-256(secret) 的前 8 個十六進位字元。主機上的 secret 相同,算出來的字元就相同,所以不用把 secret 顯示出來,也能回答「兩邊的 secret 是不是同一組」:

  ```bash
  sudo grep '^HTTPDOG_WEBHOOK_SECRET=' /etc/httpdog/secrets.env | cut -d= -f2- | tr -d '\n' | sha256sum | cut -c1-8
  ```
- **使用自己原有的 secret。** 建立金鑰時選「use one I already have」,填入主機上現有的值,主機那邊就不用改。
- 金鑰頁面上的變更從下一個請求開始生效,沒有任何快取。

## 接收端的回應

`POST /alerts` 是唯一接收告警的位址。合約以 httpdog 的 [docs/webhook.md](https://github.com/guanting112/httpdog/blob/main/docs/webhook.md) 為準。

| 狀態碼 | 情況 |
|---|---|
| `204` | 已驗證並儲存。同一則告警再次送達時也是 |
| `400` | 內容不是 httpdog 的 JSON,或沒有可用的 `instance` |
| `401` | 沒有簽章標頭;時間戳離現在太遠;沒有金鑰登記這個 instance;簽章不符合任何金鑰 |
| `413` | 內容超過 256 KiB |
| `500` | 儲存失敗,或金鑰無法解密(兩個 Worker 的 `SECRETS_KEY` 不同)。httpdog 會重試 |

回應不會說明是哪一項檢查沒過;原因在 **rejected** 頁面上。`GET /health` 回 `200 ok`,不碰任何資料。

## 帳號

- **admin** 可以管理金鑰與使用者,並查看被拒絕的請求。**viewer** 只能看告警與 instance。
- `make admin NAME=you` 可以建立管理員,也可以重設:唯一的管理員忘記密碼時,就靠它回來。
- 沒有「首次設定」頁面。一個讓先到的人成為管理員的頁面,陌生人可能比你先找到。
- 最後一個還能登入的 admin 不能被降級、停用或刪除。
- 重設密碼或停用帳號,會讓該帳號在所有裝置上登出。

## 儲存的內容與保存期限

資料表定義在 `migrations/0001_init.sql`。

- **告警**保留與簽章時完全相同的請求內容,另外加上列表顯示與篩選用的欄位。
- **同一則告警送兩次只存一筆。** 某次嘗試的回應沒有及時送達時,httpdog 會再送一次。內容相同,所以第二次只會讓計數加一,顯示為「sent 2 times」。
- **彙總表。** 接收端維護兩張小的計數表(依 instance 與 rule,以及依小時)。告警頁與 instance 頁上的數字都是從這兩張表讀的,不會去數告警本身。
- **被拒絕的請求**只留原因、對方聲稱的 instance 與來源位址,不留內容。只保留最新 500 筆,而且寫入有限速(先允許 12 筆,之後每個執行中的 Worker 每 10 秒一筆),所以陌生人猛打接收端也塞不滿資料庫。
- **清理。** 接收端每天刪除一次:超過 `RETENTION_DAYS` 的告警、過期的 session,以及超過 30 天的拒絕紀錄。
- **搜尋**會在請求內容的任何位置找文字,不分大小寫。一次請求最多查 50,000 則告警,並告訴你查到多久以前;按「search older」會從那裡接著查。

## 安全性說明

- **每一則告警都先驗證才儲存**:對 `<時間戳>.<內容>` 做 HMAC-SHA256,以固定時間比對,而且時間戳必須在 5 分鐘內。
- **簽章 secret 在資料庫裡是加密的**(AES-256-GCM),金鑰是只有兩個 Worker 持有的 `SECRETS_KEY`。只拿到資料庫的副本,拿不到 secret。如果 `SECRETS_KEY` 遺失,請設定一組新的(`make secrets FORCE=1`),再用「use one I already have」重新建立金鑰。
- **密碼**以 PBKDF2-HMAC-SHA256 儲存,迭代 100,000 次(Workers 執行環境允許的上限),長度至少 10。登入限制為每個位址每分鐘 10 次。
- **Session** 是放在 `HttpOnly`、`Secure`、`SameSite=Strict` cookie 裡的隨機 token;資料庫只存它的 SHA-256。
- **API 自己檢查每一個請求**(`server/middleware/guard.ts`):所有請求都要有 session,`/api/admin` 要是 admin,而會變更資料的請求必須來自這個網站自己的頁面。
- **來自 access log 的文字一律當作文字顯示。** 絕不會用它組出任何標記;控制字元與反轉文字方向的符號會顯示成跳脫形式;頁面帶有 Content-Security-Policy,只允許執行這個網站自己的 script。
- **建議在 Cloudflare 後台加上**:在介面的網域前面放 Cloudflare Access,並在接收端的網域上設一條速率限制規則。

## 值得知道的 Cloudflare 限制

實際數字請以 Cloudflare 官方頁面為準;這裡說明的是設計上倚賴哪些限制。

- **寫入列數。** 依 D1 的算法,一則告警大約是 7 列(本身、索引,以及兩張彙總表),之後刪除它又是差不多的量。所以免費方案每天的寫入額度,會是告警量大時最先碰到的限制。
- **讀取列數。** 列表與計數都是一次讀一頁。例外是搜尋,它的上限如前面所述。
- **CPU 時間。** 驗證密碼是刻意做得慢的。免費方案每個請求只有 10 ms 的 CPU 時間,登入需要的比這個多。Cloudflare 在免費方案上會不會放行還沒測過;如果登入失敗並出現錯誤 1102,原因就是這個,解法是付費方案。
- 兩個 Worker 共用一個資料庫,所以也共用它的額度。

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
| `scripts/` | `create-admin.ts` 與 `send-test-alert.ts` |
| `test/` | 單元測試。`d1.ts` 用記憶體內的 SQLite 加上真的資料表結構來代替 D1 |
| `wrangler.jsonc` | 介面的 Worker。`nuxt build` 會把它合併到 `.output/server/wrangler.json` |

給修改這個專案的人:

- **要與 httpdog 保持一致。** 請求內容、標頭與簽章是 httpdog 的對外介面(`docs/webhook.md`、`src/notify.rs`)。`test/shared.test.ts` 用 httpdog 自己測試用的同一組向量檢查簽章。
- **wrangler 與產生出來的設定檔。** build 之後,不帶 `-c` 執行的 wrangler 會使用 Nitro 產生的設定檔。這對部署介面是對的,對其他事情都是錯的,所以 `Makefile` 一律帶 `-c`。
- **請求自己的網址。** 在 Workers 上,h3 的 `getRequestURL()` 會把 HTTPS 請求說成 `http://`。需要真正來源的程式,請用 `server/utils/http.ts` 的 `requestOrigin()`。
- **字型。** Ubuntu Mono,只載入 Latin 子集,由這個網站自己提供。中文會退回系統字型。
- **深色與淺色。** 所有顏色都來自 `main.css` 最上面的變數;`<html data-theme="light">` 會換成第二組數值。新增顏色時要做成變數,並為兩種主題各給一個值,不要在元件裡直接寫色碼。主題以瀏覽器裡選過的為準(頁首、登入頁或帳號頁都能切換),沒選過就跟隨系統;`nuxt.config.ts` 裡有一小段 inline script 會在畫面繪製前先設定好。
- **語言。** 介面預設是英文,切換到中文後會記在瀏覽器裡。
- **兩份 README。** `README.md` 是英文版,這份是同樣內容的繁體中文版。改其中一份就要改另一份。

## 驗證過的範圍

- `make check`:型別檢查,以及 35 個單元測試,涵蓋簽章(httpdog 自己的測試向量)、加密、密碼、樣式比對,以及用真的資料表結構測接收端:接受、重複送達、每一種拒絕原因,還有每日清理。
- 在一台機器上(macOS、wrangler 4.163.0),兩個 Worker 都跑在 wrangler 的本機執行環境裡:真的 `httpdog` 執行檔重播 `sample.log`,3 則已簽章的告警都送達;改用錯的 secret 時,9 次嘗試全部被拒絕並留下紀錄。
- 用 headless Chrome 對 build 後的介面測試,HTTP 與 HTTPS 都跑過:登入、新告警即時出現、篩選、金鑰的建立、編輯、停用與刪除(每一步之後都檢查接收端的回應)、viewer 被擋在管理頁面與管理 API 之外、變更密碼,以及兩種語言、兩種主題在桌機與手機寬度下的頁面。
- **沒有驗證:Cloudflare 上的任何東西。** 還沒有部署過,所以真正的 D1、速率限制、每日排程,以及免費方案的 CPU 上限都沒有測過。
