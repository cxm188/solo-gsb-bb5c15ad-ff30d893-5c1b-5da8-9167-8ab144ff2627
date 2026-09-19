'use strict';

// 全局分支定界求解器
// 目标（按优先级）：
//   1) 改色令牌数最少
//   2) CIEDE2000 总色差最小
//   3) 令牌名与色值字典序稳定决胜

const { parseHex, contrastRatio, rgbToLab, deltaE2000 } = require('./color');

const MAX_NODES = 2_000_000; // 搜索安全上限

function solve(input) {
  const { tokens, candidates, constraints, locked } = input;

  const tokenNames = tokens.map((t) => t.name);
  const origHex = new Map(tokens.map((t) => [t.name, normalizeHex(t.value)]));

  // 候选色（十六进制小写归一，去重并排序以保证稳定）
  const candHex = [...new Set(candidates.map(normalizeHex))].sort();

  // 每个令牌的取值域：候选色 ∪ 原色
  const domains = new Map();
  for (const name of tokenNames) {
    const o = origHex.get(name);
    let values = [...new Set([o, ...candHex])];
    // 稳定排序：仅用于展示/搜索可复现
    values.sort();
    domains.set(name, values);
  }

  // 预计算对比度矩阵 contrast[[name, hex] pair key]
  // 先收集所有“颜色实体”
  const colorSet = new Set(candHex);
  for (const name of tokenNames) {
    colorSet.add(origHex.get(name));
  }
  const colors = [...colorSet].sort();
  const rgb = new Map();
  const lab = new Map();
  for (const c of colors) {
    rgb.set(c, parseHex(c));
    lab.set(c, rgbToLab(parseHex(c)));
  }
  const contrast = new Map();
  for (const c1 of colors) {
    for (const c2 of colors) {
      contrast.set(c1 + '|' + c2, contrastRatio(rgb.get(c1), rgb.get(c2)));
    }
  }

  const con = constraints.map((c, i) => ({
    index: i,
    fg: c.fg,
    bg: c.bg,
    min: c.minContrast,
  }));

  // ---- 无解诊断：锁定颜色直接造成的冲突 ----
  // 1) 两端均锁定且原色对比度不足；
  // 2) 一端锁定：扫描该端所有可能颜色（原色+候选），若另一端的所有
  //    可用取值都无法满足，则列出该约束（含最佳可达对比度）。
  const lockedSet = new Set(locked);
  const lockConflicts = detectLockConflicts({
    con,
    tokenNames,
    origHex,
    domains,
    lockedSet,
    contrast,
  });

  // ---- 分支定界 ----
  // 静态变量顺序：约束中出现次数多者优先；其次令牌名（稳定）
  const degree = new Map(tokenNames.map((n) => [n, 0]));
  for (const c of con) {
    degree.set(c.fg, (degree.get(c.fg) || 0) + 1);
    degree.set(c.bg, (degree.get(c.bg) || 0) + 1);
  }
  const vars = [...tokenNames].sort((a, b) => {
    const d = degree.get(b) - degree.get(a);
    if (d !== 0) return d;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  // 每个约束在变量顺序中的位置（用于增量检查）
  const varPos = new Map(vars.map((n, i) => [n, i]));
  const conReadyPos = con.map(
    (c) => Math.max(varPos.get(c.fg), varPos.get(c.bg))
  );
  // readyAt[i]：当赋值到第 i 个变量后可检查的约束
  const readyAt = vars.map(() => []);
  con.forEach((c, ci) => readyAt[conReadyPos[ci]].push(ci));

  // 下界：剩余未赋值变量中，尚未赋值变量即使全保持原色也需 0，
  // 真正的改变数下界是已改变数本身；色差下界同理为当前已累计色差。
  // 额外剪枝：未赋值变量若参与约束且原色不可行，则必然改变。
  // 预计算：对每个变量，原色是否在其所有参与约束中都可行（无法预知其他变量，
  // 这里用弱剪枝：跳过，保证正确性）。

  let best = null; // {changed, delta, key, assign}
  let nodes = 0;
  let truncated = false;

  const assignment = new Array(vars.length);
  const isChanged = new Array(vars.length).fill(false);

  // 解决方案字典序键（稳定决胜）：按令牌名排序的 "name=hex"
  function solutionKey(assignArr) {
    const pairs = vars.map((n, i) => n + '=' + assignArr[i]);
    pairs.sort();
    return pairs.join('');
  }

  function dfs(pos, changedCount, deltaSum) {
    if (++nodes > MAX_NODES) {
      truncated = true;
      return;
    }

    // 主导目标剪枝
    if (best) {
      if (changedCount > best.changed) return;
      if (changedCount === best.changed && deltaSum > best.delta + 1e-9) return;
    }

    if (pos === vars.length) {
      if (!best) {
        best = {
          changed: changedCount,
          delta: deltaSum,
          key: solutionKey(assignment),
          assign: [...assignment],
        };
      } else if (
        changedCount < best.changed ||
        (changedCount === best.changed && deltaSum < best.delta - 1e-9) ||
        (changedCount === best.changed &&
          Math.abs(deltaSum - best.delta) <= 1e-9 &&
          solutionKey(assignment) < best.key)
      ) {
        best = {
          changed: changedCount,
          delta: deltaSum,
          key: solutionKey(assignment),
          assign: [...assignment],
        };
      }
      return;
    }

    // 已找到 changed=0 方案时，剩余变量必须全部保持原色
    // 值排序：原色优先（先探 0 改动路径），其余按 hex 排序
    const name = vars[pos];
    let values = domains.get(name);
    if (lockedSet.has(name)) {
      values = [origHex.get(name)];
    } else if (best && changedCount === best.changed && best.changed === 0) {
      values = [origHex.get(name)];
    } else {
      values = values.slice().sort((a, b) => {
        if (a === origHex.get(name)) return -1;
        if (b === origHex.get(name)) return 1;
        return a < b ? -1 : a > b ? 1 : 0;
      });
    }

    for (const val of values) {
      const changed = val !== origHex.get(name);
      const newChanged = changedCount + (changed ? 1 : 0);
      if (best && newChanged > best.changed) continue;

      const d = changed ? deltaE2000(lab.get(origHex.get(name)), lab.get(val)) : 0;
      const newDelta = deltaSum + d;
      if (best && newChanged === best.changed && newDelta > best.delta + 1e-9) continue;

      assignment[pos] = val;
      isChanged[pos] = changed;

      // 增量检查：所有在本位置两端都已赋值的约束
      let ok = true;
      for (const ci of readyAt[pos]) {
        const c = con[ci];
        const fgVal = assignment[varPos.get(c.fg)];
        const bgVal = assignment[varPos.get(c.bg)];
        const ratio = contrast.get(fgVal + '|' + bgVal);
        if (ratio + 1e-9 < c.min) {
          ok = false;
          break;
        }
      }
      if (ok) dfs(pos + 1, newChanged, newDelta);
      if (truncated) return;
    }
    assignment[pos] = undefined;
  }

  dfs(0, 0, 0);

  if (!best) {
    return {
      feasible: false,
      truncated,
      nodes,
      conflicts: lockConflicts,
      constraints: con.map((c) => ({
        fg: c.fg,
        bg: c.bg,
        minContrast: c.min,
        before: ratioOf(contrast, origHex.get(c.fg), origHex.get(c.bg)),
        after: null,
        satisfied: false,
      })),
    };
  }

  const assignMap = new Map(vars.map((n, i) => [n, best.assign[i]]));

  const tokensOut = tokenNames.map((name) => {
    const o = origHex.get(name);
    const v = assignMap.get(name);
    return {
      name,
      original: o,
      value: v,
      changed: o !== v,
      locked: lockedSet.has(name),
      deltaE: o === v ? 0 : deltaE2000(lab.get(o), lab.get(v)),
    };
  });

  const constraintsOut = con.map((c) => {
    const before = ratioOf(contrast, origHex.get(c.fg), origHex.get(c.bg));
    const after = ratioOf(contrast, assignMap.get(c.fg), assignMap.get(c.bg));
    return {
      fg: c.fg,
      bg: c.bg,
      minContrast: c.min,
      before,
      after,
      satisfied: after + 1e-9 >= c.min,
    };
  });

  return {
    feasible: true,
    truncated,
    nodes,
    changedCount: best.changed,
    totalDeltaE: best.delta,
    tokens: tokensOut,
    constraints: constraintsOut,
  };
}

function ratioOf(matrix, a, b) {
  return matrix.get(a + '|' + b);
}

function detectLockConflicts({ con, origHex, domains, lockedSet, contrast }) {
  const conflicts = [];
  for (const c of con) {
    const fgLocked = lockedSet.has(c.fg);
    const bgLocked = lockedSet.has(c.bg);
    if (!fgLocked && !bgLocked) continue;

    let bestRatio = 0;
    let bestFg = null;
    let bestBg = null;

    const fgVals = fgLocked ? [origHex.get(c.fg)] : domains.get(c.fg);
    const bgVals = bgLocked ? [origHex.get(c.bg)] : domains.get(c.bg);

    for (const f of fgVals) {
      for (const b of bgVals) {
        const r = contrast.get(f + '|' + b);
        if (r > bestRatio) {
          bestRatio = r;
          bestFg = f;
          bestBg = b;
        }
      }
    }

    if (bestRatio + 1e-9 < c.min) {
      const curRatio = contrast.get(origHex.get(c.fg) + '|' + origHex.get(c.bg));
      conflicts.push({
        fg: c.fg,
        bg: c.bg,
        minContrast: c.min,
        fgLocked,
        bgLocked,
        currentRatio: curRatio,
        bestAchievableRatio: bestRatio,
        bestAchievableFg: bestFg,
        bestAchievableBg: bestBg,
      });
    }
  }
  return conflicts;
}

function normalizeHex(hex) {
  const rgb = parseHex(hex);
  if (!rgb) throw new Error('非法颜色值: ' + JSON.stringify(hex));
  const h = (v) => v.toString(16).padStart(2, '0');
  return '#' + h(rgb.r) + h(rgb.g) + h(rgb.b);
}

module.exports = { solve };
