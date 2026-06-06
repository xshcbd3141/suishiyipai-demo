/* ========================================
   随食一拍 · 本地多账户系统
   手机号+密码登录，纯本地存储
   ======================================== */

// ===== 密码哈希 =====
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'suishiyipai_salt');
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ===== 账户存储 =====
function getAccounts() {
  try { return JSON.parse(localStorage.getItem('ssyp_accounts') || '{}'); } catch { return {}; }
}
function saveAccounts(accounts) {
  localStorage.setItem('ssyp_accounts', JSON.stringify(accounts));
}

// ===== 获取当前登录用户手机号 =====
function currentUserPhone() {
  return localStorage.getItem('ssyp_current_user') || '';
}

// ===== 数据存储（带账户前缀） =====
function accountKey(key) {
  const phone = currentUserPhone();
  return phone ? phone + '_' + key : 'ssyp_' + key;
}

// 全局存储钩子 - app.js 通过这个读写数据
window.accountStore = {
  getItem(key) {
    const val = localStorage.getItem(accountKey(key));
    // 兼容旧数据：如果新key没有，尝试读旧的全局key（仅API配置兼容）
    if (val === null && key === 'api_config') {
      const old = localStorage.getItem('ssyp_api_base') ||
                  localStorage.getItem('ssyp_api_key') ||
                  localStorage.getItem('ssyp_model');
      if (old) return null; // 不迁移旧API配置
    }
    return val;
  },
  setItem(key, value) {
    localStorage.setItem(accountKey(key), value);
  },
  removeItem(key) {
    localStorage.removeItem(accountKey(key));
  },
  clear() {
    const phone = currentUserPhone();
    if (!phone) return;
    // 清除当前账户的所有数据
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(phone + '_')) keysToRemove.push(k);
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  }
};

// ===== 登录处理 =====
async function handleLogin() {
  const phone = ($('loginPhone').value || '').trim();
  const password = ($('loginPassword').value || '').trim();

  if (!phone || !/^1\d{10}$/.test(phone)) {
    showLoginMsg('请输入正确的11位手机号', 'error');
    return;
  }
  if (!password || password.length < 4) {
    showLoginMsg('密码至少4位', 'error');
    return;
  }

  const accounts = getAccounts();
  if (!accounts[phone]) {
    showLoginMsg('该手机号未注册，请先注册', 'warn');
    return;
  }

  const pwHash = await hashPassword(password);
  if (accounts[phone].passwordHash !== pwHash) {
    showLoginMsg('密码错误', 'error');
    return;
  }

  // 登录成功
  doLogin(phone, accounts[phone].displayName || phone);
}

// ===== 注册处理 =====
async function handleRegister() {
  const phone = ($('loginPhone').value || '').trim();
  const password = ($('loginPassword').value || '').trim();

  if (!phone || !/^1\d{10}$/.test(phone)) {
    showLoginMsg('请输入正确的11位手机号', 'error');
    return;
  }
  if (!password || password.length < 4) {
    showLoginMsg('密码至少4位', 'error');
    return;
  }

  const accounts = getAccounts();
  if (accounts[phone]) {
    showLoginMsg('该手机号已注册，请直接登录', 'warn');
    return;
  }

  const pwHash = await hashPassword(password);
  accounts[phone] = {
    phone: phone,
    passwordHash: pwHash,
    displayName: phone.slice(0,3) + '****' + phone.slice(-4),
    createdAt: new Date().toISOString()
  };
  saveAccounts(accounts);

  showLoginMsg('✅ 注册成功！正在登录…', 'ok');
  setTimeout(() => doLogin(phone, accounts[phone].displayName), 600);
}

