/**
 * algo_ai.js V8.7.1 (Stable Release)
 * 
 * 修正歷史：
 * 
 * V8.7.1 (2024-12-23):
 * - [Critical] 修復數字型彩票資料不足時的崩潰
 * - [Critical] 修復四星彩讀取三星彩資料時的錯誤
 * - [UX] 改進錯誤訊息，明確指出問題原因
 * 
 * V8.7 (2024-12-23):
 * - 統一所有版本號為 8.7
 * - 完整測試驗證通過
 * 
 * V8.6.2:
 * - [Critical] 修復 ai_handleComboSingle return 語句位置錯誤
 * - [Critical] 修復 ai_handleDigitSingle 遺失變數宣告
 * 
 * V8.6:
 * - [Security] Digit Random 模式崩潰修復
 * - [Security] Digit Strict 模式尊重排除號碼
 * - [Security] Digit Pack 1 & Pack 2 候選池污染修復
 * - [Refactor] 排序副作用修復（使用展開運算子）
 * 
 * V8.5:
 * - [Logic] Dynamic Pool Refresh（動態候選池更新）
 * - [Refactor] ai_pickTopK_WithSafetyCheck 命名改進
 * - [Stability] Deterministic Replay 可重現性
 */


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

  PARAMS: {
    lotto: {
      h_short: 8, h_long: 50, epsilon: 1, kPrior: 5,
      randomCandidateLimit: 25
    },
    power_zone1: {
      h_short: 8, h_long: 50, epsilon: 1, kPrior: 5,
      randomCandidateLimit: 25
    },
    power_zone2: {
      h_short: 15, h_long: 80, epsilon: 2, kPrior: 10,
      randomCandidateLimit: 8
    },
    digit: {
      h_short: 10, h_long: 60, epsilon: 1, kPrior: 8,
      randomCandidateLimit: 10
    }
  },

  OVERLAP_LIMITS: {
    strict: [0, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4],
    digit: [0, 0, 0, 1, 1, 1, 1, 2, 2, 2],
    default: 3
  },

  PENALTIES: {
    STRICT_NEXT_SET: 0.5,
    STRICT_OVERLAP: 0.1,
    PACK_DECAY: 0.7,
    COMBO_EXCLUDE: 0.9,
    VIOLATION_DIFF: 0.2
  },

  LIMITS: {
    DIGIT_PACK2_TOP_N: 6,
    MAX_CARTESIAN_SIZE: 5000,
    MAX_RETRY_ATTEMPTS: 50,
    CANDIDATE_BUFFER: 5
  }
};

