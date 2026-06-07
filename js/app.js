// ===== Chart.js 主题色适配 =====
function getChartTheme() {
  const isDark = document.documentElement.classList.contains('dark');
  return {
    protein: '#E60012',
    fat: '#FFD700',
    carb: '#FFFFFF',
    cal: '#E60012',
    weight: '#FFD700',
    textColor: isDark ? '#888888' : '#666666',
    gridColor: isDark ? 'rgba(230,0,18,0.08)' : 'rgba(230,0,18,0.06)',
    bgTransparent: isDark ? 'rgba(230,0,18,0.05)' : 'rgba(230,0,18,0.03)',
  };
}

// ===== 全局状态 =====
let selectedFile = null;
let currentMealType = 'lunch';
let currentDayOffset = 0; // 0=今天, -1=昨天, 1=明天
let nutritionChart = null;
let weightChart = null;
let pendingRecognitionData = null;
let pendingRawContent = '';
let pendingModel = '';

// ===== 存储键 =====
const SK = {
  apiBase: 'ssyp_api_base', apiKey: 'ssyp_api_key', model: 'ssyp_model',
  profile: 'ssyp_profile', meals: 'ssyp_meals', weightLog: 'ssyp_weight_log'
};

// ===== 工具函数 =====
function $(id) { return document.getElementById(id); }
function showToast(msg, dur = 2000) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.remove('show'), dur);
}
function todayStr() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
function dateStr(offset) { const d = new Date(); d.setDate(d.getDate() + offset); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
function formatDate(ds) { const [y,m,d] = ds.split('-'); return parseInt(m) + '/' + parseInt(d); }

// ===== Tab 切换 =====
function switchTab(name) {
  ['camera','record','assistant','profile'].forEach(t => { $(`page-${t}`).classList.toggle('active', t === name); });
  document.querySelectorAll('.tab-item').forEach((el, i) => {
    el.classList.toggle('active', ['camera','record','assistant','profile'][i] === name);
  });
  if (name === 'record') { renderDailyRecord(); }
  if (name === 'assistant') { renderAssistantPage(); }
  if (name === 'profile') { renderProfilePage(); }
}

// ===== API 配置 =====
function saveConfig() {
  // API 配置全局统一，不跟随账户
  const base = $('apiBase').value.trim(), key = $('apiKey').value.trim(), model = $('modelName').value.trim();
  if (base) localStorage.setItem('ssyp_api_base', base);
  if (key) localStorage.setItem('ssyp_api_key', key);
  if (model) localStorage.setItem('ssyp_model', model);
}
function updateStatus() {
  const base = $('apiBase').value.trim(), key = $('apiKey').value.trim(), model = $('modelName').value.trim();
  const btn = $('recognizeBtn');
  if (!base || !key || !model) {
    $('keyStatus').innerHTML = '<span class="dot off"></span> 缺少: ' + ['API URL','API Key','模型名称'].filter((_,i) => [!base,!key,!model][i]).join(', ');
    btn.disabled = true; return;
  }
  if (key.length < 8) { $('keyStatus').innerHTML = '<span class="dot err"></span> Key太短'; btn.disabled = true; return; }
  $('keyStatus').innerHTML = '<span class="dot on"></span> 已就绪 · ' + model;
  btn.disabled = !selectedFile;
}

function setPreset(type) {
  const presets = { aiping: 'https://aiping.cn/api/v1', openai: 'https://api.openai.com/v1', openrouter: 'https://openrouter.ai/api/v1', custom: '' };
  $('apiBase').value = presets[type] || '';
  saveConfig(); updateStatus();
}
function setModel(name) { $('modelName').value = name; saveConfig(); updateStatus(); }
function toggleConfig(forceOpen) {
  const p = $('configPanel'), a = $('configArrow');
  if (forceOpen === true) { p.classList.add('open'); a.classList.add('open'); }
  else if (forceOpen === false) { p.classList.remove('open'); a.classList.remove('open'); }
  else { p.classList.toggle('open'); a.classList.toggle('open'); }
}

// ===== Meal type =====
function selectMealType(type) {
  currentMealType = type;
  document.querySelectorAll('.meal-type-btn').forEach(b => b.classList.toggle('sel', b.textContent.includes({'breakfast':'早餐','lunch':'午餐','dinner':'晚餐','snack':'加餐'}[type])));
}

// ===== 文件处理 =====
function handleFile(input) {
  const file = input.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('请选择图片文件'); return; }
  selectedFile = file;
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = $('previewImg');
    img.src = e.target.result; img.style.display = 'block';
    $('placeholder').style.display = 'none';
    $('uploadZone').classList.add('has-image');
  };
  reader.readAsDataURL(file);
  updateStatus();
  $('results').classList.remove('active');
}

// ===== 图片压缩 =====
function fileToCompressedDataURL(file, maxW = 1024, maxH = 1024, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function(e) {
      const img = new Image();
      img.onload = function() {
        let w = img.width, h = img.height;
        if (w > maxW || h > maxH) { const r = Math.min(maxW/w, maxH/h); w = Math.round(w*r); h = Math.round(h*r); }
        const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const compressed = canvas.toDataURL('image/jpeg', quality);
        console.log('🖼 压缩:', img.width,'x',img.height,'→', w,'x',h, '| DataURL:', compressed.length);
        resolve(compressed);
      };
      img.onerror = reject; img.src = e.target.result;
    };
    reader.onerror = reject; reader.readAsDataURL(file);
  });
}

// ===== 食物emoji =====
function getFoodEmoji(name, cat) {
  const m = {'米':'🍚','饭':'🍚','面':'🍜','条':'🍜','面包':'🍞','馒头':'🥟','饺子':'🥟','鸡':'🍗','猪':'🥩','牛':'🥩','羊':'🥩','鱼':'🐟','虾':'🦐','蟹':'🦀','蛋':'🥚','豆腐':'🧈','菜':'🥬','沙拉':'🥗','西兰花':'🥦','果':'🍎','苹果':'🍎','香蕉':'🍌','奶茶':'🧋','咖啡':'☕','汤':'🍲','火锅':'🍲','烤':'🍖','炸':'🍗','蛋糕':'🎂','饼干':'🍪','薯片':'🥔','奶':'🥛','包':'🥟','汉堡':'🍔','薯条':'🍟','芝士':'🧀','米粉':'🍜','猪肉':'🥩','牛肉':'🥩','菠菜':'🥬','豆':'🫘','皮':'🫓','甜':'🍬','酱':'🫙','椒':'🌶'};
  const s = (name||'') + (cat||'');
  for (const [k,v] of Object.entries(m)) { if (s.includes(k)) return v; }
  return '🍽️';
}

// ===== 营养DB (每100g: 热量kcal, 蛋白g, 脂肪g, 碳水g) =====
const foodDB = {
  '米饭':  [116, 2.6, 0.3, 25.9], '馒头': [223, 7.0, 1.1, 47.0], '面条': [110, 3.5, 0.5, 22.0],
  '面包':  [266, 9.0, 3.3, 49.0], '花卷': [211, 6.4, 1.0, 45.0], '包子': [227, 8.0, 5.0, 38.0],
  '饺子':  [240, 9.0, 10.0, 28.0], '粥': [46, 1.1, 0.2, 9.8], '玉米': [112, 4.0, 1.2, 22.8],
  '红薯':  [86, 1.6, 0.1, 20.1], '土豆': [76, 2.0, 0.2, 17.5], '油条': [386, 6.9, 17.6, 51.0],
  '米粉':  [110, 2.0, 0.3, 24.0], '粿条': [95, 2.5, 2.0, 16.0], '肠粉': [100, 2.5, 0.5, 21.0], '饼': [260, 7.0, 8.0, 40.0],
  '汉堡':  [265, 13.0, 10.0, 30.0], '薯条': [312, 4.0, 15.0, 41.0],
  '鸡肉':  [167, 25.0, 6.7, 0.5], '鸡胸肉':[133, 31.0, 1.0, 0], '鸡腿': [181, 18.0, 13.0, 0],
  '鸡翅':  [222, 17.0, 16.0, 0], '猪肉': [395, 13.0, 37.0, 2.4], '五花肉':[518, 9.0, 53.0, 0],
  '排骨':  [264, 18.0, 21.0, 0], '牛肉': [125, 22.0, 4.2, 0], '牛排': [170, 26.0, 7.0, 0],
  '羊肉':  [203, 19.0, 14.0, 0], '鱼': [110, 20.0, 4.0, 0], '三文鱼':[208, 20.0, 13.0, 0],
  '虾':    [93, 20.0, 1.4, 0], '虾仁': [60, 12.0, 0.6, 1.0], '蟹': [95, 19.0, 1.8, 0],
  '鱿鱼':  [75, 15.0, 0.8, 1.0], '贝': [77, 12.0, 0.8, 7.0],
  '鸡蛋':  [144, 13.0, 9.5, 1.5], '蛋白': [48, 10.0, 0, 1.0], '蛋黄': [328, 16.0, 28.0, 3.0],
  '牛奶':  [54, 3.0, 3.0, 3.4], '酸奶': [72, 3.5, 3.0, 9.0], '奶酪': [350, 25.0, 28.0, 1.0],
  '豆腐':  [76, 8.0, 4.8, 1.9], '豆浆': [31, 2.8, 1.5, 1.5], '豆皮': [409, 46.0, 18.0, 13.0],
  '西兰花':[34, 2.8, 0.4, 6.6], '花菜': [25, 1.9, 0.3, 5.0], '菠菜': [23, 2.9, 0.4, 3.6],
  '白菜':  [13, 1.5, 0.2, 2.2], '生菜': [15, 1.4, 0.2, 2.6], '黄瓜': [15, 0.7, 0.1, 3.0],
  '番茄':  [18, 0.9, 0.2, 4.0], '胡萝卜':[41, 0.9, 0.2, 10.0], '青椒': [22, 1.0, 0.2, 4.6],
  '茄子':  [23, 1.0, 0.2, 4.9], '豆角': [31, 2.5, 0.2, 6.0], '芹菜': [14, 0.8, 0.1, 3.0],
  '韭菜':  [26, 2.4, 0.4, 3.2], '洋葱': [40, 1.1, 0.1, 9.0], '蘑菇': [22, 2.5, 0.3, 3.0],
  '海带':  [12, 0.8, 0.1, 2.0], '木耳': [21, 1.5, 0.2, 3.8],
  '苹果':  [52, 0.3, 0.2, 13.8], '香蕉': [91, 1.1, 0.3, 22.0], '橙子': [47, 0.9, 0.1, 11.8],
  '西瓜':  [30, 0.6, 0.1, 7.0], '葡萄': [69, 0.7, 0.2, 17.0], '草莓': [32, 0.7, 0.3, 7.1],
  '芒果':  [60, 0.8, 0.4, 15.0], '梨': [44, 0.4, 0.1, 10.7], '猕猴桃':[61, 1.1, 0.5, 14.7],
  '蓝莓':  [57, 0.7, 0.3, 14.5],
  '奶茶':  [85, 1.5, 3.0, 13.0], '咖啡': [2, 0.1, 0, 0.3], '拿铁': [56, 2.8, 2.8, 4.8],
  '可乐':  [42, 0, 0, 10.6], '果汁': [50, 0.3, 0.1, 12.0], '啤酒': [43, 0.5, 0, 3.6],
  '蛋糕':  [347, 5.3, 17.0, 44.0], '饼干': [433, 8.0, 14.0, 68.0], '薯片': [536, 5.0, 30.0, 53.0],
  '巧克力':[546, 7.6, 32.0, 57.0], '冰淇淋':[207, 3.5, 11.0, 23.0],
  // 通用默认 (用于模糊匹配到的食物)
  '肉类通用':[200, 18, 15, 0], '蔬菜通用':[25, 2, 0.3, 4],
  '水果通用':[55, 0.5, 0.2, 13], '主食通用':[150, 4, 1, 30],
};

function lookupFood(name) {
  if (foodDB[name]) return foodDB[name];
  // 精确包含匹配 (优先长关键字)
  const keys = Object.keys(foodDB).sort((a,b) => b.length - a.length);
  for (const k of keys) { if (name.includes(k)) return foodDB[k]; }
  // 类别回退
  if (/肉|排|腿|翅|鱼|虾|蟹|贝|鱿/.test(name)) return foodDB['肉类通用'];
  if (/菜|兰|瓜|茄|椒|菇|耳|葱|蒜|豆角|芹菜|韭菜|菠菜|白菜|生菜|海带|木耳|胡萝卜|洋葱|蘑菇/.test(name)) return foodDB['蔬菜通用'];
  if (/果|莓|梨|桃|橙|柚|蕉|瓜|葡|芒|猕猴/.test(name)) return foodDB['水果通用'];
  if (/面|粉|饭|饼|包|馒|饺|粥|薯|米|条/.test(name)) return foodDB['主食通用'];
  return [150, 8, 5, 15]; // 兜底
}

function calcNutrition(foods) {
  let cal = 0, pro = 0, fat = 0, carb = 0;
  foods.forEach(f => {
    const w = f.estimated_weight_g || 100;
    const [c100, p100, f100, cb100] = lookupFood(f.name);
    cal += Math.round(c100 * w / 100);
    pro += Math.round(p100 * w / 100);
    fat += Math.round(f100 * w / 100);
    carb += Math.round(cb100 * w / 100);
  });
  return { cal, pro, fat, carb };
}

