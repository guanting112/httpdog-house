# 部署 httpdog-house

[English](deploying.md) | 繁體中文 · 回到 [README](../README.zh-TW.md)

它從一開始就是為 Cloudflare 設計的:兩個 Worker 加一個 D1 資料庫,都在你的帳號裡。所有東西都在你的機器上 build,再用 wrangler 上傳;Cloudflare 不負責 build,也不會讀取 Git repository。

## 第一次:`make setup`

| 步驟 | 做了什麼 |
|---|---|
| 1. Cloudflare 帳號 | 這台機器還沒登入的話,`wrangler login` 會開啟瀏覽器 |
| 2. 資料庫 | 建立 D1 資料庫 `httpdog-house`,並把它的 id 記在 `deploy.local.env`。帳號裡已經有同名的資料庫時,就直接使用它 |
| 3. 資料表 | 套用 `migrations/`。wrangler 會先問你要不要繼續 |
| 4. 接收端 | 上傳 ingest Worker,並把它的網址記在 `deploy.local.env` |
| 5. 介面 | build 並上傳 UI Worker |
| 6. 金鑰 | 產生 `SECRETS_KEY` 並設定到兩個 Worker。它用來加密資料庫裡的簽章 secret,不會存在其他地方,也沒有人需要知道它的內容 |
| 7. 第一個管理員 | 問使用者名稱,再問兩次密碼。已經有管理員時會略過 |

重複執行是安全的。每一步都會先看現況,只做還缺的部分,所以失敗之後會從停下來的地方接著做;對已經完成的部署,它只會重新上傳兩個 Worker。

## 之後每一次:`make deploy`

`make deploy` 會跑檢查、更新資料表,並上傳兩個 Worker。`make deploy-ingest` 與 `make deploy-ui` 則各上傳一個。

## 你自己的設定:`deploy.local.env`

`make setup` 會建立這個檔案並填好內容。每一套部署不一樣的東西,都只放在這裡:

| 值 | 意義 |
|---|---|
| `DATABASE_ID` | D1 資料庫的 id。由 `make setup` 填入 |
| `INGEST_URL` | httpdog 要 POST 的網址,結尾是 `/alerts`。keys 頁面會顯示它。由 `make setup` 填入;設定了 `INGEST_DOMAIN` 時會跟著它 |
| `UI_DOMAIN`、`INGEST_DOMAIN` | 你自己的網域,見下方 |
| `NAME_SUFFIX` | 只有在同一個帳號放另一套部署時才需要,見下方 |
| `RETENTION_DAYS`、`MAX_SKEW_SECS` | 接收端的設定,見下方 |

Git 會忽略這個檔案。兩個 `wrangler.jsonc` 有進版本控制,裡面一直是範例值;部署指令會把你的值寫進產生出來的設定檔(`wrangler.deploy.json`、`ingest/wrangler.deploy.json` 與 `.output/server/wrangler.json`),這些檔案 Git 也會忽略。如果有人把真的 id、網址或 route 寫進有進版本控制的設定檔,`make check-config` 會擋下部署。所以公開的 fork 不帶任何人的部署資料,你也可以從同一份 checkout 部署與 push。Secret 從來不在會進版本控制的檔案裡:`SECRETS_KEY` 是 Cloudflare secret,在本機則放在 `.dev.vars`。

## 自訂網域

沒有設定時,每個 Worker 的網址是 `<Worker 名稱>.<你的帳號>.workers.dev`。要用自己的網域,就寫進 `deploy.local.env` 再部署:

```
UI_DOMAIN=alerts.example.com
INGEST_DOMAIN=hook.example.com
```

```bash
make deploy
```

每個 zone 都必須在同一個 Cloudflare 帳號裡。接收端的網址會跟著 `INGEST_DOMAIN`,所以 `INGEST_URL` 留空就好;已經在送告警的主機,要把 `HTTPDOG_WEBHOOK_URL` 改成新的網址。想從第一次部署就使用自訂網域,請先把 `deploy.local.env.example` 複製成 `deploy.local.env`,填好網域之後再執行 `make setup`。

