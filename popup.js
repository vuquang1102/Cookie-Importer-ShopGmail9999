// popup.js — Tab UI + handlers. Logic chính ở background.js.

document.addEventListener('DOMContentLoaded', async () => {
  // ============ TABS ============
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
  });

  const statusEl = document.getElementById('status');
  const logEl    = document.getElementById('log');

  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = 'status ' + cls;
  }
  function clearLog() { logEl.textContent = ''; }

  // ============ TAB: MUA MỚI ============
  const apikeyInput     = document.getElementById('apikeyInput');
  const toggleKeyBtn    = document.getElementById('toggleKeyBtn');
  const saveKeyBtn      = document.getElementById('saveKeyBtn');
  const loadProductsBtn = document.getElementById('loadProductsBtn');
  const productsCard    = document.getElementById('productsCard');
  const productSelect   = document.getElementById('productSelect');
  const quantityInput   = document.getElementById('quantityInput');
  const priceInfo       = document.getElementById('priceInfo');
  const autoImportChk   = document.getElementById('autoImportChk');
  const autoRetryChk    = document.getElementById('autoRetryChk');
  const retryDelayInput = document.getElementById('retryDelayInput');
  const buyBtn          = document.getElementById('buyBtn');
  const buyResult       = document.getElementById('buyResult');
  const accountSummary  = document.getElementById('accountSummary');
  const accountsText    = document.getElementById('accountsText');
  const copyAccountsBtn = document.getElementById('copyAccountsBtn');
  const importBoughtBtn = document.getElementById('importBoughtBtn');

  let cachedProducts = [];
  let lastBoughtAccounts = []; // {email, password, cookieJsonRaw}

  // Load API key + defaults: ưu tiên chrome.storage.local, fallback config.json (bundled).
  // config.json là file user có thể edit thủ công trong folder extension → lần đầu mở
  // sẽ tự load vào storage, sau đó storage là nguồn chính thức.
  await loadApikeyAndDefaults();

  // Auto load products nếu đã có apikey (UX: bỏ 1 click "Tải sản phẩm" lần đầu)
  if (apikeyInput.value.trim()) {
    loadProductsBtn.click();
  }

  // Populate Extension ID trong tab Hướng dẫn
  populateExtensionId();

  async function loadApikeyAndDefaults() {
    const stored = await chrome.storage.local.get(['apikey', 'autoImport', 'autoRetry', 'retryDelaySeconds']);

    let apikey            = stored.apikey;
    let autoImport        = stored.autoImport;
    let autoRetry         = stored.autoRetry;
    let retryDelaySeconds = stored.retryDelaySeconds;

    // Nếu storage trống → đọc config.json bundled
    if (apikey === undefined || autoImport === undefined ||
        autoRetry === undefined || retryDelaySeconds === undefined) {
      try {
        const resp = await fetch(chrome.runtime.getURL('config.json'));
        if (resp.ok) {
          const cfg = await resp.json();
          if (!apikey && cfg.apikey) {
            apikey = cfg.apikey;
            await chrome.storage.local.set({ apikey });
          }
          if (autoImport === undefined && typeof cfg.autoImport === 'boolean') {
            autoImport = cfg.autoImport;
            await chrome.storage.local.set({ autoImport });
          }
          if (autoRetry === undefined && typeof cfg.autoRetry === 'boolean') {
            autoRetry = cfg.autoRetry;
            await chrome.storage.local.set({ autoRetry });
          }
          if (retryDelaySeconds === undefined && typeof cfg.retryDelaySeconds === 'number') {
            retryDelaySeconds = cfg.retryDelaySeconds;
            await chrome.storage.local.set({ retryDelaySeconds });
          }
        }
      } catch (_) { /* config.json không tồn tại hoặc parse lỗi */ }
    }

    if (apikey) apikeyInput.value = apikey;
    if (typeof autoImport === 'boolean') autoImportChk.checked = autoImport;
    if (typeof autoRetry === 'boolean') autoRetryChk.checked = autoRetry;
    if (typeof retryDelaySeconds === 'number' && retryDelaySeconds > 0) {
      retryDelayInput.value = retryDelaySeconds;
    }
  }

  toggleKeyBtn.addEventListener('click', () => {
    apikeyInput.type = apikeyInput.type === 'password' ? 'text' : 'password';
  });

  autoImportChk.addEventListener('change', async () => {
    await chrome.storage.local.set({ autoImport: autoImportChk.checked });
  });

  autoRetryChk.addEventListener('change', async () => {
    await chrome.storage.local.set({ autoRetry: autoRetryChk.checked });
  });

  retryDelayInput.addEventListener('change', async () => {
    const v = parseInt(retryDelayInput.value);
    if (v >= 1 && v <= 600) await chrome.storage.local.set({ retryDelaySeconds: v });
  });

  saveKeyBtn.addEventListener('click', async () => {
    const key = apikeyInput.value.trim();
    if (!key) return setStatus('⚠️ API key trống', 'warn');
    await chrome.storage.local.set({ apikey: key });
    setStatus('💾 Đã lưu API key', 'ok');
  });

  loadProductsBtn.addEventListener('click', async () => {
    const apikey = apikeyInput.value.trim();
    if (!apikey) return setStatus('⚠️ Nhập API key trước', 'warn');

    setStatus('⏳ Đang tải sản phẩm...', 'info');
    loadProductsBtn.disabled = true;
    try {
      const result = await chrome.runtime.sendMessage({ action: 'fetchProducts', apikey });
      if (!result || !result.success) throw new Error(result?.message || 'Tải sản phẩm fail');

      cachedProducts = result.listproduct || [];
      productSelect.innerHTML = '';
      cachedProducts.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        const stock = p.quantity > 0 ? `stock: ${p.quantity}` : 'HẾT HÀNG';
        opt.textContent = `${p.name} — ${p.price.toLocaleString('vi')}đ (${stock})`;
        if (p.quantity === 0) opt.disabled = true;
        productSelect.appendChild(opt);
      });

      productsCard.style.display = 'block';
      updatePriceInfo();
      setStatus(`✅ Loaded ${cachedProducts.length} sản phẩm`, 'ok');
    } catch (e) {
      setStatus('❌ ' + e.message, 'err');
    } finally {
      loadProductsBtn.disabled = false;
    }
  });

  function updatePriceInfo() {
    const id  = parseInt(productSelect.value);
    const qty = parseInt(quantityInput.value) || 1;
    const p = cachedProducts.find(x => x.id === id);
    if (!p) { priceInfo.textContent = ''; return; }
    const total = p.price * qty;
    priceInfo.innerHTML = `Đơn giá: <strong>${p.price.toLocaleString('vi')}đ</strong> &times; ${qty} = <strong>${total.toLocaleString('vi')}đ</strong> (stock: ${p.quantity})`;
  }

  productSelect.addEventListener('change', updatePriceInfo);
  quantityInput.addEventListener('input', updatePriceInfo);

  // State retry — cho phép user click Stop để hủy giữa chừng
  let retrying = false;
  let cancelRetry = false;

  buyBtn.addEventListener('click', async () => {
    // Nếu đang retry → click thứ 2 = Stop
    if (retrying) {
      cancelRetry = true;
      setStatus('⏹ Đang dừng retry...', 'warn');
      return;
    }

    const apikey = apikeyInput.value.trim();
    const productId = parseInt(productSelect.value);
    const quantity  = parseInt(quantityInput.value) || 1;

    if (!apikey || !productId) return setStatus('⚠️ Thiếu API key hoặc sản phẩm', 'warn');

    clearLog();

    const useRetry = autoRetryChk.checked;
    const delaySec = Math.max(1, parseInt(retryDelayInput.value) || 3);

    // Set UI vào trạng thái retry
    if (useRetry) {
      retrying = true;
      cancelRetry = false;
      buyBtn.textContent = '⏹ Stop retry';
      buyBtn.classList.remove('primary');
      buyBtn.classList.add('danger');
    } else {
      buyBtn.disabled = true;
    }

    let attempt = 0;
    let lastError = '';

    try {
      while (true) {
        attempt++;
        setStatus(useRetry
          ? `⏳ Lần ${attempt}: đang mua ${quantity} account...`
          : `⏳ Đang mua ${quantity} account...`, 'info');

        let result;
        try {
          result = await chrome.runtime.sendMessage({
            action: 'buyProduct',
            apikey, productId, quantity
          });
        } catch (e) {
          result = { success: false, message: e.message };
        }

        if (result && result.success) {
          // ============ SUCCESS ============
          const data = result.data;
          lastBoughtAccounts = parseAccounts(data.accounts || []);
          const summary = lastBoughtAccounts.map((a, i) =>
            `${i + 1}. ${a.email} | ${a.password}`
          ).join('\n');
          accountSummary.innerHTML = `
            <div>Trans ID: <code>${data.trans_id}</code></div>
            <div>Số lượng: <strong>${data.quantity}</strong> &middot; Total: <strong>${(data.total || 0).toLocaleString('vi')}đ</strong></div>
            ${useRetry ? `<div class="hint">Thành công sau ${attempt} lần thử</div>` : ''}
          `;
          accountsText.value = summary;
          buyResult.style.display = 'block';

          setStatus(`✅ ${result.message || 'Mua thành công'}${useRetry ? ` (lần ${attempt})` : ''}`, 'ok');

          if (autoImportChk.checked && lastBoughtAccounts.length > 0) {
            await autoImportFirstAccount();
          }
          break;
        }

        // ============ FAIL ============
        lastError = result?.message || 'Mua fail';

        if (!useRetry) {
          // Không retry → fail luôn
          setStatus('❌ ' + lastError, 'err');
          break;
        }

        // Có retry — kiểm tra cancel
        if (cancelRetry) {
          setStatus(`⏹ Đã dừng retry sau ${attempt} lần. Lỗi cuối: ${lastError}`, 'warn');
          break;
        }

        // Log lỗi từng lần
        logEl.textContent += `[${attempt}] ${lastError}\n`;
        logEl.scrollTop = logEl.scrollHeight;

        // Đếm ngược delay với khả năng cancel
        for (let i = delaySec; i > 0; i--) {
          if (cancelRetry) break;
          setStatus(`❌ Lần ${attempt} fail: ${lastError}. Retry sau ${i}s... (click Stop để dừng)`, 'warn');
          await sleep(1000);
        }

        if (cancelRetry) {
          setStatus(`⏹ Đã dừng retry sau ${attempt} lần. Lỗi cuối: ${lastError}`, 'warn');
          break;
        }
      }
    } finally {
      retrying = false;
      cancelRetry = false;
      buyBtn.disabled = false;
      buyBtn.textContent = '💳 Mua ngay';
      buyBtn.classList.remove('danger');
      buyBtn.classList.add('primary');
    }
  });

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ============ TAB: HƯỚNG DẪN ============
  function populateExtensionId() {
    const extIdDisplay = document.getElementById('extIdDisplay');
    const copyExtIdBtn = document.getElementById('copyExtIdBtn');
    if (!extIdDisplay || !copyExtIdBtn) return;

    const id = chrome.runtime.id;
    extIdDisplay.textContent = id;

    // Replace placeholder "EXT_ID" trong các code block bằng ID thật
    document.querySelectorAll('.guide pre.code').forEach(pre => {
      pre.textContent = pre.textContent.replaceAll('EXT_ID', id).replaceAll('EXTENSION_ID', id);
    });

    copyExtIdBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(id);
        copyExtIdBtn.textContent = '✓ Copied';
        setTimeout(() => copyExtIdBtn.textContent = '📋 Copy', 1500);
      } catch (_) { /* ignore */ }
    });
  }

  async function autoImportFirstAccount() {
    const first = lastBoughtAccounts[0];
    if (!first || !first.cookieJsonRaw) {
      setStatus('⚠️ Account không có cookie kèm — skip auto-import', 'warn');
      return;
    }
    let cookies;
    try {
      cookies = JSON.parse(first.cookieJsonRaw);
      if (!Array.isArray(cookies)) throw new Error('Cookie không phải mảng');
    } catch (e) {
      setStatus('❌ Parse cookie lỗi: ' + e.message, 'err');
      return;
    }
    await runImport(cookies, {
      clearBefore: true,
      clearStorage: true,
      openAfter: true
    }, `Auto-import ${first.email}`);
  }

  copyAccountsBtn.addEventListener('click', async () => {
    if (lastBoughtAccounts.length === 0) return;
    const text = lastBoughtAccounts
      .map(a => `${a.email}|${a.password}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setStatus('📋 Đã copy danh sách email|pass', 'ok');
    } catch (e) {
      setStatus('❌ Copy lỗi: ' + e.message, 'err');
    }
  });

  importBoughtBtn.addEventListener('click', async () => {
    if (lastBoughtAccounts.length === 0) {
      return setStatus('⚠️ Chưa có account nào để import', 'warn');
    }
    const first = lastBoughtAccounts[0];
    if (!first.cookieJsonRaw) {
      return setStatus('⚠️ Account này không có cookie kèm', 'warn');
    }

    let cookies;
    try {
      cookies = JSON.parse(first.cookieJsonRaw);
      if (!Array.isArray(cookies)) throw new Error('Cookie không phải mảng');
    } catch (e) {
      return setStatus('❌ Parse cookie lỗi: ' + e.message, 'err');
    }

    await runImport(cookies, {
      clearBefore: true,
      clearStorage: true,
      openAfter: true
    }, `Import cookie cho ${first.email}`);
  });

  // Parse mảng accounts: "email|pass|cookieJson"
  function parseAccounts(accountsRaw) {
    return accountsRaw.map(s => {
      const i1 = s.indexOf('|');
      const i2 = s.indexOf('|', i1 + 1);
      if (i1 < 0 || i2 < 0) return { email: s, password: '', cookieJsonRaw: '' };
      return {
        email:         s.substring(0, i1),
        password:      s.substring(i1 + 1, i2),
        cookieJsonRaw: s.substring(i2 + 1)
      };
    });
  }

  // ============ TAB: IMPORT TỪ FILE ============
  const importBtn    = document.getElementById('importBtn');
  const deleteAllBtn = document.getElementById('deleteAllBtn');
  const cookieInput  = document.getElementById('cookieInput');

  importBtn.addEventListener('click', async () => {
    const raw = cookieInput.value.trim();
    if (!raw) return setStatus('⚠️ Paste cookie JSON vào ô trên', 'warn');

    let cookies;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) cookies = parsed;
      else if (Array.isArray(parsed?.cookies)) cookies = parsed.cookies;
      else if (Array.isArray(parsed?.Cookies)) cookies = parsed.Cookies;
      else throw new Error('Không tìm thấy mảng cookie');
    } catch (e) {
      return setStatus('❌ JSON parse lỗi: ' + e.message, 'err');
    }

    const options = {
      clearBefore : document.getElementById('clearBefore').checked,
      clearStorage: document.getElementById('clearStorage').checked,
      openAfter   : document.getElementById('openAfter').checked
    };

    await runImport(cookies, options, 'Import cookie từ file');
  });

  async function runImport(cookies, options, label) {
    if (cookies.length === 0) return setStatus('⚠️ Mảng cookie rỗng', 'warn');

    setStatus(`⏳ ${label}: ${cookies.length} cookies...`, 'info');
    clearLog();
    importBtn.disabled = true;
    importBoughtBtn.disabled = true;

    try {
      const result = await chrome.runtime.sendMessage({ action: 'import', cookies, options });
      if (!result) throw new Error('Background không trả response');

      const cls = result.imported === cookies.length ? 'ok' : 'warn';
      setStatus(`✅ Import ${result.imported}/${cookies.length} cookies (skip ${result.skipped})`, cls);
      if (result.log?.length > 0) logEl.textContent = result.log.join('\n');
    } catch (e) {
      setStatus('❌ Lỗi: ' + e.message, 'err');
    } finally {
      importBtn.disabled = false;
      importBoughtBtn.disabled = false;
    }
  }

  deleteAllBtn.addEventListener('click', async () => {
    const confirmed = confirm(
      'Xóa TẤT CẢ cookies trong trình duyệt?\n\n' +
      'Bạn sẽ bị logout khỏi MỌI website.\n\nTiếp tục?'
    );
    if (!confirmed) return;

    setStatus('⏳ Đang xóa tất cả cookies...', 'info');
    clearLog();
    deleteAllBtn.disabled = true;
    importBtn.disabled = true;

    try {
      const result = await chrome.runtime.sendMessage({ action: 'deleteAll' });
      if (!result) throw new Error('Background không trả response');
      setStatus(
        `✅ Đã xóa ${result.removed}/${result.total} cookies (fail: ${result.failed})`,
        result.failed > 0 ? 'warn' : 'ok'
      );
    } catch (e) {
      setStatus('❌ Lỗi: ' + e.message, 'err');
    } finally {
      deleteAllBtn.disabled = false;
      importBtn.disabled = false;
    }
  });
});
