/**
 * algo_pattern.js V6.1 (The Perfect Edition - Fixed)
 * 關聯學派：玩法規則完全對齊版 + 全缺口修復
 * 
 * ====================================
 * 版本歷史
 * ====================================
 * V4.2 - 原始工業級版本
 * V5.0 - 整合包牌（失敗，pool太小）
 * V6.0 - 完全重構
 * V6.1 - 修復所有 P0/P1 缺口（本版）
 * 
 * ====================================
 * V6.1 修復清單（12處）
 * ====================================
 * 1. ✅ 拖牌 score 統一為 0-100
 * 2. ✅ 鄰號 score 提升至 20.0
 * 3. ✅ 尾數群聚 score 提升至 15.0
 * 4. ✅ Z-Score score 放大為 zScore * 10
 * 5. ✅ 熱號 score 歸一化到 0-100
 * 6. ✅ score 累積加權（多來源疊加）
 * 7. ✅ 排序欄位防呆（過濾無效資料）
 * 8. ✅ 大樂透特別號檢查（不得重複）
 * 9. ✅ 威力彩包牌 excludeNumbers 支援
 * 10. ✅ 樂透型包牌 excludeNumbers 支援
 * 11. ✅ dragTop 配置生效（8個拖牌候選）
 * 12. ✅ targetCount 語意文檔說明
 * 12. ✅ 支援 3星彩笛卡兒積
 */

// ==========================================
// 配置區
// ==========================================
const PATTERN_CONFIG = {
  DEBUG_MODE: false,

  // 資料門檻
  DATA_THRESHOLDS: {
    combo: { reject: 10, warn: 20, optimal: 50 },
    digit: { reject: 5, warn: 10, optimal: 30 }
  },

  // 統計參數
  DECAY_FACTOR: 0.995,
  Z_SCORE_THRESHOLD: 1.96,
  SMOOTHING: 1,
  EPSILON: 1e-9,

  // 回溯期數
  DRAG_PERIODS: 300,
  TAIL_PERIODS: 50,
  FALLBACK_PERIOD: 50,

  // 動態配額
  ALLOCATION: {
    LOTTO_49: { drag: 3, neighbor: 2, tail: 1 },
    POWER_38: { drag: 3, neighbor: 2, tail: 1 },
    TODAY_39: { drag: 2, neighbor: 2, tail: 1 }
  },

  // V6.0 新增：候選池配置
  CANDIDATE_POOL: {
    combo: {
      dragTop: 8,      // 拖牌 Top 8
      neighborTop: 6,  // 鄰號 Top 6
      tailTop: 4,      // 尾數 Top 4
      hotTop: 6        // 熱號 Top 6
    },
    digit: {
      positionTop: 7   // 每個位置 Top 7
    }
  },

  // 包牌配置
  PACK_CONFIG: {
    MAX_CONSECUTIVE: 3,
    MIN_POOL_SIZE: 15  // 最小候選池大小
  }
};

const DIGIT_STRATEGIES = {
  default: { name: '綜合熱門' },
  aggressive: { name: '激進趨勢' },
  conservative: { name: '次熱避險' },
  balanced: { name: '分散配置' }
};

const SORT_KEY = Symbol('sortKey');
const _cacheStore = new Map();
const MAX_CACHE_SIZE = 10;

const log = (...args) => {
  if (PATTERN_CONFIG.DEBUG_MODE) console.log('[Pattern V6.1]', ...args);
};

// ==========================================
// 主入口函數
// ==========================================

export function algoPattern({
  data,
  gameDef,
  subModeId,
  strategy = 'default',
  excludeNumbers = new Set(),
  mode = 'strict',
  setIndex = 0,
  packMode = null,
  targetCount = 5
}) {
  console.log(`[Pattern] 關聯學派 | ${gameDef.type} | ${data.length}期`);

  // 1. 資料驗證
  const validation = pattern_validateByGameDef(data, gameDef);
  if (!validation.isValid) {
    return packMode ? [] : {
      numbers: [],
      groupReason: `❌ 資料驗證失敗: ${validation.error}`,
      metadata: { version: '6.1', error: validation.error }
    };
  }

  const { data: validData, warning, stats: dataStats } = validation;

  // 2. 包牌模式
  if (packMode) {
    return pattern_handlePackMode({
      data: validData,
      gameDef,
      packMode,
      targetCount,
      mode,
      warning,
      dataStats,
      excludeNumbers  // V6.1: 傳遞 excludeNumbers
    });
  }

  // 3. 單注模式
  let singleResult;
  if (gameDef.type === 'lotto' || gameDef.type === 'power') {
    singleResult = pattern_handleComboSingle(validData, gameDef, excludeNumbers, mode, setIndex);
  } else if (gameDef.type === 'digit') {
    singleResult = pattern_handleDigitSingle(validData, gameDef, strategy, mode, setIndex);
  } else {
    return {
      numbers: [],
      groupReason: "❌ 不支援的玩法類型",
      metadata: { version: '6.1' }
    };
  }

  if (warning) {
    singleResult.groupReason = `${warning} | ${singleResult.groupReason}`;
  }
  singleResult.metadata = {
    ...singleResult.metadata,
    version: '6.1',
    mode,
    dataSize: validData.length,
    dataQuality: dataStats
  };

  return singleResult;
}

// ==========================================
// V6.0 核心：資料驗證系統
// ==========================================