// ==========================================
// [B] Scoped RNG
// ==========================================
class ScopedRNG {
  constructor(seed) {
    if (typeof seed === 'number') {
      this.seed = seed;
    } else {
      const t = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      this.seed = (t >>> 0) ^ (Math.random() * 0x100000000);
    }
    this.state = this.seed;
  }
  next() {
    let t = this.state += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

// ==========================================
// [C] 主入口函式
// ==========================================
export function algoAI(params) {
  let {
    data, gameDef, subModeId, excludeNumbers = [], random = false,
    mode = 'strict', packMode = null, targetCount = 5, setIndex = 0,
    selectedCombo = null, seed = null,
    externalHistory = []
  } = params;

  const rng = new ScopedRNG(seed);

  let safeData = [...data];
  if (safeData.length > 1) {
    const first = safeData[0];
    const last = safeData[safeData.length - 1];
    if (first.date && last.date && first.date < last.date) {
      safeData.reverse();
    }
  }
  if (safeData.length === 0) return _errorResult(packMode, '❌ 資料不足', 'insufficient_data');

  const { hardExcludeNum, hardExcludeCombo } = ai_parseExclude(excludeNumbers);

  const safeExternalHistory = [];
  const expectedLength = gameDef.count;
  const warnings = [];

  if (Array.isArray(externalHistory)) {
    externalHistory.forEach(item => {
      if (Array.isArray(item)) {
        if (item.length === expectedLength && item.every(n => typeof n === 'number')) {
          safeExternalHistory.push(item);
        } else {
          warnings.push(`Ignored external history item: Invalid format (Len:${item.length}, Exp:${expectedLength})`);
        }
      }
    });
  }

  const ctx = {
    data: safeData, gameDef, subModeId, hardExcludeNum, hardExcludeCombo,
    random, mode, packMode, targetCount, setIndex, selectedCombo,
    rng, externalHistory: safeExternalHistory,
    warnings
  };

  try {
    let result;
    if (packMode) result = ai_handlePackMode(ctx);
    else if (gameDef.type === 'power') result = ai_handlePowerSingle(ctx);
    else if (gameDef.type === 'digit') result = ai_handleDigitSingle(ctx);
    else result = ai_handleComboSingle(ctx);

    if (ctx.warnings.length > 0) {
      if (Array.isArray(result)) {
        result.forEach(ticket => {
          if (!ticket.metadata.warnings) ticket.metadata.warnings = [];
          ticket.metadata.warnings.push(...ctx.warnings);
        });
      } else {
        if (!result.metadata.warnings) result.metadata.warnings = [];
        result.metadata.warnings.push(...ctx.warnings);
      }
    }
    return result;

  } catch (err) {
    console.error("[AI V8.7.1 Error]", err);
    return _errorResult(packMode, `❌ ${err.message}`, 'computation_error');
  }
}

function _errorResult(isPack, reason, code) {
  const meta = { version: '8.7', error: code };
  return isPack ? [] : { numbers: [], groupReason: reason, metadata: meta };
}

// ==========================================
// [D] 包牌 Logic
// ==========================================
function ai_handlePackMode(ctx) {
  const { gameDef } = ctx;
  if (gameDef.type === 'power') return ai_packPower(ctx);
  if (gameDef.type === 'digit') return ai_packDigit(ctx);
  return ai_packCombo(ctx);
}

function ai_packPower(ctx) {
  const { data, gameDef, packMode, targetCount, selectedCombo, hardExcludeNum, rng } = ctx;
  const tickets = [];

  const z1Raw = ai_buildRawScores({ data, range: gameDef.range, count: 6, isZone2: false, params: AI_CONFIG.PARAMS.power_zone1 });
  const z1Trend = ai_percentileRankTransform(z1Raw, 10, 98);
  const z2Raw = ai_buildRawScores({ data, range: gameDef.zone2, count: 1, isZone2: true, params: AI_CONFIG.PARAMS.power_zone2 });
  const z2Trend = ai_percentileRankTransform(z2Raw, 10, 98);

  if (packMode === 'pack_1') {
    let zone1Combo;
    if (selectedCombo && selectedCombo.length >= 6) {
      zone1Combo = selectedCombo.slice(0, 6);
    } else {
      // [V8.5] Honest Naming
      zone1Combo = ai_pickTopK_WithSafetyCheck(z1Trend, 6, hardExcludeNum, ctx);
    }

    for (let z2 = 1; z2 <= 8; z2++) {
      tickets.push({
        numbers: [
          ...zone1Combo.map(n => ({ val: n, tag: `Z1(${String(n).padStart(2, '0')})` })),
          { val: z2, tag: `Z2(${String(z2).padStart(2, '0')})` }
        ],
        groupReason: `威力彩包牌 ${z2}/8`,
        metadata: { version: '8.7', packMode: 'pack_1' }
      });
    }

  } else {
    // Pack 2 (Random)
    const limit = AI_CONFIG.PARAMS.power_zone1.randomCandidateLimit;
    const z1Cands = ai_getTopKCandidates(z1Raw, limit, hardExcludeNum, ctx);
    const z1Ctx = ai_prepareWeightedContext(z1Cands, z1Raw);
    const z2Cands = Object.keys(z2Raw).map(Number);
    const z2Ctx = ai_prepareWeightedContext(z2Cands, z2Raw);

    const seenSigs = new Set();

    for (let i = 0; i < targetCount; i++) {
      let loop = 0;
      let z1Combo, z2Val, signature;
      let degraded = false;
      let dReason = null;
      let excludeHits = 0, dedupHits = 0;

      while (loop < AI_CONFIG.LIMITS.MAX_RETRY_ATTEMPTS) {
        z1Combo = ai_weightedSample(z1Ctx, 6, rng);
        z2Val = ai_weightedSample(z2Ctx, 1, rng)[0];
        signature = [...z1Combo].sort((a, b) => a - b).join(',') + '|' + z2Val;

        if (ai_isComboExcluded(z1Combo, ctx.hardExcludeCombo)) {
          excludeHits++; loop++; continue;
        }
        if (seenSigs.has(signature)) {
          dedupHits++; loop++; continue;
        }
        break;
      }

      if (loop >= AI_CONFIG.LIMITS.MAX_RETRY_ATTEMPTS) {
        degraded = true;
        dReason = (excludeHits > dedupHits) ? 'exclude_limit' : 'dedup_limit';
      }
      seenSigs.add(signature);

      tickets.push({
        numbers: [
          ...z1Combo.sort((a, b) => a - b).map(n => ({ val: n, tag: `趨勢分${Math.round(z1Trend[n] || 50)}` })),
          { val: z2Val, tag: `趨勢分${Math.round(z2Trend[z2Val] || 50)}` }
        ],
        groupReason: `威力彩隨機 ${i + 1}/${targetCount}`,
        metadata: { version: '8.7', packMode: 'pack_2', degraded, dReason, attempts: loop }
      });
    }
  }
  return tickets;
}

function ai_packCombo(ctx) {
  const { data, gameDef, packMode, targetCount, hardExcludeNum, rng } = ctx;
  const tickets = [];

  const rawScores = ai_buildRawScores({ data, range: gameDef.range, count: gameDef.count, isZone2: false, params: AI_CONFIG.PARAMS.lotto });
  const trendScores = ai_percentileRankTransform(rawScores, 10, 98);

  if (packMode === 'pack_1') {
    const currentScores = { ...trendScores };
    const PENALTY = AI_CONFIG.PENALTIES.PACK_DECAY;

    for (let i = 0; i < targetCount; i++) {
      // [V8.5] Honest Naming
      let combo = ai_pickTopK_WithSafetyCheck(currentScores, gameDef.count, hardExcludeNum, ctx);

      combo.forEach(n => { currentScores[n] *= PENALTY; });
      tickets.push({
        numbers: combo.map(n => ({ val: n, tag: `趨勢分${Math.round(trendScores[n] || 50)}` })),
        groupReason: `樂透包牌 ${i + 1}/${targetCount}`,
        metadata: { version: '8.7', packMode: 'pack_1' }
      });
    }
  } else {
    // Pack 2 (Random)
    const limit = AI_CONFIG.PARAMS.lotto.randomCandidateLimit;
    const candidates = ai_getTopKCandidates(rawScores, limit, hardExcludeNum, ctx);
    const weightedCtx = ai_prepareWeightedContext(candidates, rawScores);

    const seenSigs = new Set();

    for (let i = 0; i < targetCount; i++) {
      let loop = 0;
      let combo, sig, degraded = false, dReason = null;
      let excludeHits = 0, dedupHits = 0;

      while (loop < AI_CONFIG.LIMITS.MAX_RETRY_ATTEMPTS) {
        combo = ai_weightedSample(weightedCtx, gameDef.count, rng);
        sig = [...combo].sort((a, b) => a - b).join(',');

        if (ai_isComboExcluded(combo, ctx.hardExcludeCombo)) { excludeHits++; loop++; continue; }
        if (seenSigs.has(sig)) { dedupHits++; loop++; continue; }
        break;
      }
      if (loop >= AI_CONFIG.LIMITS.MAX_RETRY_ATTEMPTS) {
        degraded = true;
        dReason = (excludeHits > dedupHits) ? 'exclude_limit' : 'dedup_limit';
      }
      seenSigs.add(sig);

      tickets.push({
        numbers: combo.sort((a, b) => a - b).map(n => ({ val: n, tag: `趨勢分${Math.round(trendScores[n] || 50)}` })),
        groupReason: `樂透隨機 ${i + 1}/${targetCount}`,
        metadata: { version: '8.7', packMode: 'pack_2', degraded, dReason }
      });
    }
  }
  return tickets;
}

function ai_packDigit(ctx) {
  const { data, gameDef, packMode, targetCount, subModeId, rng, hardExcludeNum } = ctx;
  const tickets = [];
  const digitCount = subModeId || gameDef.count;

  if (packMode === 'pack_1') {
    const posScores = [];
    for (let pos = 0; pos < digitCount; pos++) {
      const rScores = ai_buildDigitPosRawScores({ data, pos, params: AI_CONFIG.PARAMS.digit });
      const tScores = ai_percentileRankTransform(rScores, 10, 98);
      // [V8.6] Pack 1 Filter
      const validCands = Object.keys(tScores).map(Number).filter(n => !hardExcludeNum.has(n));
      if (validCands.length === 0) {
        throw new Error(`包牌1候選數不足 (位置${pos} 全被排除)`);
      }
      const topNum = validCands.sort((a, b) => tScores[b] - tScores[a])[0];
      posScores.push({ pos, num: topNum });
    }
    const perms = ai_uniquePermutations(posScores.map(p => p.num));
    perms.forEach((combo, idx) => {
      tickets.push({
        numbers: combo.map((num, pos) => ({ val: num, tag: `Pos${pos + 1}` })),
        groupReason: `數字型包牌 ${idx + 1}/${perms.length}`,
        metadata: { version: '8.7', packMode: 'pack_1' }
      });
    });

  } else {
    // Pack 2
    const TOP_N = AI_CONFIG.LIMITS.DIGIT_PACK2_TOP_N;
    const posCands = [];
    for (let pos = 0; pos < digitCount; pos++) {
      const rScores = ai_buildDigitPosRawScores({ data, pos, params: AI_CONFIG.PARAMS.digit });
      const tScores = ai_percentileRankTransform(rScores, 10, 98);
      // [V8.6] Pack 2 Filter
      const validCands = Object.keys(tScores).map(Number).filter(n => !hardExcludeNum.has(n));
      if (validCands.length === 0) {
        throw new Error(`包牌2候選數不足 (位置${pos} 全被排除)`);
      }
      const topNums = validCands.sort((a, b) => tScores[b] - tScores[a]).slice(0, TOP_N);
      posCands.push(topNums.map(n => ({ num: n, score: tScores[n] })));
    }

    const totalSize = posCands.reduce((acc, curr) => acc * curr.length, 1);

    let safeMode = totalSize > AI_CONFIG.LIMITS.MAX_CARTESIAN_SIZE;

    let picked = [];
    let degraded = false;
    let dReason = null;

    if (!safeMode) {
      const all = ai_cartesianProduct(posCands.map(pc => pc.map(c => c.num)));

      if (targetCount > all.length) {
        degraded = true;
        dReason = 'insufficient_combinations';
        if (ctx.warnings) ctx.warnings.push(`組合數不足: 需 ${targetCount}, 僅存 ${all.length}`);
      }

      const ranked = all.map(combo => {
        let sc = 0;
        combo.forEach((n, p) => {
          const match = posCands[p].find(x => x.num === n);
          sc += match ? match.score : 0;
        });
        return { combo, score: sc };
      }).sort((a, b) => b.score - a.score);

      const seenSigs = new Set();

      for (const item of ranked) {
        if (picked.length >= targetCount) break;
        const sig = item.combo.join(',');
        if (seenSigs.has(sig)) continue;
        if (ai_isComboExcluded(item.combo, ctx.hardExcludeCombo)) continue;
        seenSigs.add(sig);
        picked.push(item);
      }
    } else {
      // Safe Mode
      degraded = true;
      dReason = 'cartesian_safe_mode';
      let loop = 0;
      const seen = new Set();
      const MAX_SAFE_LOOP = 200;

      while (picked.length < targetCount && loop < MAX_SAFE_LOOP) {
        const combo = posCands.map(pc => pc[Math.floor(rng.next() * pc.length)].num);
        const sig = combo.join(',');
        if (!seen.has(sig) && !ai_isComboExcluded(combo, ctx.hardExcludeCombo)) {
          seen.add(sig);
          picked.push({ combo, score: 0 });
        }
        loop++;
      }
    }

    picked.forEach((item, idx) => {
      tickets.push({
        numbers: item.combo.map((num, pos) => ({ val: num, tag: `P${pos}` })),
        groupReason: `數字型彈性 ${idx + 1}/${targetCount}`,
        metadata: {
          version: '8.7',
          packMode: 'pack_2',
          degraded,
          degradeReason: dReason
        }
      });
    });
  }
  return tickets;
}

// ==========================================
// [E] 單注 Mode (Deterministic Replay)
// ==========================================

function ai_generateStrictCombo(ctx, initialScores, targetSetIndex) {
  const { gameDef, hardExcludeNum, hardExcludeCombo, externalHistory } = ctx;

  // [V8.5] Dynamic Pool: We define validNums once, but we will rebuild candidatePool
  // inside the loop based on evolving scores.
  const buffer = AI_CONFIG.LIMITS.CANDIDATE_BUFFER || 0;
  const poolSize = gameDef.count + buffer;

  const validNums = Object.keys(initialScores).map(Number).filter(n => !hardExcludeNum.has(n));

  // Safety Check: Overall validity
  if (validNums.length < gameDef.count) {
    throw new Error(`候選數不足 (需${gameDef.count}, 僅剩${validNums.length})。請減少排除號碼。`);
  }

  const externalCount = externalHistory ? externalHistory.length : 0;

  const getLimit = (globalIdx) => {
    const arr = AI_CONFIG.OVERLAP_LIMITS.strict;
    return arr[globalIdx] !== undefined ? arr[globalIdx] : AI_CONFIG.OVERLAP_LIMITS.default;
  };

  const history = [];
  if (externalHistory && Array.isArray(externalHistory)) {
    externalHistory.forEach(c => history.push(c));
  }

  let currentScores = { ...initialScores };

  // Frequency Weighted Penalty
  const freqMap = new Map();
  history.flat().forEach(n => freqMap.set(n, (freqMap.get(n) || 0) + 1));
  freqMap.forEach((count, n) => {
    if (currentScores[n] !== undefined) {
      currentScores[n] *= Math.pow(AI_CONFIG.PENALTIES.STRICT_NEXT_SET, count);
    }
  });

  for (let i = 0; i <= targetSetIndex; i++) {
    const currentGlobalIndex = externalCount + i;
    const overlapLimit = getLimit(currentGlobalIndex);

    // [V8.5] Dynamic Pool Refresh: Rebuild pool from FULL valid lists using CURRENT scores
    // This ensures fresh numbers are pulled up if too many high-ranked ones decayed.
    const candidatePool = validNums
      .sort((a, b) => currentScores[b] - currentScores[a])
      .slice(0, poolSize);

    let bestCombo = null;
    let attempts = 0;
    let degraded = false;
    let dReason = null;
    let excludeHits = 0, overlapHits = 0;

    let iterationScores = { ...currentScores };

    while (attempts < AI_CONFIG.LIMITS.MAX_RETRY_ATTEMPTS) {

      // [V8.5] Sort the candidate pool based on temporary iteration scores
      const sortedPool = [...candidatePool].sort((a, b) => iterationScores[b] - iterationScores[a]);
      const candidate = sortedPool.slice(0, gameDef.count);

      // 1. Combo Exclude
      if (ai_isComboExcluded(candidate, hardExcludeCombo)) {
        candidate.forEach(n => iterationScores[n] *= AI_CONFIG.PENALTIES.COMBO_EXCLUDE);
        attempts++;
        excludeHits++;
        continue;
      }

      // 2. Overlap Check
      let violation = false;
      let diffs = [];

      for (const prev of history) {
        if (ai_countOverlap(candidate, prev) > overlapLimit) {
          violation = true;
          diffs.push(...candidate.filter(x => prev.includes(x)));
        }
      }

      if (!violation) {
        bestCombo = candidate;
        break;
      }

      diffs.forEach(n => {
        iterationScores[n] *= AI_CONFIG.PENALTIES.STRICT_OVERLAP;
      });
      attempts++;
      overlapHits++;
      bestCombo = candidate;
    }

    if (attempts >= AI_CONFIG.LIMITS.MAX_RETRY_ATTEMPTS) {
      degraded = true;
      dReason = (excludeHits > overlapHits) ? 'exclude_limit' : 'overlap_limit';
    }

    const finalCombo = bestCombo || [];
    history.push(finalCombo);

    finalCombo.forEach(n => {
      currentScores[n] *= AI_CONFIG.PENALTIES.STRICT_NEXT_SET;
    });

    if (i === targetSetIndex) {
      return { combo: finalCombo, degraded, attempts, dReason };
    }
  }
  return { combo: [], degraded: true, attempts: 0, dReason: 'logic_error' };
}

function ai_handleComboSingle(ctx) {
  const { data, gameDef, hardExcludeNum, random, setIndex, rng } = ctx;
  const rawScores = ai_buildRawScores({ data, range: gameDef.range, count: gameDef.count, isZone2: false, params: AI_CONFIG.PARAMS.lotto });
  const trendScores = ai_percentileRankTransform(rawScores, 10, 98);

  let combo, degraded = false, attempts = 0, dReason = null;

  if (random) {
    // Random mode uses ai_getTopKCandidates which has buffer
    const limit = AI_CONFIG.PARAMS.lotto.randomCandidateLimit;
    const candidates = ai_getTopKCandidates(rawScores, limit, hardExcludeNum, ctx);
    const weightedCtx = ai_prepareWeightedContext(candidates, rawScores);

    let loop = 0;
    while (loop < AI_CONFIG.LIMITS.MAX_RETRY_ATTEMPTS) {
      combo = ai_weightedSample(weightedCtx, gameDef.count, rng);
      if (!ai_isComboExcluded(combo, ctx.hardExcludeCombo)) break;
      loop++;
    }
    attempts = loop;
    if (loop >= AI_CONFIG.LIMITS.MAX_RETRY_ATTEMPTS) {
      degraded = true;
      dReason = 'random_retry_limit';
    }

  } else {
    // Strict Replay
    const result = ai_generateStrictCombo(ctx, trendScores, setIndex);
    combo = result.combo;
    degraded = result.degraded;
    attempts = result.attempts;
    dReason = result.dReason;
  }

  return {
    numbers: combo.sort((a, b) => a - b).map(n => ({ val: n, tag: `趨勢分${Math.round(trendScores[n] || 0)}` })),
    groupReason: random ? `🎲 AI 加權隨機` : `👑 AI 嚴選 TOP${setIndex + 1}`,
    metadata: { version: '8.7', mode: ctx.mode, setIndex, degraded, attempts, dReason }
  };
}

function ai_handleDigitSingle(ctx) {
  const { data, gameDef, subModeId, hardExcludeNum, random, setIndex, rng, mode } = ctx;
  const digitCount = subModeId || gameDef.count;
  const combo = [];

  for (let pos = 0; pos < digitCount; pos++) {
    // [V8.7.1] 這裡會拋出更清楚的錯誤訊息（如果資料不足）
    const rawScores = ai_buildDigitPosRawScores({ data, pos, params: AI_CONFIG.PARAMS.digit });
    const trendScores = ai_percentileRankTransform(rawScores, 10, 98);

    let pick;
    if (random) {
      const cands = Object.keys(rawScores).map(Number).filter(n => !hardExcludeNum.has(n));
      if (cands.length === 0) {
        // [V8.7.1] 改進錯誤訊息
        throw new Error(`隨機模式失敗：位置 ${pos} 的所有號碼 (0-9) 都被排除。當前排除列表包含 ${hardExcludeNum.size} 個號碼。請減少排除數量。`);
      }
      const ctxW = ai_prepareWeightedContext(cands, rawScores);
      pick = ai_weightedSample(ctxW, 1, rng)[0];
    } else {
      const currentScores = { ...trendScores };
      const PENALTY = AI_CONFIG.PENALTIES.STRICT_NEXT_SET;

      const validCands = Object.keys(currentScores).map(Number).filter(n => !hardExcludeNum.has(n));
      if (validCands.length === 0) {
        // [V8.7.1] 改進錯誤訊息
        throw new Error(`嚴選模式失敗：位置 ${pos} 的所有號碼 (0-9) 都被排除。當前排除列表包含 ${hardExcludeNum.size} 個號碼。請減少排除數量。`);
      }

      for (let i = 0; i < setIndex; i++) {
        const t = [...validCands].sort((a, b) => currentScores[b] - currentScores[a])[0];
        currentScores[t] *= PENALTY;
      }
      pick = [...validCands].sort((a, b) => currentScores[b] - currentScores[a])[0];
    }
    combo.push({ val: pick, tag: `趨勢分${Math.round(trendScores[pick])}` });
  }

  return {
    numbers: combo,
    groupReason: random ? `🎲 AI 加權隨機` : `👑 AI 嚴選 TOP${setIndex + 1}`,
    metadata: { version: '8.7', mode, setIndex }
  };
}

function ai_handlePowerSingle(ctx) {
  const { data, gameDef, hardExcludeNum, random, setIndex, rng } = ctx;

  const z1Raw = ai_buildRawScores({ data, range: gameDef.range, count: 6, isZone2: false, params: AI_CONFIG.PARAMS.power_zone1 });
  const z1Trend = ai_percentileRankTransform(z1Raw, 10, 98);
  const z2Raw = ai_buildRawScores({ data, range: gameDef.zone2, count: 1, isZone2: true, params: AI_CONFIG.PARAMS.power_zone2 });
  const z2Trend = ai_percentileRankTransform(z2Raw, 10, 98);

  let z1Combo, z2Val, degraded = false, attempts = 0, dReason = null;

  if (random) {
    const limit = AI_CONFIG.PARAMS.power_zone1.randomCandidateLimit;
    const c1 = ai_getTopKCandidates(z1Raw, limit, hardExcludeNum, ctx);
    const ctx1 = ai_prepareWeightedContext(c1, z1Raw);

    let loop = 0;
    while (loop < AI_CONFIG.LIMITS.MAX_RETRY_ATTEMPTS) {
      z1Combo = ai_weightedSample(ctx1, 6, rng);
      if (!ai_isComboExcluded(z1Combo, ctx.hardExcludeCombo)) break;
      loop++;
    }
    attempts = loop;
    if (loop >= AI_CONFIG.LIMITS.MAX_RETRY_ATTEMPTS) {
      degraded = true;
      dReason = 'random_retry_limit';
    }

    const c2 = Object.keys(z2Raw).map(Number);
    const ctx2 = ai_prepareWeightedContext(c2, z2Raw);
    z2Val = ai_weightedSample(ctx2, 1, rng)[0];

  } else {
    // Strict Zone 1 Replay - Uses V8.5 Dynamic Pool (Now V8.6)
    const result = ai_generateStrictCombo(ctx, z1Trend, setIndex);
    z1Combo = result.combo;
    degraded = result.degraded;
    attempts = result.attempts;
    dReason = result.dReason;

    // Strict Zone 2 (Cycle)
    const sorted2 = Object.keys(z2Trend).map(Number).sort((a, b) => z2Trend[b] - z2Trend[a]);
    z2Val = sorted2[setIndex % sorted2.length];
  }

  return {
    numbers: [
      ...z1Combo.sort((a, b) => a - b).map(n => ({ val: n, tag: `趨勢分${Math.round(z1Trend[n] || 0)}` })),
      { val: z2Val, tag: `趨勢分${Math.round(z2Trend[z2Val] || 0)}` }
    ],
    groupReason: random ? `🎲 AI 加權隨機` : `👑 AI 嚴選 TOP${setIndex + 1}`,
    metadata: { version: '8.7', mode: ctx.mode, setIndex, degraded, attempts, dReason }
  };
}


// ==========================================
// [F] Helper Functions
// ==========================================

function ai_buildRawScores({ data, range, count, isZone2, params }) {
  const minNum = (range === 9) ? 0 : 1;
  const maxNum = range;
  const { h_short, h_long, epsilon, kPrior } = params;

  const numbersPerDraw = data.map(d => {
    if (isZone2) return [d.zone2 || d.numbers[d.numbers.length - 1]];
    return d.numbers.slice(0, count).filter(n => n >= minNum && n <= maxNum);
  });

  const wS = ai_computeHalfLifeWeights(data.length, h_short);
  const wL = ai_computeHalfLifeWeights(data.length, h_long);
  const statS = ai_computeWeightedStats(numbersPerDraw, wS, minNum, maxNum);
  const statL = ai_computeWeightedStats(numbersPerDraw, wL, minNum, maxNum);
  const mom = ai_computeLogLift(statS.C, statS.E, statL.C, statL.E, minNum, maxNum, epsilon);
  const shrink = ai_computeKishShrinkage(wS, kPrior);

  const scores = {};
  for (let n = minNum; n <= maxNum; n++) scores[n] = mom[n] * shrink;
  return scores;
}

function ai_buildDigitPosRawScores({ data, pos, params }) {
  const { h_short, h_long, epsilon, kPrior } = params;
  const numbersPerDraw = data.map(d => 
    (d.numbers && d.numbers.length > pos) ? [d.numbers[pos]] : []
  ).filter(a => a.length > 0);

  // [V8.7.1] 資料不足檢查
  if (numbersPerDraw.length === 0) {
    throw new Error(`數字型資料不足：位置 ${pos} 無任何歷史資料。請確認：1) 資料庫有足夠記錄, 2) subModeId (${pos + 1}星彩) 與資料匹配`);
  }

  const wS = ai_computeHalfLifeWeights(numbersPerDraw.length, h_short);
  const wL = ai_computeHalfLifeWeights(numbersPerDraw.length, h_long);
  const statS = ai_computeWeightedStats(numbersPerDraw, wS, 0, 9);
  const statL = ai_computeWeightedStats(numbersPerDraw, wL, 0, 9);
  const mom = ai_computeLogLift(statS.C, statS.E, statL.C, statL.E, 0, 9, epsilon);
  const shrink = ai_computeKishShrinkage(wS, kPrior);

  const scores = {};
  for (let n = 0; n <= 9; n++) scores[n] = mom[n] * shrink;
  return scores;
}

function ai_parseExclude(input) {
  const hardExcludeNum = new Set();
  const hardExcludeCombo = [];
  if (!input) return { hardExcludeNum, hardExcludeCombo };
  const arr = (input instanceof Set) ? Array.from(input) : (Array.isArray(input) ? [...input] : []);
  arr.forEach(item => {
    if (typeof item === 'number') {
      hardExcludeNum.add(item);
    } else if (Array.isArray(item)) {
      const safeCombo = [...item].filter(x => typeof x === 'number').sort((a, b) => a - b);
      hardExcludeCombo.push(safeCombo.join(','));
    }
  });
  return { hardExcludeNum, hardExcludeCombo };
}

function ai_isComboExcluded(combo, hardExcludeCombo) {
  if (!hardExcludeCombo || hardExcludeCombo.length === 0) return false;
  const sig = [...combo].sort((a, b) => a - b).join(',');
  return hardExcludeCombo.includes(sig);
}

function ai_countOverlap(c1, c2) {
  const s2 = new Set(c2);
  return c1.filter(x => s2.has(x)).length;
}

function _getFilteredSortedAll(scores, excludeSet) {
  return Object.keys(scores)
    .map(Number)
    .filter(n => !excludeSet.has(n))
    .sort((a, b) => scores[b] - scores[a]);
}

// [V8.5] Honest Naming
function ai_pickTopK_WithSafetyCheck(scores, k, excludeSet, ctx) {
  const buffer = AI_CONFIG.LIMITS.CANDIDATE_BUFFER || 0;
  const all = _getFilteredSortedAll(scores, excludeSet);

  if (all.length < k) {
    throw new Error(`候選數不足 (需${k}, 剩餘${all.length})`);
  }

  if (all.length < k + buffer && ctx?.warnings) {
    ctx.warnings.push(`Low pool risk: ${all.length} < safe ${k + buffer}`);
  }

  return all.slice(0, k);
}

function ai_getTopKCandidates(rawScores, k, excludeSet, ctx) {
  const buffer = AI_CONFIG.LIMITS.CANDIDATE_BUFFER || 0;
  const targetK = k + buffer;
  const all = _getFilteredSortedAll(rawScores, excludeSet);

  if (all.length === 0) return [];
  if (all.length < k) {
    if (ctx?.warnings) ctx.warnings.push(`Low pool in getCands: ${all.length} < desired ${k}`);
    return all;
  }
  return all.slice(0, targetK);
}

function ai_prepareWeightedContext(candidates, rawScores) {
  if (candidates.length === 0) return [];
  const values = candidates.map(n => rawScores[n]);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  let variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
  let std = Math.sqrt(variance);
  if (std < 1e-4) std = 1e-4;

  const items = candidates.map(n => ({ num: n, z: (rawScores[n] - mean) / std }));
  const maxZ = Math.max(...items.map(i => i.z));
  return items.map(item => ({ num: item.num, weight: Math.exp(item.z - maxZ) }));
}

function ai_weightedSample(ctx, count, rng) {
  if (ctx.length < count) throw new Error(`隨機候選數不足Pool (需${count}, 剩餘${ctx.length})`);
  const picked = [];
  let list = ctx.map(x => ({ ...x }));
  for (let i = 0; i < count; i++) {
    const sumW = list.reduce((a, b) => a + b.weight, 0);
    if (sumW <= 1e-9) {
      const idx = Math.floor(rng.next() * list.length);
      picked.push(list[idx].num);
      list.splice(idx, 1);
      continue;
    }
    let r = rng.next() * sumW;
    let selectedIdx = -1;
    for (let j = 0; j < list.length; j++) {
      r -= list[j].weight;
      if (r <= 0) { selectedIdx = j; break; }
    }
    if (selectedIdx === -1) selectedIdx = list.length - 1;
    picked.push(list[selectedIdx].num);
    list.splice(selectedIdx, 1);
  }
  return picked;
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
    if (!seen.has(k)) { seen.add(k); unique.push(p); }
  });
  return unique;
}

function ai_cartesianProduct(arrays) {
  return arrays.reduce((a, b) => a.flatMap(d => b.map(e => [d, e].flat())), [[]]);
}


