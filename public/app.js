'use strict';

const SAMPLE = {
  tokens: [
    { name: 'bg', value: '#ffffff' },
    { name: 'text', value: '#767676' },
    { name: 'muted', value: '#9a9a9a' },
    { name: 'title', value: '#5d6b85' },
    { name: 'primary', value: '#6a8dff' },
  ],
  candidates: [
    '#000000', '#101828', '#1f3a8a', '#2456d6',
    '#3b6cf0', '#6a8dff', '#9db4ff', '#c9d6ff',
    '#4b5563', '#111827', '#e8eefc', '#ffffff',
  ],
  constraints: [
    { fg: 'text', bg: 'bg', minContrast: 4.5 },
    { fg: 'muted', bg: 'bg', minContrast: 4.5 },
    { fg: 'title', bg: 'bg', minContrast: 4.5 },
    { fg: 'primary', bg: 'bg', minContrast: 4.5 },
    { fg: 'bg', bg: 'primary', minContrast: 3.0 },
  ],
  locked: [],
};

const UNSAT_SAMPLE = {
  tokens: [
    { name: 'bg', value: '#ffffff' },
    { name: 'brand', value: '#f0c0c0' },
    { name: 'text', value: '#8a8a8a' },
  ],
  candidates: ['#101828', '#374151', '#6b7280', '#f9fafb'],
  constraints: [
    { fg: 'brand', bg: 'bg', minContrast: 7.0 },
    { fg: 'text', bg: 'brand', minContrast: 4.5 },
  ],
  locked: ['bg', 'brand'],
};

const $ = (id) => document.getElementById(id);

let parsed = null;
let lastResult = null;

function showError(msg) {
  const el = $('parse-error');
  if (msg) {
    el.textContent = msg;
    el.hidden = false;
  } else {
    el.hidden = true;
    el.textContent = '';
  }
}

function parseInput() {
  showError('');
  let data;
  try {
    data = JSON.parse($('json-input').value);
  } catch (e) {
    throw new Error('JSON 解析失败: ' + e.message);
  }
  if (!data || typeof data !== 'object') throw new Error('JSON 顶层必须是对象');
  if (!Array.isArray(data.tokens)) throw new Error('缺少 tokens 数组');
  const locked = Array.isArray(data.locked) ? data.locked : [];
  return { data, locked: new Set(locked) };
}

function renderTokens() {
  const { data, locked } = parsed;
  const list = $('token-list');
  list.innerHTML = '';
  for (const t of data.tokens) {
    const row = document.createElement('label');
    row.className = 'token-item';
    const isLocked = locked.has(t.name);
    row.innerHTML = `
      <span class="swatch" style="background:${t.value}"></span>
      <span class="token-meta">
        <span class="token-name"></span>
        <div class="token-hex"></div>
      </span>
      <span class="lock-toggle ${isLocked ? 'locked' : ''}">
        <input type="checkbox" ${isLocked ? 'checked' : ''} />
        锁定
      </span>`;
    row.querySelector('.token-name').textContent = t.name;
    row.querySelector('.token-hex').textContent = t.value;
    const cb = row.querySelector('input');
    cb.addEventListener('change', () => {
      if (cb.checked) locked.add(t.name);
      else locked.delete(t.name);
      row.querySelector('.lock-toggle').classList.toggle('locked', cb.checked);
    });
    list.appendChild(row);
  }

  const chips = $('candidate-chips');
  chips.innerHTML = '';
  const label = document.createElement('span');
  label.className = 'chips-label';
  label.textContent = `候选色（${data.candidates.length}）：`;
  chips.appendChild(label);
  for (const c of data.candidates) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `<span class="dot" style="background:${c}"></span>`;
    chip.appendChild(document.createTextNode(c));
    chips.appendChild(chip);
  }

  $('lock-card').hidden = false;
  $('result-card').hidden = true;
}

function reloadFromTextarea() {
  try {
    parsed = parseInput();
    renderTokens();
    return true;
  } catch (e) {
    showError(e.message);
    $('lock-card').hidden = true;
    return false;
  }
}

function fmt(n, digits = 2) {
  return Number(n).toFixed(digits);
}

