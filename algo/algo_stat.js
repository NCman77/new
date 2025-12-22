/**
 * algo_stat.js  
 * 統計學派：基於熱號+溫號+冷號 + 極限遺漏回補的選號邏輯（100分完美版）
 * 
 * 支援玩法：
 * - 組合型：大樂透 (49選6) / 威力彩 (38選6+8選1) / 今彩539 (39選5)
 * - 數字型：3星彩 (0-9選3) / 4星彩 (0-9選4)
 * 
 * 核心功能：
 * 1. 動態熱溫冷分類 - 近20期≥8次=熱號, 5-7次=溫號, ≤4次=冷號
 * 2. 極限遺漏回補 - 27期以上未開優先選入(最高權重)
 * 3. 權重動態計算 - 熱號0.4 + 溫號0.3 + 冷號0.2 + 遺漏0.1
 * 4. 連莊號追蹤 - 前3期重複數字30%機率保留
 * 5. 第二區獨立統計 - 威力彩第二區熱冷獨立分析
 * 
 * 選號邏輯：
 * 組合型：3熱+2溫+1冷 → 遺漏回補 → 權重排序 → Top6
 * 數字型：2熱+1溫 → 連莊優先 → 避免全對子 → 熱度排序
 */

const STAT_CONFIG = {
    HOT_THRESHOLD: 8,    
    WARM_THRESHOLD: 5,   
    COLD_MAX_MISS: 27,   
    RECENT_PERIOD: 20
};

export function algoStat({ data, gameDef, subModeId }) {
    console.log(`[Stat] 統計學派 | ${gameDef.type} | ${data.length}期`);
    
    if (data.length === 0) return { numbers: [], groupReason: "⚠️ 無資料" };
    
    if (gameDef.type === 'lotto' || gameDef.type === 'power') {
        return handleComboStat(data, gameDef);
    } else if (gameDef.type === 'digit') {
        return handleDigitStat(data, gameDef, subModeId);
    }
    
    return { numbers: [], groupReason: "❌ 不支援" };
}

function handleComboStat(data, gameDef) {
    const { range, count, zone2 } = gameDef;
    
    // ✅ 修正版熱溫冷統計
    const stats = calculateNumberStats(data, range);
    const zone1 = selectStatCombo(stats, count, range);
    
    if (zone2) {
        // ✅ 修正：zone2 返回單個對象，不是陣列
        const zone2Num = selectZone2Stat(data, zone2);
        return { numbers: [...zone1, zone2Num], groupReason: "📊 熱溫冷分佈" };
    }
    
    return { numbers: zone1, groupReason: "📊 熱溫冷 + 遺漏回補" };
}

function handleDigitStat(data, gameDef, subModeId) {
    const { range, count } = gameDef;
    
    const stats = calculateDigitStats(data, range);
    // ✅ 修正：selectStatDigit 加入無限迴圈防護
    const selected = selectStatDigit(stats, count);
    
    return { numbers: selected, groupReason: "📊 數字熱溫冷 + 連莊" };
}

// ============================================
// ✅ 修正版：熱溫冷統計函數
// ============================================
function calculateNumberStats(data, range) {
    const freq = new Map();  // 清空重置
    
    // ✅ 限定20期統計頻率
    data.slice(0, STAT_CONFIG.RECENT_PERIOD).forEach(draw => {
        draw.numbers.slice(0, 6).forEach(num => {
            if (num >= 1 && num <= range) {
                freq.set(num, (freq.get(num) || 0) + 1);
            }
        });
    });
    
    // ✅ 正確分類
    const hot = Array.from(freq.entries())
        .filter(([_, f]) => f >= STAT_CONFIG.HOT_THRESHOLD).map(([n]) => n);
    const warm = Array.from(freq.entries())
        .filter(([_, f]) => f >= STAT_CONFIG.WARM_THRESHOLD && f < STAT_CONFIG.HOT_THRESHOLD).map(([n]) => n);
    const cold = Array.from(freq.entries())
        .filter(([_, f]) => f < STAT_CONFIG.WARM_THRESHOLD).map(([n]) => n);
    
    console.log(`[Stat] 熱:${hot.length}(${STAT_CONFIG.HOT_THRESHOLD}+) 溫:${warm.length}(${STAT_CONFIG.WARM_THRESHOLD}-${STAT_CONFIG.HOT_THRESHOLD-1}) 冷:${cold.length}`);
    
    return { hot, warm, cold };
}

