// background.js — Service worker. Xử lý toàn bộ logic clear/fix/import cookie.

// Các domain "phụ" cố định (không phải google.*)
const GOOGLE_SUFFIXES = [
  'googleapis.com',
  'googleusercontent.com',
  'youtube.com',
  'gstatic.com',
  'youtube-nocookie.com',
  'gmail.com'
];

// Regex bắt mọi google ccTLD: google.com, google.com.vn, google.co.uk, accounts.google.de, ...
// Khớp khi domain == "google.<tld>" hoặc kết thúc bằng ".google.<tld>" (TLD có thể có 2 cấp như .com.vn).
const GOOGLE_REGEX = /(^|\.)google\.[a-z]{2,}(\.[a-z]{2,})?$/i;

// Origin để clear browsingData (localStorage/IndexedDB/SW)
const GOOGLE_ORIGINS = [
  'https://accounts.google.com',
  'https://myaccount.google.com',
  'https://mail.google.com',
  'https://drive.google.com',
  'https://docs.google.com',
  'https://www.google.com',
  'https://photos.google.com',
  'https://contacts.google.com'
];

// API endpoints shopgmail9999
const API_LIST = 'https://shopgmail9999.com/api/BuyGmail/GetListGmailProduct';
const API_BUY  = 'https://shopgmail9999.com/api/BuyGmail/BuyProduct';

// ============== INTERNAL MESSAGES (từ popup.html) ==============
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  dispatchAction(msg, sendResponse);
  return true; // luôn async
});

// ============== EXTERNAL MESSAGES (từ web page / Selenium) ==============
// Cho phép web page khớp externally_connectable.matches (shopgmail9999.com, localhost)
// gửi message vào extension qua: chrome.runtime.sendMessage(EXTENSION_ID, {...}, callback)
if (chrome.runtime.onMessageExternal) {
  chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
    // Log origin để debug
    console.log('[External]', sender.origin, msg?.action);
    dispatchAction(msg, sendResponse);
    return true;
  });
}

async function dispatchAction(msg, sendResponse) {
  try {
    if (!msg || !msg.action) {
      return sendResponse({ success: false, message: 'Thiếu field action' });
    }

    switch (msg.action) {
      // Cookie operations
      case 'import': {
        const r = await handleImport(msg);
        return sendResponse(r);
      }
      case 'deleteAll': {
        const r = await deleteAllCookies();
        return sendResponse(r);
      }

      // Shop API
      case 'fetchProducts': {
        const apikey = msg.apikey || (await chrome.storage.local.get('apikey')).apikey;
        const r = await fetchProducts(apikey);
        return sendResponse(r);
      }
      case 'buyProduct': {
        const apikey = msg.apikey || (await chrome.storage.local.get('apikey')).apikey;
        const productId = msg.productId;
        const quantity  = msg.quantity || 1;
        const autoRetry = msg.autoRetry === true;
        const retryDelaySeconds = Math.max(1, msg.retryDelaySeconds || 3);
        const maxRetries = msg.maxRetries > 0 ? msg.maxRetries : 0; // 0 = unlimited

        let r;
        let attempts = 0;
        while (true) {
          attempts++;
          try {
            r = await buyProduct(apikey, productId, quantity);
          } catch (e) {
            r = { success: false, message: e.message };
          }
          if (r && r.success) break;
          if (!autoRetry) break;
          if (maxRetries > 0 && attempts >= maxRetries) break;
          await sleep(retryDelaySeconds * 1000);
        }

        if (r) r.attempts = attempts;

        // Auto-import nếu được yêu cầu
        if (msg.autoImport && r && r.success && r.data && Array.isArray(r.data.accounts)) {
          const first = parseFirstAccount(r.data.accounts);
          if (first?.cookies) {
            const importResult = await handleImport({
              cookies: first.cookies,
              options: msg.importOptions || {
                clearBefore: true, clearStorage: true, openAfter: true
              }
            });
            r.imported = importResult;
            r.firstAccount = { email: first.email, password: first.password };
          }
        }
        return sendResponse(r);
      }

      // Storage / settings
      case 'setApiKey': {
        if (!msg.apikey) return sendResponse({ success: false, message: 'Thiếu apikey' });
        await chrome.storage.local.set({ apikey: msg.apikey });
        return sendResponse({ success: true });
      }
      case 'getState': {
        const stored = await chrome.storage.local.get(['apikey', 'autoImport']);
        return sendResponse({
          success: true,
          hasApikey: !!stored.apikey,
          autoImport: stored.autoImport !== false,
          version: chrome.runtime.getManifest().version
        });
      }

      default:
        return sendResponse({ success: false, message: 'Unknown action: ' + msg.action });
    }
  } catch (err) {
    return sendResponse({ success: false, message: err.message || String(err) });
  }
}