// ===== 核心: 识别 =====
async function recognize() {
  const apiBase = $('apiBase').value.trim().replace(/\/+$/, '');
  const apiKey = $('apiKey').value.trim();
  const model = $('modelName').value.trim();
  if (!apiBase || !apiKey || !model || !selectedFile) return;

  const btn = $('recognizeBtn'), loading = $('loading'), results = $('results');
  btn.disabled = true; btn.textContent = '识别中…';
  loading.classList.add('active'); results.classList.remove('active');
  $('loadingModel').textContent = model + ' · 检测连接…';
  loading.scrollIntoView({ behavior: 'smooth', block: 'center' });

  try {
    const url = apiBase + '/chat/completions';

    // 纯文本预检
    let textOk = false;
    try {
      const tr = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({ model, max_tokens: 10, messages: [{ role: 'user', content: '回复OK' }] }),
      });
      if (tr.ok) { textOk = true; console.log('🔍 纯文本测试 OK'); }
      else { const et = await tr.text(); console.error('🔍 纯文本失败:', et.substring(0,200)); }
    } catch(e) { console.warn('🔍 预检异常:', e.message); }

    // 压缩图片
    $('loadingModel').textContent = model + ' · 压缩中…';
    const dataURL = await fileToCompressedDataURL(selectedFile, 1024, 1024, 0.75);

    const prompt = `识别图中所有食物。规则：
1. 主体列出组合食物（例如"汉堡"整体，"粿条"整体，"套餐"按主要菜品分），不要拆成原料
2. 每样食物只出现一次
3. 对于组合食物，在 sub_items 字段列出其大致成分和估算克数（例如 汉堡→面包胚80g/肉饼120g/芝士20g/生菜30g，粿条→粿条250g/肉片100g/菠菜50g/汤200ml）
4. 独立的配菜/饮品单独列为主食物
返回JSON：{"foods":[{"name":"食物名","category":"主食/肉类/蔬菜/水果/饮品/零食/汤品/豆制品/蛋奶/其他","estimated_weight_g":克数,"confidence":0.95,"sub_items":[{"name":"成分","estimated_weight_g":克数}]}],"meal_context":{"cuisine_type":"中式/日式/西式/混合"}}
重量参考：一碗面/粉≈450g, 一个汉堡≈250g, 一碟炒菜≈300g, 一个苹果≈200g, 一杯奶茶≈500ml`;

    $('loadingModel').textContent = model + ' · AI识别中…';

    const formats = [
      { label: 'text+image_url', body: { model, temperature: 0, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataURL } }] }] } },
      { label: 'image_url+text', body: { model, temperature: 0, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: dataURL } }, { type: 'text', text: prompt }] }] } },
      { label: 'qwen-image', body: { model, temperature: 0, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image', image: dataURL }] }] } },
      { label: 'images-field', body: { model, temperature: 0, messages: [{ role: 'user', content: prompt, images: [dataURL] }] } },
      { label: 'image_url-str', body: { model, temperature: 0, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: dataURL }] }] } },
      { label: 'no-max_tokens', body: { model, temperature: 0, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataURL } }] }] }, noMaxTokens: true },
    ];

    let json = null, rawContent = '', lastError = null, lastStatus = null;

    for (const fmt of formats) {
      if (json) break;
      const body = { ...fmt.body };
      if (!fmt.noMaxTokens) body.max_tokens = 2048;

      const resp = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify(body),
      });
      lastStatus = resp.status;
      if (!resp.ok) {
        const et = await resp.text(); lastError = et;
        if (resp.status === 400 || resp.status === 422) continue;
        let msg;
        if (resp.status === 401) msg = 'API Key 无效'; else if (resp.status === 402) msg = '余额不足'; else if (resp.status === 429) msg = '请求太频繁'; else msg = '请求失败 (' + resp.status + ')';
        throw new Error(msg + '\n' + et.substring(0, 200));
      }
      const rj = await resp.json();
      rawContent = rj.choices?.[0]?.message?.content || '';
      if (rawContent) { json = rj; break; }
    }

    if (!json) {
      let detail = ''; try { detail = JSON.parse(lastError||'{}').msg || ''; } catch {}
      results.innerHTML = `<div class="error-card"><span class="icon">⚠️</span>API错误 (HTTP ${lastStatus})<br><small>${detail}</small></div>`;
      results.classList.add('active'); return;
    }

    // 清理 GLM box 标签
    rawContent = rawContent.replace(/<\|begin_of_box\|>/g, '').replace(/<\|end_of_box\|>/g, '');

    // JSON 解析
    let data = null;
    try { data = JSON.parse(rawContent); } catch {
      const m = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (m) { try { data = JSON.parse(m[1]); } catch {} }
      if (!data) {
        const s = rawContent.indexOf('{'), e = rawContent.lastIndexOf('}');
        if (s >= 0 && e > s) {
          try { let c = rawContent.substring(s, e+1); c = c.replace(/,(\s*[}\]])/g, '$1'); data = JSON.parse(c); } catch {}
        }
      }
    }

    const noFood = !data || !data.foods || !data.foods.length;
    const noFoodText = rawContent.includes('未识别') || rawContent.includes('没有食物') || rawContent.includes('未检测') || rawContent.includes('无食物');

    if (noFood) {
      if (noFoodText || !data) {
        results.innerHTML = '<div class="error-card"><span class="icon">🔍</span>AI 未检测到食物<br><small>请尝试拍摄食物照片</small></div>';
      } else {
        results.innerHTML = `<div class="error-card"><span class="icon">⚠️</span>无法解析食物数据<details class="raw-toggle"><summary>查看AI输出</summary><pre>${(rawContent||'(空)').replace(/</g,'&lt;')}</pre></details></div>`;
      }
      results.classList.add('active'); return;
    }

    // 显示结果 — 可编辑食物列表
    pendingRecognitionData = data; pendingRawContent = rawContent; pendingModel = model;

    renderEditableResults(data, rawContent, model);
    saveConfig();

  } catch (err) {
    console.error('❌ 识别失败:', err);
    results.innerHTML = '<div class="error-card"><span class="icon">❌</span>' + err.message.replace(/\n/g, '<br>') + '<br><small style="color:#666;">按F12查看日志</small></div>';
    results.classList.add('active');
  } finally {
    btn.disabled = false; btn.textContent = '识别食物';
    loading.classList.remove('active');
  }
}

// ===== 渲染可编辑的食物结果 =====
function renderEditableResults(data, rawContent, model) {
  const foods = data.foods;
  const results = $('results');
  const cName = data.meal_context?.cuisine_type || '';

  const foodCards = foods.map((f, i) => {
    const w = f.estimated_weight_g || 100;
    const conf = f.confidence ? Math.round(f.confidence * 100) : 0;
    const macro = lookupFood(f.name);
    const [c100, p100, f100, cb100] = macro;
    const cal = Math.round(c100 * w / 100);
    const insight = getFatInsight(f.name, cal, macro, w);

    const subs = f.sub_items || [];
    let subHTML = '';
    if (subs.length) {
      const subRows = subs.map(s => {
        const sw = s.estimated_weight_g || 10;
        const sm = lookupFood(s.name);
        const sc = Math.round(sm[0] * sw / 100);
        return '<div class="sub-item"><span class="sub-name">' + s.name + '</span><span class="sub-w">' + sw + 'g</span><span class="sub-cal">' + sc + 'kcal</span></div>';
      }).join('');
      subHTML = '<div class="food-expand" onclick="var n=this.nextElementSibling;n.style.display=n.style.display===\'none\'?\'block\':\'none\';this.querySelector(\'.tri\').classList.toggle(\'open\')"><span class="tri">▶</span> \u67e5\u770b\u6210\u5206 (' + subs.length + '\u9879)</div><div style="display:none;margin-top:2px;">' + subRows + '</div>';
    }

    const tipText = insight.tips.join(' \u00b7 ');
    return '<div class="food-item" id="foodItem' + i + '"><div class="food-emoji">' + getFoodEmoji(f.name, f.category) + '</div><div class="food-body"><div class="food-name" style="display:flex;align-items:center;gap:6px;"><span contenteditable="true" oninput="onFoodEdit()" data-food-idx="' + i + '" data-field="name" style="outline:none;border-bottom:1px dashed transparent;padding:1px 2px;min-width:60px;" onfocus="this.style.borderBottomColor=\'var(--color-primary)\'" onblur="this.style.borderBottomColor=\'transparent\'">' + (f.name||'\u98df\u7269') + '</span>' + (conf > 0 ? '<span style="font-size:11px;color:var(--color-primary);">' + conf + '%</span>' : '') + '</div><div class="food-meta" style="display:flex;align-items:center;gap:6px;">' + (f.category||'') + '<input class="food-weight-input" type="number" value="' + w + '" min="5" max="5000" step="5" data-food-idx="' + i + '" data-field="weight" oninput="onFoodEdit()"> g</div><div class="food-tags"><span class="food-tag cal">\ud83d\udd25 ' + cal + '</span><span class="food-tag protein">\ud83e\udd5a ' + Math.round(p100*w/100) + 'g</span><span class="food-tag fat">\ud83e\udd51 ' + Math.round(f100*w/100) + 'g</span><span class="food-tag carb">\ud83c\udf3e ' + Math.round(cb100*w/100) + 'g</span></div>' + subHTML + '<div class="fat-insight ' + insight.level + '">\ud83d\udd0d <span class="badge">' + tipText + '</span></div></div><div class="food-cal-right"><div class="food-cal-num">' + cal + '</div><div class="food-cal-unit">\u5343\u5361</div></div><button class="food-delete" onclick="deleteFoodItem(' + i + ')" title="\u5220\u9664\u6b64\u9879">\u2715</button></div>';
  }).join('');

  results.innerHTML = '<div class="summary-card" id="summaryCard"><div style="font-size:11px;opacity:0.8;">\ud83d\udcca ' + (cName||'\u8bc6\u522b\u7ed3\u679c') + ' \u00b7 ' + model + '</div><div class="summary-cal" id="summaryCal">--<span>\u5343\u5361</span></div><div class="summary-detail" id="summaryDetail">\u8ba1\u7b97\u4e2d...</div></div><div id="foodList">' + foodCards + '</div><div class="card" style="margin-top:10px;"><div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px;">+ \u624b\u52a8\u6dfb\u52a0\u98df\u7269</div><div class="add-food-row"><input type="text" id="addFoodName" placeholder="\u98df\u7269\u540d (\u5982: \u82f9\u679c)"><input type="number" id="addFoodWeight" placeholder="\u91cd\u91cfg" min="5" max="5000" step="10" value="200" style="width:80px;flex:0 0 auto;"><button class="btn btn-small btn-secondary" onclick="addFoodItem()" style="flex:0 0 auto;">+ \u6dfb\u52a0</button></div></div><div class="card" style="margin-top:10px;text-align:center;"><div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">\u8bb0\u5f55\u4e3a\uff1a<b>' + ({breakfast:'\ud83c\udf05 \u65e9\u9910',lunch:'\u2600\ufe0f \u5348\u9910',dinner:'\ud83c\udf19 \u665a\u9910',snack:'\ud83c\udf6a \u52a0\u9910'}[currentMealType]) + '</b></div><button class="btn btn-primary" onclick="saveMeal()" style="width:100%;">\ud83d\udcbe \u4fdd\u5b58\u5230\u4eca\u65e5\u8bb0\u5f55</button><details class="raw-toggle" style="margin-top:10px;"><summary>\ud83d\udcc4 AI\u539f\u59cb\u8f93\u51fa</summary><pre>' + (rawContent||'').replace(/</g,'&lt;') + '</pre></details></div>';
  results.classList.add('active');
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  updateSummaryCard();
}

// ===== 致胖分析 =====
function getFatInsight(name, cal, macro, weight) {
  const c100 = macro[0], p100 = macro[1], f100 = macro[2], cb100 = macro[3];
  const totalCal = cal || 1;
  const fatCal = Math.round(f100 * weight / 100) * 9;
  const carbCal = Math.round(cb100 * weight / 100) * 4;
  const fatPct = Math.round(fatCal / totalCal * 100);
  const carbPct = Math.round(carbCal / totalCal * 100);
  const density = c100 / 100;
  const tips = [];
  if (fatPct > 40) tips.push('高脂(' + fatPct + '%)');
  if (carbPct > 55 && c100 > 80) tips.push('高碳快吸收(' + carbPct + '%)');
  if (density > 3) tips.push('高热量密度(' + density.toFixed(1) + 'kcal/g)');
  if (f100 > 15) tips.push('脂肪偏高(' + f100 + 'g/100g)');
  if (p100 < 5 && c100 > 20) tips.push('低蛋白高碳水');
  if (tips.length === 0) tips.push('营养均衡');
  return { tips, fatPct, carbPct, density, level: tips.length <= 1 ? 'ok' : 'warn' };
}