介面有自己的網域之後,就可以放在 Cloudflare Access 或 IP 規則後面,不影響主機送告警的網址。

## 同一個帳號放多套部署

每一套部署有自己的檔案與自己的名稱:

```bash
cp deploy.local.env.example deploy.team-a.env    # 然後在裡面設定 NAME_SUFFIX=team-a
make setup  DEPLOY_ENV=deploy.team-a.env
make deploy DEPLOY_ENV=deploy.team-a.env         # 之後更新時使用
```

這樣兩個 Worker 會叫 `httpdog-house-ui-team-a` 與 `httpdog-house-ingest-team-a`,資料庫叫 `httpdog-house-team-a`,登入的 rate limiter 也會有自己的編號。各套部署之間不共用任何東西:`SECRETS_KEY`、帳號、金鑰與告警都是各自一份。每個會連到 Cloudflare 的指令都會先印出它讀的是哪個檔案、要動的是哪兩個 Worker。不指定 `DEPLOY_ENV` 時讀的是 `deploy.local.env`;沒有設定 `NAME_SUFFIX` 時用的是不帶後綴的名稱。後綴要在第一次 `make setup` 之前設好,之後不要改:換後綴等於另一套新的部署。Git 會忽略所有 `deploy.*.env`。

## 接收端的設定

這是 `deploy.local.env` 裡另外兩個值。留空就使用預設值。

| 值 | 預設值 | 意義 |
|---|---|---|
| `RETENTION_DAYS` | `365` | 告警保留幾天。超過的每天刪除一次。`0` 代表永久保留 |
| `MAX_SKEW_SECS` | `300` | 請求的時間戳可以與接收端時鐘相差多少秒。超出範圍的請求會被拒絕 |

```
RETENTION_DAYS=30
```

```bash
make deploy-ingest
```

改短之後,下一次每日清理就會生效,把已經太舊的告警刪掉。每一套部署有自己的設定。填的不是整數時部署會停下來,這樣打錯字就不會被當成預設值。

## 一步一步來

`make setup` 會替你執行這些指令;它們也可以單獨使用。`make` 會列出所有指令。

| 指令 | 作用 |
|---|---|
| `make login`、`make whoami` | 登入 Cloudflare;顯示目前登入的是哪個帳號 |
| `make db-create` | 建立資料庫;印出的 id 要由你填進 `deploy.local.env` |
| `make db-migrate` | 建立或更新資料表 |
| `make secrets` | 給兩個 Worker 同一把新的 `SECRETS_KEY`。已經設定過就會拒絕,因為換新的金鑰會讓已儲存的簽章 secret 無法解密 |
| `make admin NAME=you` | 建立管理員,或替帳號設定新密碼 |
| `make dry-run` | 打包兩個 Worker 並檢查兩份設定,但不上傳 |
| `make tail-ingest`、`make tail-ui` | 即時看某個 Worker 的 log |

## 值得知道的 Cloudflare 限制

實際數字請以 Cloudflare 官方頁面為準;這裡說明的是設計上倚賴哪些限制。

- **寫入列數。** 依 D1 的算法,一則告警大約是 7 列(本身、索引,以及兩張彙總表),之後刪除它又是差不多的量。所以免費方案每天的寫入額度,會是告警量大時最先碰到的限制。
- **讀取列數。** 列表與計數都是一次讀一頁。例外是搜尋,它有上限:一次請求最多檢查 50,000 則告警。
- **CPU 時間。** 驗證密碼是刻意做得慢的。免費方案每個請求只有 10 ms 的 CPU 時間,登入需要的比這個多。Cloudflare 在免費方案上會不會放行還沒測過;如果登入失敗並出現錯誤 1102,原因就是這個,解法是付費方案。
- 兩個 Worker 共用一個資料庫,所以也共用它的額度。