// ===== 执行登录 =====
function doLogin(phone, displayName) {
  localStorage.setItem('ssyp_current_user', phone);

  // 初始化账户的API配置（如果还没有的话）
  if (!localStorage.getItem(phone + '_api_base')) {
    localStorage.setItem(phone + '_api_base', 'https://aiping.cn/api/v1');
    localStorage.setItem(phone + '_model', 'Qwen3-VL-30B-A3B-Instruct');
  }

  // 切换到主界面
  $('page-login').classList.remove('active');
  $('page-camera').classList.add('active');
  document.querySelector('.tab-bar').style.display = '';

  // 更新账号切换器（下次登录页可见）
  updateAccountSwitcher();

  // 初始化 app
  initAppForCurrentUser();

  showToast('欢迎回来，' + displayName, 2000);
}

// ===== 退出登录 =====
function handleLogout() {
  if (!confirm('确定要退出登录吗？你的数据会保留在本地。')) return;

  const phone = currentUserPhone();
  localStorage.removeItem('ssyp_current_user');

  // 清除当前图表引用
  if (window.nutritionChart) { window.nutritionChart.destroy(); window.nutritionChart = null; }
  if (window.weightChart) { window.weightChart.destroy(); window.weightChart = null; }
  if (window.trendChart) { window.trendChart.destroy(); window.trendChart = null; }

  // 回到登录页
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  $('page-login').classList.add('active');
  document.querySelector('.tab-bar').style.display = 'none';

  // 清空登录表单
  $('loginPhone').value = '';
  $('loginPassword').value = '';
  $('loginMsg').textContent = '';

  updateAccountSwitcher();
}

// ===== 登录页消息 =====
function showLoginMsg(msg, type) {
  const el = $('loginMsg');
  if (!el) return;
  el.textContent = msg;
  el.style.color = type === 'error' ? '#E60012' : type === 'warn' ? '#FFD700' : type === 'ok' ? 'var(--color-primary)' : 'var(--text-secondary)';
}

// ===== 账号快速切换器 =====
function updateAccountSwitcher() {
  const switcher = $('accountSwitcher');
  const list = $('accountList');
  if (!switcher || !list) return;

  const accounts = getAccounts();
  const phones = Object.keys(accounts);
  const currentPhone = currentUserPhone();

  // 过滤掉当前登录的（在登录页不显示当前）
  const otherPhones = phones.filter(p => p !== currentPhone);

  if (otherPhones.length === 0) {
    switcher.style.display = 'none';
    return;
  }

  switcher.style.display = '';
  list.innerHTML = otherPhones.map(p => {
    const display = (p || '').slice(0,3) + '****' + (p || '').slice(-4);
    return '<button class="account-chip" onclick="switchToAccount(\'' + p + '\')">' + display + '</button>';
  }).join('');
}

// ===== 快速切换账号（无需密码，因为已在设备上登录过） =====
function switchToAccount(phone) {
  const accounts = getAccounts();
  if (!accounts[phone]) return;

  // 保存当前会话
  localStorage.removeItem('ssyp_current_user');

  doLogin(phone, accounts[phone].displayName);
}

// ===== 页面加载时检查登录状态 =====
(function initAuth() {
  // 等 DOM 就绪
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkAuth);
  } else {
    checkAuth();
  }

  function checkAuth() {
    const currentPhone = localStorage.getItem('ssyp_current_user') || '';
    const accounts = getAccounts();

    if (currentPhone && accounts[currentPhone]) {
      // 已登录，直接进入
      const loginPage = document.getElementById('page-login');
      const cameraPage = document.getElementById('page-camera');
      const tabBar = document.querySelector('.tab-bar');
      if (loginPage) loginPage.classList.remove('active');
      if (cameraPage) cameraPage.classList.add('active');
      if (tabBar) tabBar.style.display = '';
    } else {
      // 未登录
      localStorage.removeItem('ssyp_current_user');
      const allPages = document.querySelectorAll('.page');
      allPages.forEach(p => p.classList.remove('active'));
      const loginPage = document.getElementById('page-login');
      if (loginPage) loginPage.classList.add('active');
      const tabBar = document.querySelector('.tab-bar');
      if (tabBar) tabBar.style.display = 'none';
      updateAccountSwitcher();
    }
  }
})();
