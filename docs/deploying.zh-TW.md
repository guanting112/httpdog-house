# 部署 httpdog-house

[English](deploying.md) | 繁體中文 · 回到 [README](../README.zh-TW.md)

它從一開始就是為 Cloudflare 設計的:兩個 Worker 加一個 D1 資料庫,都在你的帳號裡。所有東西都在你的機器上 build,再用 wrangler 上傳;Cloudflare 不負責 build,也不會讀取 Git repository。

## 第一次之前:兩個主機名稱

一套部署只會掛在你自己的兩個主機名稱上,不會出現在別的地方。沒有它們就什麼都不會建立:缺少時 `make setup` 和每一次部署都會停下來,而兩個 Worker 的 `workers.dev` 網址一律關閉。

```bash
cp deploy.local.env.example deploy.local.env
```

```
UI_DOMAIN=alerts.example.com       # 登入用
INGEST_DOMAIN=hook.example.com     # httpdog POST 的地方:https://hook.example.com/<一段路徑>/alerts
```

- **兩個都要是同一個 Cloudflare 帳號裡某個網域底下的名稱**,而且不能相同。
- **兩個都還沒有 DNS 紀錄。** 它們會各自成為所屬 Worker 的 Custom Domain:上傳 Worker 時 Cloudflare 會建立 DNS 紀錄與憑證,不需要手動加任何東西。新的主機名稱可能要一兩分鐘才會有回應。
- **主機名稱不是祕密。** 為它簽發的憑證會像所有憑證一樣登錄在公開的紀錄裡,掃描器也會去拜訪它得知的每一個主機名稱。所以介面不會讓陌生人看到任何東西:見下方的[登入網址](#登入網址)。取一個看不出用途的名稱,透露的就更少。接收端則必須對你的主機開放,所以它只在一個沒有人猜得到的網址上收告警,其他網址一律回「not found」:見[接收端的網址](#接收端的網址)。
- **之後要換主機名稱**,改這兩行再執行 `make deploy` 就可以。主機上的 `HTTPDOG_WEBHOOK_URL` 要跟著換成新的網址,送到舊網址的告警會遺失。

在沒有 `deploy.local.env` 的 checkout 裡執行 `make setup`,它會替你建立這個檔案,說明上面這些事,然後停下來。

## 第一次:`make setup`

| 步驟 | 做了什麼 |
|---|---|
| 開始之前 | 從 `deploy.local.env` 讀兩個主機名稱。缺任何一個就停在這裡:不會問任何問題,也不會建立任何東西 |
| 1. Cloudflare 帳號 | 這台機器還沒登入的話,`wrangler login` 會開啟瀏覽器。接著它會顯示登入的是誰、是哪個帳號、要用哪兩個主機名稱,並詢問你。回答的不是 yes 就會停下來,什麼都不會建立。登入的身分可以使用多個帳號時,必須指定其中一個:`CLOUDFLARE_ACCOUNT_ID=<id> make setup`。回答 yes 之後,如果 `deploy.local.env` 還沒有 `ENTRY_PATH` 與 `INGEST_PATH`,它會各寫入一個新的 |
| 2. 資料庫 | 建立 D1 資料庫 `httpdog-house`,並把它的 id 記在 `deploy.local.env`。帳號裡已經有同名的資料庫時,就直接使用它 |
| 3. 資料表 | 套用 `migrations/`。wrangler 會先問你要不要繼續 |
| 4. 接收端 | 把 ingest Worker 上傳到 `INGEST_DOMAIN`。Cloudflare 會建立這個主機名稱的 DNS 紀錄與憑證 |
| 5. 介面 | build 並把 UI Worker 上傳到 `UI_DOMAIN`,做法相同 |
| 6. 金鑰 | 產生 `SECRETS_KEY` 並設定到兩個 Worker。它用來加密資料庫裡的簽章 secret,不會存在其他地方,也沒有人需要知道它的內容 |
| 7. 第一個管理員 | 問使用者名稱,再問兩次密碼。已經有管理員時會略過 |

重複執行是安全的。每一步都會先看現況,只做還缺的部分,所以失敗之後會從停下來的地方接著做;對已經完成的部署,它只會重新上傳兩個 Worker。

## 登入網址

`make setup` 最後會印出它,`make entry` 可以再顯示一次:

```
https://<UI_DOMAIN>/<ENTRY_PATH>
```

對沒見過的瀏覽器,介面只有這一個網址會有回應。其他的一切,包括只打主機名稱、`/login`、API 和每一個檔案,都只會回同樣的 `not found`:沒有登入頁可以被碰巧找到,沒有標題、沒有圖示,沒有任何東西說明這裡跑的是什麼。

- **打開這個網址一次就夠了。** 它會留下一個 cookie,並把瀏覽器帶到登入頁。之後這個瀏覽器直接用主機名稱就可以,效期 400 天,再打開一次這個網址會重新計算。
- **每個瀏覽器、每個人都要走一次。** 新增使用者時,把這個網址和帳號一起交給對方。
- **`ENTRY_PATH` 放在 `deploy.local.env`。** `make setup` 會產生 30 個隨機字元,除非檔案裡已經有你自己設定的(8 到 64 個字母、數字、連字號或底線)。沒有它,任何部署都不會進行。
- **要更換的話**,設定另一個再執行 `make deploy-ui`。在去過新的網址之前,每個瀏覽器都會再被擋在外面。這不會結束 session;瀏覽器通過之後,登入狀態和原本一樣。
- **它不是密碼。** 它讓陌生人和掃描器看不到這裡有什麼;保護告警的仍然是後面的登入。這個網址會留在瀏覽器的歷史紀錄和傳送它的管道裡,所以請當成只有自己人知道的東西,有人離開時就換掉。
- **在本機上沒有這道門**:`make dev` 與 `make preview` 在任何網址都會回應。

## 接收端的網址

```
https://<INGEST_DOMAIN>/<INGEST_PATH>/alerts
```

這就是要填進主機 `HTTPDOG_WEBHOOK_URL` 的網址,keys 頁面會把它和主機需要的其他設定一起顯示出來。接收端只在這個網址收告警:只打主機名稱、單純的 `/alerts` 和其他任何網址,都只會回 `not found`,而且不在這個網址上的請求不會被讀取、檢查或記錄。

- **陌生人送不了任何東西給它。** 不知道路徑就沒有請求可以拒絕,所以陌生人做的任何事都不會出現在 **rejected** 頁面上,也不會消耗資料庫的寫入。那裡列出來的都來自知道網址的人:secret 填錯、名稱沒有金鑰登記,或時鐘不準的自家主機。
- **讓告警進得來的仍然是簽章。** 路徑只決定誰有機會嘗試。
- **`INGEST_PATH` 放在 `deploy.local.env`。** `make setup` 會產生 30 個隨機字元,除非檔案裡已經有你自己設定的(8 到 64 個字母、數字、連字號或底線)。沒有它,任何部署都不會進行。
- **已經有主機在送之後就不要動它。** 換掉它就等於要改每一台主機的 `HTTPDOG_WEBHOOK_URL`,而這段期間送到舊網址的告警會遺失:httpdog 重試 3 次就放棄。真的要換的話,設定新的、執行 `make deploy`,然後馬上更新主機。
- **在本機上沒有這個路徑**:`make dev` 在 `/alerts` 收告警。

## 之後每一次:`make deploy`

`make deploy` 會跑檢查、更新資料表,並上傳兩個 Worker。`make deploy-ingest` 與 `make deploy-ui` 則各上傳一個。

## 你自己的設定:`deploy.local.env`

每一套部署不一樣的東西,都只放在這裡:

| 值 | 意義 |
|---|---|
| `UI_DOMAIN`、`INGEST_DOMAIN` | **必填,由你自己填。** 兩個主機名稱,見上方 |
| `DATABASE_ID` | D1 資料庫的 id。由 `make setup` 填入 |
| `ENTRY_PATH` | 登入網址的最後一段,見上方。由 `make setup` 填入,除非你自己設定了 |
| `INGEST_PATH` | 接收端網址裡 `/alerts` 前面的那一段,見上方。由 `make setup` 填入,除非你自己設定了 |
| `NAME_SUFFIX` | 只有在同一個帳號放另一套部署時才需要,見下方 |
| `RETENTION_DAYS`、`MAX_SKEW_SECS` | 接收端的設定,見下方 |

Git 會忽略這個檔案。兩個 `wrangler.jsonc` 有進版本控制,裡面一直是範例值;部署指令會把你的值寫進產生出來的設定檔(`wrangler.deploy.json`、`ingest/wrangler.deploy.json` 與 `.output/server/wrangler.json`),這些檔案 Git 也會忽略。如果有人把真的 id、網址或 route 寫進有進版本控制的設定檔,`make check-config` 會擋下部署。所以公開的 fork 不帶任何人的部署資料,你也可以從同一份 checkout 部署與 push。Secret 從來不在會進版本控制的檔案裡:`SECRETS_KEY` 是 Cloudflare secret,在本機則放在 `.dev.vars`。

在主機名稱變成必填之前建立的檔案,裡面可能還有一行 `INGEST_URL`。它已經不會被讀取,部署時會提醒你;這一行可以刪掉。

## 同一個帳號放多套部署

每一套部署有自己的檔案與自己的名稱:

```bash
cp deploy.local.env.example deploy.team-a.env    # 然後在裡面設定 NAME_SUFFIX=team-a 和它自己的兩個主機名稱
make setup  DEPLOY_ENV=deploy.team-a.env
make deploy DEPLOY_ENV=deploy.team-a.env         # 之後更新時使用
```

這樣兩個 Worker 會叫 `httpdog-house-ui-team-a` 與 `httpdog-house-ingest-team-a`,資料庫叫 `httpdog-house-team-a`,登入的 rate limiter 也會有自己的編號。各套部署之間不共用任何東西:主機名稱、`SECRETS_KEY`、帳號、金鑰與告警都是各自一份。每個會連到 Cloudflare 的指令都會先印出它讀的是哪個檔案、要動的是哪兩個 Worker。不指定 `DEPLOY_ENV` 時讀的是 `deploy.local.env`;沒有設定 `NAME_SUFFIX` 時用的是不帶後綴的名稱。後綴要在第一次 `make setup` 之前設好,之後不要改:換後綴等於另一套新的部署。Git 會忽略所有 `deploy.*.env`。

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