// ===== 从当前页面DOM读取食物列表 =====
function readFoodListFromDOM() {
  const foods = [];
  const items = document.querySelectorAll('#foodList .food-item');
  items.forEach(item => {
    const nameEl = item.querySelector('[data-field="name"]');
    const weightEl = item.querySelector('[data-field="weight"]');
    const catEl = item.querySelector('.food-meta');
    if (!nameEl || !weightEl) return;
    const name = (nameEl.textContent || '').trim();
    const weight = parseFloat(weightEl.value) || 100;
    if (!name) return;
    const catText = catEl ? catEl.textContent.replace(/\d+\s*g/, '').trim() : '';
    foods.push({ name, estimated_weight_g: weight, category: catText || '其他', confidence: 1.0 });
  });
  return foods;
}

// ===== 编辑食物时更新汇总 =====
function onFoodEdit() { updateSummaryCard(); }

// ===== 更新汇总卡片 =====
function updateSummaryCard() {
  const foods = readFoodListFromDOM();
  if (foods.length === 0) { $('summaryCal').innerHTML = '0<span>千卡</span>'; $('summaryDetail').textContent = '暂无食物'; return; }
  const nut = calcNutrition(foods);
  $('summaryCal').innerHTML = nut.cal + '<span>千卡</span>';
  $('summaryDetail').innerHTML = '<span>🥚 蛋白 ' + nut.pro + 'g</span><span>🥑 脂肪 ' + nut.fat + 'g</span><span>🌾 碳水 ' + nut.carb + 'g</span><span>📋 ' + foods.length + '种</span>';
  // 更新每行的营养成分
  foods.forEach((f, i) => {
    const item = document.getElementById('foodItem' + i);
    if (!item) return;
    const [c100, p100, f100, cb100] = lookupFood(f.name);
    const w = f.estimated_weight_g;
    const cal = Math.round(c100 * w / 100);
    const tags = item.querySelector('.food-tags');
    if (tags) tags.innerHTML = '<span class="food-tag cal">🔥 ' + cal + '</span><span class="food-tag protein">🥚 ' + Math.round(p100*w/100) + 'g</span><span class="food-tag fat">🥑 ' + Math.round(f100*w/100) + 'g</span><span class="food-tag carb">🌾 ' + Math.round(cb100*w/100) + 'g</span>';
    const calR = item.querySelector('.food-cal-num');
    if (calR) calR.textContent = cal;
  });
}

// ===== 删除食物项 =====
function deleteFoodItem(idx) {
  const item = document.getElementById('foodItem' + idx);
  if (item) { item.style.opacity = '0'; item.style.transform = 'scale(0.9)'; item.style.transition = 'all 0.2s'; setTimeout(() => { item.remove(); reindexFoodItems(); updateSummaryCard(); }, 200); }
}

// ===== 手动添加食物 =====
function addFoodItem() {
  const name = ($('addFoodName').value || '').trim();
  const weight = parseInt($('addFoodWeight').value) || 200;
  if (!name) { showToast('请输入食物名称'); return; }
  const [c100, p100, f100, cb100] = lookupFood(name);
  const cal = Math.round(c100 * weight / 100);
  const idx = document.querySelectorAll('#foodList .food-item').length;
  const div = document.createElement('div');
  div.className = 'food-item'; div.id = 'foodItem' + idx;
  div.style.animation = 'slideUp 0.3s ease-out both';
  div.innerHTML = `<div class="food-emoji">${getFoodEmoji(name, '')}</div>
    <div class="food-body">
      <div class="food-name" style="display:flex;align-items:center;gap:6px;">
        <span contenteditable="true" oninput="onFoodEdit()" data-food-idx="${idx}" data-field="name" style="outline:none;border-bottom:1px dashed transparent;padding:1px 2px;min-width:60px;" onfocus="this.style.borderBottomColor='var(--color-primary)'" onblur="this.style.borderBottomColor='transparent'">${name}</span>
      </div>
      <div class="food-meta" style="display:flex;align-items:center;gap:6px;">
        <input class="food-weight-input" type="number" value="${weight}" min="5" max="5000" step="5" data-food-idx="${idx}" data-field="weight" oninput="onFoodEdit()"> g
      </div>
      <div class="food-tags"><span class="food-tag cal">🔥 ${cal}</span><span class="food-tag protein">🥚 ${Math.round(p100*weight/100)}g</span><span class="food-tag fat">🥑 ${Math.round(f100*weight/100)}g</span><span class="food-tag carb">🌾 ${Math.round(cb100*weight/100)}g</span></div>
    </div>
    <div class="food-cal-right"><div class="food-cal-num">${cal}</div><div class="food-cal-unit">千卡</div></div>
    <button class="food-delete" onclick="deleteFoodItem(${idx})" title="删除此项">✕</button>`;
  $('foodList').appendChild(div);
  $('addFoodName').value = ''; $('addFoodWeight').value = '200';
  updateSummaryCard();
}

// ===== 删除后重新编号 =====
function reindexFoodItems() {
  const items = document.querySelectorAll('#foodList .food-item');
  items.forEach((item, i) => {
    item.id = 'foodItem' + i;
    item.querySelectorAll('[data-food-idx]').forEach(el => el.dataset.foodIdx = i);
    const delBtn = item.querySelector('.food-delete');
    if (delBtn) delBtn.setAttribute('onclick', 'deleteFoodItem(' + i + ')');
  });
}

// ===== 保存用餐记录 (从页面DOM读取, 支持用户修改) =====
function saveMeal() {
  const foods = readFoodListFromDOM();
  if (!foods.length) { showToast('没有可保存的食物'); return; }
  const nut = calcNutrition(foods);
  const date = todayStr();

  const meals = JSON.parse(acGet(SK.meals) || '{}');
  if (!meals[date]) meals[date] = [];

  meals[date].push({
    id: Date.now(),
    mealType: currentMealType,
    mealContext: pendingRecognitionData ? (pendingRecognitionData.meal_context || {}) : {},
    foods: foods,
    nutrition: nut,
    model: pendingModel,
    time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
  });

  // 保存并限制总记录数
  const allDates = Object.keys(meals).sort();
  if (allDates.length > 90) {
    allDates.slice(0, allDates.length - 90).forEach(d => delete meals[d]);
  }
  acSet(SK.meals, JSON.stringify(meals));

  showToast('✅ 已保存到今日记录！', 2000);
  pendingRecognitionData = null;
  updateNavStatus();
}

// ===== 每日记录渲染 =====
function renderDailyRecord() {
  const date = dateStr(currentDayOffset);
  $('recordDate').textContent = currentDayOffset === 0 ? '📅 今天 ' + formatDate(date) : '📅 ' + formatDate(date);

  const meals = JSON.parse(acGet(SK.meals) || '{}');
  const dayMeals = meals[date] || [];

  // 汇总
  let totalCal = 0, totalPro = 0, totalFat = 0, totalCarb = 0;
  dayMeals.forEach(m => { totalCal += m.nutrition.cal; totalPro += m.nutrition.pro; totalFat += m.nutrition.fat; totalCarb += m.nutrition.carb; });

  // Target from profile
  const profile = getProfile();
  const target = profile ? profile.dailyTarget : 2000;

  // Stats
  const calPct = target > 0 ? Math.round(totalCal / target * 100) : 0;
  const calColor = calPct <= 85 ? 'green' : calPct <= 110 ? 'orange' : 'red';
  $('dailyStats').innerHTML = `
    <div class="stat-card"><div class="stat-num ${calColor}">${totalCal}</div><div class="stat-label">已摄入 (千卡)</div></div>
    <div class="stat-card"><div class="stat-num">${target}</div><div class="stat-label">目标 (千卡)</div><div class="progress-bar-wrap"><div class="progress-bar-fill ${calPct <= 85 ? 'ok' : calPct <= 110 ? 'warn' : 'over'}" style="width:${Math.min(calPct, 150)}%"></div></div></div>
    <div class="stat-card"><div class="stat-num">${totalPro}</div><div class="stat-label">蛋白质 (g)</div></div>
    <div class="stat-card"><div class="stat-num">${totalFat}</div><div class="stat-label">脂肪 (g)</div></div>
  `;

  // Chart
  const chartCard = $('chartCard');
  if (dayMeals.length > 0) {
    chartCard.style.display = '';
    renderNutritionChart(totalPro, totalFat, totalCarb);
  } else {
    chartCard.style.display = 'none';
  }

  // Meals list
  const mealTypes = [
    { key: 'breakfast', label: '🌅 早餐' },
    { key: 'lunch', label: '☀️ 午餐' },
    { key: 'dinner', label: '🌙 晚餐' },
    { key: 'snack', label: '🍪 加餐' },
  ];

  let mealsHTML = '';
  mealTypes.forEach(mt => {
    const items = dayMeals.filter(m => m.mealType === mt.key);
    mealsHTML += `<div class="meal-group"><div class="meal-group-label">${mt.label} <span class="count">${items.length > 0 ? items.length+'餐' : ''}</span></div>`;
    if (items.length === 0) {
      mealsHTML += '<div class="meal-empty">暂无记录</div>';
    } else {
      items.forEach((m, i) => {
        const names = m.foods.map(f => f.name).join('、');
        mealsHTML += `<div class="meal-mini">
          <div class="emoji">${getFoodEmoji(m.foods[0]?.name, m.foods[0]?.category)}</div>
          <div class="info">${names} <span style="color:var(--text-secondary);font-size:11px;">${m.time||''}</span></div>
          <div class="cals">${m.nutrition.cal}千卡</div>
          <button style="background:none;border:none;cursor:pointer;font-size:14px;padding:4px;" onclick="deleteMeal('${date}',${m.id})">🗑</button>
        </div>`;
      });
    }
    mealsHTML += '</div>';
  });
  $('mealsList').innerHTML = mealsHTML;

  updateNavStatus();
}

function deleteMeal(date, id) {
  const meals = JSON.parse(acGet(SK.meals) || '{}');
  if (meals[date]) { meals[date] = meals[date].filter(m => m.id !== id); if (meals[date].length === 0) delete meals[date]; }
  acSet(SK.meals, JSON.stringify(meals));
  renderDailyRecord();
  showToast('已删除');
}

function changeDay(offset) {
  if (offset === 0) currentDayOffset = 0;
  else currentDayOffset += offset;
  // 限制范围: -30 ~ +1
  currentDayOffset = Math.max(-30, Math.min(1, currentDayOffset));
  renderDailyRecord();
}

function renderNutritionChart(pro, fat, carb) {
  const ctx = $('nutritionChart').getContext('2d');
  if (nutritionChart) nutritionChart.destroy();
  const theme = getChartTheme();
  nutritionChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['蛋白质', '脂肪', '碳水'],
      datasets: [{
        data: [pro * 4, fat * 9, carb * 4],
        backgroundColor: [theme.protein, theme.fat, theme.carb],
        borderWidth: 2, borderColor: '#1A1A1A',
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { padding: 16, font: { size: 11 } } },
        tooltip: { callbacks: { label: ctx => ctx.label + ': ' + ctx.parsed + '千卡 (' + [pro, fat, carb][ctx.dataIndex] + 'g)' } }
      },
    }
  });
}

// ===== 用户档案 =====
// ===== 账户隔离存储包装 =====
// 以下函数替换所有 localStorage 调用，实现多账户数据隔离
// accountStore 在 account.js 中定义
function acGet(key) {
  return window.accountStore ? window.accountStore.getItem(key) : localStorage.getItem(key);
}
function acSet(key, val) {
  if (window.accountStore) window.accountStore.setItem(key, val);
  else localStorage.setItem(key, val);
}
function getProfile() {
  const raw = acGet(SK.profile);
  const p = JSON.parse(raw || '{}');
  if (!p.height || !p.weight) return null;
  const gender = p.gender || '';
  const bmi = p.weight / Math.pow(p.height / 100, 2);
  let bmr = gender === 'male' ? 10 * p.weight + 6.25 * p.height - 5 * (p.age||25) + 5 : 10 * p.weight + 6.25 * p.height - 5 * (p.age||25) - 161;
  const tdee = Math.round(bmr * (parseFloat(p.activity) || 1.2));
  // 目标热量: 减重 -500, 增重 +300, 维持不变
  const diff = p.targetWeight ? (p.weight - p.targetWeight) : 0;
  let dailyTarget = tdee;
  if (diff > 3) dailyTarget = tdee - 500;
  else if (diff > 0) dailyTarget = tdee - 300;
  else if (diff < -2) dailyTarget = tdee + 300;
  const proTarget = Math.round(p.weight * 1.2); // 1.2g/kg
  let bmiStatus = bmi < 18.5 ? '偏瘦' : bmi < 24 ? '正常' : bmi < 28 ? '偏胖' : '肥胖';
  return { ...p, bmi: Math.round(bmi*10)/10, bmr: Math.round(bmr), tdee, dailyTarget, proTarget, bmiStatus };
}

function saveProfile() {
  const p = {
    userID: $('pUserID').value.trim() || currentUserPhone(),
    gender: $('pGender').value,
    age: $('pAge').value ? parseInt($('pAge').value) : null,
    height: $('pHeight').value ? parseFloat($('pHeight').value) : null,
    weight: $('pWeight').value ? parseFloat($('pWeight').value) : null,
    targetWeight: $('pTargetWeight').value ? parseFloat($('pTargetWeight').value) : null,
    activity: $('pActivity').value,
    preferences: $('pPreferences').value,
  };
  acSet(SK.profile, JSON.stringify(p));
  renderProfilePage();
  updateNavStatus();
}

