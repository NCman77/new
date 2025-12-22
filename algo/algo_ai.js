/**
 * algo_ai.js V7.0
 * AI 學派：時間序列動能分析
 *
 * 核心演算法：
 * - 半衰期指數衰減權重（short / long 雙尺度）
 * - Log-Lift 動能計算
 * - Kish Neff 收縮
 * - Percentile Rank 轉趨勢分 0-100
 * - Deterministic TOP5 去重（overlap 階梯）
 * - Random 模式（Softmax + 重試 + fallback）
 * - 包牌支援（pack_1 / pack_2）
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
      temperature: 0.7,
      topNRange: [15, 25, 35, 45, 49], // 【修改1】擴大範圍
      tempRange: [0.5, 2.0] // 【修改1】擴大範圍
    },
    power_zone1: {
      h_short: 8,
      h_long: 50,
      epsilon: 1,
      kPrior: 5,
      temperature: 0.7,
      topNRange: [15, 25, 35, 45, 49], // 【修改1】添加並擴大範圍
      tempRange: [0.5, 2.0] // 【修改1】擴大範圍
    },
    power_zone2: {
      h_short: 15,
      h_long: 80,
      epsilon: 2,
      kPrior: 10,
      temperature: 0.5,
      topNRange: [3, 4, 5, 6, 8], // 【修改1】添加範圍
      tempRange: [0.3, 1.5] // 【修改1】擴大範圍
    },
    digit: {
      h_short: 10,
      h_long: 60,
      epsilon: 1,
      kPrior: 8,
      temperature: 0.6,
      tempRange: [0.5, 2.0] // 【修改1】擴大範圍
    }
  },

  // strict 模式 overlap 階梯
  OVERLAP_THRESHOLDS: {
    lotto: [2, 2, 3, 3, 4], // setIndex 0-4
    digit: [1, 1, 2, 2, 2]
  },

  // 重試與 fallback
  RANDOM_RETRY_LIMIT: 30,
  FALLBACK_TO_STRICT: true,

  // digit pack_2 配置
  DIGIT_PACK2_TOP_N: 4
};

// [B] 除錯工具
const log = (...args) => {
  if (AI_CONFIG.DEBUG_MODE) console.log('[AI V7.0]', ...args);
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
  selectedCombo = null // 【修改4】添加參數支援
}) {
  log(`啟動 | 玩法: ${gameDef.type} | 模式: ${mode} | 包牌: ${packMode || '單注'} | setIndex: ${setIndex}`);

  // 1. 資料驗證
  if (!Array.isArray(data) || data.length === 0) {
    log('資料不足');
    return packMode ? [] : {
      numbers: [],
      groupReason: '❌ 資料不足',
      metadata: { version: '7.0', error: 'insufficient_data' }
    };
  }

  // 2. 包牌模式
  if (packMode) {
    return ai_handlePackMode({
      data,
      gameDef,
      packMode,
      targetCount,
      mode,
      random,
      subModeId,
      selectedCombo // 【修改4】傳遞參數
    });
  }

  // 3. 單注模式
  if (gameDef.type === 'power') {
    return ai_handlePowerSingle({
      data,
      gameDef,
      excludeNumbers,
      random,
      mode,
      setIndex
    });
  } else if (gameDef.type === 'digit') {
    return ai_handleDigitSingle({
      data,
      gameDef,
      subModeId,
      excludeNumbers,
      random,
      mode,
      setIndex
    });
  } else {
    // lotto / today
    return ai_handleComboSingle({
      data,
      gameDef,
      excludeNumbers,
      random,
      mode,
      setIndex
    });
  }
}

// ==========================================
// [D] 包牌邏輯
// ==========================================
function ai_handlePackMode({ data, gameDef, packMode, targetCount, mode, random, subModeId, selectedCombo }) {
  log(`包牌模式: ${packMode} | 目標: ${targetCount}注`);

  if (gameDef.type === 'power') {
    return ai_packPower({ data, gameDef, packMode, targetCount, mode, selectedCombo }); // 【修改4】傳遞參數
  } else if (gameDef.type === 'digit') {
    return ai_packDigit({ data, gameDef, packMode, targetCount, subModeId, selectedCombo }); // 【修改4】傳遞參數
  } else {
    return ai_packCombo({ data, gameDef, packMode, targetCount, mode, selectedCombo }); // 【修改4】傳遞參數
  }
}

function ai_packPower({ data, gameDef, packMode, targetCount, mode, selectedCombo }) {
  const tickets = [];

  if (packMode === 'pack_1') {
    // Pack_1: 第1區用 AI Top1，第2區全包 1-8
    let zone1Combo;

    // 【修改3】如果有 selectedCombo，直接使用，否則用降權策略選 TOP 1
    if (selectedCombo && Array.isArray(selectedCombo) && selectedCombo.length >= 6) {
      zone1Combo = selectedCombo.slice(0, 6);
    } else {
      const zone1Scores = ai_buildCandidateScores({
        data,
        range: gameDef.range,
        count: 6,
        isZone2: false,
        params: AI_CONFIG.PARAMS.power_zone1
      });

      // 使用降權策略選出 TOP 1
      const currentScores = { ...zone1Scores };
      const PENALTY = 0.7;
      
      // 根據需要降權次數（這裡選 TOP 1，所以不需要降權）
      zone1Combo = ai_pickTopNumbers(currentScores, 6, new Set());
    }

    // 第2區全包
    for (let z2 = 1; z2 <= 8; z2++) {
      tickets.push({
        numbers: [
          ...zone1Combo.map((n, idx) => ({ val: n, tag: `Z1(${String(idx + 1).padStart(2, '0')})` })),
          { val: z2, tag: `Z2(${String(z2).padStart(2, '0')})` }
        ],
        groupReason: `威力彩包牌 ${z2}/8 - 第1區 AI Top1 鎖定`,
        metadata: { version: '7.0', packMode: 'pack_1', zone2: z2 }
      });
    }

  } else {
    // Pack_2: 第1區分散（使用降權策略），第2區輪流
    const zone1Scores = ai_buildCandidateScores({
      data,
      range: gameDef.range,
      count: 6,
      isZone2: false,
      params: AI_CONFIG.PARAMS.power_zone1
    });

    const zone2Scores = ai_buildCandidateScores({
      data,
      range: gameDef.zone2,
      count: 1,
      isZone2: true,
      params: AI_CONFIG.PARAMS.power_zone2
    });

    const sortedZ2 = Object.keys(zone2Scores).map(Number).sort((a, b) => zone2Scores[b] - zone2Scores[a]);

    // 【修改3】使用降權策略生成 5 組不同的第1區組合
    const currentScores = { ...zone1Scores };
    const PENALTY = 0.7;

    for (let i = 0; i < Math.min(targetCount, 5); i++) {
      const zone1Combo = ai_pickTopNumbers(currentScores, 6, new Set());
      
      // 降權已選號碼
      zone1Combo.forEach(n => {
        currentScores[n] *= PENALTY;
      });

      const z2Val = sortedZ2[i % sortedZ2.length];

      tickets.push({
        numbers: [
          ...zone1Combo.map(n => ({ val: n, tag: `趨勢分${Math.round(zone1Scores[n] || 50)}` })),
          { val: z2Val, tag: `趨勢分${Math.round(zone2Scores[z2Val] || 50)}` }
        ],
        groupReason: `威力彩彈性包牌 ${i + 1}/${targetCount}`,
        metadata: { version: '7.0', packMode: 'pack_2' }
      });
    }
  }

  log(`威力彩包牌完成: ${tickets.length}注`);
  return tickets;
}

function ai_packDigit({ data, gameDef, packMode, targetCount, subModeId, selectedCombo }) {
  const tickets = [];
  const digitCount = subModeId || gameDef.count;

  if (packMode === 'pack_1') {
    // Pack_1: 每位 Top1 的全排列
    const posScores = [];

    for (let pos = 0; pos < digitCount; pos++) {
      const scores = ai_buildDigitPosScores({ data, pos, params: AI_CONFIG.PARAMS.digit });
      const topNum = Object.keys(scores).map(Number).sort((a, b) => scores[b] - scores[a])[0];
      posScores.push({ pos, num: topNum, score: scores[topNum] });
    }

    const baseCombo = posScores.map(p => p.num);
    const perms = ai_uniquePermutations(baseCombo);

    perms.forEach((combo, idx) => {
      tickets.push({
        numbers: combo.map((num, pos) => ({ val: num, tag: `Pos${pos + 1}` })),
        groupReason: `數字型強勢包牌 ${idx + 1}/${perms.length} - Top1全排列`,
        metadata: { version: '7.0', packMode: 'pack_1' }
      });
    });

  } else {
    // Pack_2: 每位 Top N 的笛卡兒積高分挑選
    const TOP_N = AI_CONFIG.DIGIT_PACK2_TOP_N;
    const posCandidates = [];

    for (let pos = 0; pos < digitCount; pos++) {
      const scores = ai_buildDigitPosScores({ data, pos, params: AI_CONFIG.PARAMS.digit });
      const topNums = Object.keys(scores).map(Number).sort((a, b) => scores[b] - scores[a]).slice(0, TOP_N);
      posCandidates.push(topNums.map(n => ({ num: n, score: scores[n] })));
    }

    // 笛卡兒積
    const allCombos = ai_cartesianProduct(posCandidates.map(pc => pc.map(c => c.num)));

    // 計算 ComboScore
    const rankedCombos = allCombos.map(combo => {
      let score = 0;
      combo.forEach((num, pos) => {
        const posScore = posCandidates[pos].find(c => c.num === num)?.score || 0;
        score += Math.log(posScore + 1);
      });
      return { combo, score };
    }).sort((a, b) => b.score - a.score);

    // 挑選分散的前 N 注
    const picked = [];
    const pickWithMinDiff = (minDiff) => {
      for (const item of rankedCombos) {
        if (picked.length >= targetCount) break;
        const combo = item.combo;
        if (minDiff > 0) {
          const ok = picked.every(p => ai_posDiff(p, combo) >= minDiff);
          if (!ok) continue;
        }
        picked.push(combo);
      }
    };

    pickWithMinDiff(2);
    if (picked.length < targetCount) pickWithMinDiff(1);
    if (picked.length < targetCount) pickWithMinDiff(0);

    picked.forEach((combo, idx) => {
      tickets.push({
        numbers: combo.map((num, pos) => {
          const posScore = posCandidates[pos].find(c => c.num === num)?.score || 50;
          return { val: num, tag: `趨勢分${Math.round(posScore)}` };
        }),
        groupReason: `數字型彈性包牌 ${idx + 1}/${picked.length} - Top${TOP_N}笛卡兒積`,
        metadata: { version: '7.0', packMode: 'pack_2' }
      });
    });
  }

  log(`數字型包牌完成: ${tickets.length}注`);
  return tickets;
}

function ai_packCombo({ data, gameDef, packMode, targetCount, mode, selectedCombo }) {
  // 樂透型包牌（539 等）
  const tickets = [];
  const scores = ai_buildCandidateScores({
    data,
    range: gameDef.range,
    count: gameDef.count,
    isZone2: false,
    params: AI_CONFIG.PARAMS.lotto
  });

  if (packMode === 'pack_1') {
    // 【修改2】Pack_1: 改用降權策略（與 ai_handleComboSingle 嚴選模式相同邏輯）
    const currentScores = { ...scores };
    const PENALTY = 0.7; // 降權係數

    for (let i = 0; i < targetCount; i++) {
      const combo = ai_pickTopNumbers(currentScores, gameDef.count, new Set());
      
      // 降權已選號碼
      combo.forEach(n => {
        currentScores[n] *= PENALTY;
      });

      tickets.push({
        numbers: combo.map(n => ({ val: n, tag: `趨勢分${Math.round(scores[n] || 50)}` })),
        groupReason: `樂透包牌 ${i + 1}/${targetCount} - 降權策略`,
        metadata: { version: '7.0', packMode: 'pack_1' }
      });
    }

  } else {
    // Pack_2: 隨機分散
    const sortedNums = Object.keys(scores).map(Number).sort((a, b) => scores[b] - scores[a]);

    for (let i = 0; i < targetCount; i++) {
      const shuffled = ai_fisherYates([...sortedNums]);
      const combo = shuffled.slice(0, gameDef.count).sort((a, b) => a - b);

      tickets.push({
        numbers: combo.map(n => ({ val: n, tag: `趨勢分${Math.round(scores[n] || 50)}` })),
        groupReason: `樂透彈性包牌 ${i + 1}/${targetCount}`,
        metadata: { version: '7.0', packMode: 'pack_2' }
      });
    }
  }

  log(`樂透型包牌完成: ${tickets.length}注`);
  return tickets;
}

// ==========================================
// [E] 單注邏輯
// ==========================================
function ai_handleComboSingle({ data, gameDef, excludeNumbers, random, mode, setIndex }) {
  const scores = ai_buildCandidateScores({
    data,
    range: gameDef.range,
    count: gameDef.count,
    isZone2: false,
    params: AI_CONFIG.PARAMS.lotto
  });

  // 忽略 excludeNumbers（避免模式互相干擾）
  const hardExclude = new Set();

  // 過濾候選
  const candidates = Object.keys(scores)
    .map(Number)
    .filter(n => !hardExclude.has(n))
    .sort((a, b) => scores[b] - scores[a]);

  let combo;

  if (random) {
    // 隨機模式：使用動態參數
    const params = AI_CONFIG.PARAMS.lotto;
    const topNOptions = params.topNRange;
    const topN = topNOptions[setIndex % topNOptions.length];
    const tempMin = params.tempRange[0];
    const tempMax = params.tempRange[1];
    const temperature = tempMin + Math.random() * (tempMax - tempMin);
    const topCandidates = candidates.slice(0, topN);
    combo = ai_softmaxSample(topCandidates.map(n => ({ num: n, score: scores[n] })), temperature, gameDef.count);

  } else {
    // 嚴選模式：貪心加總 + 軟降權策略
    const currentScores = { ...scores };
    const PENALTY = 0.7; // 降權係數

    // 根據 setIndex 決定降權次數
    for (let i = 0; i < setIndex; i++) {
      // 選出當前最高分的組合
      const tempCombo = ai_pickTopNumbers(currentScores, gameDef.count, new Set());

      // 降權已選號碼
      tempCombo.forEach(n => {
        currentScores[n] *= PENALTY;
      });
    }

    // 最後一次選出的就是 TOP N 組合
    combo = ai_pickTopNumbers(currentScores, gameDef.count, new Set());
  }

  return {
    numbers: combo.sort((a, b) => a - b).map(n => ({ val: n, tag: `趨勢分${Math.round(scores[n])}` })),
    groupReason: random ? `🎲 隨機推薦 (AI動能導向)` : `👑 AI嚴選 TOP${setIndex + 1}`,
    metadata: { version: '7.0', mode, setIndex }
  };
}

function ai_handlePowerSingle({ data, gameDef, excludeNumbers, random, mode, setIndex }) {
  const zone1Scores = ai_buildCandidateScores({
    data,
    range: gameDef.range,
    count: 6,
    isZone2: false,
    params: AI_CONFIG.PARAMS.power_zone1
  });

  const zone2Scores = ai_buildCandidateScores({
    data,
    range: gameDef.zone2,
    count: 1,
    isZone2: true,
    params: AI_CONFIG.PARAMS.power_zone2
  });

  // 忽略 excludeNumbers
  const hardExclude = new Set();

  const zone1Candidates = Object.keys(zone1Scores)
    .map(Number)
    .filter(n => !hardExclude.has(n))
    .sort((a, b) => zone1Scores[b] - zone1Scores[a]);

  const zone2Candidates = Object.keys(zone2Scores)
    .map(Number)
    .sort((a, b) => zone2Scores[b] - zone2Scores[a]);

  let zone1Combo, zone2Val;

  if (random) {
    // 隨機模式：動態溫度
    const params1 = AI_CONFIG.PARAMS.power_zone1;
    const topNOptions = params1.topNRange || [10, 15, 20, 30, 38];
    const topN = topNOptions[setIndex % topNOptions.length];
    const temp1 = params1.tempRange[0] + Math.random() * (params1.tempRange[1] - params1.tempRange[0]);

    const params2 = AI_CONFIG.PARAMS.power_zone2;
    const topNOptions2 = params2.topNRange || [3, 4, 5, 6, 8];
    const topN2 = topNOptions2[setIndex % topNOptions2.length];
    const temp2 = params2.tempRange[0] + Math.random() * (params2.tempRange[1] - params2.tempRange[0]);

    const topCandidates1 = zone1Candidates.slice(0, topN);
    const topCandidates2 = zone2Candidates.slice(0, topN2);

    zone1Combo = ai_softmaxSample(topCandidates1.map(n => ({ num: n, score: zone1Scores[n] })), temp1, 6);
    zone2Val = ai_softmaxSample(topCandidates2.map(n => ({ num: n, score: zone2Scores[n] })), temp2, 1)[0];

  } else {
    // 嚴選模式：軟降權策略
    const currentScores = { ...zone1Scores };
    const PENALTY = 0.7;

    for (let i = 0; i < setIndex; i++) {
      const tempCombo = ai_pickTopNumbers(currentScores, 6, new Set());
      tempCombo.forEach(n => {
        currentScores[n] *= PENALTY;
      });
    }

    zone1Combo = ai_pickTopNumbers(currentScores, 6, new Set());
    zone2Val = zone2Candidates[setIndex % zone2Candidates.length];
  }

  return {
    numbers: [
      ...zone1Combo.sort((a, b) => a - b).map(n => ({ val: n, tag: `趨勢分${Math.round(zone1Scores[n])}` })),
      { val: zone2Val, tag: `趨勢分${Math.round(zone2Scores[zone2Val])}` }
    ],
    groupReason: random ? `🎲 隨機推薦 (AI動能導向)` : `👑 AI嚴選 TOP${setIndex + 1}`,
    metadata: { version: '7.0', mode, setIndex }
  };
}

function ai_handleDigitSingle({ data, gameDef, subModeId, excludeNumbers, random, mode, setIndex }) {
  const digitCount = subModeId || gameDef.count;
  const combo = [];

  for (let pos = 0; pos < digitCount; pos++) {
    const scores = ai_buildDigitPosScores({ data, pos, params: AI_CONFIG.PARAMS.digit });
    const candidates = Object.keys(scores).map(Number).sort((a, b) => scores[b] - scores[a]);

    let pick;

    if (random) {
      // 隨機模式：動態溫度
      const params = AI_CONFIG.PARAMS.digit;
      const temperature = params.tempRange[0] + Math.random() * (params.tempRange[1] - params.tempRange[0]);
      pick = ai_softmaxSample(candidates.map(n => ({ num: n, score: scores[n] })), temperature, 1)[0];

    } else {
      // 嚴選模式：軟降權策略
      const currentScores = { ...scores };
      const PENALTY = 0.7;

      for (let i = 0; i < setIndex; i++) {
        const tempPick = candidates.sort((a, b) => currentScores[b] - currentScores[a])[0];
        currentScores[tempPick] *= PENALTY;
      }

      pick = candidates.sort((a, b) => currentScores[b] - currentScores[a])[0];
    }

    combo.push({ val: pick, tag: `趨勢分${Math.round(scores[pick])}` });
  }

  return {
    numbers: combo,
    groupReason: random ? `🎲 隨機推薦 (AI動能導向)` : `👑 AI嚴選 TOP${setIndex + 1}`,
    metadata: { version: '7.0', mode, setIndex }
  };
}

// ==========================================
// [F] 核心演算法 - 候選分數計算
// ==========================================
function ai_buildCandidateScores({ data, range, count, isZone2, params }) {
  const { h_short, h_long, epsilon, kPrior } = params;
  const minNum = (range === 9) ? 0 : 1; // digit 允許 0
  const maxNum = range;

  // 提取號碼資料
  const numbersPerDraw = data.map(d => {
    if (isZone2) {
      // 威力彩第2區
      return [d.zone2 || d.numbers[d.numbers.length - 1]];
    } else {
      // 主區號碼
      return d.numbers.slice(0, count).filter(n => n >= minNum && n <= maxNum);
    }
  });

  // 計算權重
  const weights_short = ai_computeHalfLifeWeights(data.length, h_short);
  const weights_long = ai_computeHalfLifeWeights(data.length, h_long);

  // 計算加權統計
  const stats_short = ai_computeWeightedStats(numbersPerDraw, weights_short, minNum, maxNum);
  const stats_long = ai_computeWeightedStats(numbersPerDraw, weights_long, minNum, maxNum);

  // 計算 Log-Lift
  const momentum = ai_computeLogLift(stats_short.C, stats_short.E, stats_long.C, stats_long.E, minNum, maxNum, epsilon);

  // 計算收縮係數
  const shrinkage = ai_computeKishShrinkage(weights_short, kPrior);

  // 收縮後的分數
  const shrunkScores = {};
  for (let n = minNum; n <= maxNum; n++) {
    shrunkScores[n] = momentum[n] * shrinkage;
  }

  // 轉換為趨勢分 0-100
  const trendScores = ai_percentileRankTransform(shrunkScores, 10, 98);

  log(`候選分數計算完成 | range: ${minNum}-${maxNum} | shrinkage: ${shrinkage.toFixed(3)}`);
  return trendScores;
}

function ai_buildDigitPosScores({ data, pos, params }) {
  const numbersPerDraw = data.map(d => {
    if (d.numbers && d.numbers.length > pos) {
      return [d.numbers[pos]];
    }
    return [];
  }).filter(arr => arr.length > 0);

  const { h_short, h_long, epsilon, kPrior } = params;

  const weights_short = ai_computeHalfLifeWeights(numbersPerDraw.length, h_short);
  const weights_long = ai_computeHalfLifeWeights(numbersPerDraw.length, h_long);

  const stats_short = ai_computeWeightedStats(numbersPerDraw, weights_short, 0, 9);
  const stats_long = ai_computeWeightedStats(numbersPerDraw, weights_long, 0, 9);

  const momentum = ai_computeLogLift(stats_short.C, stats_short.E, stats_long.C, stats_long.E, 0, 9, epsilon);

  const shrinkage = ai_computeKishShrinkage(weights_short, kPrior);

  const shrunkScores = {};
  for (let n = 0; n <= 9; n++) {
    shrunkScores[n] = momentum[n] * shrinkage;
  }

  const trendScores = ai_percentileRankTransform(shrunkScores, 10, 98);
  return trendScores;
}

// ==========================================
// [G] 工具函式
// ==========================================
function ai_parseExcludeNumbers(excludeNumbers) {
  const hardExclude = new Set();
  const layerB = [];

  if (excludeNumbers instanceof Set) {
    excludeNumbers.forEach(n => hardExclude.add(n));
  } else if (Array.isArray(excludeNumbers)) {
    if (excludeNumbers.length > 0) {
      if (typeof excludeNumbers[0] === 'number') {
        // Layer A: 硬排除
        excludeNumbers.forEach(n => hardExclude.add(n));
      } else if (Array.isArray(excludeNumbers[0])) {
        // Layer B: 注級累積
        excludeNumbers.forEach(combo => layerB.push(combo));
      }
    }
  }

  return { hardExclude, layerB };
}

function ai_pickTopNumbers(scores, count, exclude) {
  const candidates = Object.keys(scores)
    .map(Number)
    .filter(n => !exclude.has(n))
    .sort((a, b) => scores[b] - scores[a]);

  return candidates.slice(0, count);
}

function ai_softmaxSample(candidates, temperature, count) {
  if (candidates.length === 0) return [];

  // 計算 softmax 機率
  const maxScore = Math.max(...candidates.map(c => c.score));
  const expScores = candidates.map(c => Math.exp((c.score - maxScore) / temperature));
  const sumExp = expScores.reduce((a, b) => a + b, 0);
  const probs = expScores.map(e => e / sumExp);

  // 不放回抽樣
  const picked = [];
  const remaining = [...candidates];
  const remainingProbs = [...probs];

  for (let i = 0; i < count && remaining.length > 0; i++) {
    // 累積機率抽樣
    const rand = Math.random();
    let cumProb = 0;
    let idx = 0;

    for (let j = 0; j < remainingProbs.length; j++) {
      cumProb += remainingProbs[j];
      if (rand <= cumProb) {
        idx = j;
        break;
      }
    }

    picked.push(remaining[idx].num);
    remaining.splice(idx, 1);
    remainingProbs.splice(idx, 1);

    // 重新歸一化
    const newSum = remainingProbs.reduce((a, b) => a + b, 0);
    if (newSum > 0) {
      for (let j = 0; j < remainingProbs.length; j++) {
        remainingProbs[j] /= newSum;
      }
    }
  }

  return picked;
}

function ai_uniquePermutations(nums) {
  const counts = new Map();
  nums.forEach(n => counts.set(n, (counts.get(n) || 0) + 1));
  const uniqueVals = Array.from(counts.keys());

  const res = [];
  const path = [];

  const dfs = () => {
    if (path.length === nums.length) {
      res.push([...path]);
      return;
    }

    for (const v of uniqueVals) {
      const c = counts.get(v) || 0;
      if (c <= 0) continue;
      counts.set(v, c - 1);
      path.push(v);
      dfs();
      path.pop();
      counts.set(v, c);
    }
  };

  dfs();
  return res;
}

function ai_cartesianProduct(arrays) {
  if (arrays.length === 0) return [];
  if (arrays.length === 1) return arrays[0].map(x => [x]);

  const result = [];
  const helper = (current, remaining) => {
    if (remaining.length === 0) {
      result.push([...current]);
      return;
    }

    for (const item of remaining[0]) {
      helper([...current, item], remaining.slice(1));
    }
  };

  helper([], arrays);
  return result;
}

function ai_posDiff(combo1, combo2) {
  let diff = 0;
  for (let i = 0; i < combo1.length; i++) {
    if (combo1[i] !== combo2[i]) diff++;
  }
  return diff;
}

function ai_fisherYates(arr) {
  const res = [...arr];
  for (let i = res.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [res[i], res[j]] = [res[j], res[i]];
  }
  return res;
}

function ai_arrayToScoreMap(arr, scoreMap) {
  const result = {};
  arr.forEach(n => {
    result[n] = scoreMap[n] || 0;
  });
  return result;
}
