/**
 * algo_smartwheel.js
 * 聰明包牌模組 (Phase 6 最終版)
 * 核心邏輯：雙軌策略 (標準/強勢 vs 彈性/隨機)
 */

export function algoSmartWheel(data, gameDef, pool, packMode = 'pack_1') {
    let results = [];
    
    if (!Array.isArray(pool) || pool.length === 0) {
        return [];
    }

    // ==========================================
    // [新增] 通用工具：強度排序 + 連號限制 (最多 3 連號)
    // ==========================================
    const MAX_CONSECUTIVE = 3;
    const DECAY = 0.995;
    const LOOKBACK = 80;

    const getMaxConsecutiveRun = (nums) => {
        const sorted = [...nums].sort((a, b) => a - b);
        let maxCons = 1, currentCons = 1;
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i] === sorted[i - 1] + 1) currentCons++;
            else currentCons = 1;
            if (currentCons > maxCons) maxCons = currentCons;
        }
        return maxCons;
    };

    const isConsecutiveOk = (nums) => getMaxConsecutiveRun(nums) <= MAX_CONSECUTIVE;

    const buildZone1ScoreMap = () => {
        const score = new Map();
        const lookback = Math.min(LOOKBACK, Array.isArray(data) ? data.length : 0);
        const zone1Count = gameDef && typeof gameDef.count === 'number' ? gameDef.count : 6;

        for (let i = 0; i < lookback; i++) {
            const d = data[i];
            if (!d || !Array.isArray(d.numbers)) continue;
            const weight = Math.pow(DECAY, i);
            d.numbers.slice(0, zone1Count).forEach(n => {
                if (typeof n !== 'number') return;
                score.set(n, (score.get(n) || 0) + weight);
            });
        }
        return score;
    };

    const rankPoolByScore = (inputPool) => {
        const scoreMap = buildZone1ScoreMap();
        const uniq = [...new Set(inputPool)].filter(n => typeof n === 'number');
        return uniq
            .map(n => ({ n, s: scoreMap.get(n) || 0 }))
            .sort((a, b) => (b.s - a.s) || (a.n - b.n))
            .map(x => x.n);
    };

    const pickSetGreedy = (ranked, need) => {
        const set = [];
        for (const n of ranked) {
            if (set.includes(n)) continue;
            const next = [...set, n];
            if (isConsecutiveOk(next)) set.push(n);
            if (set.length >= need) break;
        }
        return set;
    };

    const completeSet = (seed, ranked, need) => {
        let set = [...new Set(seed)];
        if (set.length > need) set = set.slice(0, need);

        if (!isConsecutiveOk(set)) {
            return pickSetGreedy(ranked, need);
        }

        for (const n of ranked) {
            if (set.length >= need) break;
            if (set.includes(n)) continue;
            const next = [...set, n];
            if (isConsecutiveOk(next)) set.push(n);
        }
        return set;
    };

    // ==========================================
    // 1. 威力彩 (Power)
    // ==========================================
    if (gameDef.type === 'power') {
        const rankedPool = rankPoolByScore(pool);

        // [策略 A] 二區包牌 (pack_1): 鎖定最強 6 碼
        if (packMode === 'pack_1') {
            let zone1 = pickSetGreedy(rankedPool, 6);
            zone1 = completeSet(zone1, rankedPool, 6).sort((a, b) => a - b);
            if (zone1.length < 6) return []; 

            for (let i = 1; i <= 8; i++) {
                results.push({
                    numbers: [...zone1, i],
                    groupReason: `二區包牌 (0${i}) - 第一區鎖定`
                });
            }
        } 
        // [策略 B] 彈性包牌 (pack_2): 區段輪轉 (Segment Rotation)
        // 避免滑動視窗造成的重疊，改用跳躍組合
        else {
            // 將 Pool 分為 4 個區段 (每段 3 碼，共 12 碼)
            // 如果 Pool 不足 12 碼，循環補足
            const base = rankedPool.length > 0 ? rankedPool : [...new Set(pool)];
            const extendedPool = [...base, ...base].slice(0, 12);
            const segA = extendedPool.slice(0, 3);
            const segB = extendedPool.slice(3, 6);
            const segC = extendedPool.slice(6, 9);
            const segD = extendedPool.slice(9, 12);

            // 產生 8 種不同的組合 (A+B, C+D, A+C...)
            const combos = [
                [...segA, ...segB], // 1
                [...segC, ...segD], // 2
                [...segA, ...segC], // 3
                [...segB, ...segD], // 4
                [...segA, ...segD], // 5
                [...segB, ...segC], // 6
                // 混合跳躍
                [segA[0], segB[1], segC[2], segD[0], segA[1], segB[2]], // 7
                [segC[0], segD[1], segA[2], segB[0], segC[1], segD[2]]  // 8
            ];

            for (let i = 0; i < 8; i++) {
                let set = [...new Set(combos[i % combos.length])];
                set = completeSet(set, base, 6).sort((a, b) => a - b);

                results.push({
                    numbers: [...set, i + 1],
                    groupReason: `彈性輪轉包牌 (0${i+1}) - 區段跳躍`
                });
            }
        }
    } 
    // ==========================================
    // 2. 數字型 (3星/4星)
    // ==========================================
    else if (gameDef.type === 'digit') {
        const count = gameDef.count;
        const bestNums = pool.slice(0, count); // 這裡的 pool 來自 app.js 收集的 Set1, Set2, Set3...
        
        if (bestNums.length < count) return []; 

        // [策略 A] 強勢包牌 (pack_1): 複式排列 (Permutation)
        // 鎖定最強的號碼，買光排列
        if (packMode === 'pack_1') {
            if (count === 3) {
                const perms = [[0,1,2], [0,2,1], [1,0,2], [1,2,0], [2,0,1], [2,1,0]];
                perms.forEach(p => {
                    const set = [bestNums[p[0]], bestNums[p[1]], bestNums[p[2]]];
                    results.push({
                        numbers: set,
                        groupReason: `強勢複式 - 鎖定排列`
                    });
                });
            } else {
                // 4星彩循環移位
                for(let i=0; i<5; i++) {
                    const set = [...bestNums];
                    const shift = set.splice(0, i % 4);
                    set.push(...shift);
                    results.push({
                        numbers: set,
                        groupReason: `強勢複式 - 循環排列`
                    });
                }
            }
        }
        // [策略 B] 彈性包牌 (pack_2): 分組取號 (Chunking)
        // 每一注都拿完全不同的號碼，不重疊
        else {
            const targetCount = 5; 
            for (let i = 0; i < targetCount; i++) {
                const set = [];
                for (let k = 0; k < count; k++) {
                    // 直接從 Pool 中依序抓取，確保不重複
                    // Pool 來自 app.js 收集的 Set1, Set2, Set3...
                    const idx = (i * count + k) % pool.length;
                    set.push(pool[idx]);
                }
                // 數字型絕對不排序
                results.push({
                    numbers: set,
                    groupReason: `彈性分組 - 組合 ${i+1}`
                });
            }
        }
    } 
    // ==========================================
    // 3. 樂透型 (大樂透/539)
    // ==========================================
    else {
        const targetCount = 5; 
        const rankedPool = rankPoolByScore(pool);

        // pack_1：標準/強勢 → deterministic + 連號限制
        if (packMode === 'pack_1') {
            const base = rankedPool.length > 0 ? rankedPool : [...new Set(pool)];
            const step = base.length > 0 ? Math.max(1, Math.floor(base.length / targetCount)) : 1;

            for (let k = 0; k < targetCount; k++) {
                const offset = base.length > 0 ? (k * step) % base.length : 0;
                const rotated = base.slice(offset).concat(base.slice(0, offset));

                let set = pickSetGreedy(rotated, gameDef.count);
                set = completeSet(set, base, gameDef.count).sort((a, b) => a - b);

                results.push({
                    numbers: set,
                    groupReason: `聰明包牌 - 優選組合`
                });
            }
        }
        // pack_2：彈性/隨機 → 保留隨機，但仍套用連號限制
        else {
            for (let k = 0; k < targetCount; k++) {
                let set = [];
                let tries = 0;

                while (tries < 12 && set.length < gameDef.count) {
                    // Fisher-Yates 洗牌
                    const shuffled = [...pool];
                    for (let i = shuffled.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                    }
                    const candidate = [...new Set(shuffled)].slice(0, gameDef.count);
                    if (candidate.length === gameDef.count && isConsecutiveOk(candidate)) {
                        set = candidate.sort((a, b) => a - b);
                        break;
                    }
                    tries++;
                }

                if (set.length < gameDef.count) {
                    let fallback = pickSetGreedy(rankedPool, gameDef.count);
                    fallback = completeSet(fallback, rankedPool, gameDef.count).sort((a, b) => a - b);
                    set = fallback;
                }
                
                results.push({
                    numbers: set,
                    groupReason: `聰明包牌 - 優選組合`
                });
            }
        }
    }

    return results;
}