function renderProfilePage() {
  const raw = JSON.parse(acGet(SK.profile) || '{}');
  $('pUserID').value = raw.userID || currentUserPhone();
  $('pGender').value = raw.gender || '';
  $('pAge').value = raw.age || '';
  $('pHeight').value = raw.height || '';
  $('pWeight').value = raw.weight || '';
  $('pTargetWeight').value = raw.targetWeight || '';
  $('pActivity').value = raw.activity || '';
  $('pPreferences').value = raw.preferences || '';

  const p = getProfile();
  if (p) {
    $('calcBMI').textContent = p.bmi;
    $('calcBMR').textContent = p.bmr;
    $('calcTDEE').textContent = p.tdee;
    $('calcTarget').textContent = p.dailyTarget;
    $('calcProtein').textContent = p.proTarget;
    $('calcBMIStatus').textContent = p.bmiStatus;
  }
  renderWeightChart();
  renderDigitalTwin();
  renderRiskWarnings();
  renderGameCard();
}

// ===== 体重记录 =====
function logWeight() {
  const w = parseFloat($('weightInput').value);
  if (!w || w < 20 || w > 300) { showToast('请输入有效体重'); return; }
  const log = JSON.parse(acGet(SK.weightLog) || '[]');
  log.push({ date: todayStr(), weight: Math.round(w * 10) / 10 });
  // 去重同日
  const seen = new Set();
  const deduped = log.reverse().filter(e => { const k = e.date; if (seen.has(k)) return false; seen.add(k); return true; }).reverse();
  if (deduped.length > 90) deduped.splice(0, deduped.length - 90);
  acSet(SK.weightLog, JSON.stringify(deduped));

  // 更新profile体重
  const profile = JSON.parse(acGet(SK.profile) || '{}');
  profile.weight = w;
  acSet(SK.profile, JSON.stringify(profile));

  $('weightInput').value = '';
  renderProfilePage();
  showToast('✅ 体重已记录');
}

function renderWeightChart() {
  const theme = getChartTheme();
  const log = JSON.parse(acGet(SK.weightLog) || '[]');
  if (log.length < 2) { $('weightHistory').textContent = log.length === 1 ? '最新: ' + log[0].weight + 'kg (' + log[0].date + ')' : '暂无体重记录'; return; }
  $('weightHistory').textContent = '最新: ' + log[log.length-1].weight + 'kg · 共' + log.length + '条记录';

  const ctx = $('weightChart').getContext('2d');
  if (weightChart) weightChart.destroy();
  const labels = log.map(e => formatDate(e.date));
  weightChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '体重 (kg)',
        data: log.map(e => e.weight),
        borderColor: theme.weight, backgroundColor: theme.bgTransparent,
        fill: true, tension: 0.3, pointRadius: 3,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { grace: '5%' } }
    }
  });
}

// ===== AI 每日报告 (模块四) =====
async function generateDailyReport() {
  const apiKey = $('apiKey').value.trim();
  const model = $('modelName').value.trim();
  const apiBase = $('apiBase').value.trim().replace(/\/+$/, '');
  if (!apiKey || !model) { showToast('请先配置API Key和模型'); return; }

  const date = dateStr(currentDayOffset);
  const meals = JSON.parse(acGet(SK.meals) || '{}');
  const dayMeals = meals[date] || [];
  if (!dayMeals.length) { showToast('今日暂无饮食记录'); return; }

  const profile = getProfile() || {};
  const totalCal = dayMeals.reduce((s, m) => s + m.nutrition.cal, 0);
  const totalPro = dayMeals.reduce((s, m) => s + m.nutrition.pro, 0);
  const totalFat = dayMeals.reduce((s, m) => s + m.nutrition.fat, 0);
  const totalCarb = dayMeals.reduce((s, m) => s + m.nutrition.carb, 0);

  // 构建食物清单文本
  const mealTexts = dayMeals.map(m => {
    const names = m.foods.map(f => f.name + '(' + (f.estimated_weight_g||100) + 'g)').join('、');
    const labels = {breakfast:'早餐', lunch:'午餐', dinner:'晚餐', snack:'加餐'};
    return (labels[m.mealType] || '餐') + ': ' + names + ' 小计' + m.nutrition.cal + '千卡';
  });

  const prompt = `你是专业营养师。根据以下数据生成每日饮食分析报告。

【用户档案】${profile.gender==='female'?'女':'男'} ${profile.age||'?'}岁 ${profile.height||'?'}cm ${profile.weight||'?'}kg 目标${profile.targetWeight||'?'}kg BMI${profile.bmi||'?'} BMR${profile.bmr||'?'} TDEE${profile.tdee||'?'} 每日目标${profile.dailyTarget||'?'}千卡

【今日饮食】
${mealTexts.join('\n')}
总摄入: ${totalCal}千卡 | 蛋白${totalPro}g | 脂肪${totalFat}g | 碳水${totalCarb}g

请返回JSON:
{"overall_score":85,"balance_score":80,"calorie_pct":92,"protein_pct":78,"alerts":["蛋白质不足","膳食纤维偏低"],"summary":"今日总结一句话","advice":"今日建议","tomorrow":"明日计划"}`;

  const btn = $('reportBtn'); const area = $('reportArea');
  btn.disabled = true; btn.textContent = 'AI分析中…';
  area.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">⏳ AI正在生成分析报告…</div>';

  try {
    const url = apiBase + '/chat/completions';
    const body = { model, temperature: 0, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] };
    const resp = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify(body),
    });
    if (!resp.ok) { const e = await resp.text(); throw new Error('API失败: ' + e.substring(0, 200)); }
    const rj = await resp.json();
    let raw = rj.choices?.[0]?.message?.content || '';
    raw = raw.replace(/<\|begin_of_box\|>/g, '').replace(/<\|end_of_box\|>/g, '');
    // 解析
    let data = null;
    try { data = JSON.parse(raw); } catch {
      const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (m) { try { data = JSON.parse(m[1]); } catch {} }
      if (!data) { const s = raw.indexOf('{'), e = raw.lastIndexOf('}'); if (s>=0 && e>s) try { data = JSON.parse(raw.substring(s, e+1)); } catch {} }
    }

    if (!data) { area.innerHTML = '<div style="color:#999;font-size:13px;">AI返回了非结构化内容</div>'; return; }

    const alertsHTML = (data.alerts || []).map(a => '<div class="report-alert">⚠️ ' + a + '</div>').join('');
    const calPct = data.calorie_pct || Math.round(totalCal / (profile.dailyTarget || 2000) * 100);
    area.innerHTML = `<div class="report-card">
      <div class="twin-title">📋 每日饮食分析报告 ${'· ' + formatDate(date)}</div>
      <div class="report-score-row">
        <div class="report-score"><div class="num">${data.overall_score||'--'}</div><div class="label">综合评分</div></div>
        <div class="report-score"><div class="num">${data.balance_score||'--'}</div><div class="label">均衡评分</div></div>
        <div class="report-score"><div class="num">${calPct}%</div><div class="label">热量完成</div></div>
        <div class="report-score"><div class="num">${data.protein_pct||'--'}%</div><div class="label">蛋白达标</div></div>
      </div>
      ${alertsHTML}
      ${data.summary ? '<div class="report-text"><b>📝 总结：</b>' + data.summary + '</div>' : ''}
      ${data.advice ? '<hr class="report-divider"><div class="report-text"><b>💡 建议：</b>' + data.advice + '</div>' : ''}
      ${data.tomorrow ? '<div class="report-text" style="margin-top:4px;"><b>📅 明日：</b>' + data.tomorrow + '</div>' : ''}
    </div>`;
  } catch (err) {
    console.error('报告生成失败:', err);
    area.innerHTML = '<div style="color:#E60012;font-size:13px;">❌ 报告生成失败: ' + err.message.substring(0, 100) + '</div>';
  } finally {
    btn.disabled = false; btn.textContent = '🤖 AI 生成每日报告';
  }
}

// ===== 数字健康孪生 (模块七) =====
function renderDigitalTwin() {
  const meals = JSON.parse(acGet(SK.meals) || '{}');
  const wtLog = JSON.parse(acGet(SK.weightLog) || '[]');
  const profile = getProfile();
  const dates = Object.keys(meals).sort();
  const recentDates = dates.slice(-14);
  if (!profile || recentDates.length < 3) {
    $('twinSummary').textContent = '需要至少3天饮食数据（最好7天以上）';
    $('twinBig').innerHTML = '--<span></span>';
    $('twinPred').innerHTML = '';
    $('twinBarWrap').style.display = 'none';
    $('twinNote').textContent = '';
    return;
  }

  // 计算每日摄入 vs TDEE
  let totalDeficit = 0, days = 0;
  recentDates.forEach(d => {
    const dayMeals = meals[d] || [];
    const cal = dayMeals.reduce((s, m) => s + m.nutrition.cal, 0);
    if (cal > 100) { totalDeficit += (profile.dailyTarget - cal); days++; }
  });
  if (days < 3) { $('twinSummary').textContent = '有效饮食数据不足'; return; }

  const avgDeficit = Math.round(totalDeficit / days); // 日均热量差(负数=超标)
  const kgPerDay = avgDeficit / 7700; // 7700千卡≈1kg
  const kg30 = Math.round(kgPerDay * 30 * 10) / 10;
  const kg90 = Math.round(kgPerDay * 90 * 10) / 10;
  const currentWt = profile.weight || 65;
  const wt30 = Math.round((currentWt + kg30) * 10) / 10;
  const wt90 = Math.round((currentWt + kg90) * 10) / 10;
  const targetWt = profile.targetWeight || 60;
  const kgToGoal = currentWt - targetWt;
  const daysToGoal = kgPerDay !== 0 ? Math.round(Math.abs(kgToGoal / kgPerDay)) : null;

  // 体重趋势 (从wtLog验证)
  let wtTrend = kgPerDay;
  if (wtLog.length >= 5) {
    const recentWt = wtLog.slice(-5);
    const firstWt = recentWt[0].weight;
    const lastWt = recentWt[recentWt.length - 1].weight;
    // 估算天数差
    const firstDate = new Date(recentWt[0].date);
    const lastDate = new Date(recentWt[recentWt.length - 1].date);
    const dayDiff = Math.max(1, Math.round((lastDate - firstDate) / 86400000));
    wtTrend = (lastWt - firstWt) / dayDiff;
  }
  // 综合trend和intake trend
  const blendedTrend = wtTrend * 0.4 + kgPerDay * 0.6;

  const losing = blendedTrend < -0.02;
  const stable = Math.abs(blendedTrend) <= 0.02;
  const arrow = losing ? '📉' : stable ? '➡️' : '📈';
  const verb = losing ? '下降' : stable ? '保持稳定' : '上升';
  const trendDesc = losing || blendedTrend > 0.02
    ? '约' + Math.abs(Math.round(blendedTrend * 1000) / 10) + 'kg/月'
    : '体重稳定';

  $('twinSummary').textContent = '基于近' + days + '天饮食数据 · 日均热量' + (avgDeficit >= 0 ? '缺口' : '超标') + Math.abs(avgDeficit) + '千卡';
  $('twinBig').innerHTML = arrow + ' ' + verb + '<span> · ' + trendDesc + '</span>';

  let predHTML = '';
  if (!stable) {
    const preds = [
      { label: '30天后体重', val: wt30 + 'kg', detail: (kg30 <= 0 ? '' : '+') + kg30 + 'kg' },
      { label: '90天后体重', val: wt90 + 'kg', detail: (kg90 <= 0 ? '' : '+') + kg90 + 'kg' },
    ];
    predHTML = preds.map(p => '<div class="twin-pred-item"><div class="val">' + p.val + '</div><div class="lbl">' + p.label + ' (' + p.detail + ')</div></div>').join('');
  }

  let goalHTML = '';
  if (daysToGoal && daysToGoal > 0 && daysToGoal < 365 && kgToGoal > 0 && blendedTrend < -0.01) {
    const pct = Math.min(100, Math.round(days / daysToGoal * 100));
    goalHTML = '<div style="margin-top:10px;font-size:12px;">🏁 预计<strong>' + daysToGoal + '天</strong>后达到目标体重' + targetWt + 'kg（已完成' + pct + '%）</div>';
    $('twinBarWrap').style.display = '';
    $('twinBar').style.width = pct + '%';
  } else if (blendedTrend >= -0.01 && kgToGoal > 0) {
    goalHTML = '<div style="margin-top:10px;font-size:12px;">⚠️ 当前趋势下难以达到目标体重，建议调整饮食</div>';
    $('twinBarWrap').style.display = 'none';
  } else if (kgToGoal <= 0) {
    goalHTML = '<div style="margin-top:10px;font-size:12px;">🎉 已达成目标体重！保持当前习惯</div>';
    $('twinBarWrap').style.display = 'none';
  } else {
    $('twinBarWrap').style.display = 'none';
  }

  $('twinPred').innerHTML = predHTML;
  $('twinNote').innerHTML = goalHTML;
  if (!predHTML) $('twinPred').innerHTML = '<div style="grid-column:1/-1;text-align:center;opacity:0.6;font-size:13px;padding:12px;">当前饮食与消耗基本平衡<br>体重将保持稳定</div>';
}

// ===== AI助手页 =====
let trendChart = null, currentTrend = 'cal';

