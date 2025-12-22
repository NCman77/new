/**
 * algo_ai.js V7.2
 * AI 學派：時間序列動能分析 (Production Grade)
 *
 * 核心演算法：
 * - 半衰期指數衰減權重
 * - Log-Lift 動能計算
 * - Kish Neff 收縮
 * - Percentile Rank 轉趨勢分 (UI 顯示與 Strict 排序用)
 * - Random 模式：原始動能分 Z-Score 標準化 + Shift-by-max 加權抽樣
 * - 候選池控制：Random 模式限制 Top-K 抽樣，避免過度稀釋準度
 * - 排除邏輯：支援 Set 與 nested array，並明確定義 Zone2 規則
 */

// 引入 utils.js 的 AI 工具函式
import {
  ai_computeHalfLifeWeights,
  ai_computeWeightedStats,
  ai_computeLogLift,
  ai_computeKishShrinkage,
  ai_percentileRankTransform
} from '../utils.js';

// ==========================================
// [A] 配置區
// ==========================================
const AI_CONFIG = {
  DEBUG_MODE: false,

  // 超參數配置
  PARAMS: {
    lotto: {
      h_short: 8,
      h_long: 50,
      epsilon: 1,
      kPrior: 5,
      // Random 模式限制：只從前 N 名候選中抽樣
      randomCandidateLimit: 25
    },
    power_zone1: {
      h_short: 8,
      h_long: 50,
      epsilon: 1,
      kPrior: 5,
      randomCandidateLimit: 25
    },
    power_zone2: {
      h_short: 15, // 稍微拉長觀察期
      h_long: 80,
      epsilon: 2,
      kPrior: 10,
      randomCandidateLimit: 8 // Zone2 只有 8 顆，全取即可
    },
    digit: {
      h_short: 10,
      h_long: 60,
      epsilon: 1,
      kPrior: 8,
      randomCandidateLimit: 10 // Digit 只有 10 顆
    }
  },

  // strict 模式 overlap 階梯 (避免連續 setIndex 推薦重複)
  // [Top1重疊數, Top2重疊數, ...]
  OVERLAP_LIMITS: {
    lotto: [0, 1, 2, 3, 4],
    digit: [0, 0, 1, 1, 2]
  },

  // digit pack_2 配置
  DIGIT_PACK2_TOP_N: 4
};

// [B] 除錯工具
const log = (...args) => {
  if (AI_CONFIG.DEBUG_MODE) console.log('[AI V7.2]', ...args);
};

// ==========================================
// [C] 主入口函式
// ==========================================
export function algoAI({
  data,
  gameDef,
  subModeId,
  excludeNumbers = [],
  random = false,
  mode = 'strict',
  packMode = null,
  targetCount = 5,
  setIndex = 0,
  selectedCombo = null
}) {
  log(`啟動 | 玩法: ${gameDef.type} | 模式: ${mode} | 包牌: ${packMode || '單注'} | setIndex: ${setIndex}`);

  // 1. 資料驗證
  if (!Array.isArray(data) || data.length === 0) {
    return packMode ? [] : {
      numbers: [],
      groupReason: '❌ 資料不足',
      metadata: { version: '7.2', error: 'insufficient_data' }
    };
  }

  // 2. 處理排除號碼 (支援複雜結構)
  // 規則：hardExclude 僅作用於主區域 (Zone1 / Single Zone)。Zone2 不排除，以免無號可選。
  const hardExclude = ai_parseExcludeNumbers(excludeNumbers);

  // 3. 包牌模式
  if (packMode) {
    return ai_handlePackMode({
      data, gameDef, packMode, targetCount, mode, random, subModeId, selectedCombo, hardExclude
    });
  }

  // 4. 單注模式
  if (gameDef.type === 'power') {
    return ai_handlePowerSingle({
      data, gameDef, hardExclude, random, mode, setIndex
    });
  } else if (gameDef.type === 'digit') {
    return ai_handleDigitSingle({
      data, gameDef, subModeId, hardExclude, random, mode, setIndex
    });
  } else {
    // lotto / today
    return ai_handleComboSingle({
      data, gameDef, hardExclude, random, mode, setIndex
    });
  }
}