function renderResult(payload) {
  lastResult = payload;
  const { result } = payload;
  const card = $('result-card');
  card.hidden = false;

  const summary = $('result-summary');
  summary.innerHTML = '';
  const badgeWrap = document.createElement('div');
  badgeWrap.className = 'summary';

  if (result.feasible) {
    badgeWrap.innerHTML = `
      <span class="badge ok">✓ 找到可行方案</span>
      <span class="badge neutral">改色令牌：${result.changedCount} / ${result.tokens.length}</span>
      <span class="badge neutral">总色差 ΔE2000：${fmt(result.totalDeltaE)}</span>
      <span class="badge neutral">搜索节点：${result.nodes}</span>
      ${result.truncated ? '<span class="badge warn">⚠ 达到搜索节点上限，返回已找到的最优方案</span>' : ''}
    `;
  } else {
    badgeWrap.innerHTML = `
      <span class="badge bad">✗ 无解</span>
      <span class="badge neutral">搜索节点：${result.nodes}</span>
    `;
  }
  summary.appendChild(badgeWrap);

  // 令牌结果表
  const tokWrap = $('result-tokens');
  tokWrap.innerHTML = '';
  if (result.feasible) {
    const table = document.createElement('table');
    table.innerHTML = `
      <thead><tr>
        <th>令牌</th><th>原色</th><th></th><th>结果</th>
        <th class="num">ΔE2000</th><th>状态</th>
      </tr></thead>`;
    const tbody = document.createElement('tbody');
    for (const t of result.tokens) {
      const tr = document.createElement('tr');
      const status = t.locked
        ? '<span class="badge warn">已锁定</span>'
        : t.changed
        ? '<span class="badge bad">已改色</span>'
        : '<span class="badge ok">保持原色</span>';
      tr.innerHTML = `
        <td><strong></strong></td>
        <td><span class="mini-swatch" style="background:${t.original}"></span><code>${t.original}</code></td>
        <td class="arrow">→</td>
        <td><span class="mini-swatch" style="background:${t.value}"></span><code>${t.value}</code></td>
        <td class="num">${t.changed ? fmt(t.deltaE) : '—'}</td>
        <td>${status}</td>`;
      tr.querySelector('strong').textContent = t.name;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tokWrap.appendChild(table);
  }

  // 约束表
  const cWrap = $('result-constraints');
  cWrap.innerHTML = '';
  const ctable = document.createElement('table');
  ctable.innerHTML = `
    <thead><tr>
      <th>前景</th><th>背景</th><th class="num">最低对比度</th>
      <th class="num">改前</th><th></th><th class="num">改后</th><th>结果</th>
    </tr></thead>`;
  const ctbody = document.createElement('tbody');
  for (const c of result.constraints) {
    const tr = document.createElement('tr');
    const ok = c.after !== null && c.satisfied;
    const afterCell =
      c.after === null
        ? '<td class="num">—</td>'
        : `<td class="num ${ok ? 'pass' : 'fail'}">${fmt(c.after)}</td>`;
    tr.innerHTML = `
      <td></td>
      <td></td>
      <td class="num">${fmt(c.minContrast, 1)}</td>
      <td class="num ${c.before + 1e-9 >= c.minContrast ? 'pass' : 'fail'}">${fmt(c.before)}</td>
      <td class="arrow">→</td>
      ${afterCell}
      <td>${
        c.after === null
          ? '<span class="badge bad">不可满足</span>'
          : ok
          ? '<span class="badge ok">满足</span>'
          : '<span class="badge bad">违反</span>'
      }</td>`;
    const tds = tr.querySelectorAll('td');
    tds[0].textContent = c.fg;
    tds[1].textContent = c.bg;
    ctbody.appendChild(tr);
  }
  ctable.appendChild(ctbody);
  cWrap.appendChild(ctable);

  // 锁定冲突
  const xWrap = $('result-conflicts');
  xWrap.innerHTML = '';
  if (!result.feasible && result.conflicts && result.conflicts.length) {
    const box = document.createElement('div');
    box.className = 'conflict-box';
    box.innerHTML = '<h4>锁定颜色直接造成的冲突：</h4><ul></ul>';
    const ul = box.querySelector('ul');
    for (const cf of result.conflicts) {
      const li = document.createElement('li');
      const lockDesc = [cf.fgLocked ? `前景「${cf.fg}」锁定` : null,
                        cf.bgLocked ? `背景「${cf.bg}」锁定` : null]
        .filter(Boolean).join('，');
      li.innerHTML = `
        <strong>${cf.fg}</strong> / <strong>${cf.bg}</strong>
        要求对比度 ≥ ${fmt(cf.minContrast, 1)}，${lockDesc}；
        当前比值 ${fmt(cf.currentRatio)}，在现有候选色下最佳仅可达
        ${fmt(cf.bestAchievableRatio)}（${cf.bestAchievableFg} 配 ${cf.bestAchievableBg}）。`;
      ul.appendChild(li);
    }
    xWrap.appendChild(box);
  } else if (!result.feasible) {
    const box = document.createElement('div');
    box.className = 'conflict-box';
    box.innerHTML =
      '<h4>无解</h4><p style="margin:0;font-size:13px">未检测到单纯由锁定颜色直接造成的约束冲突，不可行性可能来自多条约束的组合效应。</p>';
    xWrap.appendChild(box);
  }

  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function solve() {
  if (!reloadFromTextarea()) return;
  const { data, locked } = parsed;
  const body = {
    tokens: data.tokens,
    candidates: data.candidates || [],
    constraints: data.constraints,
    locked: [...locked],
  };
  $('btn-solve').disabled = true;
  $('btn-solve').textContent = '求解中…';
  try {
    const resp = await fetch('/api/solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await resp.json();
    if (!resp.ok) {
      showError(json.error || '求解失败');
      return;
    }
    renderResult(json);
  } catch (e) {
    showError('请求失败: ' + e.message);
  } finally {
    $('btn-solve').disabled = false;
    $('btn-solve').textContent = '开始求解';
  }
}

function exportTokens() {
  if (!lastResult || !lastResult.result.feasible) return;
  const out = {};
  for (const t of lastResult.result.tokens) out[t.name] = t.value;
  const blob = new Blob([JSON.stringify(out, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'tokens.resolved.json';
  a.click();
  URL.revokeObjectURL(url);
}

function loadSample(sample) {
  $('json-input').value = JSON.stringify(sample, null, 2);
  reloadFromTextarea();
}

$('btn-sample').addEventListener('click', () => loadSample(SAMPLE));
$('btn-sample-unsat').addEventListener('click', () => loadSample(UNSAT_SAMPLE));
$('btn-solve').addEventListener('click', solve);
$('btn-export').addEventListener('click', exportTokens);
$('json-input').addEventListener('input', () => {
  $('lock-card').hidden = true;
  $('result-card').hidden = true;
  showError('');
});
$('file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    $('json-input').value = String(reader.result);
    reloadFromTextarea();
  };
  reader.readAsText(file);
  e.target.value = '';
});

// 默认载入可解示例
loadSample(SAMPLE);