function renderAssistantPage() {
  renderWeeklyDash();
  renderDetailedDashboard();
  renderHealthAlerts();
  renderTrendChart();
}

// 本周营养概览
function renderWeeklyDash() {
  const meals = JSON.parse(acGet(SK.meals) || '{}');
  const dates = Object.keys(meals).sort();
  const today = todayStr();
  // 找本周的日期 (最近7天)
  const recent7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    recent7.push(ds);
  }
  const weekDays = recent7.filter(d => d in meals);
  const profile = getProfile();
  const target = profile ? profile.dailyTarget : 2000;

  let totalCal = 0, totalPro = 0, loggedDays = 0;
  weekDays.forEach(d => {
    const day = meals[d];
    const cal = day.reduce((s, m) => s + m.nutrition.cal, 0);
    if (cal > 50) { totalCal += cal; totalPro += day.reduce((s, m) => s + m.nutrition.pro, 0); loggedDays++; }
  });
  const avgCal = loggedDays > 0 ? Math.round(totalCal / loggedDays) : 0;
  const avgPro = loggedDays > 0 ? Math.round(totalPro / loggedDays) : 0;
  const calCompliance = target > 0 ? Math.round(avgCal / target * 100) : 0;
  const streak = calcStreak(meals);

  $('weeklyDash').innerHTML = `
    <div class="dash-item"><div class="dash-val">${loggedDays}</div><div class="dash-lbl">本周记录天数</div><div class="dash-sub">共${weekDays.length}天有数据</div></div>
    <div class="dash-item"><div class="dash-val">${avgCal}</div><div class="dash-lbl">日均热量 (千卡)</div><div class="dash-sub">目标${target}千卡 · ${calCompliance}%</div></div>
    <div class="dash-item"><div class="dash-val">${streak}</div><div class="dash-lbl">连续记录 (天)</div><div class="dash-sub">最长连续打卡</div></div>
    <div class="dash-item"><div class="dash-val">${avgPro}g</div><div class="dash-lbl">日均蛋白质</div><div class="dash-sub">推荐${profile?profile.proTarget:'--'}g/天</div></div>
  `;
}

function calcStreak(meals) {
  let streak = 0, maxStreak = 0;
  const today = new Date();
  for (let i = 90; i >= 0; i--) {
    const d = new Date(); d.setDate(today.getDate() - i);
    const ds = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    if (meals[ds] && meals[ds].reduce((s, m) => s + m.nutrition.cal, 0) > 50) {
      streak++;
      if (streak > maxStreak) maxStreak = streak;
    } else { streak = 0; }
  }
  return maxStreak;
}

// 趋势图
function switchTrend(type) {
  currentTrend = type;
  document.querySelectorAll('.trend-tab').forEach(b => {
    b.classList.toggle('sel', b.textContent.includes({cal:'热量', weight:'体重', macro:'营养素'}[type]));
  });
  renderTrendChart();
}

function renderTrendChart() {
  const theme = getChartTheme();
  const ctx = document.getElementById('trendChart').getContext('2d');
  if (trendChart) trendChart.destroy();

  const meals = JSON.parse(acGet(SK.meals) || '{}');
  const wtLog = JSON.parse(acGet(SK.weightLog) || '[]');

  // 取最近30天
  const dates = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    dates.push(d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'));
  }
  const labels = dates.map(formatDate);

  if (currentTrend === 'cal') {
    const calData = dates.map(d => {
      const day = meals[d] || [];
      return day.reduce((s, m) => s + m.nutrition.cal, 0) || null;
    });
    trendChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: '热量 (千卡)',
          data: calData,
          backgroundColor: calData.map(v => v === null ? 'transparent' : (v > 2200 ? 'rgba(230,0,18,0.5)' : 'rgba(230,0,18,0.2)')),
          borderColor: theme.cal, borderWidth: 1,
        }]
      },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, title: { display: true, text: '千卡' } } }
      }
    });
  } else if (currentTrend === 'weight') {
    const wtMap = {};
    wtLog.forEach(e => { wtMap[e.date] = e.weight; });
    const wtData = dates.map(d => wtMap[d] || null);
    trendChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: '体重 (kg)',
          data: wtData,
          borderColor: theme.weight, backgroundColor: theme.bgTransparent,
          fill: true, tension: 0.3, pointRadius: 2, spanGaps: false,
        }]
      },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { grace: '5%', title: { display: true, text: 'kg' } } }
      }
    });
  } else {
    const proData = dates.map(d => { const day = meals[d] || []; const v = day.reduce((s, m) => s + m.nutrition.pro, 0); return v || null; });
    const fatData = dates.map(d => { const day = meals[d] || []; const v = day.reduce((s, m) => s + m.nutrition.fat, 0); return v || null; });
    const carbData = dates.map(d => { const day = meals[d] || []; const v = day.reduce((s, m) => s + m.nutrition.carb, 0); return v || null; });
    trendChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: '蛋白(g)', data: proData, borderColor: theme.protein, tension: 0.3, pointRadius: 1, spanGaps: true },
          { label: '脂肪(g)', data: fatData, borderColor: theme.fat, tension: 0.3, pointRadius: 1, spanGaps: true },
          { label: '碳水(g)', data: carbData, borderColor: theme.carb, tension: 0.3, pointRadius: 1, spanGaps: true },
        ]
      },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
        scales: { y: { title: { display: true, text: 'g' } } }
      }
    });
  }
}

// AI聊天
function askHint(q) { $('chatInput').value = q; askAI(); }

async function askAI() {
  const q = ($('chatInput').value || '').trim();
  if (!q) return;
  const apiKey = $('apiKey').value.trim();
  const model = $('modelName').value.trim();
  const apiBase = $('apiBase').value.trim().replace(/\/+$/, '');
  if (!apiKey || !model) { showToast('请先配置API'); return; }

  const msgs = $('chatMsgs');
  // 添加用户消息
  const userDiv = document.createElement('div');
  userDiv.className = 'chat-msg user';
  userDiv.innerHTML = '<div class="avatar">👤</div><div class="bubble">' + q.replace(/</g,'&lt;') + '</div>';
  msgs.appendChild(userDiv);

  // 添加加载中
  const loadDiv = document.createElement('div');
  loadDiv.className = 'chat-loading';
  loadDiv.innerHTML = '🤖 思考中<span class="dot-ani">.</span><span class="dot-ani">.</span><span class="dot-ani">.</span>';
  loadDiv.id = 'chatLoading';
  msgs.appendChild(loadDiv);

  // 隐藏hint
  const hints = $('chatHints');
  if (hints) hints.style.display = 'none';

  $('chatInput').value = '';
  msgs.scrollTop = msgs.scrollHeight;

  // 构建上下文
  const profile = getProfile();
  const meals = JSON.parse(acGet(SK.meals) || '{}');
  const today = todayStr();
  const dayMeals = meals[today] || [];
  const todayCal = dayMeals.reduce((s, m) => s + m.nutrition.cal, 0);
  const todayPro = dayMeals.reduce((s, m) => s + m.nutrition.pro, 0);

  let ctxText = '';
  if (profile) ctxText += '用户: ' + (profile.gender==='female'?'女':'男') + ' ' + profile.age + '岁 ' + profile.height + 'cm ' + profile.weight + 'kg 目标' + profile.targetWeight + 'kg BMI' + profile.bmi + ' 每日目标' + profile.dailyTarget + '千卡。';
  if (dayMeals.length > 0) {
    const mealNames = dayMeals.map(m => m.foods.map(f => f.name).join('+')).join('; ');
    ctxText += '今日已吃: ' + mealNames + ' 共' + todayCal + '千卡 蛋白' + todayPro + 'g。';
  } else {
    ctxText += '今日暂无饮食记录。';
  }
  if (profile && profile.preferences) ctxText += '偏好/忌口: ' + profile.preferences + '。';

  try {
    const url = apiBase + '/chat/completions';
    const body = {
      model, temperature: 0.3, max_tokens: 800,
      messages: [
        { role: 'system', content: `你是「随食一拍」的AI营养师。你有权限访问用户的健康档案和饮食记录。

【回答范围】
✅ 核心领域（充分发挥）：饮食营养、热量管理、体重管理、食物推荐、运动健身、增肌减脂、健康习惯、营养素分析、食谱规划。
✅ 边界可关联（从饮食角度切入）：情绪困扰→推荐舒缓心情的食物（如黑巧克力、香蕉）；压力大→建议镁/维B丰富的食物；失恋/失眠→推荐助眠安神的饮食方案；天气热→推荐补水消暑食物。
❌ 硬性拒绝（简短委婉）：政治、宗教、军事、违法、投资理财、医疗诊断、心理咨询、情感指导、编程技术、非饮食相关的生活建议。

【回答风格】用中文，2-5句话。尽量引用用户实际数据（热量、蛋白、体重等），给出可操作建议。适当用emoji。

【拒绝模板】当遇到应拒绝的问题时，简短回复："抱歉，我是营养健康助手，这方面给不了专业建议～需要我根据你的饮食记录，推荐一些适合当前状态的食物吗？"` },
        { role: 'user', content: ctxText + '\n\n用户问题: ' + q }
      ]
    };
    const resp = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify(body),
    });
    if (!resp.ok) { const e = await resp.text(); throw new Error(e.substring(0, 200)); }
    const rj = await resp.json();
    const answer = rj.choices?.[0]?.message?.content || '抱歉，我没能回答这个问题。';

    loadDiv.remove();
    const aiDiv = document.createElement('div');
    aiDiv.className = 'chat-msg ai';
    aiDiv.innerHTML = '<div class="avatar">🤖</div><div class="bubble">' + answer + '</div>';
    msgs.appendChild(aiDiv);
  } catch (err) {
    loadDiv.remove();
    const errDiv = document.createElement('div');
    errDiv.className = 'chat-msg ai';
    errDiv.innerHTML = '<div class="avatar">🤖</div><div class="bubble" style="color:#E60012;">抱歉，出了点问题：' + err.message.substring(0, 80) + '</div>';
    msgs.appendChild(errDiv);
  }
  msgs.scrollTop = msgs.scrollHeight;
}

// ===== Nav status (写入页面subtitle) =====
function updateNavStatus() {
  const date = todayStr();
  const meals = JSON.parse(acGet(SK.meals) || '{}');
  const dayMeals = meals[date] || [];
  const totalCal = dayMeals.reduce((s, m) => s + m.nutrition.cal, 0);
  const profile = getProfile();
  const brandSub = document.querySelector('.camera-brand .brand-sub');
  if (profile) {
    const pct = profile.dailyTarget > 0 ? Math.round(totalCal / profile.dailyTarget * 100) : 0;
    if (brandSub) brandSub.textContent = '🔥 ' + totalCal + '/' + profile.dailyTarget + '千卡 (' + pct + '%)';
  } else {
    if (brandSub) brandSub.textContent = dayMeals.length > 0 ? '🔥 今日 ' + totalCal + '千卡' : '心を盗む · 营养即正义';
  }
}

// ===== 拖拽 & 粘贴 =====
const uz = $('uploadZone');
['dragover','dragenter'].forEach(e => uz.addEventListener(e, ev => { ev.preventDefault(); uz.style.borderColor = 'var(--color-primary)'; }));
['dragleave','drop'].forEach(e => uz.addEventListener(e, () => { uz.style.borderColor = ''; }));
uz.addEventListener('drop', e => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f?.type.startsWith('image/')) { const dt = new DataTransfer(); dt.items.add(f); $('fileInput').files = dt.files; handleFile($('fileInput')); }
});
document.addEventListener('paste', e => {
  for (const item of (e.clipboardData?.items || [])) {
    if (item.type.startsWith('image/')) {
      const f = item.getAsFile(); const dt = new DataTransfer(); dt.items.add(f);
      $('fileInput').files = dt.files; handleFile($('fileInput')); break;
    }
  }
});