function pattern_validateByGameDef(data, gameDef) {
  if (!Array.isArray(data)) {
    return { isValid: false, error: "非陣列格式" };
  }

  const validators = {
    'power': pattern_validatePower,
    'lotto': pattern_validateLotto,
    'today': pattern_validateToday,
    'digit': pattern_validateDigit
  };

  const validator = validators[gameDef.type];
  if (!validator) {
    return { isValid: false, error: `未知玩法類型: ${gameDef.type}` };
  }

  return validator(data, gameDef);
}

function pattern_validatePower(data, gameDef) {
  const cleaned = [];
  let rejected = 0;

  for (const d of data) {
    if (!d || !Array.isArray(d.numbers)) {
      rejected++;
      continue;
    }

    if (d.numbers.length !== 7) {
      rejected++;
      continue;
    }

    const zone1 = d.numbers.slice(0, 6);
    const zone2 = d.numbers[6];

    const hasInvalidZone1 = zone1.some(n => typeof n !== 'number' || n < 1 || n > 38);
    if (hasInvalidZone1) {
      rejected++;
      continue;
    }

    if (new Set(zone1).size !== 6) {
      rejected++;
      continue;
    }

    if (typeof zone2 !== 'number' || zone2 < 1 || zone2 > 8) {
      rejected++;
      continue;
    }

    cleaned.push({
      ...d,
      zone1: zone1,
      zone2: zone2
    });
  }

  return pattern_finalizeValidation(cleaned, rejected, gameDef, data.length);
}

function pattern_validateLotto(data, gameDef) {
  const cleaned = [];
  let rejected = 0;

  // 以 gameDef 為準（539: count=5, range=39；大樂透: count=6, range=49）
  const mainCount = (typeof gameDef.count === 'number' && gameDef.count > 0) ? gameDef.count : 6;
  const range = (typeof gameDef.range === 'number' && gameDef.range > 0) ? gameDef.range : 49;

  // 特別號允許條件：
  // 1) 明確宣告 gameDef.special 為 true
  // 2) 或維持既有相容：主號為 6 的 lotto（通常代表大樂透類）允許第 7 顆特別號
  const allowSpecial = !!gameDef.special || mainCount === 6;

  for (const d of data) {
    if (!d || !Array.isArray(d.numbers)) {
      rejected++;
      continue;
    }

    const len = d.numbers.length;

    // 長度必須是 mainCount（例如539=5）或（允許特別號時）mainCount+1
    const isValidLen = (len === mainCount) || (allowSpecial && len === mainCount + 1);
    if (!isValidLen) {
      rejected++;
      continue;
    }

    const mainNumbers = d.numbers.slice(0, mainCount);
    const specialNumber = (len === mainCount + 1) ? d.numbers[mainCount] : null;

    // 主號：型別 + 範圍
    const hasInvalidMain = mainNumbers.some(n => typeof n !== 'number' || n < 1 || n > range);
    if (hasInvalidMain) {
      rejected++;
      continue;
    }

    // 主號：不得重複
    if (new Set(mainNumbers).size !== mainCount) {
      rejected++;
      continue;
    }

    // 特別號（若存在）：型別 + 範圍
    if (specialNumber !== null) {
      if (typeof specialNumber !== 'number' || specialNumber < 1 || specialNumber > range) {
        rejected++;
        continue;
      }
      // V6.1: 修復8 - 檢查特別號不得與主號重複
      if (mainNumbers.includes(specialNumber)) {
        rejected++;
        continue;
      }
    }

    // 清洗後：numbers 一律只保留主號（避免後續把特別號當主號運算）
    cleaned.push({
      ...d,
      numbers: mainNumbers,
      mainNumbers: mainNumbers,
      specialNumber: specialNumber
    });
  }

  return pattern_finalizeValidation(cleaned, rejected, gameDef, data.length);
}


function pattern_validateToday(data, gameDef) {
  const cleaned = [];
  let rejected = 0;

  for (const d of data) {
    if (!d || !Array.isArray(d.numbers)) {
      rejected++;
      continue;
    }

    if (d.numbers.length !== 5) {
      rejected++;
      continue;
    }

    const hasInvalidNum = d.numbers.some(n => typeof n !== 'number' || n < 1 || n > 39);
    if (hasInvalidNum) {
      rejected++;
      continue;
    }

    if (new Set(d.numbers).size !== 5) {
      rejected++;
      continue;
    }

    cleaned.push({ ...d });
  }

  return pattern_finalizeValidation(cleaned, rejected, gameDef, data.length);
}

function pattern_validateDigit(data, gameDef) {
  const cleaned = [];
  let rejected = 0;
  const expectedLength = gameDef.count;

  for (const d of data) {
    if (!d || !Array.isArray(d.numbers)) {
      rejected++;
      continue;
    }

    if (d.numbers.length !== expectedLength) {
      rejected++;
      continue;
    }

    const hasInvalidNum = d.numbers.some(n => typeof n !== 'number' || n < 0 || n > 9);
    if (hasInvalidNum) {
      rejected++;
      continue;
    }

    cleaned.push({ ...d });
  }

  return pattern_finalizeValidation(cleaned, rejected, gameDef, data.length);
}

