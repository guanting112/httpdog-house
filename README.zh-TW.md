# httpdog-house

[English](README.md) | 繁體中文

你的 [httpdog](https://github.com/guanting112/httpdog) 回報的地方:每一台主機送來的每一則告警,都在這裡驗證、存起來、可以搜尋,而且要登入才看得到。它跑在你自己的 Cloudflare 帳號上,一個指令就能部署好。

```
httpdog (web-01) ──┐
httpdog (web-02) ──┼── POST /alerts ──▶  ingest Worker ──▶  D1  ◀── UI Worker ◀── 你的瀏覽器
httpdog (db-01)  ──┘   已簽章             驗證、儲存               頁面與 /api,需要登入
```

## 為什麼用它

- **不用顧機器。** 兩個 Cloudflare Worker 加一個 D1 資料庫。沒有主機要租、要更新、要備份。
- **一個指令部署。** `make setup` 會帶你登入、建立資料庫、上傳兩個 Worker,並建立你的帳號。
- **資料是你的。** 整套都在你的 Cloudflare 帳號裡。告警的內容來自你的 access log,不會送到別的地方。
- **每一則告警都經過驗證。** 每則告警都帶 HMAC 簽章,驗證不過就拒絕。**rejected** 頁面會說明原因,所以 secret 填錯或時鐘不準,從介面上就看得出來。
- **告警不容易漏接。** 接收端是獨立的小 Worker,和介面分開。介面更新出問題,也不會讓告警進不來。
- **什麼都找不到。** 沒去過 `make setup` 給你的那個網址的瀏覽器,不管打的是主機名稱還是其他任何網址,得到的都是「not found」。掃描器碰巧知道主機名稱,也看不到登入頁、標題或任何檔案。
- **為了閱讀而做。** 新告警送到就出現,可以篩選,也可以搜尋整個請求內容。有深色與淺色、English 與繁體中文,桌機和手機都能用。

## 部署

需要:

- 一個 [Cloudflare](https://dash.cloudflare.com/sign-up) 帳號,而且你的網域已經加在裡面,
- 這個網域底下兩個還沒有在用的主機名稱:一個用來登入,一個給 httpdog 送告警,
- [Bun](https://bun.sh),以及 `make`(macOS 與 Linux 內建;Windows 請用 WSL)。

```bash
git clone https://github.com/guanting112/httpdog-house.git
cd httpdog-house
cp deploy.local.env.example deploy.local.env
```

把兩個主機名稱填進 `deploy.local.env`:

```
UI_DOMAIN=alerts.example.com
INGEST_DOMAIN=hook.example.com
```

然後:

```bash
make setup
```

**沒有填這兩個主機名稱,`make setup` 什麼都不會建立**:它會停下來,告訴你缺了什麼。部署一律使用你自己的主機名稱,不會用 `workers.dev`。DNS 紀錄和憑證都不用自己加:上傳 Worker 時 Cloudflare 會建立。

`make setup` 就是第一次部署的全部:

1. 還沒登入的話先登入 Cloudflare(會開啟瀏覽器),顯示接下來要用的是哪個帳號,你回答 yes 才會繼續,
2. 建立資料庫與資料表,
3. 上傳接收端與介面,各自掛在自己的主機名稱上,
4. 給兩者同一把用來加密 secret 的金鑰,這把金鑰不會存在其他地方,
5. 問你使用者名稱與密碼,並把這個帳號設為第一個管理員。

最後它會印出兩個網址:登入用的 `https://<UI_DOMAIN>/<入口路徑>`,以及給 httpdog 的 `https://<INGEST_DOMAIN>/alerts`。**第一個請留好:只有這個網址能讓瀏覽器進來。** 只打主機名稱會得到「not found」;瀏覽器去過登入網址一次之後就會被記住。`make entry` 可以再顯示一次這個網址。新的主機名稱可能要一兩分鐘才會有回應。如果某一步失敗,照它說的處理後再執行一次 `make setup`,它會從停下來的地方接著做。

之後用 `git pull && make deploy` 更新你的部署。

建議使用付費的 Workers 方案:在免費方案上,登入需要的 CPU 時間可能超過單一請求的上限,這一點還沒有實測。主機名稱怎麼選、同一個帳號放多套部署、設定與限制,請看 [docs/deploying.zh-TW.md](docs/deploying.zh-TW.md)。

## 接上一台 httpdog

登入後打開 **keys** 頁面,建立一把登記了你的 instance 名稱的金鑰。它的「set up a host」會顯示下面這些內容,並填好你的實際數值。

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

## 日常使用

- **金鑰。** 一把金鑰是一組 secret,加上可以使用它的 instance 名稱;`web-*` 涵蓋 `web-01` 與 `web-02`。要更換 secret 又不漏接告警,就新增第二把金鑰,把主機逐一換過去,再刪掉舊的。
- **被拒絕的請求。** 接收端拒絕的請求都列在 **rejected** 頁面,並附上原因。
- **使用者。** admin 管理金鑰與使用者,viewer 只能看。帳號在 **users** 頁面建立。
- **登入網址。** 用 `make entry` 查看。新的瀏覽器或新的使用者,要先打開它一次,之後主機名稱才會回應。要更換的話,在 `deploy.local.env` 設定另一個 `ENTRY_PATH` 再執行 `make deploy-ui`:之後每個瀏覽器都要重新走一次新的網址。
- **進不去。** `make admin NAME=you` 可以替帳號設定新密碼。
- **告警保留多久。** 365 天。要更改的話,在 `deploy.local.env` 設定 `RETENTION_DAYS` 再執行 `make deploy-ingest`;`0` 代表永久保留。
- **Log。** `make tail-ingest` 與 `make tail-ui` 可以即時看兩個 Worker 的 log。

## 更多說明

| 文件 | 內容 |
|---|---|
| [docs/deploying.zh-TW.md](docs/deploying.zh-TW.md) | `make setup` 做了什麼、自訂網域、多套部署、設定、Cloudflare 的限制 |
| [docs/how-it-works.zh-TW.md](docs/how-it-works.zh-TW.md) | 為什麼分成兩個 Worker、簽章金鑰的細節、接收端的回應、儲存的內容、安全性 |
| [docs/development.zh-TW.md](docs/development.zh-TW.md) | 在本機執行、檔案位置、驗證過的範圍 |

## 安全性與授權

發現漏洞的話,請依照 [SECURITY.md](SECURITY.md) 的說明私下回報,不要開公開的 issue。

以 [MIT License](LICENSE) 釋出。