// ========================================
// 公共健康分析引擎 (模块八、九、十一、十四共用)
// ========================================
function analyzeHealth() {
  const meals = JSON.parse(acGet(SK.meals) || '{}');
  const profile = getProfile();
  const dates = Object.keys(meals).sort();
  const alerts = [];
  const risks = [];
  const gaps = {};

  if (!profile || dates.length < 3) {
    return { alerts: [], risks: [], gaps: null, dashboard: null, ready: false };
  }

  const recentDates = dates.slice(-30);
  const today = todayStr();

  // ── 基础统计 ──
  let totalDays = 0, totalCal = 0, totalPro = 0, totalFat = 0, totalCarb = 0;
  let mealTypeTotals = { breakfast: [], lunch: [], dinner: [], snack: [] };
  let veggieDays = 0, highFatDays = 0, highSodiumDays = 0, highSugarDays = 0;
  let missingDays = 0, recentMissing = 0;

  // 检查最近30天的每一天
  const checkDates = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    checkDates.push(d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'));
  }

  checkDates.forEach(d => {
    const day = meals[d] || [];
    if (day.length === 0) { missingDays++; return; }
    const dayCal = day.reduce((s, m) => s + m.nutrition.cal, 0);
    const dayPro = day.reduce((s, m) => s + m.nutrition.pro, 0);
    const dayFat = day.reduce((s, m) => s + m.nutrition.fat, 0);
    const dayCarb = day.reduce((s, m) => s + m.nutrition.carb, 0);
    if (dayCal < 50) { missingDays++; return; }

    totalDays++;
    totalCal += dayCal; totalPro += dayPro; totalFat += dayFat; totalCarb += dayCarb;

    // 按餐类统计
    day.forEach(m => {
      const mt = m.mealType;
      if (mt && mealTypeTotals[mt] !== undefined) {
        mealTypeTotals[mt].push(m.nutrition.cal);
      }
    });

    // 蔬菜检测
    const hasVeggie = day.some(m => m.foods.some(f => {
      const cat = (f.category || '').toLowerCase();
      return cat.includes('蔬菜') || /菜|兰|菇|藻/.test(f.name);
    }));
    if (hasVeggie) veggieDays++;

    // 高脂检测: 脂肪供能比 > 35%
    if (dayFat * 9 / dayCal > 0.35) highFatDays++;
    // 高钠检测: 加工食品/酱料/炸食 (用脂肪+零食近似)
    const hasHighNa = day.some(m => m.foods.some(f => {
      const cat = (f.category || '').toLowerCase();
      return cat.includes('零食') || f.name.includes('酱') || f.name.includes('炸') || f.name.includes('薯') || f.name.includes('饼');
    }));
    if (hasHighNa) highSodiumDays++;
    // 高糖检测: 零食+饮品+甜品
    const hasHighSugar = day.some(m => m.foods.some(f => {
      const cat = (f.category || '').toLowerCase();
      return cat.includes('零食') || cat.includes('饮品') || f.name.includes('糖') || f.name.includes('奶茶') || f.name.includes('可乐');
    }));
    if (hasHighSugar) highSugarDays++;
  });

  // 最近7天缺失
  const recent7 = checkDates.slice(-7);
  recent7.forEach(d => {
    const day = meals[d] || [];
    const dayCal = day.reduce((s, m) => s + m.nutrition.cal, 0);
    if (dayCal < 50) recentMissing++;
  });

  if (totalDays < 1) {
    return { alerts: [], risks: [], gaps: null, dashboard: null, ready: false };
  }

  const avgCal = Math.round(totalCal / totalDays);
  const avgPro = Math.round(totalPro / totalDays);
  const avgFat = Math.round(totalFat / totalDays);
  const avgCarb = Math.round(totalCarb / totalDays);
  const calCompliance = profile.dailyTarget > 0 ? Math.round(avgCal / profile.dailyTarget * 100) : 0;

  // ── 缺口计算 ──
  gaps.protein_g = Math.max(0, (profile.proTarget || 60) - avgPro);
  gaps.calorie_deficit = (profile.dailyTarget || 2000) - avgCal;
  gaps.fiber_risk = veggieDays < totalDays * 0.5;

  // ── Agent 警报 (模块八) ──
  if (totalDays >= 3 && recentMissing >= 3) {
    alerts.push({ type: 'missing', severity: 'warn', icon: '📭', title: '连续' + recentMissing + '天未记录', detail: '最近7天内有' + recentMissing + '天没有饮食数据，恢复记录才能获得准确的健康分析' });
  }
  if (totalDays >= 7 && avgPro < (profile.proTarget || 60) * 0.7) {
    alerts.push({ type: 'protein_low', severity: 'warn', icon: '🥚', title: '蛋白质持续不足', detail: '近' + totalDays + '天日均蛋白仅' + avgPro + 'g，远低于推荐的' + (profile.proTarget || 60) + 'g/天。建议增加蛋类、鸡胸肉、豆制品' });
  }
  if (totalDays >= 7 && calCompliance > 110) {
    alerts.push({ type: 'cal_over', severity: 'warn', icon: '🔥', title: '热量持续超标', detail: '近' + totalDays + '天日均摄入' + avgCal + '千卡，超出目标' + calCompliance + '%。建议控制主食和油脂摄入' });
  }
  if (totalDays >= 5 && veggieDays < totalDays * 0.4) {
    alerts.push({ type: 'fiber_low', severity: 'info', icon: '🥬', title: '蔬菜摄入偏少', detail: '近' + totalDays + '天中仅' + veggieDays + '天有蔬菜记录，纤维摄入可能不足。建议每天至少吃一份绿叶蔬菜' });
  }
  if (totalDays >= 5 && highSodiumDays > totalDays * 0.4) {
    alerts.push({ type: 'sodium_high', severity: 'info', icon: '🧂', title: '高钠食物频率偏高', detail: '加工食品/酱料/油炸类占比较高，长期可能影响血压。建议减少酱料、多选清淡烹饪' });
  }

  // ── 风险预警 (模块十一) ──
  if (totalDays >= 10 && veggieDays < totalDays * 0.3) {
    risks.push({ type: 'fiber_deficit', level: 'risk', icon: '🥦', title: '膳食纤维长期不足', detail: '近30天仅' + veggieDays + '天有蔬菜记录，膳食纤维长期不足可能增加消化问题和慢性病风险', advice: '尝试每餐搭配一份蔬菜，每天至少摄入300g蔬菜' });
  }
  if (totalDays >= 10 && highFatDays > totalDays * 0.5) {
    risks.push({ type: 'high_fat', level: 'warn', icon: '🥑', title: '脂肪摄入占比偏高', detail: '近30天有' + highFatDays + '天脂肪供能比>35%，长期高脂饮食可能影响心血管健康', advice: '减少油炸食品和肥肉，选择清蒸、水煮等低脂烹饪方式' });
  }
  if (totalDays >= 10 && highSugarDays > totalDays * 0.4) {
    risks.push({ type: 'high_sugar', level: 'warn', icon: '🍬', title: '高糖食物频率偏高', detail: '零食/饮品/甜品出现频率较高，长期高糖可能增加肥胖和代谢疾病风险', advice: '用水果替代甜食，选择无糖饮品，每周甜食控制在2次以内' });
  }
  if (totalDays >= 10 && highSodiumDays > totalDays * 0.5) {
    risks.push({ type: 'high_sodium', level: 'warn', icon: '🧂', title: '钠摄入可能偏高', detail: '加工食品和酱料出现频率较高，长期高钠可能影响血压', advice: '减少酱料用量，少吃加工食品，多喝水帮助钠排出' });
  }
  if (totalDays >= 14 && missingDays > totalDays * 0.3) {
    risks.push({ type: 'irregular', level: 'info', icon: '📅', title: '饮食记录不规律', detail: '近30天有' + missingDays + '天无记录，数据不足影响分析准确性', advice: '养成每日记录习惯，完整的饮食数据是健康管理的基础' });
  }

  // ── 仪表盘数据 (模块十四) ──
  const totalCalFromFat = avgFat * 9;
  const totalCalFromCarb = avgCarb * 4;
  const totalCalFromPro = avgPro * 4;
  const totalCalMacro = totalCalFromFat + totalCalFromCarb + totalCalFromPro;
  const fatPct = totalCalMacro > 0 ? Math.round(totalCalFromFat / totalCalMacro * 100) : 0;
  const carbPct = totalCalMacro > 0 ? Math.round(totalCalFromCarb / totalCalMacro * 100) : 0;
  const proPct = totalCalMacro > 0 ? Math.round(totalCalFromPro / totalCalMacro * 100) : 0;

  // 餐类占比
  const mealCalAvg = {};
  for (const [mt, cals] of Object.entries(mealTypeTotals)) {
    mealCalAvg[mt] = cals.length > 0 ? Math.round(cals.reduce((a, b) => a + b, 0) / cals.length) : 0;
  }

  // 连续打卡
  let streak = 0;
  for (let i = 29; i >= 0; i--) {
    const d = checkDates[i];
    const day = meals[d] || [];
    const dayCal = day.reduce((s, m) => s + m.nutrition.cal, 0);
    if (dayCal >= 50) streak++;
    else break;
  }

  // 达标天数
  let compliantDays = 0;
  checkDates.forEach(d => {
    const day = meals[d] || [];
    const dayCal = day.reduce((s, m) => s + m.nutrition.cal, 0);
    if (dayCal >= 50) {
      const pct = dayCal / (profile.dailyTarget || 2000) * 100;
      if (pct >= 80 && pct <= 110) compliantDays++;
    }
  });

  const dashboard = {
    totalDays, avgCal, avgPro, avgFat, avgCarb,
    calCompliance, fatPct, carbPct, proPct,
    mealCalAvg, streak, compliantDays,
    veggieDays, highFatDays, highSodiumDays, highSugarDays, missingDays,
  };

  return { alerts, risks, gaps, dashboard, ready: true };
}

// ========================================
// 模块十四: 详细数据分析仪表盘
// ========================================
function renderDetailedDashboard() {
  const container = $('detailedDash');
  if (!container) return;

  const result = analyzeHealth();
  if (!result.ready) {
    container.innerHTML = '<div style="text-align:center;color:var(--text-secondary);font-size:13px;padding:16px;">需要至少3天饮食数据才能生成详细报告</div>';
    return;
  }

  const d = result.dashboard;

  // 热量构成解释
  const calTips = [];
  if (d.fatPct > 30) calTips.push('<span style="color:#E60012;">脂肪比偏高</span>');
  if (d.carbPct > 65) calTips.push('<span style="color:#FFD700;">碳水比偏高</span>');
  if (d.proPct < 15) calTips.push('<span style="color:#E60012;">蛋白质比偏低</span>');
  if (calTips.length === 0) calTips.push('<span style="color:#FFFFFF;">供能比例良好</span>');

  const mealCalRow = ['breakfast', 'lunch', 'dinner', 'snack']
    .map(mt => {
      const labels = {breakfast:'🌅早餐', lunch:'☀️午餐', dinner:'🌙晚餐', snack:'🍪加餐'};
      const cal = d.mealCalAvg[mt] || 0;
      const barW = d.avgCal > 0 ? Math.min(100, Math.round(cal / d.avgCal * 100)) : 0;
      const color = mt === 'dinner' && cal > d.avgCal * 0.45 ? '#E60012' : '#FF1A2D';
      return '<div class="meal-cal-item"><div class="meal-cal-label">' + labels[mt] + '</div><div class="meal-cal-bar-wrap"><div class="meal-cal-bar" style="width:' + barW + '%;background:' + color + ';"></div></div><div class="meal-cal-val">' + cal + '千卡</div></div>';
    }).join('');

  container.innerHTML = `
    <div class="dash-grid" style="margin-bottom:14px;">
      <div class="dash-item"><div class="dash-val">${d.totalDays}</div><div class="dash-lbl">统计天数</div><div class="dash-sub">近30天有效记录</div></div>
      <div class="dash-item"><div class="dash-val">${d.compliantDays}</div><div class="dash-lbl">达标天数</div><div class="dash-sub">热量80%-110%目标</div></div>
      <div class="dash-item"><div class="dash-val">${d.streak}</div><div class="dash-lbl">连续打卡</div><div class="dash-sub">最长连续记录</div></div>
      <div class="dash-item"><div class="dash-val">${d.veggieDays}/${d.totalDays}</div><div class="dash-lbl">蔬菜覆盖</div><div class="dash-sub">有蔬菜记录的天数</div></div>
    </div>

    <div class="macro-bar-card">
      <div class="macro-bar-title">📊 热量来源结构 ${calTips.map(t => '· '+t).join('')}</div>
      <div class="macro-bar-row">
        <div class="macro-bar-seg" style="width:${d.proPct}%;background:#E60012;" title="蛋白质 ${d.proPct}%"></div>
        <div class="macro-bar-seg" style="width:${d.fatPct}%;background:#FF1A2D;" title="脂肪 ${d.fatPct}%"></div>
        <div class="macro-bar-seg" style="width:${d.carbPct}%;background:#FFD700;" title="碳水 ${d.carbPct}%"></div>
      </div>
      <div class="macro-bar-legend">
        <span>🥚 蛋白${d.proPct}%</span>
        <span>🥑 脂肪${d.fatPct}%</span>
        <span>🌾 碳水${d.carbPct}%</span>
      </div>
    </div>

    <div class="meal-cal-section">
      <div class="macro-bar-title" style="margin-top:10px;">🍽 各餐热量对比</div>
      ${mealCalRow}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px;">
      <div class="risk-indicator ${d.highFatDays > d.totalDays * 0.4 ? 'warn' : 'ok'}">
        <div class="risk-ind-val">${d.highFatDays}/${d.totalDays}</div>
        <div class="risk-ind-lbl">高脂天数</div>
      </div>
      <div class="risk-indicator ${d.highSugarDays > d.totalDays * 0.3 ? 'warn' : 'ok'}">
        <div class="risk-ind-val">${d.highSugarDays}/${d.totalDays}</div>
        <div class="risk-ind-lbl">高糖天数</div>
      </div>
      <div class="risk-indicator ${d.highSodiumDays > d.totalDays * 0.4 ? 'warn' : 'ok'}">
        <div class="risk-ind-val">${d.highSodiumDays}/${d.totalDays}</div>
        <div class="risk-ind-lbl">高钠天数</div>
      </div>
      <div class="risk-indicator ${d.missingDays > d.totalDays * 0.2 ? 'warn' : 'ok'}">
        <div class="risk-ind-val">${d.missingDays}天</div>
        <div class="risk-ind-lbl">无记录</div>
      </div>
    </div>
  `;
}