// ==========================================
// [D] 包牌邏輯
// ==========================================
function ai_handlePackMode({ data, gameDef, packMode, targetCount, mode, random, subModeId, selectedCombo, hardExclude }) {
  if (gameDef.type === 'power') {
    return ai_packPower({ data, gameDef, packMode, targetCount, mode, selectedCombo, hardExclude });
  } else if (gameDef.type === 'digit') {
    return ai_packDigit({ data, gameDef, packMode, targetCount, subModeId, selectedCombo, hardExclude });
  } else {
    return ai_packCombo({ data, gameDef, packMode, targetCount, mode, selectedCombo, hardExclude });
  }
}

function ai_packPower({ data, gameDef, packMode, targetCount, mode, selectedCombo, hardExclude }) {
  const tickets = [];

  // Zone 1 計算
  const z1Raw = ai_buildRawScores({ data, range: gameDef.range, count: 6, isZone2: false, params: AI_CONFIG.PARAMS.power_zone1 });
  const z1Trend = ai_percentileRankTransform(z1Raw, 10, 98);

  // Zone 2 計算
  const z2Raw = ai_buildRawScores({ data, range: gameDef.zone2, count: 1, isZone2: true, params: AI_CONFIG.PARAMS.power_zone2 });
  const z2Trend = ai_percentileRankTransform(z2Raw, 10, 98);

  if (packMode === 'pack_1') {
    // Pack_1: Zone1 Top1 鎖定，Zone2 全包 (1~8)
    let zone1Combo;
    if (selectedCombo && selectedCombo.length >= 6) {
      zone1Combo = selectedCombo.slice(0, 6);
    } else {
      zone1Combo = ai_pickTopNumbers(z1Trend, 6, hardExclude);
    }

    // Zone2 全包 1-8 (固定規則，不應用 exclude)
    for (let z2 = 1; z2 <= 8; z2++) {
      tickets.push({
        numbers: [
          ...zone1Combo.map(n => ({ val: n, tag: `Z1(${String(n).padStart(2, '0')})` })),
          { val: z2, tag: `Z2(${String(z2).padStart(2, '0')})` }
        ],
        groupReason: `威力彩包牌 ${z2}/8 - 第1區鎖定`,
        metadata: { version: '7.2', packMode: 'pack_1', zone2: z2 }
      });
    }

  } else {
    // Pack_2: 加權隨機包牌
    // Zone1: 限制前 K 名候選 (避免選到太差的)
    const z1Limit = AI_CONFIG.PARAMS.power_zone1.randomCandidateLimit || 25;
    const z1Candidates = ai_getTopKCandidates(z1Raw, z1Limit, hardExclude);
    const z1Ctx = ai_prepareWeightedContext(z1Candidates, z1Raw);

    // Zone2: 只有 8 顆，全取
    const z2Candidates = Object.keys(z2Raw).map(Number);
    const z2Ctx = ai_prepareWeightedContext(z2Candidates, z2Raw);

    for (let i = 0; i < targetCount; i++) {
      const zone1Combo = ai_weightedSample(z1Ctx, 6);
      const zone2Val = ai_weightedSample(z2Ctx, 1)[0];

      tickets.push({
        numbers: [
          ...zone1Combo.sort((a, b) => a - b).map(n => ({ val: n, tag: `趨勢分${Math.round(z1Trend[n] || 50)}` })),
          { val: zone2Val, tag: `趨勢分${Math.round(z2Trend[zone2Val] || 50)}` }
        ],
        groupReason: `威力彩隨機包牌 ${i + 1}/${targetCount}`,
        metadata: { version: '7.2', packMode: 'pack_2' }
      });
    }
  }
  return tickets;
}

function ai_packCombo({ data, gameDef, packMode, targetCount, mode, selectedCombo, hardExclude }) {
  const tickets = [];

  const rawScores = ai_buildRawScores({
    data, range: gameDef.range, count: gameDef.count, isZone2: false, params: AI_CONFIG.PARAMS.lotto
  });
  const trendScores = ai_percentileRankTransform(rawScores, 10, 98);

  if (packMode === 'pack_1') {
    // Pack_1: 降權策略 (Strict 變體)
    const currentScores = { ...trendScores };
    const PENALTY = 0.7;

    for (let i = 0; i < targetCount; i++) {
      const combo = ai_pickTopNumbers(currentScores, gameDef.count, hardExclude);
      combo.forEach(n => { currentScores[n] *= PENALTY; });

      tickets.push({
        numbers: combo.map(n => ({ val: n, tag: `趨勢分${Math.round(trendScores[n] || 50)}` })),
        groupReason: `樂透包牌 ${i + 1}/${targetCount} - 嚴選降權`,
        metadata: { version: '7.2', packMode: 'pack_1' }
      });
    }

  } else {
    // Pack_2: 加權隨機抽樣
    // 限制候選池 (Top-K) 以維持準度
    const limit = AI_CONFIG.PARAMS.lotto.randomCandidateLimit || 25;
    const candidates = ai_getTopKCandidates(rawScores, limit, hardExclude);
    const ctx = ai_prepareWeightedContext(candidates, rawScores);

    for (let i = 0; i < targetCount; i++) {
      const combo = ai_weightedSample(ctx, gameDef.count);
      tickets.push({
        numbers: combo.sort((a, b) => a - b).map(n => ({ val: n, tag: `趨勢分${Math.round(trendScores[n] || 50)}` })),
        groupReason: `樂透隨機包牌 ${i + 1}/${targetCount}`,
        metadata: { version: '7.2', packMode: 'pack_2' }
      });
    }
  }
  return tickets;
}

