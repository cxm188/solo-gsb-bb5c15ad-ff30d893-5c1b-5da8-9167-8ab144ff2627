'use strict';

const { parseHex } = require('./color');

const LIMITS = {
  maxTokens: 10,
  maxCandidates: 12,
  maxConstraints: 30,
};

function validateInput(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('请求体必须为 JSON 对象');
  }
  const { tokens, candidates, constraints, locked } = body;

  if (!Array.isArray(tokens)) throw new Error('缺少 tokens 数组');
  if (!Array.isArray(candidates)) throw new Error('缺少 candidates 数组');
  if (!Array.isArray(constraints)) throw new Error('缺少 constraints 数组');
  if (locked !== undefined && !Array.isArray(locked)) {
    throw new Error('locked 必须为令牌名数组');
  }

  if (tokens.length === 0) throw new Error('tokens 不能为空');
  if (tokens.length > LIMITS.maxTokens) {
    throw new Error(`令牌数量超过上限（${LIMITS.maxTokens}）`);
  }
  if (candidates.length > LIMITS.maxCandidates) {
    throw new Error(`候选色数量超过上限（${LIMITS.maxCandidates}）`);
  }
  if (constraints.length > LIMITS.maxConstraints) {
    throw new Error(`约束数量超过上限（${LIMITS.maxConstraints}）`);
  }

  const names = new Set();
  const normTokens = [];
  for (const t of tokens) {
    if (!t || typeof t.name !== 'string' || !t.name.trim()) {
      throw new Error('每个令牌必须包含非空 name');
    }
    const name = t.name.trim();
    if (names.has(name)) throw new Error('令牌名重复: ' + name);
    names.add(name);
    const value = normalizeHex(t.value);
    if (!value) throw new Error(`令牌 ${name} 的颜色值非法: ${t.value}`);
    normTokens.push({ name, value });
  }

  const normCandidates = [];
  for (const c of candidates) {
    const v = normalizeHex(c);
    if (!v) throw new Error(`候选色非法: ${c}`);
    normCandidates.push(v);
  }
  if (new Set(normCandidates).size !== normCandidates.length) {
    // 允许重复但归一化去重，不报错
  }

  const normConstraints = [];
  constraints.forEach((c, i) => {
    if (!c || typeof c !== 'object') throw new Error(`第 ${i + 1} 条约束格式错误`);
    if (typeof c.fg !== 'string' || !names.has(c.fg)) {
      throw new Error(`第 ${i + 1} 条约束的 fg 不是有效令牌名`);
    }
    if (typeof c.bg !== 'string' || !names.has(c.bg)) {
      throw new Error(`第 ${i + 1} 条约束的 bg 不是有效令牌名`);
    }
    if (c.fg === c.bg) {
      throw new Error(`第 ${i + 1} 条约束的 fg 与 bg 不能相同（对比度恒为 1）`);
    }
    const min = Number(c.minContrast);
    if (!Number.isFinite(min) || min <= 1) {
      throw new Error(`第 ${i + 1} 条约束的 minContrast 必须为大于 1 的数字`);
    }
    if (min > 21) {
      throw new Error(`第 ${i + 1} 条约束的 minContrast 不能超过 21`);
    }
    normConstraints.push({ fg: c.fg, bg: c.bg, minContrast: min });
  });

  let normLocked = [];
  if (locked) {
    for (const l of locked) {
      if (typeof l !== 'string' || !names.has(l)) {
        throw new Error('locked 包含无效令牌名: ' + JSON.stringify(l));
      }
      normLocked.push(l);
    }
  }

  return {
    tokens: normTokens,
    candidates: normCandidates,
    constraints: normConstraints,
    locked: normLocked,
  };
}

function normalizeHex(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const h = (v) => v.toString(16).padStart(2, '0');
  return '#' + h(rgb.r) + h(rgb.g) + h(rgb.b);
}

module.exports = { validateInput, LIMITS };
