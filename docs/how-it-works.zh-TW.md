# httpdog-house 如何運作

[English](how-it-works.md) | 繁體中文 · 回到 [README](../README.zh-TW.md)

httpdog 監看 access log,符合規則時把告警 POST 到你指定的網址。這個專案就是那個網址,再加上一個要登入才能用的介面:它接收所有 instance 的告警、逐一驗證簽章、存起來,並讓你搜尋與篩選。整套都跑在 Cloudflare 上:兩個 Worker 加一個 D1 資料庫。

```
httpdog (web-01) ──┐
httpdog (web-02) ──┼── POST /alerts ──▶  ingest Worker ──▶  D1  ◀── UI Worker ◀── 你的瀏覽器
httpdog (db-01)  ──┘   已簽章             驗證、儲存               頁面與 /api,需要登入
```

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
- **陌生人什麼都看不到。** 瀏覽器沒有帶登入網址發的 cookie 時,不論要的是頁面、API 還是檔案,介面一律回 `not found`(`shared/door.ts`、`server/middleware/01.door.ts`)。cookie 是入口路徑的 SHA-256,所以不會洩漏路徑本身,而且是 `HttpOnly`。這是為了讓公開的主機名稱通不到任何地方;保護資料的仍然是後面的登入。
- **API 自己檢查每一個請求**(`server/middleware/guard.ts`):所有請求都要有 session,`/api/admin` 要是 admin,而會變更資料的請求必須來自這個網站自己的頁面。
- **來自 access log 的文字一律當作文字顯示。** 絕不會用它組出任何標記;控制字元與反轉文字方向的符號會顯示成跳脫形式;頁面帶有 Content-Security-Policy,只允許執行這個網站自己的 script。
- **建議在 Cloudflare 後台加上**:在介面的網域前面放 Cloudflare Access,並在接收端的網域上設一條速率限制規則。