function ai_packDigit({ data, gameDef, packMode, targetCount, subModeId, selectedCombo, hardExclude }) {
  const tickets = [];
  const digitCount = subModeId || gameDef.count;
  // Digit 通常不 exclude，hardExclude 暫時忽略

  if (packMode === 'pack_1') {
    // Pack_1: Top1 全排列 (未變更)
    const posScores = [];
    for (let pos = 0; pos < digitCount; pos++) {
      const rScores = ai_buildDigitPosRawScores({ data, pos, params: AI_CONFIG.PARAMS.digit });
      const tScores = ai_percentileRankTransform(rScores, 10, 98);
      const topNum = Object.keys(tScores).map(Number).sort((a, b) => tScores[b] - tScores[a])[0];
      posScores.push({ pos, num: topNum, score: tScores[topNum] });
    }
    const perms = ai_uniquePermutations(posScores.map(p => p.num));
    perms.forEach((combo, idx) => {
      tickets.push({
        numbers: combo.map((num, pos) => ({ val: num, tag: `Pos${pos + 1}` })),
        groupReason: `數字型包牌 ${idx + 1}/${perms.length} - 排列組合`,
        metadata: { version: '7.2', packMode: 'pack_1' }
      });
    });

  } else {
    // Pack_2: Top-N 笛卡兒積 + 多樣性篩選 (恢復 diff 檢查)
    const TOP_N = AI_CONFIG.DIGIT_PACK2_TOP_N;
    const posCandidates = [];

    for (let pos = 0; pos < digitCount; pos++) {
      const rScores = ai_buildDigitPosRawScores({ data, pos, params: AI_CONFIG.PARAMS.digit });
      const tScores = ai_percentileRankTransform(rScores, 10, 98);
      // 取 Top N
      const topNums = Object.keys(tScores).map(Number).sort((a, b) => tScores[b] - tScores[a]).slice(0, TOP_N);
      posCandidates.push(topNums.map(n => ({ num: n, score: tScores[n] })));
    }

    // 笛卡兒積
    const allCombos = ai_cartesianProduct(posCandidates.map(pc => pc.map(c => c.num)));
    // 依總分排序
    const rankedCombos = allCombos.map(combo => {
      let score = 0;
      combo.forEach((num, pos) => {
        const posScore = posCandidates[pos].find(c => c.num === num)?.score || 0;
        score += Math.log(posScore + 1);
      });
      return { combo, score };
    }).sort((a, b) => b.score - a.score);

    // 挑選分散的組合 (Diversity Check)
    const picked = [];
    // 策略：嘗試保持 diff >= 2，如果選不夠再降為 diff >= 1，最後 diff >= 0
    const pickWithDiff = (minDiff) => {
      for (const item of rankedCombos) {
        if (picked.length >= targetCount) break;
        const isDiffEnough = picked.every(p => ai_posDiff(p.combo, item.combo) >= minDiff);
        if (isDiffEnough) {
          picked.push(item);
        }
      }
    }

    // 階段式放寬標準
    pickWithDiff(2);
    if (picked.length < targetCount) pickWithDiff(1);
    if (picked.length < targetCount) pickWithDiff(0);

    picked.forEach((item, idx) => {
      tickets.push({
        numbers: item.combo.map((num, pos) => ({ val: num, tag: `P${pos}` })),
        groupReason: `數字型彈性包牌 ${idx + 1}/${targetCount}`,
        metadata: { version: '7.2', packMode: 'pack_2' }
      });
    });
  }
  return tickets;
}