// Parse 1 account string "email|pass|cookieJson" → { email, password, cookies[] }
function parseFirstAccount(accounts) {
  if (!Array.isArray(accounts) || accounts.length === 0) return null;
  const s = accounts[0];
  const i1 = s.indexOf('|');
  const i2 = s.indexOf('|', i1 + 1);
  if (i1 < 0 || i2 < 0) return null;
  const email    = s.substring(0, i1);
  const password = s.substring(i1 + 1, i2);
  const rawJson  = s.substring(i2 + 1);
  try {
    const cookies = JSON.parse(rawJson);
    return { email, password, cookies: Array.isArray(cookies) ? cookies : [] };
  } catch (_) {
    return { email, password, cookies: [] };
  }
}

// ============== SHOP API ==============

async function fetchProducts(apikey) {
  if (!apikey) throw new Error('Thiếu API key');
  const url = `${API_LIST}?apikey=${encodeURIComponent(apikey)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  return data; // { success, listproduct: [...] }
}

async function buyProduct(apikey, productId, quantity) {
  if (!apikey)    throw new Error('Thiếu API key');
  if (!productId) throw new Error('Thiếu product_id');
  if (!quantity || quantity < 1) quantity = 1;

  const url = `${API_BUY}?apikey=${encodeURIComponent(apikey)}`
            + `&product_id=${encodeURIComponent(productId)}`
            + `&quantity=${encodeURIComponent(quantity)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  return data; // { success, message, data: { trans_id, quantity, total, accounts: [...] } }
}

// ============== DELETE ALL COOKIES (nuclear option) ==============

async function deleteAllCookies() {
  const all = await chrome.cookies.getAll({});
  let removed = 0;
  let failed = 0;

  for (const c of all) {
    const cleanDomain = c.domain.replace(/^\./, '');
    const proto = c.secure ? 'https' : 'http';
    const url = `${proto}://${cleanDomain}${c.path || '/'}`;
    try {
      await chrome.cookies.remove({
        url,
        name: c.name,
        storeId: c.storeId
      });
      removed++;
    } catch (_) {
      failed++;
    }
  }

  return { total: all.length, removed, failed };
}

async function handleImport({ cookies, options }) {
  const log = [];
  let imported = 0;
  let skipped  = 0;

  if (options.clearBefore) {
    const removed = await clearGoogleCookies();
    log.push(`[Clear] Đã xóa ${removed} cookies Google cũ`);
  }

  if (options.clearStorage) {
    // Origins mở rộng: canonical + ccTLDs lấy từ chính cookie đang import (vd google.com.vn)
    const origins = deriveOriginsFromCookies(cookies);
    const ok = await clearGoogleStorage(origins);
    log.push(ok
      ? `[Clear] Đã clear storage cho ${origins.length} origins Google`
      : '[Clear] Không clear được storage (kiểm tra quyền browsingData)');
  }

  // Đợi Chrome flush cookie store/state trước khi ghi cookie mới.
  // Tránh race: Chrome đang xóa cookie cũ thì cookie mới được set → bị wipe theo.
  if (options.clearBefore || options.clearStorage) {
    await sleep(300);
  }

  for (const raw of cookies) {
    try {
      const fixed = fixCookie(raw);
      if (!fixed) {
        skipped++;
        log.push(`[Skip] ${raw.name || '?'}@${raw.domain || '?'} — thiếu name/domain`);
        continue;
      }
      await chrome.cookies.set(fixed);
      imported++;
    } catch (e) {
      skipped++;
      log.push(`[Fail] ${raw.name}@${raw.domain}: ${e.message}`);
    }
  }

  log.push(`[Done] ${imported} imported, ${skipped} skipped`);

  if (options.openAfter) {
    try {
      await chrome.tabs.create({ url: 'https://accounts.google.com' });
    } catch (_) { /* ignore */ }
  }

  return { imported, skipped, log };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============== CLEAR ==============

async function clearGoogleCookies() {
  let removed = 0;
  try {
    const all = await chrome.cookies.getAll({});
    for (const c of all) {
      if (!isGoogleDomain(c.domain)) continue;
      const cleanDomain = c.domain.replace(/^\./, '');
      const proto = c.secure ? 'https' : 'http';
      const url = `${proto}://${cleanDomain}${c.path || '/'}`;
      try {
        await chrome.cookies.remove({
          url,
          name: c.name,
          storeId: c.storeId
        });
        removed++;
      } catch (_) {
        // Có thể fail nếu cookie partitioned hoặc protocol mismatch — skip im lặng.
      }
    }
  } catch (e) {
    console.warn('[clearGoogleCookies]', e);
  }
  return removed;
}

async function clearGoogleStorage(origins) {
  try {
    await chrome.browsingData.remove(
      { origins: origins && origins.length > 0 ? origins : GOOGLE_ORIGINS },
      {
        cacheStorage: true,
        indexedDB: true,
        localStorage: true,
        serviceWorkers: true
        // KHÔNG xóa cookies ở đây vì đã xử lý riêng ở clearGoogleCookies
      }
    );
    return true;
  } catch (e) {
    console.warn('[clearGoogleStorage]', e);
    return false;
  }
}

// Thu thập tất cả Google origins liên quan từ danh sách cookie sắp import.
// Vd cookie có domain ".google.com.vn" → thêm: https://google.com.vn,
// https://accounts.google.com.vn, https://mail.google.com.vn, ...
function deriveOriginsFromCookies(cookies) {
  const set = new Set(GOOGLE_ORIGINS);
  const subdomains = ['', 'accounts.', 'mail.', 'myaccount.', 'www.', 'drive.', 'docs.', 'photos.'];

  for (const c of cookies) {
    if (!c || !c.domain) continue;
    const d = c.domain.replace(/^\./, '').toLowerCase();

    // Tìm phần "google.<tld>" trong domain (cuối chuỗi)
    const m = d.match(/(^|\.)(google\.[a-z]{2,}(\.[a-z]{2,})?)$/);
    if (!m) continue;
    const root = m[2]; // "google.com" hoặc "google.com.vn" hoặc "google.co.uk"

    for (const sub of subdomains) {
      set.add(`https://${sub}${root}`);
    }
  }
  return Array.from(set);
}

function isGoogleDomain(domain) {
  if (!domain) return false;
  const d = domain.replace(/^\./, '').toLowerCase();
  if (GOOGLE_REGEX.test(d)) return true;
  return GOOGLE_SUFFIXES.some(s => d === s || d.endsWith('.' + s));
}

// ============== FIX & BUILD ==============

function fixCookie(c) {
  if (!c || !c.name || !c.domain) return null;

  const name   = String(c.name);
  const domain = String(c.domain);
  const isHostPrefix   = name.startsWith('__Host-');
  const isSecurePrefix = name.startsWith('__Secure-');

  // Path — __Host- phải = "/"
  let path = c.path && c.path.length > 0 ? c.path : '/';
  if (isHostPrefix) path = '/';

  // SameSite normalize
  let sameSite = (c.sameSite || c.SameSite || 'unspecified').toString().toLowerCase();
  if (sameSite === 'none')           sameSite = 'no_restriction';
  if (sameSite === 'no_restriction') sameSite = 'no_restriction';
  else if (sameSite === 'lax')        sameSite = 'lax';
  else if (sameSite === 'strict')     sameSite = 'strict';
  else                                sameSite = 'unspecified';

  // Secure — bắt buộc nếu __Host-/__Secure- hoặc SameSite=None
  const secure =
       (c.secure === true)
    || isHostPrefix
    || isSecurePrefix
    || sameSite === 'no_restriction';

  // HostOnly: __Host- bắt buộc true. Còn lại theo cookie.hostOnly hoặc suy từ domain.
  const hasLeadingDot = domain.startsWith('.');
  const isHostOnly    = isHostPrefix || c.hostOnly === true || !hasLeadingDot;

  // Build URL cho chrome.cookies.set
  const cleanDomain = hasLeadingDot ? domain.substring(1) : domain;
  const proto = secure ? 'https' : 'http';
  const url = `${proto}://${cleanDomain}${path}`;

  const out = {
    url,
    name,
    value: c.value != null ? String(c.value) : '',
    path,
    secure,
    httpOnly: c.httpOnly === true,
    sameSite
  };

  // chrome.cookies.set: nếu có domain thì cookie là non-hostOnly (Domain attribute).
  // Bỏ qua domain để Chrome tự derive hostOnly từ url.
  if (!isHostOnly) {
    out.domain = domain;
  }

  // expirationDate (Unix epoch, double). Nếu thiếu thì là session cookie.
  if (typeof c.expirationDate === 'number' && c.expirationDate > 0) {
    out.expirationDate = c.expirationDate;
  } else if (typeof c.expires === 'number' && c.expires > 0) {
    out.expirationDate = c.expires;
  }

  // Partitioned cookies (CHIPS) — Chrome 116+. Chỉ truyền nếu hợp lệ.
  if (c.partitionKey) {
    try {
      if (typeof c.partitionKey === 'string' && c.partitionKey.length > 0) {
        out.partitionKey = { topLevelSite: c.partitionKey };
      } else if (typeof c.partitionKey === 'object' && c.partitionKey.topLevelSite) {
        out.partitionKey = c.partitionKey;
      }
    } catch (_) { /* skip */ }
  }

  return out;
}