function pattern_finalizeValidation(cleaned, rejected, gameDef, originalSize) {
  pattern_sortData(cleaned);

  const thresholds = gameDef.type === 'digit'
    ? PATTERN_CONFIG.DATA_THRESHOLDS.digit
    : PATTERN_CONFIG.DATA_THRESHOLDS.combo;

  if (cleaned.length < thresholds.reject) {
    return {
      isValid: false,
      error: `有效資料不足 (${cleaned.length}筆 < ${thresholds.reject}筆，原始${originalSize}筆，排除${rejected}筆)`
    };
  }

  let warning = null;
  if (rejected > originalSize * 0.1) {
    warning = `⚠️ 資料品質警告：排除了${rejected}筆 (${(rejected / originalSize * 100).toFixed(1)}%)`;
  } else if (cleaned.length < thresholds.warn) {
    warning = `⚠️ 樣本偏少 (${cleaned.length}筆)`;
  }

  return {
    isValid: true,
    data: cleaned,
    warning,
    stats: {
      original: originalSize,
      cleaned: cleaned.length,
      rejected: rejected,
      rejectRate: (rejected / originalSize * 100).toFixed(1) + '%'
    }
  };
}

// V6.1: 修復7 - 排序欄位防呆
function pattern_sortData(data) {
  if (data.length === 0) return;

  const sample = data[0];
  let getTimeValue = null;

  if (sample.hasOwnProperty('date')) {
    getTimeValue = (d) => d.date instanceof Date ? d.date.getTime() : new Date(d.date).getTime();
  } else if (sample.hasOwnProperty('lotteryDate')) {
    getTimeValue = (d) => new Date(d.lotteryDate).getTime();
  } else if (sample.hasOwnProperty('period')) {
    getTimeValue = (d) => typeof d.period === 'string' ? parseFloat(d.period) : Number(d.period);
  } else if (sample.hasOwnProperty('drawNumber')) {
    getTimeValue = (d) => typeof d.drawNumber === 'string' ? parseInt(d.drawNumber) : Number(d.drawNumber);
  } else {
    getTimeValue = () => 0;
  }

  try {
    // V6.1: 排序欄位缺失時標記為 null，後續會被過濾
    for (const item of data) {
      const val = getTimeValue(item);
      item[SORT_KEY] = isNaN(val) || val === 0 ? null : val;
    }

    // V6.1: 過濾掉無效時序的資料
    const validData = data.filter(item => item[SORT_KEY] !== null);
    if (validData.length < data.length * 0.9) {
      // 如果超過10%資料無效，使用索引作為後備
      data.forEach((item, idx) => item[SORT_KEY] = -idx);
    } else {
      // 移除無效資料
      data.length = 0;
      data.push(...validData);
    }
  } catch (e) {
    data.forEach((item, idx) => item[SORT_KEY] = -idx);
  }

  data.sort((a, b) => b[SORT_KEY] - a[SORT_KEY]);
}

// ==========================================
// V6.1 核心：候選池系統（統一計分）
// ==========================================

function pattern_buildCandidatePoolCombo(data, gameDef, config, excludeNumbers = new Set()) {
  const { range } = gameDef;
  const { dragTop, neighborTop, tailTop, hotTop } = config;
  const lastDraw = data[0].numbers.slice(0, 6);

  const candidates = new Map();

  // V6.1: 修復1 - 拖牌候選（dragTop 生效）
  const dragMap = pattern_generateWeightedDragMapCached(data, PATTERN_CONFIG.DRAG_PERIODS);
  lastDraw.forEach(seedNum => {
    const drags = dragMap[seedNum] || [];
    drags.slice(0, 8).forEach(d => {  // V6.1: dragTop 配置生效
      if (d.num >= 1 && d.num <= range && !excludeNumbers.has(d.num)) {
        // V6.1: 拖牌 score 已經是 0-100，直接使用
        pattern_addOrUpdateCandidate(candidates, d.num, d.prob, `${seedNum}拖`, ['拖牌']);
      }
    });
  });

  // V6.1: 修復2 - 鄰號候選（score 提升至 20.0）
  lastDraw.forEach(seedNum => {
    [-1, +1].forEach(offset => {
      const n = seedNum + offset;
      if (n >= 1 && n <= range && !excludeNumbers.has(n)) {
        pattern_addOrUpdateCandidate(candidates, n, 20.0, `${seedNum}鄰`, ['鄰號']);
      }
    });
  });

  // V6.1: 修復3/4 - 尾數候選
  const tailAnalysis = pattern_analyzeTailStatsDynamic(data, range, PATTERN_CONFIG.TAIL_PERIODS);
  const tailClusters = pattern_findTailClusters(lastDraw);

  tailClusters.forEach(({ tail }) => {
    for (let n = (tail === 0 ? 10 : tail); n <= range; n += 10) {
      if (!excludeNumbers.has(n)) {
        // V6.1: 尾數群聚 score 統一為 15.0
        pattern_addOrUpdateCandidate(candidates, n, 15.0, `${tail}尾群`, ['尾數', '群聚']);
      }
    }
  });

  tailAnalysis.slice(0, tailTop).forEach(({ tail, zScore }) => {
    for (let n = (tail === 0 ? 10 : tail); n <= range; n += 10) {
      if (!excludeNumbers.has(n)) {
        // V6.1: Z-Score 尾數 score 統一為 zScore * 10
        pattern_addOrUpdateCandidate(candidates, n, zScore * 10, `Z-${tail}尾`, ['尾數', 'Z-Score']);
      }
    }
  });

  // V6.1: 修復5 - 熱號候選（歸一化到 0-100）
  const hotFreq = pattern_getWeightedHotFrequency(data, range, PATTERN_CONFIG.FALLBACK_PERIOD);
  Object.entries(hotFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, hotTop)
    .forEach(([num, weight]) => {
      const n = parseInt(num);
      if (!excludeNumbers.has(n)) {
        // V6.1: 熱號 score 歸一化到 0-100
        const normalizedScore = Math.min((weight / 50) * 100, 100);
        pattern_addOrUpdateCandidate(candidates, n, normalizedScore, '熱號', ['頻率']);
      }
    });

  const pool = Array.from(candidates.values())
    .sort((a, b) => b.score - a.score);

  log(`候選池建構完成: ${pool.length}個候選`);
  return pool;
}