// ==========================================
// [E] 單注邏輯 (Strict / Random)
// ==========================================
function ai_handleComboSingle({ data, gameDef, hardExclude, random, mode, setIndex }) {
  const rawScores = ai_buildRawScores({
    data, range: gameDef.range, count: gameDef.count, isZone2: false, params: AI_CONFIG.PARAMS.lotto
  });
  const trendScores = ai_percentileRankTransform(rawScores, 10, 98); // For display & strict

  let combo;

  if (random) {
    // [Online 修正] Random 模式：
    // 1. 限制候選池 (Top-K) 以保證準度
    // 2. 加權抽樣 (Shift-by-max Softmax)
    const limit = AI_CONFIG.PARAMS.lotto.randomCandidateLimit || 25;
    const candidates = ai_getTopKCandidates(rawScores, limit, hardExclude);
    const ctx = ai_prepareWeightedContext(candidates, rawScores);

    combo = ai_weightedSample(ctx, gameDef.count);

  } else {
    // Strict 模式：Overlap 階梯控制
    // 避免第 2 組推薦跟第 1 組推薦 80% 重複
    const overlapLimit = AI_CONFIG.OVERLAP_LIMITS.lotto[setIndex] !== undefined
      ? AI_CONFIG.OVERLAP_LIMITS.lotto[setIndex]
      : 2; // default

    // 這裡需要知道 "上一組" 是什麼，但因為我們是無狀態呼叫，
    // 我們使用 "降權模擬" 來達成類似效果。
    // 如果 setIndex > 0，我們假設前 (setIndex) 次的 Top1 都已被選走。

    const currentScores = { ...trendScores };
    const PENALTY = 0.5; // 加重降權力道以錯開組合

    for (let i = 0; i < setIndex; i++) {
      const topC = ai_pickTopNumbers(currentScores, gameDef.count, hardExclude);
      topC.forEach(n => currentScores[n] *= PENALTY);
    }
    combo = ai_pickTopNumbers(currentScores, gameDef.count, hardExclude);
  }

  return {
    numbers: combo.sort((a, b) => a - b).map(n => ({ val: n, tag: `趨勢分${Math.round(trendScores[n] || 0)}` })),
    groupReason: random ? `🎲 AI 加權隨機 (Top${AI_CONFIG.PARAMS.lotto.randomCandidateLimit})` : `👑 AI 嚴選 TOP${setIndex + 1}`,
    metadata: { version: '7.2', mode, setIndex }
  };
}

function ai_handleDigitSingle({ data, gameDef, subModeId, hardExclude, random, mode, setIndex }) {
  const digitCount = subModeId || gameDef.count;
  const combo = [];

  for (let pos = 0; pos < digitCount; pos++) {
    const rawScores = ai_buildDigitPosRawScores({ data, pos, params: AI_CONFIG.PARAMS.digit });
    const trendScores = ai_percentileRankTransform(rawScores, 10, 98);

    let pick;
    if (random) {
      // Digit 只有 10 個候選，不需要截斷 (除非 user exclude)
      const candidates = Object.keys(rawScores).map(Number).filter(n => !hardExclude.has(n));
      const ctx = ai_prepareWeightedContext(candidates, rawScores);
      pick = ai_weightedSample(ctx, 1)[0];
    } else {
      const currentScores = { ...trendScores };
      const PENALTY = 0.5;
      for (let i = 0; i < setIndex; i++) {
        const t = Object.keys(currentScores).map(Number).sort((a, b) => currentScores[b] - currentScores[a])[0];
        currentScores[t] *= PENALTY;
      }
      pick = Object.keys(currentScores).map(Number).sort((a, b) => currentScores[b] - currentScores[a])[0];
    }
    combo.push({ val: pick, tag: `趨勢分${Math.round(trendScores[pick])}` });
  }

  return {
    numbers: combo,
    groupReason: random ? `🎲 AI 加權隨機` : `👑 AI 嚴選 TOP${setIndex + 1}`,
    metadata: { version: '7.2', mode, setIndex }
  };
}