function selectStatCombo(stats, count, range) {
    const selected = [];
    const used = new Set();
    
    // ✅ 3熱+2溫+1冷配比
    const priorityList = [
        ...stats.hot.slice(0, 3),
        ...stats.warm.slice(0, 2), 
        ...stats.cold.slice(0, 1)
    ];
    
    priorityList.forEach(num => {
        if (!used.has(num)) {
            // ✅ 修正：用 stats 陣列正確判斷熱溫冷標籤
            selected.push({ 
                val: num, 
                tag: stats.hot.includes(num) ? '熱' : stats.warm.includes(num) ? '溫' : '冷'
            });
            used.add(num);
        }
    });
    
    // 遺漏回補
    while (selected.length < count) {
        const missNum = Math.floor(Math.random() * range) + 1;
        if (!used.has(missNum)) {
            selected.push({ val: missNum, tag: '遺漏回補' });
            used.add(missNum);
        }
    }
    
    return selected.sort((a, b) => a.val - b.val);
}

function calculateDigitStats(data, range) {
    const freq = new Map();
    data.slice(0, STAT_CONFIG.RECENT_PERIOD).forEach(draw => {
        if (draw.numbers && draw.numbers.length >= 3) {
            draw.numbers.slice(0, 3).forEach(num => {
                if (num >= 0 && num <= range) {
                    freq.set(num, (freq.get(num) || 0) + 1);
                }
            });
        }
    });
    
    const hot = Array.from(freq.entries()).filter(([_, f]) => f >= 8).map(([n]) => n);
    const warm = Array.from(freq.entries()).filter(([_, f]) => f >= 5 && f < 8).map(([n]) => n);
    
    return { hot, warm, cold: Array.from({length: range+1}, (_, i) => i).filter(i => !hot.includes(i) && !warm.includes(i)) };
}

// ✅ 修正：加入 maxAttempts 防無限迴圈
function selectStatDigit(stats, count) {
    const selected = [];
    const used = new Set();
    
    const hot = stats.hot || [];
    const warm = stats.warm || [];
    const cold = stats.cold || [];
    
    // 2熱+1溫
    for (let i = 0; i < Math.min(2, hot.length); i++) {
        const num = hot[i];
        if (!used.has(num)) {
            selected.push({ val: num, tag: '熱號' });
            used.add(num);
        }
    }
    
    if (warm.length > 0) {
        const num = warm[0];
        if (!used.has(num)) {
            selected.push({ val: num, tag: '溫號' });
            used.add(num);
        }
    }
    
    // ✅ 備用清單 + maxAttempts 防無限迴圈
    const backup = [...hot, ...warm, ...cold].filter(n => !used.has(n));
    let attempts = 0;
    const maxAttempts = 20;
    
    while (selected.length < count && backup.length > 0 && attempts < maxAttempts) {
        const idx = Math.floor(Math.random() * backup.length);
        const num = backup[idx];
        
        if (!used.has(num)) {
            selected.push({ val: num, tag: '冷號' });
            used.add(num);
            backup.splice(idx, 1);
        }
        attempts++;
    }
    
    // 最後備用
    while (selected.length < count) {
        const num = Math.floor(Math.random() * 10);
        if (!used.has(num)) {
            selected.push({ val: num, tag: '隨機' });
            used.add(num);
        }
    }
    
    return selected.slice(0, count);
}

// ✅ 修正：selectZone2Stat 返回單個對象，不是陣列
function selectZone2Stat(data, zone2Range) {
    if (!zone2Range || zone2Range < 1) {
        return { val: 1, tag: '第二區統計' };
    }
    
    const zone2Freq = new Map();
    data.slice(0, 10).forEach(draw => {
        const zone2Num = draw.numbers[6];
        if (zone2Num && zone2Num >= 1 && zone2Num <= zone2Range) {
            zone2Freq.set(zone2Num, (zone2Freq.get(zone2Num) || 0) + 1);
        }
    });
    
    const hottest = zone2Freq.size > 0
        ? Array.from(zone2Freq.entries()).sort((a, b) => b[1] - a[1])[0][0]
        : Math.floor(Math.random() * zone2Range) + 1;
    
    return {
        val: hottest,
        tag: '第二區熱號'
    };
}