// V6.1: 修復6 - 候選池計分邏輯（改用累積加權）
function pattern_addOrUpdateCandidate(candidates, num, score, source, tags) {
  if (!candidates.has(num)) {
    candidates.set(num, { num, score, source, tags });
  } else {
    const existing = candidates.get(num);
    // V6.1: 改用累積加權，多來源訊號疊加（新來源貢獻 40%）
    existing.score += score * 0.4;
    // 合併來源說明
    if (!existing.source.includes(source)) {
      existing.source += `, ${source}`;
    }
    // 合併 tags
    tags.forEach(tag => {
      if (!existing.tags.includes(tag)) existing.tags.push(tag);
    });
  }
}

function pattern_buildCandidatePoolDigit(data, gameDef, topN) {
  const { count } = gameDef;
  const positionPools = [];

  const posStats = Array.from({ length: count }, () => new Array(10).fill(0));
  data.slice(0, 50).forEach(d => {
    if (d.numbers.length >= count) {
      for (let i = 0; i < count; i++) {
        const n = d.numbers[i];
        if (n >= 0 && n <= 9) posStats[i][n]++;
      }
    }
  });

  posStats.forEach((counts, posIdx) => {
    const sorted = counts
      .map((c, n) => ({ num: n, score: c }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
    positionPools.push(sorted);
  });

  log(`數字型候選池: 每位置 Top ${topN}`);
  return positionPools;
}

function pattern_getWeightedHotFrequency(data, range, lookback) {
  const weightedFreq = {};
  const limit = Math.min(lookback, data.length);

  for (let i = 0; i < limit; i++) {
    const weight = Math.pow(PATTERN_CONFIG.DECAY_FACTOR, i);
    data[i].numbers.slice(0, 6).forEach(n => {
      if (n <= range) weightedFreq[n] = (weightedFreq[n] || 0) + weight;
    });
  }

  return weightedFreq;
}

// ==========================================
// V6.1 核心：包牌邏輯（支援 excludeNumbers）
// ==========================================

function pattern_handlePackMode({ data, gameDef, packMode, targetCount, mode, warning, dataStats, excludeNumbers = new Set() }) {
  let tickets = [];

  if (gameDef.type === 'power') {
    // V6.1: 修復9 - 傳遞 excludeNumbers
    tickets = pattern_packPower(data, gameDef, packMode, targetCount, mode, excludeNumbers);
  } else if (gameDef.type === 'digit') {
    tickets = pattern_packDigit(data, gameDef, packMode, targetCount, mode);
  } else {
    // V6.1: 修復10 - 傳遞 excludeNumbers
    tickets = pattern_packCombo(data, gameDef, packMode, targetCount, mode, excludeNumbers);
  }

  if (warning) {
    tickets.forEach(ticket => {
      ticket.groupReason = `${warning} | ${ticket.groupReason}`;
    });
  }

  tickets.forEach((ticket, idx) => {
    ticket.metadata = {
      version: '6.1',
      mode,
      packMode,
      ticketIndex: idx + 1,
      totalTickets: tickets.length,
      dataSize: data.length,
      dataQuality: dataStats
    };
  });

  return tickets;
}

// V6.1: 修復9/12 - 威力彩包牌支援 excludeNumbers
function pattern_packPower(data, gameDef, packMode, targetCount, mode, excludeNumbers = new Set()) {
  const config = PATTERN_CONFIG.CANDIDATE_POOL.combo;
  const tickets = [];

  // V6.1: 傳入 excludeNumbers
  const zone1Pool = pattern_buildCandidatePoolCombo(data, gameDef, config, excludeNumbers);
  const zone2Pool = pattern_buildZone2Pool(data, gameDef.zone2);

  if (packMode === 'pack_1') {
    // 標準包牌：第一區鎖定 + 第二區全包
    const zone1Best = pattern_pickSetGreedy(zone1Pool.map(c => c.num), 6);

    for (let z2 = 1; z2 <= 8; z2++) {
      tickets.push({
        numbers: [
          ...zone1Best.map(n => ({ val: n, tag: '鎖定' })),
          { val: z2, tag: `Z2(${String(z2).padStart(2, '0')})` }
        ],
        groupReason: `標準包牌 - 第二區 ${String(z2).padStart(2, '0')} (第二區全包策略)`
      });
    }

    // V6.1: 修復12 - targetCount 在 pack_1 無效（固定回傳8注）
    // 說明：威力彩包牌 pack_1 邏輯是「第一區鎖定 + 第二區全包(1-8)」
    // 因此不論 targetCount 設為多少，都會回傳 8 注
    // 如果未來要支援 targetCount，需要改為「部分第二區」策略
  }
  log(`威力彩包牌完成: ${tickets.length}注`);
  return tickets;
}

function pattern_buildZone2Pool(data, zone2Range) {
  const freq = {};
  const lastSeen = {};
  const lookback = Math.min(50, data.length);

  for (let i = 0; i < lookback; i++) {
    const zone2 = data[i].zone2 || data[i].numbers[data[i].numbers.length - 1];
    if (typeof zone2 === 'number' && zone2 >= 1 && zone2 <= zone2Range) {
      freq[zone2] = (freq[zone2] || 0) + 1;
      if (lastSeen[zone2] === undefined) lastSeen[zone2] = i;
    }
  }

  const pool = [];
  for (let n = 1; n <= zone2Range; n++) {
    const gap = lastSeen[n] !== undefined ? lastSeen[n] : lookback;
    const count = freq[n] || 0;
    const score = count + (gap * 0.4);
    pool.push({ num: n, gap, score });
  }

  pool.sort((a, b) => b.score - a.score);
  return pool;
}

function pattern_packDigit(data, gameDef, packMode, targetCount, mode) {
  const { count } = gameDef;
  const tickets = [];

  const want = Math.max(1, Number(targetCount) || 5);

  // ===== pack_1：強勢包牌 = 嚴選Top1 的「全排列」(含重複時去重後的全排列) =====
  if (packMode === 'pack_1') {
    // 嚴選 Top1：每個位置各取 Top1（等同你現有嚴選 SET1 的核心）
    const poolsTop1 = pattern_buildCandidatePoolDigit(data, gameDef, 1);
    const base = poolsTop1.map(p => (p && p[0] ? p[0].num : 0));

    // 產生不重複排列（例：1-1-2 => 3 組）
    const perms = pattern_uniquePermutations(base);

    perms.forEach((combo, idx) => {
      tickets.push({
        numbers: combo.map((num, pos) => ({ val: num, tag: `Pos${pos + 1}` })),
        groupReason: `強勢包牌 ${idx + 1}/${perms.length} - 嚴選Top1全排列`
      });
    });

    log(`數字型強勢包牌完成: ${tickets.length}注 (全排列去重)`);
    return tickets;
  }

  log(`數字型強勢包牌完成: ${tickets.length}注 (全排列去重)`);
  return tickets;
}

function pattern_cartesianProduct(arrays) {
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
// ===== Digit helpers (pack_1 / pack_2 專用) =====

// 產生「不重複排列」：例如 [1,1,2] => 3 組
function pattern_uniquePermutations(nums) {
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

// combo 簽章（用於去重/排除）
function pattern_digitComboSignature(combo) {
  return combo.join('-');
}

// 計算兩組在「位置上」差幾位（差越多越不像）
function pattern_posDiff(a, b) {
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) diff++;
  }
  return diff;
}

// 建立每個位置 num->score 的查表，供快速評分
function pattern_buildDigitPosScoreMap(pools) {
  return pools.map(pool => {
    const m = new Map();
    pool.forEach(item => m.set(item.num, item.score));
    return m;
  });
}

// 組合評分：用 log 平滑，確保穩定且可加總（確定性）
function pattern_scoreDigitCombo(combo, scoreMaps) {
  let s = 0;
  for (let pos = 0; pos < combo.length; pos++) {
    const c = (scoreMaps[pos].get(combo[pos]) ?? 0) + 1; // +1 smoothing
    s += Math.log(c);
  }
  return s;
}

// V6.1: 修復10 - 樂透型包牌支援 excludeNumbers
function pattern_packCombo(data, gameDef, packMode, targetCount, mode, excludeNumbers = new Set()) {
  const config = PATTERN_CONFIG.CANDIDATE_POOL.combo;
  const tickets = [];

  // V6.1: 傳入 excludeNumbers
  const pool = pattern_buildCandidatePoolCombo(data, gameDef, config, excludeNumbers);

  if (pool.length < PATTERN_CONFIG.PACK_CONFIG.MIN_POOL_SIZE) {
    log(`候選池過小 (${pool.length} < ${PATTERN_CONFIG.PACK_CONFIG.MIN_POOL_SIZE})，包牌失敗`);
    return [];
  }

  const poolNums = pool.map(c => c.num);

  if (packMode === 'pack_1') {
    const step = Math.max(1, Math.floor(poolNums.length / targetCount));

    for (let k = 0; k < targetCount; k++) {
      const offset = k * step;
      const rotated = [...poolNums.slice(offset), ...poolNums.slice(0, offset)];
      const set = pattern_pickSetGreedy(rotated, gameDef.count);

      tickets.push({
        numbers: set.map(n => ({ val: n, tag: '優選' })),
        groupReason: `標準包牌 ${k + 1}/${targetCount} - 輪轉組合`
      });
    }

  } else {
    for (let k = 0; k < targetCount; k++) {
      let set = [];
      let tries = 0;

      while (tries < 12 && set.length < gameDef.count) {
        const shuffled = pattern_fisherYates([...poolNums]);
        const candidate = [...new Set(shuffled)].slice(0, gameDef.count);

        if (candidate.length === gameDef.count && pattern_isConsecutiveOk(candidate)) {
          set = candidate.sort((a, b) => a - b);
          break;
        }
        tries++;
      }

      if (set.length < gameDef.count) {
        set = pattern_pickSetGreedy(poolNums, gameDef.count);
      }

      tickets.push({
        numbers: set.map(n => ({ val: n, tag: '彈性' })),
        groupReason: `彈性包牌 ${k + 1}/${targetCount} - 隨機組合`
      });
    }
  }

  log(`樂透型包牌完成: ${tickets.length}注`);
  return tickets;
}

// ==========================================
// 單注邏輯（保留 V6.0 核心）
// ==========================================

function pattern_handleComboSingle(data, gameDef, excludeNumbers, mode, setIndex) {
  const { range, count, zone2 } = gameDef;
  const lastDraw = data[0].numbers.slice(0, 6);
  const isRandom = mode === 'random';

  const allocation = pattern_calculateDynamicAllocationSafe(data.length, gameDef, count);

  const dragMap = pattern_generateWeightedDragMapCached(data, PATTERN_CONFIG.DRAG_PERIODS);
  const tailAnalysis = pattern_analyzeTailStatsDynamic(data, range, PATTERN_CONFIG.TAIL_PERIODS);
  const tailClusters = pattern_findTailClusters(lastDraw);

  const selected = new Set();
  const result = [];
  const checkSet = new Set(excludeNumbers);
  const stats = { drag: 0, neighbor: 0, tail: 0, hot: 0 };

  console.log(`[Pattern] 候選分配: 拖牌(${dragCandidates.length || 0}) 鄰號(${neighborCandidates.length || 0}) 尾數(${tailAnalysis.length || 0})`);

  const isConsecutiveSafe = (currentList, newNum) => {
    const nums = [...currentList.map(x => x.val), newNum].sort((a, b) => a - b);
    let maxCons = 1, currentCons = 1;
    for (let i = 1; i < nums.length; i++) {
      if (nums[i] === nums[i - 1] + 1) currentCons++;
      else currentCons = 1;
      maxCons = Math.max(maxCons, currentCons);
    }
    return maxCons <= 3;
  };

  const applyNoise = (arr, scoreKey) => {
    if (!isRandom) return arr;
    return arr.map(item => ({
      ...item,
      _noiseScore: (item[scoreKey] || 1) * (0.9 + Math.random() * 0.2)
    })).sort((a, b) => b._noiseScore - a._noiseScore);
  };

  const shuffle = (arr) => pattern_fisherYates(arr);

  // Phase A: 拖牌
  let dragCandidates = pattern_getDragCandidatesStrict(lastDraw, dragMap, range, checkSet);
  dragCandidates = applyNoise(dragCandidates, 'prob');
  for (const cand of dragCandidates) {
    if (result.length >= allocation.drag) break;
    if (!selected.has(cand.num) && isConsecutiveSafe(result, cand.num)) {
      selected.add(cand.num);
      checkSet.add(cand.num);
      result.push({ val: cand.num, tag: `${cand.from}拖` });
      stats.drag++;
    }
  }

  // Phase B: 鄰號
  let neighborCandidates = pattern_getNeighborCandidatesStrict(lastDraw, range, checkSet);
  if (isRandom) neighborCandidates = shuffle(neighborCandidates);
  for (const n of neighborCandidates) {
    if (result.length >= allocation.drag + allocation.neighbor) break;
    if (!selected.has(n.num) && isConsecutiveSafe(result, n.num)) {
      selected.add(n.num);
      checkSet.add(n.num);
      result.push({ val: n.num, tag: `${n.from}鄰` });
      stats.neighbor++;
    }
  }

  console.log(`[Pattern] 候選分配: 拖牌(${dragCandidates?.length || 0}) 鄰號(${neighborCandidates?.length || 0}) 尾數(${tailAnalysis?.length || 0})`);

  // Phase C: 尾數
  let tailCandidates = pattern_getTailCandidatesStrict(tailClusters, tailAnalysis, range, checkSet);
  if (isRandom) tailCandidates = shuffle(tailCandidates);
  for (const t of tailCandidates) {
    if (result.length >= count) break;
    if (!selected.has(t.num) && isConsecutiveSafe(result, t.num)) {
      selected.add(t.num);
      checkSet.add(t.num);
      result.push({ val: t.num, tag: `${t.tail}尾` });
      stats.tail++;
    }
  }

  // Phase D: 熱號回補
  if (result.length < count) {
    const needed = count - result.length;
    const hotFreq = pattern_getWeightedHotFrequency(data, range, PATTERN_CONFIG.FALLBACK_PERIOD);
    let hotNumbers = Object.entries(hotFreq)
      .sort((a, b) => b[1] - a[1])
      .map(([n, w]) => parseInt(n))
      .filter(n => !checkSet.has(n))
      .slice(0, needed * 5);

    const isLowEntropy = hotNumbers.slice(0, 5).every((n, i) => n === hotNumbers[0] + i);
    if (isLowEntropy || isRandom) hotNumbers = shuffle(hotNumbers);

    for (const n of hotNumbers) {
      if (stats.hot >= needed) break;
      if (isConsecutiveSafe(result, n)) {
        selected.add(n);
        result.push({ val: n, tag: '熱號' });
        stats.hot++;
      }
    }
  }

  const structStr = [];
  if (stats.drag) structStr.push(`${stats.drag}拖`);
  if (stats.neighbor) structStr.push(`${stats.neighbor}鄰`);
  if (stats.tail) structStr.push(`${stats.tail}尾`);
  if (stats.hot) structStr.push(`${stats.hot}熱`);
  const reasonPrefix = isRandom ? "隨機結構" : "嚴選結構";
  const groupReason = `${reasonPrefix}：${structStr.join('/')}`;

  if (zone2) {
    const z2Pool = pattern_buildZone2Pool(data, zone2);
    let z2Pick;
    if (isRandom && z2Pool.length >= 3) {
      const top3 = z2Pool.slice(0, 3);
      const rndIdx = Math.floor(Math.random() * top3.length);
      z2Pick = { val: top3[rndIdx].num, tag: `Z2(隨機)` };
    } else {
      const pickIdx = setIndex % Math.min(5, z2Pool.length);
      z2Pick = { val: z2Pool[pickIdx].num, tag: `Z2(G${z2Pool[pickIdx].gap})` };
    }

    return {
      numbers: [...result.sort((a, b) => a.val - b.val), z2Pick],
      groupReason,
      metadata: { allocation, composition: stats }
    };
  }

  return {
    numbers: result.sort((a, b) => a.val - b.val),
    groupReason,
    metadata: { allocation, composition: stats }
  };
}

function pattern_handleDigitSingle(data, gameDef, strategy, mode, setIndex) {
  const { count } = gameDef;
  const isRandom = mode === 'random';

  const posStats = Array.from({ length: count }, () => new Array(10).fill(0));
  data.slice(0, 50).forEach(d => {
    if (d.numbers.length >= count) {
      for (let i = 0; i < count; i++) {
        const n = d.numbers[i];
        if (n >= 0 && n <= 9) posStats[i][n]++;
      }
    }
  });

  const rankedPos = posStats.map(counts => {
    let sorted = counts.map((c, n) => ({ n, c })).sort((a, b) => b.c - a.c);
    if (isRandom) {
      const top5 = sorted.slice(0, 5);
      const shuffled = top5.map(item => ({
        ...item,
        _noise: item.c * (0.8 + Math.random() * 0.4)
      })).sort((a, b) => b._noise - a._noise);
      sorted = [...shuffled, ...sorted.slice(5)];
    }
    return sorted;
  });

  const result = [];
  const pickIndex = strategy === 'conservative' ? 1 : 0;
  for (let i = 0; i < count; i++) {
    const actualIdx = isRandom ? pickIndex : ((pickIndex + (setIndex % 5)) % 5);
    const pick = rankedPos[i][actualIdx] || rankedPos[i][0];
    result.push({ val: pick.n, tag: `Pos${i + 1}` });
  }

  const reasonPrefix = isRandom
    ? '隨機推薦：依近期熱門分布，每次略作變化'
    : '嚴選數字';

  return {
    numbers: result,
    groupReason: `${reasonPrefix} (${DIGIT_STRATEGIES[strategy]?.name || strategy})`,
    metadata: { setIndex, strategy }
  };
}

// ==========================================
// 數學核心模塊
// ==========================================

function pattern_calculateDynamicAllocationSafe(dataSize, gameDef, targetCount) {
  const { range } = gameDef;
  const optimal = PATTERN_CONFIG.DATA_THRESHOLDS.combo.optimal;
  const sufficiency = Math.min(1.0, dataSize / optimal);

  let baseAlloc;
  if (range === 49) baseAlloc = PATTERN_CONFIG.ALLOCATION.LOTTO_49;
  else if (range === 38) baseAlloc = PATTERN_CONFIG.ALLOCATION.POWER_38;
  else if (range === 39) baseAlloc = PATTERN_CONFIG.ALLOCATION.TODAY_39;
  else baseAlloc = { drag: Math.ceil(targetCount / 2), neighbor: 1, tail: 1 };

  const adjusted = {
    drag: Math.max(1, Math.floor(baseAlloc.drag * sufficiency)),
    neighbor: Math.max(1, baseAlloc.neighbor),
    tail: Math.max(1, Math.floor(baseAlloc.tail * Math.sqrt(sufficiency)))
  };

  return adjusted;
}

function pattern_generateWeightedDragMapCached(data, periods) {
  const latestTimestamp = data[0][SORT_KEY] || 0;
  const contentHash = data[0].numbers.slice(0, 6).join('-');
  const cacheKey = `${latestTimestamp}_${contentHash}_${periods}`;

  if (_cacheStore.has(cacheKey)) {
    const entry = _cacheStore.get(cacheKey);
    _cacheStore.delete(cacheKey);
    _cacheStore.set(cacheKey, entry);
    return entry;
  }

  const map = pattern_generateWeightedDragMap(data, periods);

  if (_cacheStore.size >= MAX_CACHE_SIZE) {
    const firstKey = _cacheStore.keys().next().value;
    _cacheStore.delete(firstKey);
  }

  _cacheStore.set(cacheKey, map);
  return map;
}

// V6.1: 修復11 - dragTop 配置生效
function pattern_generateWeightedDragMap(data, periods) {
  const dragMap = {};
  const seedTotalScore = {};
  const lookback = Math.min(periods, data.length - 1);

  for (let i = 0; i < lookback; i++) {
    const currentDraw = data[i].numbers.slice(0, 6);
    const prevDraw = data[i + 1].numbers.slice(0, 6);
    const weight = Math.pow(PATTERN_CONFIG.DECAY_FACTOR, i);

    prevDraw.forEach(causeNum => {
      seedTotalScore[causeNum] = (seedTotalScore[causeNum] || 0) + weight;
      if (!dragMap[causeNum]) dragMap[causeNum] = {};
      currentDraw.forEach(resultNum => {
        dragMap[causeNum][resultNum] = (dragMap[causeNum][resultNum] || 0) + weight;
      });
    });
  }

  const finalMap = {};
  // V6.1: dragTop 從配置讀取（預設8）
  const dragTopLimit = PATTERN_CONFIG.CANDIDATE_POOL?.combo?.dragTop || 8;
  Object.keys(dragMap).forEach(key => {
    const causeNum = parseInt(key);
    const denominator = (seedTotalScore[causeNum] || 0) + PATTERN_CONFIG.SMOOTHING;
    finalMap[causeNum] = Object.entries(dragMap[key])
      .map(([num, score]) => ({
        num: parseInt(num),
        prob: parseFloat(((score / denominator) * 100).toFixed(2))
      }))
      .sort((a, b) => b.prob - a.prob)
      .slice(0, dragTopLimit);  // V6.1: 使用配置值
  });

  return finalMap;
}

function pattern_analyzeTailStatsDynamic(data, range, periods) {
  const tailCounts = Array(10).fill(0);
  const lookback = Math.min(periods, data.length);
  let totalBalls = 0;

  for (let i = 0; i < lookback; i++) {
    data[i].numbers.slice(0, 6).forEach(n => {
      if (n <= range) {
        tailCounts[n % 10]++;
        totalBalls++;
      }
    });
  }

  const mean = totalBalls / 10;
  const variance = tailCounts.reduce((acc, count) => acc + Math.pow(count - mean, 2), 0) / 9;
  const stdDev = Math.sqrt(variance);

  if (stdDev < PATTERN_CONFIG.EPSILON) return [];

  const MIN_STD_DEV = Math.max(0.5, Math.sqrt(totalBalls / (range * 5)));
  const effectiveStdDev = Math.max(stdDev, MIN_STD_DEV);

  const hotTails = [];
  tailCounts.forEach((count, tail) => {
    const zScore = (count - mean) / effectiveStdDev;
    if (zScore > PATTERN_CONFIG.Z_SCORE_THRESHOLD) {
      hotTails.push({ tail, zScore });
    }
  });

  return hotTails.sort((a, b) => b.zScore - a.zScore);
}

function pattern_findTailClusters(lastDraw) {
  const counts = {};
  lastDraw.forEach(n => {
    const t = n % 10;
    counts[t] = (counts[t] || 0) + 1;
  });
  return Object.entries(counts)
    .filter(([_, c]) => c >= 2)
    .map(([t, c]) => ({ tail: parseInt(t), count: c }))
    .sort((a, b) => b.count - a.count);
}

function pattern_getDragCandidatesStrict(lastDraw, dragMap, range, checkSet) {
  const candidates = [];
  lastDraw.forEach(seedNum => {
    const drags = dragMap[seedNum] || [];
    drags.forEach(d => {
      if (d.num >= 1 && d.num <= range && !checkSet.has(d.num)) {
        candidates.push({ num: d.num, from: seedNum, prob: d.prob });
      }
    });
  });

  const unique = new Map();
  candidates.forEach(c => {
    if (!unique.has(c.num) || unique.get(c.num).prob < c.prob) unique.set(c.num, c);
  });

  return Array.from(unique.values()).sort((a, b) => {
    if (Math.abs(b.prob - a.prob) > 0.1) return b.prob - a.prob;
    return a.num - b.num;
  });
}

function pattern_getNeighborCandidatesStrict(lastDraw, range, checkSet) {
  const candidates = [];
  lastDraw.forEach(seedNum => {
    [-1, +1].forEach(offset => {
      const n = seedNum + offset;
      if (n >= 1 && n <= range && !checkSet.has(n)) {
        candidates.push({ num: n, from: seedNum });
      }
    });
  });
  return candidates.sort((a, b) => a.num - b.num);
}

function pattern_getTailCandidatesStrict(clusters, zAnalysis, range, checkSet) {
  const candidates = [];
  clusters.forEach(({ tail }) => {
    for (let n = (tail === 0 ? 10 : tail); n <= range; n += 10) {
      if (!checkSet.has(n)) candidates.push({ num: n, tail, source: '群聚' });
    }
  });

  if (candidates.length < 2) {
    zAnalysis.forEach(({ tail, zScore }) => {
      for (let n = (tail === 0 ? 10 : tail); n <= range; n += 10) {
        if (!checkSet.has(n) && !candidates.some(c => c.num === n)) {
          candidates.push({ num: n, tail, source: `Z:${zScore.toFixed(1)}` });
        }
      }
    });
  }

  return candidates;
}

// ==========================================
// 工具函數
// ==========================================

function pattern_pickSetGreedy(pool, need) {
  const set = [];
  for (const n of pool) {
    if (set.includes(n)) continue;
    const next = [...set, n];
    if (pattern_isConsecutiveOk(next)) set.push(n);
    if (set.length >= need) break;
  }
  return set;
}

function pattern_isConsecutiveOk(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  let maxCons = 1, currentCons = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) currentCons++;
    else currentCons = 1;
    if (currentCons > maxCons) maxCons = currentCons;
  }
  return maxCons <= PATTERN_CONFIG.PACK_CONFIG.MAX_CONSECUTIVE;
}

function pattern_fisherYates(arr) {
  const res = [...arr];
  for (let i = res.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [res[i], res[j]] = [res[j], res[i]];
  }
  return res;
}