function ai_handlePowerSingle({ data, gameDef, hardExclude, random, mode, setIndex }) {
  // Zone 1
  const raw1 = ai_buildRawScores({ data, range: gameDef.range, count: 6, isZone2: false, params: AI_CONFIG.PARAMS.power_zone1 });
  const trend1 = ai_percentileRankTransform(raw1, 10, 98);

  // Zone 2
  const raw2 = ai_buildRawScores({ data, range: gameDef.zone2, count: 1, isZone2: true, params: AI_CONFIG.PARAMS.power_zone2 });
  const trend2 = ai_percentileRankTransform(raw2, 10, 98);

  let z1Combo, z2Val;

  if (random) {
    // Zone1 Random: Top-K + Weighted
    const limit = AI_CONFIG.PARAMS.power_zone1.randomCandidateLimit || 25;
    const c1 = ai_getTopKCandidates(raw1, limit, hardExclude);
    const ctx1 = ai_prepareWeightedContext(c1, raw1);
    z1Combo = ai_weightedSample(ctx1, 6);

    // Zone2 Random: Weighted (no exclude usually)
    const c2 = Object.keys(raw2).map(Number);
    const ctx2 = ai_prepareWeightedContext(c2, raw2);
    z2Val = ai_weightedSample(ctx2, 1)[0];
  } else {
    // Strict
    const currentScores = { ...trend1 };
    const PENALTY = 0.5;
    for (let i = 0; i < setIndex; i++) {
      const t = ai_pickTopNumbers(currentScores, 6, hardExclude);
      t.forEach(n => currentScores[n] *= PENALTY);
    }
    z1Combo = ai_pickTopNumbers(currentScores, 6, hardExclude);

    // Zone2: Cycle through
    const sorted2 = Object.keys(trend2).map(Number).sort((a, b) => trend2[b] - trend2[a]);
    z2Val = sorted2[setIndex % sorted2.length];
  }

  return {
    numbers: [
      ...z1Combo.sort((a, b) => a - b).map(n => ({ val: n, tag: `趨勢分${Math.round(trend1[n] || 0)}` })),
      { val: z2Val, tag: `趨勢分${Math.round(trend2[z2Val] || 0)}` }
    ],
    groupReason: random ? `🎲 AI 加權隨機` : `👑 AI 嚴選 TOP${setIndex + 1}`,
    metadata: { version: '7.2', mode, setIndex }
  };
}


// ==========================================
// [F] 核心演算法 - 分數計算
// ==========================================
// 保持 V7.1 邏輯，不做變動 (ai_buildRawScores, ai_buildDigitPosRawScores...)
function ai_buildRawScores({ data, range, count, isZone2, params }) {
  const { h_short, h_long, epsilon, kPrior } = params;
  const minNum = (range === 9) ? 0 : 1;
  const maxNum = range;

  const numbersPerDraw = data.map(d => {
    if (isZone2) {
      return [d.zone2 || d.numbers[d.numbers.length - 1]];
    } else {
      return d.numbers.slice(0, count).filter(n => n >= minNum && n <= maxNum);
    }
  });

  const weights_short = ai_computeHalfLifeWeights(data.length, h_short);
  const weights_long = ai_computeHalfLifeWeights(data.length, h_long);

  const stats_short = ai_computeWeightedStats(numbersPerDraw, weights_short, minNum, maxNum);
  const stats_long = ai_computeWeightedStats(numbersPerDraw, weights_long, minNum, maxNum);

  const momentum = ai_computeLogLift(stats_short.C, stats_short.E, stats_long.C, stats_long.E, minNum, maxNum, epsilon);
  const shrinkage = ai_computeKishShrinkage(weights_short, kPrior);

  const rawScores = {};
  for (let n = minNum; n <= maxNum; n++) {
    rawScores[n] = momentum[n] * shrinkage;
  }
  return rawScores;
}

function ai_buildDigitPosRawScores({ data, pos, params }) {
  const numbersPerDraw = data.map(d => {
    if (d.numbers && d.numbers.length > pos) return [d.numbers[pos]];
    return [];
  }).filter(arr => arr.length > 0);

  const { h_short, h_long, epsilon, kPrior } = params;
  const weights_short = ai_computeHalfLifeWeights(numbersPerDraw.length, h_short);
  const weights_long = ai_computeHalfLifeWeights(numbersPerDraw.length, h_long);
  const stats_short = ai_computeWeightedStats(numbersPerDraw, weights_short, 0, 9);
  const stats_long = ai_computeWeightedStats(numbersPerDraw, weights_long, 0, 9);
  const momentum = ai_computeLogLift(stats_short.C, stats_short.E, stats_long.C, stats_long.E, 0, 9, epsilon);
  const shrinkage = ai_computeKishShrinkage(weights_short, kPrior);
  const rawScores = {};
  for (let n = 0; n <= 9; n++) {
    rawScores[n] = momentum[n] * shrinkage;
  }
  return rawScores;
}

