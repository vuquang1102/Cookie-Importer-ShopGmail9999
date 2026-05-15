# ShopGmail9999 Cookie Importer

Chrome Extension import cookie Gmail 1 phát ăn liền, tự xử lý mọi edge case khiến Chrome sign-out.

## Pre-fill API key thủ công (lần đầu cài extension)

Sau khi load unpacked, bạn không cần mở popup gõ key — chỉ cần sửa file `config.json` trong folder extension:

```json
{
  "apikey": "PASTE_API_KEY_TẠI_ĐÂY",
  "autoImport": true,
  "defaultClearBefore": true,
  "defaultClearStorage": true,
  "defaultOpenAfter": true
}
```

Sau đó vào `chrome://extensions` → click **Reload** trên card extension. Lần đầu mở popup sẽ tự nạp key vào `chrome.storage.local`. Lần sau key đã trong storage → sửa `config.json` không còn tác dụng (trừ khi clear storage qua `chrome://settings/cookies` → search extension → remove).

→ Hữu ích khi distribute extension cho nhiều máy: chỉ cần edit `config.json` 1 lần, đóng gói, gửi.

## Automation từ ngoài (Selenium / web)

Extension expose API qua **`chrome.runtime.onMessageExternal`** cho các trang web matching:
- `*://shopgmail9999.com/*` (và subdomain)
- `http://localhost/*`
- `http://127.0.0.1/*`

### Lấy Extension ID
Vào `chrome://extensions` → tìm extension → copy **ID** (chuỗi 32 ký tự).

### Action hỗ trợ

| Action | Params | Response |
|---|---|---|
| `getState` | — | `{ success, hasApikey, autoImport, version }` |
| `setApiKey` | `apikey` | `{ success }` |
| `fetchProducts` | `apikey` (optional, fallback storage) | `{ success, listproduct: [{id,name,price,quantity}] }` |
| `buyProduct` | `productId`, `quantity`, `autoImport?`, `autoRetry?`, `retryDelaySeconds?`, `maxRetries?`, `importOptions?` | `{ success, message, data, attempts, imported?, firstAccount? }` |
| `import` | `cookies: []`, `options: { clearBefore, clearStorage, openAfter }` | `{ imported, skipped, log: [] }` |
| `deleteAll` | — | `{ total, removed, failed }` |

### Ví dụ JavaScript trên trang web

```html
<!-- Page phải nằm trong externally_connectable.matches -->
<script>
  const EXT_ID = "abcdefghijklmnopabcdefghijklmnop"; // ID extension của bạn

  // 1. Set API key
  chrome.runtime.sendMessage(EXT_ID, {
    action: "setApiKey",
    apikey: "your-api-key"
  }, (resp) => console.log("setApiKey:", resp));

  // 2. Mua + auto import cookie + mở accounts.google.com
  chrome.runtime.sendMessage(EXT_ID, {
    action: "buyProduct",
    productId: 4,
    quantity: 1,
    autoImport: true,
    // Optional: retry tới khi thành công (vd lúc hết stock đang chờ refill)
    autoRetry: true,
    retryDelaySeconds: 5,
    maxRetries: 0       // 0 = unlimited
  }, (resp) => {
    console.log("Attempts:", resp.attempts);
    console.log("Bought:", resp.firstAccount);   // {email, password}
    console.log("Imported:", resp.imported);     // {imported, skipped}
  });
</script>
```

### Ví dụ Selenium (Python)

```python
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

opts = Options()
opts.add_argument("--load-extension=/path/to/cookie-importer")
driver = webdriver.Chrome(options=opts)

EXT_ID = "abcdefghijklmnopabcdefghijklmnop"

# Navigate to a page matching externally_connectable
driver.get("https://shopgmail9999.com/")

# Set API key
result = driver.execute_async_script("""
  const cb = arguments[arguments.length - 1];
  chrome.runtime.sendMessage(arguments[0],
    { action: "setApiKey", apikey: arguments[1] },
    resp => cb(resp));
""", EXT_ID, "your-api-key")
print("setApiKey:", result)

# Buy + auto-import
result = driver.execute_async_script("""
  const cb = arguments[arguments.length - 1];
  chrome.runtime.sendMessage(arguments[0], {
    action: "buyProduct",
    productId: 4,
    quantity: 1,
    autoImport: true
  }, resp => cb(resp));
""", EXT_ID)
print("Account:", result["firstAccount"])  # {email, password}

# Sau đó driver chuyển sang accounts.google.com → đã login
```