function toggleDashDetail() {
  const p = $('dashDetailPanel');
  if (!p) return;
  const isOpen = p.classList.toggle('open');
  if (isOpen) renderDetailedDashboard();
  const btn = document.getElementById('dashToggleBtn');
  if (btn) btn.textContent = isOpen ? '收起详细分析 ▲' : '展开详细分析 ▼';
}

// ========================================
// 模块八: AI主动健康Agent
// ========================================
function renderHealthAlerts() {
  const container = $('healthAgentAlerts');
  if (!container) return;

  const result = analyzeHealth();
  if (!result.ready) {
    container.innerHTML = '<div class="agent-empty">🤖 需要至少3天饮食数据，AI才能开始主动监测你的健康</div>';
    return;
  }

  const alerts = result.alerts;
  if (alerts.length === 0) {
    container.innerHTML = '<div class="agent-ok">✅ 近30天饮食状况良好，AI未检测到明显异常。继续坚持！</div>';
    return;
  }

  // 按严重度排序
  alerts.sort((a, b) => ({'warn':0,'info':1}[a.severity]||0) - ({'warn':0,'info':1}[b.severity]||0));

  const html = alerts.map(a => `
    <div class="agent-alert severity-${a.severity}">
      <div class="agent-alert-icon">${a.icon}</div>
      <div class="agent-alert-body">
        <div class="agent-alert-title">${a.title} <span class="agent-severity-tag tag-${a.severity}">${a.severity==='warn'?'⚠️ 注意':'ℹ️ 提醒'}</span></div>
        <div class="agent-alert-detail">${a.detail}</div>
      </div>
    </div>
  `).join('');

  container.innerHTML = '<div class="agent-summary">🔔 AI主动发现 <b>' + alerts.length + '</b> 个需要关注的问题</div>' + html;
}