// ==========================================
// [G] 工具與加權抽樣
// ==========================================

// [V7.2] 強化排除解析：支援 Set, number[], nested array
function ai_parseExcludeNumbers(input) {
  const hardExclude = new Set();

  // 如果輸入本身是 Set
  if (input instanceof Set) {
    input.forEach(v => hardExclude.add(v));
    return hardExclude;
  }

  if (Array.isArray(input)) {
    input.forEach(item => {
      if (typeof item === 'number') {
        hardExclude.add(item);
      } else if (Array.isArray(item)) {
        // 處理 nested array (例如注單排除)，展平
        item.forEach(sub => {
          if (typeof sub === 'number') hardExclude.add(sub);
        });
      }
    });
  }
  return hardExclude;
}

function ai_pickTopNumbers(scores, count, exclude) {
  return Object.keys(scores)
    .map(Number)
    .filter(n => !exclude.has(n))
    .sort((a, b) => scores[b] - scores[a])
    .slice(0, count);
}

// [V7.2] 取得 Top-K 候選 (用於 Random 模式預先截斷)
function ai_getTopKCandidates(rawScores, k, exclude) {
  return Object.keys(rawScores)
    .map(Number)
    .filter(n => !exclude.has(n))
    .sort((a, b) => rawScores[b] - rawScores[a]) // 大到小
    .slice(0, k);
}

// [V7.2] 準備 Context：Softmax Shift-by-Max 保護 + Z-Score 標準化
function ai_prepareWeightedContext(candidates, rawScores) {
  if (candidates.length === 0) return [];

  const values = candidates.map(n => rawScores[n]);
  // 計算 Z-Score 統計量
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const std = Math.sqrt(values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length) || 1e-6;

  // 計算 Z-Score
  const items = candidates.map(n => ({
    num: n,
    z: (rawScores[n] - mean) / std
  }));

  // [Shift-by-Max] 數值穩定保護
  const maxZ = Math.max(...items.map(i => i.z));

  return items.map(item => ({
    num: item.num,
    // weight = exp(z - maxZ)
    // 這樣最大值的 weight 永遠是 1 (exp(0))，其他 < 1，保證不溢位
    weight: Math.exp(item.z - maxZ)
  }));
}

// 加權隨機抽樣 (不放回)
function ai_weightedSample(ctx, count) {
  const picked = [];
  // Deep copy
  let list = ctx.map(x => ({ ...x }));

  for (let i = 0; i < count && list.length > 0; i++) {
    const sumW = list.reduce((a, b) => a + b.weight, 0);
    if (sumW <= 0) {
      // 所有權重為 0 (極端情況)，退化為均勻隨機
      const idx = Math.floor(Math.random() * list.length);
      picked.push(list[idx].num);
      list.splice(idx, 1);
      continue;
    }

    let r = Math.random() * sumW;
    let selectedIdx = -1;

    for (let j = 0; j < list.length; j++) {
      r -= list[j].weight;
      if (r <= 0) {
        selectedIdx = j;
        break;
      }
    }
    if (selectedIdx === -1) selectedIdx = list.length - 1;

    picked.push(list[selectedIdx].num);
    list.splice(selectedIdx, 1);
  }
  return picked;
}

// 其他工具
function ai_posDiff(combo1, combo2) {
  let diff = 0;
  for (let i = 0; i < Math.min(combo1.length, combo2.length); i++) {
    if (combo1[i] !== combo2[i]) diff++;
  }
  return diff;
}

function ai_uniquePermutations(nums) {
  if (nums.length === 0) return [[]];
  const first = nums[0];
  const rest = nums.slice(1);
  const permsWithoutFirst = ai_uniquePermutations(rest);
  const allPerms = [];
  permsWithoutFirst.forEach(perm => {
    for (let i = 0; i <= perm.length; i++) {
      const start = perm.slice(0, i);
      const end = perm.slice(i);
      allPerms.push([...start, first, ...end]);
    }
  });
  const seen = new Set();
  const unique = [];
  allPerms.forEach(p => {
    const k = p.join(',');
    if (!seen.has(k)) {
      seen.add(k);
      unique.push(p);
    }
  });
  return unique;
}

function ai_cartesianProduct(arrays) {
  return arrays.reduce((a, b) => a.flatMap(d => b.map(e => [d, e].flat())), [[]]);
}