### Ví dụ Selenium (C#)

```csharp
var options = new ChromeOptions();
options.AddArgument($"--load-extension={extensionPath}");
using var driver = new ChromeDriver(options);

const string EXT_ID = "abcdefghijklmnopabcdefghijklmnop";
driver.Navigate().GoToUrl("https://shopgmail9999.com/");

var js = (IJavaScriptExecutor)driver;
var result = js.ExecuteAsyncScript(@"
    const cb = arguments[arguments.length - 1];
    chrome.runtime.sendMessage(arguments[0], {
        action: 'buyProduct',
        productId: 4,
        quantity: 1,
        autoImport: true
    }, resp => cb(resp));
", EXT_ID);

Console.WriteLine(result); // dictionary với firstAccount/imported
```

### Lưu ý

- **Extension ID khác nhau giữa các máy** khi load unpacked. Để cố định ID, thêm field `"key"` trong manifest.json (chuỗi public key base64). Xem [Chrome docs](https://developer.chrome.com/docs/extensions/reference/manifest/key).
- Page phải đã được Chrome load + extension đã active. Nếu chrome.runtime undefined → page không matching `externally_connectable`.
- Response của `buyProduct` với `autoImport: true` có thêm field `imported` (cookie import stats) + `firstAccount` (email/pass đã mua).

## Changelog

**v1.3.0**
- Khi mở popup, nếu API key đã có sẵn (storage hoặc config.json) → tự động tải danh sách sản phẩm, không phải click thủ công.
- Thêm tab **📚 Hướng dẫn** với đầy đủ:
  - Quy trình mua / setup DBSC.
  - Cách pre-fill API key qua `config.json`.
  - Bảng 6 action API.
  - Code mẫu JS (console), Selenium Python, Selenium C#.
  - Tự hiển thị Extension ID + nút copy + tự thay thế `EXT_ID` trong code mẫu.
  - Troubleshooting.

**v1.2.1**
- Thêm option **Auto retry đến khi mua thành công** với delay configurable (mặc định 3s).
  - UI: checkbox + ô nhập delay (1-600s). Nút Mua đổi thành **⏹ Stop retry** để hủy giữa chừng.
  - Status hiển thị lần thứ mấy + lỗi mỗi lần fail. Log lưu lịch sử retry.
- Automation API `buyProduct` nhận thêm params: `autoRetry`, `retryDelaySeconds`, `maxRetries`. Response có thêm field `attempts`.

**v1.2.0**
- Bỏ hint API key trong placeholder (tránh leak key thật).
- Input API key đổi sang `type="password"` + nút 👁 toggle hiện/ẩn.
- Thêm option **Auto-import sau khi mua** (default ON) — chạy thẳng không hỏi gì.
- Bỏ confirm dialog trước khi mua (theo yêu cầu user).
- File `config.json` bundled trong extension — user paste API key thủ công cho lần đầu cài.
- **`externally_connectable`** — Selenium / web page tại shopgmail9999.com hoặc localhost gọi vào extension qua `chrome.runtime.sendMessage(EXT_ID, ...)`. Hỗ trợ actions: `setApiKey`, `getState`, `fetchProducts`, `buyProduct` (kèm `autoImport`), `import`, `deleteAll`.

**v1.1.0**
- **Mua Gmail trực tiếp trong extension** qua API shopgmail9999.com.
  - Tab "💰 Mua mới": nhập API key (lưu local), chọn sản phẩm từ dropdown, xem giá + stock, mua → tự import cookie.
  - Hỗ trợ mua nhiều account 1 lúc; import cookie account đầu tiên, các account còn lại copy được.
- Endpoint dùng:
  - `GET /api/BuyGmail/GetListGmailProduct?apikey=...` — list sản phẩm
  - `GET /api/BuyGmail/BuyProduct?apikey=...&product_id=N&quantity=N` — mua
- API key lưu trong `chrome.storage.local` — không gửi đi đâu khác ngoài shopgmail9999.com.

**v1.0.2**
- Thêm nút **🗑️ Xóa TẤT CẢ cookies** trong trình duyệt (nuclear option khi bị xung đột nặng).
- Thêm delay 300ms giữa clear và set để Chrome flush state, tránh race.
- Cảnh báo rõ hơn trong UI: hướng dẫn tắt DBSC + tắt Chrome Sync nếu vẫn bị sign-out.

**v1.0.1**
- Fix `No host permissions` cho cookie thuộc Google ccTLDs (`.google.com.vn`, `.google.co.uk`, ...). Trước đây bị skip → thiếu session cookie → Google không login.
- Mở rộng clearStorage / clearCookies sang mọi Google ccTLD phát hiện trong cookie import.

**v1.0.0** — initial release.

## Tính năng

- **Clear cookie Google cũ** trước khi import (tránh xung đột account)
- **Clear localStorage / IndexedDB / Service Worker** của Google origins
- **Auto-fix spec** cho từng cookie:
  - `__Host-*`: bắt buộc `secure=true`, `path="/"`, `hostOnly=true` (không gửi `domain`)
  - `__Secure-*`: bắt buộc `secure=true`
  - `SameSite=None`: bắt buộc `secure=true`
- **Import qua `chrome.cookies.set`** API (ghi thẳng cookie store, bỏ qua extension layer)
- **Hỗ trợ partitioned cookies (CHIPS)** cho Chrome 116+
- **Auto navigate** tới `accounts.google.com` sau khi xong
- **Parser linh hoạt** — chấp nhận mảng JSON root hoặc object có field `cookies`/`Cookies`

## Cài đặt

1. Mở Chrome → `chrome://extensions`
2. Bật **Developer mode** (góc phải trên)
3. Click **Load unpacked** → chọn folder `cookie-importer` này
4. Pin extension vào toolbar cho dễ click

## ⚠️ Setup 1 lần (BẮT BUỘC)

Để cookie sống lâu, phải tắt **DBSC (Device Bound Session Credentials)**:

1. Mở `chrome://flags`
2. Search "**Bound Session Credentials**"
3. Set **Disabled**
4. Click **Relaunch**

Nếu không tắt, Google sẽ tự sign-out sau vài phút do session bị bind vào device gốc.

## Sử dụng

1. Click icon extension
2. Paste cookie JSON (format Cookie-Editor) vào textarea
3. (Optional) Toggle các option:
   - ☑️ Xóa cookie Google cũ trước khi import (mặc định BẬT)
   - ☑️ Clear localStorage / IndexedDB / Service Worker (mặc định BẬT)
   - ☑️ Mở accounts.google.com sau khi xong (mặc định BẬT)
4. Click **Import & Login**
5. Tab mới sẽ tự mở `accounts.google.com` với account đã login

## Format cookie hỗ trợ

```json
[
  {
    "name": "SID",
    "value": "...",
    "domain": ".google.com",
    "path": "/",
    "expirationDate": 1798567890.123,
    "hostOnly": false,
    "httpOnly": true,
    "secure": true,
    "sameSite": "no_restriction",
    "session": false
  },
  ...
]
```

Cũng chấp nhận wrapper:
```json
{ "cookies": [ ... ] }
```
hoặc PascalCase:
```json
{ "Cookies": [ ... ] }
```

## Permissions (manifest)

- `cookies` — đọc/ghi cookies
- `tabs` — mở tab mới
- `browsingData` — clear storage
- `storage` — lưu config (chưa dùng, để sau)
- host_permissions: `*.google.com`, `*.googleapis.com`, `*.googleusercontent.com`, `*.youtube.com`, `*.gstatic.com`

## Privacy

Extension **không gửi data ra ngoài**. Toàn bộ logic chạy local trong service worker. Mã nguồn ngắn, có thể audit ngay trong `background.js`.

## Build / Đóng gói cho khách hàng

Không cần build — Extension là pure HTML/CSS/JS. Để publish:
- **Dev**: load unpacked như hướng dẫn trên
- **Distribution riêng**: zip cả folder → khách hàng load unpacked
- **Chrome Web Store**: upload zip, có thể bị review do quyền `cookies` rộng

## Troubleshooting

**Import 0 cookie, tất cả skip:**
- JSON sai format → check log popup
- Hoặc protocol mismatch (cookie có `secure=true` nhưng URL build ra `http://`) → đã fix trong code

**Google vẫn sign-out sau import:**
- Chưa tắt DBSC flag → xem mục Setup ở trên
- Có account Google khác đang sync trong Chrome → vào `chrome://settings/people` sign-out hết

**Lỗi "permission denied" hoặc "Cannot find a name 'chrome'":**
- Extension chưa load đúng → vào `chrome://extensions`, click reload icon trên card extension

**Cookie có `partitionKey` không work:**
- Chrome < 116 không hỗ trợ partitioned cookies API → cookie đó sẽ skip
- Update Chrome lên bản mới nhất