// ========================================
// 模块十一: 健康风险预警
// ========================================
function renderRiskWarnings() {
  const container = $('riskWarnings');
  if (!container) return;

  const result = analyzeHealth();
  if (!result.ready) {
    container.innerHTML = '<div style="text-align:center;color:var(--text-secondary);font-size:12px;padding:12px;">需要至少10天饮食数据才能生成长周期风险分析</div>';
    return;
  }

  const risks = result.risks;
  if (risks.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:14px 0;">
        <div style="font-size:28px;">🛡️</div>
        <div style="font-size:13px;color:var(--text-secondary);margin-top:4px;">基于近30天数据，未检测到长期健康风险</div>
      </div>
      <div class="disclaimer">⚠️ 以上分析仅供参考，不能替代专业医疗诊断。如有健康疑虑，请咨询医生或注册营养师。</div>
    `;
    return;
  }

  const levelOrder = { risk: 0, warn: 1, info: 2 };
  risks.sort((a, b) => (levelOrder[a.level] || 9) - (levelOrder[b.level] || 9));

  const html = risks.map(r => `
    <div class="risk-item level-${r.level}">
      <div class="risk-item-icon">${r.icon}</div>
      <div class="risk-item-content">
        <div class="risk-item-title">
          ${r.title}
          <span class="risk-level-tag tag-${r.level}">${r.level==='risk'?'🔴 风险':r.level==='warn'?'🟡 警告':'🔵 注意'}</span>
        </div>
        <div class="risk-item-detail">${r.detail}</div>
        <div class="risk-item-advice">💡 ${r.advice}</div>
      </div>
    </div>
  `).join('');

  container.innerHTML = html + '<div class="disclaimer">⚠️ 以上分析仅供参考，不能替代专业医疗诊断。如有健康疑虑，请咨询医生或注册营养师。</div>';
}

// ========================================
// 模块九: 个性化美食推荐
// ========================================
let recoMealType = 'lunch';
let recoData = null;

function selectRecoMeal(type) {
  recoMealType = type;
  document.querySelectorAll('.reco-meal-btn').forEach(b => {
    b.classList.toggle('sel', b.dataset.meal === type);
  });
}

async function generateMealRecommendation() {
  const apiKey = $('apiKey').value.trim();
  const model = $('modelName').value.trim();
  const apiBase = $('apiBase').value.trim().replace(/\/+$/, '');
  if (!apiKey || !model) { showToast('请先配置API'); return; }

  const container = $('recoResults');
  if (!container) return;

  const btn = $('recoBtn');
  btn.disabled = true; btn.textContent = 'AI生成中…';
  container.innerHTML = '<div class="chat-loading" style="padding:10px 0;justify-content:center;">🤖 正在分析你的营养缺口<span class="dot-ani">.</span><span class="dot-ani">.</span><span class="dot-ani">.</span></div>';

  try {
    const result = analyzeHealth();
    const profile = getProfile() || {};
    const meals = JSON.parse(acGet(SK.meals) || '{}');
    const today = todayStr();
    const dayMeals = meals[today] || [];
    const todayCal = dayMeals.reduce((s, m) => s + m.nutrition.cal, 0);
    const todayPro = dayMeals.reduce((s, m) => s + m.nutrition.pro, 0);

    const mealLabels = {breakfast:'早餐', lunch:'午餐', dinner:'晚餐', snack:'加餐'};
    let ctx = '用户: ' + (profile.gender==='female'?'女':'男') + ' ' + profile.age + '岁 ' + profile.height + 'cm ' + profile.weight + 'kg';
    ctx += ' BMI' + profile.bmi + ' 每日目标' + profile.dailyTarget + '千卡 蛋白目标' + profile.proTarget + 'g。';
    if (todayCal > 50) {
      ctx += '今日已摄入' + todayCal + '千卡 蛋白' + todayPro + 'g。';
      const remaining = (profile.dailyTarget || 2000) - todayCal;
      ctx += '剩余额度约' + remaining + '千卡。';
    }
    if (profile.preferences) ctx += '偏好/忌口: ' + profile.preferences + '。';
    if (result.ready && result.gaps) {
      const g = result.gaps;
      ctx += '营养缺口分析: ';
      const gapList = [];
      if (g.protein_g > 10) gapList.push('蛋白质缺口' + g.protein_g + 'g');
      if (g.fiber_risk) gapList.push('膳食纤维可能不足');
      if (g.calorie_deficit < -200) gapList.push('热量已超标' + Math.abs(g.calorie_deficit) + '千卡');
      if (g.calorie_deficit > 500) gapList.push('热量缺口' + g.calorie_deficit + '千卡(可适当多吃)');
      ctx += gapList.length > 0 ? gapList.join('; ') : '各项指标正常';
      ctx += '。';
    }

    // 历史偏好
    let recentFoods = [];
    const allDates = Object.keys(meals).sort().slice(-14);
    allDates.forEach(d => {
      (meals[d] || []).forEach(m => m.foods.forEach(f => recentFoods.push(f.name)));
    });
    if (recentFoods.length > 0) {
      ctx += '近14天常吃: ' + [...new Set(recentFoods)].slice(0, 8).join('、') + '。';
    }

    const url = apiBase + '/chat/completions';
    const body = {
      model, temperature: 0.3, max_tokens: 600,
      messages: [
        { role: 'system', content: '你是专业营养师和美食推荐专家。根据用户营养缺口、口味偏好和历史饮食，推荐适合的下一餐。返回JSON: {"dishes":[{"name":"菜名","calories":热量千卡,"protein_g":蛋白克数,"reason":"为什么推荐"}, ...]}。推荐3道菜。给出具体菜名（如"鸡胸肉藜麦沙拉"而非"高蛋白食物"），热量要合理。' },
        { role: 'user', content: '用户需要为「' + (mealLabels[recoMealType] || '正餐') + '」推荐食物。\n\n用户数据: ' + ctx }
      ]
    };

    const resp = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify(body),
    });

    if (!resp.ok) { const e = await resp.text(); throw new Error(e.substring(0, 200)); }
    const rj = await resp.json();
    let raw = rj.choices?.[0]?.message?.content || '';
    raw = raw.replace(/<\|begin_of_box\|>/g, '').replace(/<\|end_of_box\|>/g, '');

    let data = null;
    try { data = JSON.parse(raw); } catch {
      const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (m) { try { data = JSON.parse(m[1]); } catch {} }
      if (!data) { const s = raw.indexOf('{'), e = raw.lastIndexOf('}'); if (s>=0 && e>s) try { data = JSON.parse(raw.substring(s, e+1)); } catch {} }
    }

    if (!data || !data.dishes || !data.dishes.length) {
      container.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;text-align:center;padding:12px;">AI返回了非结构化内容，请重试</div>';
      return;
    }

    const recosMealLabels = {breakfast:'早餐', lunch:'午餐', dinner:'晚餐', snack:'加餐'};
    const dishesHTML = data.dishes.map(d => `
      <div class="reco-dish">
        <div class="reco-dish-emoji">${getFoodEmoji(d.name, '')}</div>
        <div class="reco-dish-body">
          <div class="reco-dish-name">${d.name}</div>
          <div class="reco-dish-meta">🔥 ${d.calories||'?'}千卡 · 🥚 ${d.protein_g||'?'}g蛋白</div>
          <div class="reco-dish-reason">💡 ${d.reason||''}</div>
        </div>
      </div>
    `).join('');

    container.innerHTML = `
      <div class="reco-dish-list">
        ${dishesHTML}
      </div>
    `;

    recoData = data;
  } catch (err) {
    console.error('推荐失败:', err);
    container.innerHTML = '<div style="color:#E60012;font-size:13px;text-align:center;padding:8px;">❌ ' + err.message.substring(0, 100) + '</div>';
  } finally {
    btn.disabled = false; btn.textContent = '🤖 AI智能推荐';
  }
}

// ========================================
// 模块十二: 游戏化成长系统
// ========================================
const GAME_LEVELS = [
  { level: 1, title: '健康萌新', icon: '🌱', minScore: 0 },
  { level: 2, title: '饮食学徒', icon: '🥗', minScore: 100 },
  { level: 3, title: '饮食达人', icon: '💪', minScore: 300 },
  { level: 4, title: '健身达人', icon: '🏋️', minScore: 700 },
  { level: 5, title: '营养大师', icon: '🎓', minScore: 1500 },
  { level: 6, title: '健康教练', icon: '👑', minScore: 3000 },
];

const ACHIEVEMENTS = [
  { id: 'first_log', icon: '📝', title: '初次记录', desc: '完成第一次饮食记录', check: () => true },
  { id: 'streak_7', icon: '🔥', title: '连续7天', desc: '连续7天打卡', check: (gd) => (gd.streaks || []).some(s => s >= 7) },
  { id: 'streak_30', icon: '⚡', title: '月度坚守', desc: '连续30天打卡', check: (gd) => (gd.streaks || []).some(s => s >= 30) },
  { id: 'meals_100', icon: '🍽️', title: '百餐记录', desc: '累计记录100餐', check: (gd) => (gd.totalMeals || 0) >= 100 },
  { id: 'veggie_70', icon: '🥬', title: '蔬菜达人', desc: '蔬菜覆盖率>70%', check: (gd) => gd.veggiePct >= 70 },
  { id: 'protein_90', icon: '🥚', title: '蛋白达标', desc: '日均蛋白质达标率>90%', check: (gd) => gd.proCompliance >= 90 },
];

function loadGameData() {
  let gd = JSON.parse(acGet('ssyp_game') || '{}');
  if (!gd.totalScore) gd.totalScore = 0;
  if (!gd.history) gd.history = [];
  if (!gd.achievements) gd.achievements = [];
  if (!gd.streaks) gd.streaks = [];
  if (!gd.totalMeals) gd.totalMeals = 0;
  return gd;
}

function saveGameData(gd) {
  acSet('ssyp_game', JSON.stringify(gd));
}

function getLevelInfo(score) {
  let current = GAME_LEVELS[0];
  let next = GAME_LEVELS[1];
  for (let i = GAME_LEVELS.length - 1; i >= 0; i--) {
    if (score >= GAME_LEVELS[i].minScore) {
      current = GAME_LEVELS[i];
      next = GAME_LEVELS[i + 1] || null;
      break;
    }
  }
  const progress = next ? Math.round((score - current.minScore) / (next.minScore - current.minScore) * 100) : 100;
  return { current, next, progress };
}

function updateGameScore() {
  const gd = loadGameData();
  const today = todayStr();

  // 每天只计一次
  const already = gd.history.find(h => h.date === today);
  if (already) return gd;

  const meals = JSON.parse(acGet(SK.meals) || '{}');
  const dayMeals = meals[today] || [];
  const dayCal = dayMeals.reduce((s, m) => s + m.nutrition.cal, 0);
  const profile = getProfile();

  if (dayCal < 50) return gd; // 没记录

  let score = 10; // 基础打卡

  // 热量达标
  if (profile && dayCal >= profile.dailyTarget * 0.8 && dayCal <= profile.dailyTarget * 1.1) {
    score += 20;
  }

  // 3餐记录
  const mealTypes = new Set(dayMeals.map(m => m.mealType));
  if (mealTypes.size >= 3) score += 15;

  // 蔬菜
  const hasVeggie = dayMeals.some(m => m.foods.some(f => {
    const cat = (f.category || '').toLowerCase();
    return cat.includes('蔬菜') || /菜|兰|菇|藻/.test(f.name);
  }));
  if (hasVeggie) score += 5;

  // 连续7天检查
  const allDates = Object.keys(meals).sort();
  const todayIdx = allDates.indexOf(today);
  let streak = 0;
  if (todayIdx >= 0) {
    for (let i = todayIdx; i >= 0; i--) {
      const d = allDates[i];
      const expected = dateStr(i - todayIdx);
      if (d === expected && meals[d].reduce((s, m) => s + m.nutrition.cal, 0) >= 50) streak++;
      else break;
    }
  }
  if (streak > 0 && streak % 7 === 0) score += 50;

  // 更新累计
  gd.totalScore += score;
  gd.totalMeals = (gd.totalMeals || 0) + dayMeals.length;
  gd.history.push({ date: today, score, streak });

  // 记录streak
  if (!gd.streaks) gd.streaks = [];
  const lastStreak = gd.streaks.length > 0 ? gd.streaks[gd.streaks.length - 1] : 0;
  if (streak > lastStreak || gd.streaks.length === 0 || streak === 0) {
    gd.streaks.push(streak);
    if (gd.streaks.length > 10) gd.streaks.shift();
  }

  // 检测成就
  // 蔬菜覆盖率
  const allMeals = JSON.parse(acGet(SK.meals) || '{}');
  const allDates2 = Object.keys(allMeals).sort();
  let totalDays2 = 0, vegDays2 = 0;
  allDates2.forEach(d => {
    const day = allMeals[d] || [];
    if (day.reduce((s, m) => s + m.nutrition.cal, 0) >= 50) {
      totalDays2++;
      if (day.some(m => m.foods.some(f => {
        const cat = (f.category || '').toLowerCase();
        return cat.includes('蔬菜') || /菜|兰|菇|藻/.test(f.name);
      }))) vegDays2++;
    }
  });
  gd.veggiePct = totalDays2 > 0 ? Math.round(vegDays2 / totalDays2 * 100) : 0;

  // 蛋白达标率
  let proDays = 0, proOk = 0;
  if (profile) {
    allDates2.forEach(d => {
      const day = allMeals[d] || [];
      const dayCal = day.reduce((s, m) => s + m.nutrition.cal, 0);
      const dayPro = day.reduce((s, m) => s + m.nutrition.pro, 0);
      if (dayCal >= 50) {
        proDays++;
        if (dayPro >= profile.proTarget * 0.8) proOk++;
      }
    });
  }
  gd.proCompliance = proDays > 0 ? Math.round(proOk / proDays * 100) : 0;

  // 解锁成就
  ACHIEVEMENTS.forEach(a => {
    if (!gd.achievements.includes(a.id) && (a.check(gd) || a.id === 'first_log')) {
      gd.achievements.push(a.id);
    }
  });

  saveGameData(gd);
  return gd;
}

function renderGameCard() {
  const container = $('gameCardInner');
  if (!container) return;

  let gd = loadGameData();
  // 尝试更新今日积分
  gd = updateGameScore();
  const levelInfo = getLevelInfo(gd.totalScore);
  const lvl = levelInfo.current;
  const nextLvl = levelInfo.next;

  // 成就列表
  const achievedHTML = gd.achievements.map(id => {
    const a = ACHIEVEMENTS.find(x => x.id === id);
    return a ? `<span class="ach-badge">${a.icon} ${a.title}</span>` : '';
  }).join('');

  // 最近得分
  const recentScores = (gd.history || []).slice(-7);

  container.innerHTML = `
    <div class="game-level-row">
      <div class="game-level-icon">${lvl.icon}</div>
      <div class="game-level-body">
        <div class="game-level-name">Lv${lvl.level} · ${lvl.title}</div>
        ${nextLvl ? `
        <div class="game-level-bar-wrap">
          <div class="game-level-bar-fill" style="width:${levelInfo.progress}%"></div>
        </div>
        <div class="game-level-sub">${gd.totalScore}/${nextLvl.minScore} 升级到 ${nextLvl.icon} ${nextLvl.title}</div>
        ` : '<div class="game-level-sub" style="color:#FFD700;">🏆 已满级！</div>'}
      </div>
      <div class="game-score-num">${gd.totalScore}<span class="game-score-unit">分</span></div>
    </div>
    ${achievedHTML ? '<div class="game-achievements"><div class="ach-title">🏅 已获成就</div><div class="ach-list">' + achievedHTML + '</div></div>' : '<div style="text-align:center;font-size:11px;color:var(--text-secondary);padding:8px 0;">记录饮食即可解锁成就</div>'}
    ${recentScores.length > 0 ? `
    <div class="game-recent">
      <div class="ach-title" style="margin-top:6px;">📅 近7日积分</div>
      <div class="game-score-row">
        ${recentScores.map(s => {
          const day = s.date.replace(/^\d{4}-/, '').replace('-', '/');
          return `<div class="game-score-dot" title="${day}: +${s.score}">
            <div class="dot-bar" style="height:${Math.min(40, s.score)}px;"></div>
            <div class="dot-label">+${s.score}</div>
          </div>`;
        }).join('')}
      </div>
    </div>
    ` : ''}
  `;
}

// ========================================
// 模块六补充: AI 周报 + 月报
// ========================================
async function generatePeriodReport(period) {
  const apiKey = $('apiKey').value.trim();
  const model = $('modelName').value.trim();
  const apiBase = $('apiBase').value.trim().replace(/\/+$/, '');
  if (!apiKey || !model) { showToast('请先配置API'); return; }

  const area = $('reportArea');
  const result = analyzeHealth();
  if (!result.ready) {
    area.innerHTML = '<div style="text-align:center;color:var(--text-secondary);font-size:13px;padding:12px;">需要至少3天饮食数据</div>';
    return;
  }

  const d = result.dashboard;
  const minDays = period === 'week' ? 4 : 14;
  if (d.totalDays < minDays) {
    area.innerHTML = `<div style="text-align:center;color:var(--text-secondary);font-size:13px;padding:12px;">${period==='week'?'周报':'月报'}需要至少${minDays}天数据，当前仅${d.totalDays}天</div>`;
    return;
  }

  const labels = { week: '周报(7天)', month: '月报(30天)' };
  const btnText = period === 'week' ? 'AI周报分析中…' : 'AI月报分析中…';

  area.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">⏳ AI正在生成' + labels[period] + '…</div>';

  const gapText = [];
  if (d.proPct < 15) gapText.push('蛋白质占比偏低(' + d.proPct + '%)');
  if (d.fatPct > 30) gapText.push('脂肪占比偏高(' + d.fatPct + '%)');
  if (d.veggieDays < d.totalDays * 0.5) gapText.push('蔬菜覆盖不足(' + d.veggieDays + '/' + d.totalDays + '天)');
  if (d.highSugarDays > d.totalDays * 0.3) gapText.push('高糖天数较多(' + d.highSugarDays + '天)');

  const prompt = `你是专业营养师。根据以下周期饮食数据生成${labels[period]}分析报告。

【周期】${labels[period]}，实际有效数据${d.totalDays}天
【日均摄入】热量${d.avgCal}千卡(${d.calCompliance}%目标) | 蛋白${d.avgPro}g | 脂肪${d.avgFat}g | 碳水${d.avgCarb}g
【供能结构】蛋白${d.proPct}% 脂肪${d.fatPct}% 碳水${d.carbPct}%
【行为数据】${d.compliantDays}/${d.totalDays}天达标 | 连续打卡${d.streak}天 | 蔬菜${d.veggieDays}天 | 高脂${d.highFatDays}天 高糖${d.highSugarDays}天
${gapText.length > 0 ? '【营养缺口】' + gapText.join('；') : ''}

请返回JSON:
{"summary":"周期总结(2-3句)","trend":"上升/下降/稳定","highlights":"亮点(1句话)","issues":"待改进(1句话)","advice":"下${period==='week'?'周':'月'}建议(具体可操作)"}`;

  try {
    const url = apiBase + '/chat/completions';
    const body = { model, temperature: 0, max_tokens: 800, messages: [{ role: 'user', content: prompt }] };
    const resp = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify(body),
    });
    if (!resp.ok) { const e = await resp.text(); throw new Error(e.substring(0, 200)); }
    const rj = await resp.json();
    let raw = rj.choices?.[0]?.message?.content || '';
    raw = raw.replace(/<\|begin_of_box\|>/g, '').replace(/<\|end_of_box\|>/g, '');

    let data = null;
    try { data = JSON.parse(raw); } catch {
      const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (m) { try { data = JSON.parse(m[1]); } catch {} }
      if (!data) { const s2 = raw.indexOf('{'), e2 = raw.lastIndexOf('}'); if (s2>=0 && e2>s2) try { data = JSON.parse(raw.substring(s2, e2+1)); } catch {} }
    }

    if (!data) { area.innerHTML = '<div style="color:#999;font-size:13px;text-align:center;padding:12px;">AI返回了非结构化内容</div>'; return; }

    const trendEmoji = { '上升': '📈', '下降': '📉', '稳定': '➡️' };
    const trendIcon = trendEmoji[data.trend] || '📊';

    area.innerHTML = `<div class="report-card" style="background:linear-gradient(135deg, #E60012, #0D0D0D);">
      <div class="twin-title">${period==='week'?'📊':'📅'} AI${labels[period]}分析报告</div>
      <div class="report-score-row">
        <div class="report-score"><div class="num">${trendIcon}</div><div class="label">趋势${data.trend||'?'}</div></div>
        <div class="report-score"><div class="num">${d.compliantDays}/${d.totalDays}</div><div class="label">达标天数</div></div>
        <div class="report-score"><div class="num">${d.avgCal}</div><div class="label">日均千卡</div></div>
        <div class="report-score"><div class="num">${d.streak}</div><div class="label">连续打卡</div></div>
      </div>
      ${data.summary ? '<div class="report-text"><b>📝 总结：</b>' + data.summary + '</div>' : ''}
      ${data.highlights ? '<hr class="report-divider"><div class="report-text"><b>⭐ 亮点：</b>' + data.highlights + '</div>' : ''}
      ${data.issues ? '<div class="report-text" style="margin-top:4px;"><b>⚠️ 待改进：</b>' + data.issues + '</div>' : ''}
      ${data.advice ? '<hr class="report-divider"><div class="report-text"><b>💡 建议：</b>' + data.advice + '</div>' : ''}
    </div>`;
  } catch (err) {
    console.error(period + '报告失败:', err);
    area.innerHTML = '<div style="color:#E60012;font-size:13px;">❌ ' + err.message.substring(0, 100) + '</div>';
  }
}

function generateWeekReport() { generatePeriodReport('week'); }
function generateMonthReport() { generatePeriodReport('month'); }

// ===== 登录后初始化当前用户数据 =====
function initAppForCurrentUser() {
  // API 配置从全局读取
  const base = localStorage.getItem('ssyp_api_base'), key = localStorage.getItem('ssyp_api_key'), model = localStorage.getItem('ssyp_model');
  if (base) $('apiBase').value = base;
  if (key) $('apiKey').value = key;
  if (model) $('modelName').value = model;
  updateStatus();
  updateNavStatus();
  // 刷新当前活跃的页面
  const activeTab = document.querySelector('.tab-item.active');
  if (activeTab) {
    const tabs = ['camera','record','assistant','profile'];
    const idx = Array.from(document.querySelectorAll('.tab-item')).indexOf(activeTab);
    if (idx >= 0) switchTab(tabs[idx]);
  }
}

// ===== 初始化 =====
(function init() {
  // API 配置全局读取
  const base = localStorage.getItem('ssyp_api_base'), key = localStorage.getItem('ssyp_api_key'), model = localStorage.getItem('ssyp_model');
  if (base) $('apiBase').value = base;
  if (key) $('apiKey').value = key;
  if (model) $('modelName').value = model;
  updateStatus();
  updateNavStatus();
  // 暗色模式初始化
  const saved = localStorage.getItem('ssyp_dark');
  const darkToggle = document.getElementById('darkToggle');
  if (saved === '1' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
    if (darkToggle) darkToggle.textContent = '☀️';
  } else {
    if (darkToggle) darkToggle.textContent = '🌙';
  }
})();

// ===== 暗色模式切换 =====
function toggleDark() {
  const html = document.documentElement;
  html.classList.toggle('dark');
  const isDark = html.classList.contains('dark');
  localStorage.setItem('ssyp_dark', isDark ? '1' : '0');
  const dt = document.getElementById('darkToggle');
  if (dt) dt.textContent = isDark ? '☀️' : '🌙';
  // 更新状态栏颜色
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', isDark ? '#000000' : '#0D0D0D');
  // 重绘图表以适配暗色模式
  if (nutritionChart && $('chartCard').style.display !== 'none') {
    const pageActive = document.querySelector('.page.active');
    if (pageActive && pageActive.id === 'page-record') {
      const meals = JSON.parse(acGet(SK.meals) || '{}');
      const date = dateStr(currentDayOffset);
      const dayMeals = meals[date] || [];
      let tp = 0, tf = 0, tc = 0;
      dayMeals.forEach(m => { tp += m.nutrition.pro; tf += m.nutrition.fat; tc += m.nutrition.carb; });
      if (dayMeals.length > 0) renderNutritionChart(tp, tf, tc);
    }
  }
  if (trendChart) renderTrendChart();
  if (weightChart) renderWeightChart();
}

['apiBase','apiKey','modelName'].forEach(id => { $(id).addEventListener('input', () => { saveConfig(); updateStatus(); }); });
