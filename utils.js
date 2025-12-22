/**
 * utils.js
 * 全功能工具箱：包含數學運算、統計邏輯、命理轉換，以及資料讀取與 API 連線 (Scheme B)
 * 
 * Final Version（移除 Firestore + 修正 Fallback）：
 * - P0: 移除所有 Firestore 相關功能
 * - P0: 修正 fallback 日期過濾（防止資料膨脹）
 * - P1: DEBUG_MODE（URL 參數 + 開發環境限定）
 * - P1: Log 優化（摘要模式）
 * - P1: LocalStorage 錯誤處理改善
 */

// ==========================================
// 0. Debug 模式設定 (Debug Configuration)
// ==========================================

// 檢查是否為開發環境
const isDev = window.location.hostname === 'localhost' || 
              window.location.hostname === '127.0.0.1' ||
              window.location.hostname === '';

// 讀取 URL 參數
const urlParams = new URLSearchParams(window.location.search);
const debugParam = urlParams.get('debug'); // 'zip' | 'csv' | 'api' | 'all'
const debugKey = urlParams.get('key');     // 密碼保護（production 需要）

// 密碼驗證（請修改成您的密鑰）
const SECRET_DEBUG_KEY = 'lottery2025';
const allowDebug = isDev || debugKey === SECRET_DEBUG_KEY;

// Debug 開關（可透過 URL 參數控制）
const DEBUG_MODE = {
    ZIP: allowDebug && (debugParam === 'all' || debugParam === 'zip'),
    CSV: allowDebug && (debugParam === 'all' || debugParam === 'csv'),
    API: allowDebug && (debugParam === 'all' || debugParam === 'api'),
    SUMMARY: true,  // 摘要永遠開啟
    ERROR: true     // 錯誤永遠開啟
};

// ==========================================
// 1. 資料處理與 IO 工具 (Data & IO Tools)
// ==========================================

// 解析 CSV 字串為物件 (支援大小順序與開出順序)
function parseCSVLine(line) {
    const cleanLine = line.replace(/^\uFEFF/, '').trim(); // 去除 BOM
    if (!cleanLine) return null;
    
    // 處理 CSV 欄位 (去除引號)
    const cols = cleanLine.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 5) return null;

    // 判斷遊戲類型
    const gameNameMap = {
        // 標準遊戲
        '大樂透': '大樂透', '威力彩': '威力彩', '今彩539': '今彩539',
        '雙贏彩': '雙贏彩', '3星彩': '3星彩', '4星彩': '4星彩',
        '三星彩': '3星彩', '四星彩': '4星彩',

        // 修正：解決「大樂透加開獎項」CSV 第一欄顯示為活動名稱的問題
        '春節': '大樂透',
        '端午': '大樂透',
        '中秋': '大樂透',
        '加開': '大樂透',

        // 修正：解決樂合彩與賓果賓果解析為 0 筆的問題
        '49樂合彩': '49樂合彩', 
        '39樂合彩': '39樂合彩', 
        '38樂合彩': '38樂合彩',
        '賓果賓果': '賓果賓果'
    };

    let matchedGame = null;
    for (const [ch, en] of Object.entries(gameNameMap)) {
        if (cols[0].includes(ch)) { matchedGame = en; break; }
    }
    if (!matchedGame) return null;

    // 解析日期 (民國轉西元)
    const dateMatch = cols[2].match(/(\d{3,4})\/(\d{1,2})\/(\d{1,2})/);
    if (!dateMatch) return null;
    let year = parseInt(dateMatch[1]);
    if (year < 1911) year += 1911;
    const dateStr = `${year}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;

    // 解析號碼 (從第 6 欄開始，跳過銷售金額)
    const numbers = [];
    for (let i = 6; i < cols.length; i++) {
        if (/^\d+$/.test(cols[i])) numbers.push(parseInt(cols[i]));
    }

    if (numbers.length < 2) return null;

    // 因為歷史 CSV 通常只提供一組號碼，我們暫時將其視為 "開出順序" (appear)
    // 並自動排序產生 "大小順序" (size)
    const numsAppear = [...numbers];
    const numsSize = [...numbers].sort((a, b) => a - b);

    return {
        game: matchedGame,
        data: {
            date: dateStr, // 保持字串，合併後轉 Date
            period: cols[1],
            numbers: numsAppear,       // 預設為開出順序
            numbers_size: numsSize,    // 大小順序
            source: 'history_zip'
        }
    };
}

// 下載並解壓縮 ZIP 檔
export async function fetchAndParseZip(url) {
    if (DEBUG_MODE.SUMMARY) console.log(`📦 [ZIP] 開始下載: ${url}`);
    
    if (!window.JSZip) { 
        if (DEBUG_MODE.ERROR) console.error("❌ [ZIP] JSZip library not found"); 
        return {}; 
    }
    
    try {
        const res = await fetch(url);
        if (!res.ok) {
            if (DEBUG_MODE.ERROR) console.error(`❌ [ZIP] HTTP 錯誤: ${url} - Status ${res.status}`);
            return {};
        }
        
        if (DEBUG_MODE.ZIP) console.log(`✅ [ZIP] 下載完成: ${url}，開始解壓縮...`);
        
        const blob = await res.blob();
        const zip = await window.JSZip.loadAsync(blob);
        
        if (DEBUG_MODE.ZIP) console.log(`📂 [ZIP] 解壓縮完成: ${url}，檔案數量: ${Object.keys(zip.files).length}`);
        
        const zipData = {};
        let processedFiles = 0;
        let totalLines = 0;
        
        for (const filename of Object.keys(zip.files)) {
            if (filename.toLowerCase().endsWith('.csv') && !filename.startsWith('__')) {
                if (DEBUG_MODE.ZIP) console.log(`📄 [ZIP] 處理 CSV: ${filename}`);
                
                const text = await zip.files[filename].async("string");
                const lines = text.split(/\r\n|\n/);

                // Debug: 顯示前 3 行內容
                if (DEBUG_MODE.CSV) {
                    console.log(`📝 [CSV内容] ${filename} 前 3 行:`, lines.slice(0, 3));
                }

                let validLines = 0;
                lines.forEach(line => {
                    const parsed = parseCSVLine(line);
                    if (parsed) {
                        if (!zipData[parsed.game]) zipData[parsed.game] = [];
                        zipData[parsed.game].push(parsed.data);
                        validLines++;
                    }
                });
                
                if (DEBUG_MODE.ZIP) console.log(`  ✓ ${filename}: ${validLines} 筆有效資料`);
                processedFiles++;
                totalLines += validLines;
            }
        }
        
        // 摘要輸出（永遠顯示）
        if (DEBUG_MODE.SUMMARY) {
            console.log(`✅ [ZIP] 共處理 ${processedFiles} 檔案，${totalLines} 筆資料`);
        }
        
        return zipData;
        
    } catch (e) {
        if (DEBUG_MODE.ERROR) console.error(`❌ [ZIP] 處理失敗: ${url}`, e);
        return {};
    }
}


// 前端即時抓取 Live Data（已修正：fallback 加上日期過濾）
export async function fetchLiveLotteryData() {
    const GAMES = {
        'Lotto649': 'Lotto649', 'SuperLotto638': 'SuperLotto638',
        'Daily539': 'Daily539', 'Lotto1224': 'Lotto1224',
        '3D': '3D', '4D': '4D'
    };
    const API_BASE = 'https://api.taiwanlottery.com/TLCAPIWeB/Lottery';
    const liveData = {};

    // 代碼轉換
    const codeMap = {
        'Lotto649': '大樂透', 'SuperLotto638': '威力彩',
        'Daily539': '今彩539', 'Lotto1224': '雙贏彩',
        '3D': '3星彩', '4D': '4星彩'
    };

    // 產生月份清單（往前推 2 個月）
    const today = new Date();
    const monthsToFetch = [];
    for (let i = 0; i < 2; i++) {
        const targetDate = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const yearMonth = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
        monthsToFetch.push(yearMonth);
    }

    // ★ P0 修正：計算日期門檻（用於 fallback 過濾）
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
    const dateThreshold = twoMonthsAgo.toISOString().split('T')[0];

    if (DEBUG_MODE.SUMMARY) console.log(`🔄 [Utils] 抓取資料: ${monthsToFetch.join(', ')}`);

    // 修正 contentKey 函數
    const getContentKey = (code) => {
        if (code === '3D') return 'lotto3DRes';
        if (code === '4D') return 'lotto4DRes';
        return code.charAt(0).toLowerCase() + code.slice(1) + 'Res';
    };

    for (const code of Object.values(GAMES)) {
        const gameName = codeMap[code] || code;
        if (!liveData[gameName]) liveData[gameName] = [];

        // 平行查詢所有月份（加速）
        const monthPromises = monthsToFetch.map(async (month) => {
            try {
                const url = `${API_BASE}/${code}Result?month=${month}&pageNum=1&pageSize=100`;
                const res = await fetch(url);
                if (!res.ok) return [];

                const json = await res.json();
                const contentKey = getContentKey(code);
                const records = json.content[contentKey] || [];
                
                if (DEBUG_MODE.API && records.length > 0) {
                    console.log(`✅ [${gameName}] ${month}: ${records.length} 筆`);
                }
                
                return records;
            } catch (e) {
                if (DEBUG_MODE.API) console.warn(`⚠️ [${gameName}] ${month} 失敗`);
                return [];
            }
        });

        const allMonthRecords = await Promise.all(monthPromises);
        const allRecords = allMonthRecords.flat();

        // 處理所有記錄
        allRecords.forEach(item => {
            const dateStr = item.lotteryDate.split('T')[0];
            const numsSize = item.drawNumberSize || [];
            const numsAppear = item.drawNumberAppear || [];
            
            if (numsSize.length > 0 || numsAppear.length > 0) {
                liveData[gameName].push({
                    date: dateStr,
                    period: String(item.period),
                    numbers: numsAppear.length > 0 ? numsAppear : numsSize,
                    numbers_size: numsSize.length > 0 ? numsSize : numsAppear,
                    jackpot: item.totalAmount || 0,
                    source: 'live_api'
                });
            }
        });

        // 備援：如果逐月查詢失敗，嘗試區間查詢
        if (allRecords.length === 0) {
            if (DEBUG_MODE.API) console.log(`🔄 [${gameName}] 逐月無資料，嘗試區間查詢...`);
            try {
                const startMonth = monthsToFetch[monthsToFetch.length - 1];
                const endMonth = monthsToFetch[0];
                const url = `${API_BASE}/${code}Result?startMonth=${startMonth}&endMonth=${endMonth}&pageNum=1&pageSize=100`;
                const res = await fetch(url);
                
                if (res.ok) {
                    const json = await res.json();
                    const contentKey = getContentKey(code);
                    const records = json.content[contentKey] || [];

                    if (records.length > 0) {
                        if (DEBUG_MODE.API) console.log(`✅ [${gameName}] 區間查詢: ${records.length} 筆（過濾前）`);
                        
                        // ★ P0 修正：過濾日期，只保留近 2 個月
                        let filteredCount = 0;
                        records.forEach(item => {
                            const dateStr = item.lotteryDate.split('T')[0];
                            
                            // 只保留 >= dateThreshold 的資料
                            if (dateStr >= dateThreshold) {
                                const numsSize = item.drawNumberSize || [];
                                const numsAppear = item.drawNumberAppear || [];
                                
                                if (numsSize.length > 0 || numsAppear.length > 0) {
                                    liveData[gameName].push({
                                        date: dateStr,
                                        period: String(item.period),
                                        numbers: numsAppear.length > 0 ? numsAppear : numsSize,
                                        numbers_size: numsSize.length > 0 ? numsSize : numsAppear,
                                        jackpot: item.totalAmount || 0,
                                        source: 'live_api'
                                    });
                                    filteredCount++;
                                }
                            }
                        });
                        
                        if (DEBUG_MODE.API) {
                            console.log(`✅ [${gameName}] 區間查詢: ${filteredCount} 筆（過濾後，門檻: ${dateThreshold}）`);
                        }
                    }
                }
            } catch (e) {
                if (DEBUG_MODE.API) console.warn(`⚠️ [${gameName}] 區間查詢失敗`);
            }
        }
        
        // 摘要輸出（每遊戲一行）
        if (DEBUG_MODE.SUMMARY && liveData[gameName].length > 0) {
            console.log(`✅ [${gameName}] 2 個月共 ${liveData[gameName].length} 筆`);
        }
    }
    
    return liveData;
}



// 合併多重來源資料 (Base + ZIPs + Live)
// 注意：已移除 Firestore，只處理 3 個來源
export function mergeLotteryData(baseData, zipResults, liveData) {
    const merged = { ...baseData.games }; // 淺拷貝

    // 1. 合併 ZIP 資料
    zipResults.forEach(zipGameData => {
        for (const [game, rows] of Object.entries(zipGameData)) {
            if (!merged[game]) merged[game] = [];
            merged[game] = [...merged[game], ...rows];
        }
    });

    // 2. 合併 Live Data
    if (liveData) {
        for (const [game, rows] of Object.entries(liveData)) {
            if (!merged[game]) merged[game] = [];
            merged[game] = [...merged[game], ...rows];
        }
    }

    // 3. 去重與排序（簡化：Live API > ZIP/Base）
    for (const game in merged) {
        const unique = new Map();
        
        merged[game].forEach(item => {
            const key = `${item.date instanceof Date ? item.date.toISOString().split('T')[0] : item.date}-${item.period}`;
            
            // 簡單規則：Live API 優先（source === 'live_api'）
            if (!unique.has(key) || item.source === 'live_api') {
                unique.set(key, item);
            }
        });
        
        // 轉回陣列並排序 (由新到舊)
        merged[game] = Array.from(unique.values()).sort((a, b) => {
            const da = new Date(a.date);
            const db = new Date(b.date);
            return db - da;
        });
    }

    return { games: merged };
}

// ★ P1 改善：LocalStorage 快取（錯誤處理從靜默改為警告）
export function saveToCache(data) {
    try {
        const cacheData = {
            timestamp: Date.now(),
            data: data
        };
        
        const jsonStr = JSON.stringify(cacheData);
        
        // 可選：檢查大小（警告用戶）
        const sizeKB = new Blob([jsonStr]).size / 1024;
        if (DEBUG_MODE.SUMMARY && sizeKB > 1000) {
            console.log(`💾 [Cache] 快取大小: ${sizeKB.toFixed(0)} KB`);
        }
        
        if (sizeKB > 4000) {
            console.warn(`⚠️ [Cache] 快取過大 (${sizeKB.toFixed(0)} KB)，可能超過 LocalStorage 5MB 上限`);
        }
        
        localStorage.setItem('lottery_live_cache', jsonStr);
        
        if (DEBUG_MODE.SUMMARY) {
            console.log(`✅ [Cache] 已儲存快取 (${sizeKB.toFixed(0)} KB)`);
        }
        
    } catch (e) {
        // ★ 改善：從靜默改為明確警告
        if (DEBUG_MODE.ERROR) {
            console.error(`❌ [Cache] LocalStorage 寫入失敗（可能超過 5MB 上限或被瀏覽器阻擋）`, e);
        }
    }
}

export function loadFromCache() {
    try {
        const raw = localStorage.getItem('lottery_live_cache');
        if (!raw) return null;
        
        const parsed = JSON.parse(raw);
        
        if (DEBUG_MODE.SUMMARY) {
            const age = Math.floor((Date.now() - parsed.timestamp) / 1000 / 60);
            console.log(`📂 [Cache] 載入快取（${age} 分鐘前）`);
        }
        
        return parsed;
    } catch (e) { 
        if (DEBUG_MODE.ERROR) {
            console.error(`❌ [Cache] LocalStorage 讀取失敗`, e);
        }
        return null; 
    }
}


// ==========================================
// 2. 核心選號引擎 (The Core Engine)
// ==========================================
export function calculateZone(data, range, count, isSpecial, mode, lastDraw=[], customWeights={}, stats={}, wuxingContext={}) {
    const max = range; const min = (mode.includes('digit')) ? 0 : 1; 
    const totalDraws = stats ? stats.totalDraws : 0; const recentDrawsCount = 30;
    let weights = customWeights;

    if (Object.keys(weights).length === 0 || mode.includes('random')) {
        for(let i=min; i<=max; i++) weights[i] = 10;
        if (mode === 'stat') {
            data.forEach(d => { const nums = d.numbers.filter(n => n <= max); nums.forEach(n => weights[n] = (weights[n]||10) + 10); });
        } else if (mode === 'ai_weight') {
             data.slice(0, 10).forEach((d, idx) => { const w = 20 - idx; d.numbers.forEach(n => { if(n<=max) weights[n] += w; }); });
        }
    }

    const selected = []; const pool = [];
    for(let i=min; i<=max; i++) { const w = Math.floor(weights[i]); for(let k=0; k<w; k++) pool.push(i); }
    while(selected.length < count) {
        if(pool.length === 0) break;
        const idx = Math.floor(Math.random() * pool.length); const val = pool[idx];
        const isDigit = mode.includes('digit');
        if (isDigit || !selected.includes(val)) {
            selected.push(val);
            if (!isDigit) { const temp = pool.filter(n => n !== val); pool.length = 0; pool.push(...temp); }
        }
    }
    if (!mode.includes('digit') && !isSpecial) selected.sort((a,b)=>a-b);
    
    const resultWithTags = [];
    for (const num of selected) {
        let tag = '選號'; 
        if (isSpecial) { tag = '特別號'; } 
        else if (mode === 'stat' || mode === 'stat_missing') {
            const freq30 = data.slice(0, recentDrawsCount).filter(d => d.numbers.includes(num)).length;
            const missingCount = stats.missing ? stats.missing[num] : 0;
            if (mode === 'stat_missing') { tag = '極限回補'; } 
            else if (freq30 > 5) { tag = `近${recentDrawsCount}期${freq30}次`; } 
            else if (missingCount > 15) { tag = `遺漏${missingCount}期`; } 
            else { tag = '常態選號'; }
        } else if (mode === 'pattern') {
            const numTail = num % 10; const lastDrawTails = lastDraw.map(n => n % 10);
            if (lastDraw.includes(num)) { tag = '連莊強勢'; } 
            else if (lastDraw.includes(num - 1) || lastDraw.includes(num + 1)) { const neighbor = lastDraw.includes(num-1) ? (num-1) : (num+1); tag = `${neighbor}鄰號`; } 
            else if (lastDrawTails.includes(numTail) && numTail !== 0) { tag = `${numTail}尾群聚`; } 
            else { tag = '版路預測'; }
        } else if (mode === 'ai_weight') {
            const maxWeight = Math.max(...Object.values(weights)); const score = Math.round((weights[num] / maxWeight) * 100); tag = `趨勢分${score}`;
        } else if (mode.includes('balance') || mode.includes('random')) {
            const isOdd = num % 2 !== 0; const isBig = num > max / 2;
            tag = (isBig ? "大號" : "小號") + "/" + (isOdd ? "奇數" : "偶數"); 
        } else if (mode === 'wuxing') {
            if (wuxingContext && wuxingContext.tagMap && wuxingContext.tagMap[num]) {
                tag = wuxingContext.tagMap[num];
            } else {
                tag = '流年運數'; 
            }
        }
        resultWithTags.push({ val: num, tag: tag });
    }
    return resultWithTags;
}

// ==========================================
// 3. 統計與數學工具 (Math & Stats Tools)
// ==========================================
export function getLotteryStats(data, range, count) {
    const isDigit = range === 9; const stats = { freq: {}, missing: {}, totalDraws: data.length };
    const maxNum = isDigit ? 9 : range; const minNum = isDigit ? 0 : 1;
    for (let i = minNum; i <= maxNum; i++) { stats.freq[i] = 0; stats.missing[i] = data.length; }
    data.forEach((d, drawIndex) => { d.numbers.forEach(n => { if (n >= minNum && n <= maxNum) { stats.freq[n]++; if (stats.missing[n] === data.length) { stats.missing[n] = drawIndex; } } }); });
    return stats;
}

export function calcAC(numbers) { let diffs = new Set(); for(let i=0; i<numbers.length; i++) for(let j=i+1; j<numbers.length; j++) diffs.add(Math.abs(numbers[i] - numbers[j])); return diffs.size - (numbers.length - 1); }

export function checkPoisson(num, freq, totalDraws) { const theoreticalFreq = totalDraws / 49; return freq < (theoreticalFreq * 0.5); }

export function monteCarloSim(numbers, gameDef) { if(gameDef.type === 'digit') return true; return true; }

// ==========================================
// 4. 命理玄學工具 (Metaphysical Tools)
// ==========================================
export function getGanZhi(year) {
    const stems = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
    const branches = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
    const offset = year - 4; 
    return { gan: stems[offset % 10], zhi: branches[offset % 12] };
}

export function getFlyingStars(gan) {
    const map = {
        "甲": { lu: "廉貞", ji: "太陽" }, "乙": { lu: "天機", ji: "太陰" }, "丙": { lu: "天同", ji: "廉貞" },
        "丁": { lu: "太陰", ji: "巨門" }, "戊": { lu: "貪狼", ji: "天機" }, "己": { lu: "武曲", ji: "文曲" },
        "庚": { lu: "太陽", ji: "天同" }, "辛": { lu: "巨門", ji: "文昌" }, "壬": { lu: "天梁", ji: "武曲" },
        "癸": { lu: "破軍", ji: "貪狼" }
    };
    return map[gan] || { lu: "吉星", ji: "煞星" };
}

export function getHeTuNumbers(star) {
    if (["武曲", "七殺", "文昌", "擎羊"].some(s => star.includes(s))) return [4, 9]; 
    if (["天機", "貪狼", "天梁"].some(s => star.includes(s))) return [3, 8]; 
    if (["太陰", "天同", "破軍", "巨門", "文曲"].some(s => star.includes(s))) return [1, 6]; 
    if (["太陽", "廉貞", "火星", "鈴星"].some(s => star.includes(s))) return [2, 7]; 
    if (["紫微", "天府", "天相", "左輔", "右弼"].some(s => star.includes(s))) return [5, 0]; 
    return [];
}

// ==========================================
// 5. AI 學派專用統計工具 (AI School Stats V7.0)
// ==========================================

/**
 * 計算半衰期指數衰減權重
 * @param {number} dataLength - 歷史資料總筆數
 * @param {number} halfLife - 半衰期參數（h）
 * @returns {number[]} - 權重陣列，[0] 為最新一期
 */
export function ai_computeHalfLifeWeights(dataLength, halfLife) {
    const weights = [];
    for (let i = 0; i < dataLength; i++) {
        weights.push(Math.pow(0.5, i / halfLife));
    }
    return weights;
}

/**
 * 計算加權統計（曝光槽位 E 和出現次數 C）
 * 注意：numbersPerDraw 必須由呼叫端依據 gameDef 拆好區（主區/特別號/第2區）
 * @param {number[][]} numbersPerDraw - 每期號碼陣列（已拆區），例如 [[1,2,3,4,5,6], [3,5,7,9,12,18], ...]
 * @param {number[]} weights - 權重陣列
 * @param {number} minNum - 最小號碼（樂透為 1，digit 為 0）
 * @param {number} maxNum - 最大號碼（樂透為 range，digit 為 9）
 * @returns {Object} { E: 加權曝光槽位, C: 每個號碼的加權出現次數 }
 */
export function ai_computeWeightedStats(numbersPerDraw, weights, minNum, maxNum) {
    let E = 0;
    const C = {};
    
    // 初始化 C（包含所有可能號碼，含 0）
    for (let n = minNum; n <= maxNum; n++) {
        C[n] = 0;
    }
    
    numbersPerDraw.forEach((nums, idx) => {
        // 防護：weights 越界時視為權重 0
        const w = (idx < weights.length) ? weights[idx] : 0;
        E += w * nums.length; // 該期曝光槽位數 × 權重
        
        nums.forEach(num => {
            if (C[num] !== undefined) {
                C[num] += w;
            }
        });
    });
    
    return { E, C };
}

/**
 * 計算 Log-Lift 動能分數
 * @param {Object} C_short - 短期加權出現次數 { [num]: count }
 * @param {number} E_short - 短期加權曝光槽位
 * @param {Object} C_long - 長期加權出現次數 { [num]: count }
 * @param {number} E_long - 長期加權曝光槽位
 * @param {number} minNum - 最小號碼
 * @param {number} maxNum - 最大號碼
 * @param {number} epsilon - 加性平滑參數（預設 0.5）
 * @returns {Object} - { [num]: momentum }
 */
export function ai_computeLogLift(C_short, E_short, C_long, E_long, minNum, maxNum, epsilon = 0.5) {
    const momentum = {};
    const rangeCount = maxNum - minNum + 1;
    
    for (let n = minNum; n <= maxNum; n++) {
        const p_short = (C_short[n] + epsilon) / (E_short + epsilon * rangeCount);
        const p_long = (C_long[n] + epsilon) / (E_long + epsilon * rangeCount);
        momentum[n] = Math.log(p_short / p_long);
    }
    
    return momentum;
}

/**
 * 計算 Kish 有效樣本數並進行收縮
 * @param {number[]} weights - 權重陣列
 * @param {number} k - 先驗強度參數（預設 8）
 * @returns {number} - 收縮係數 s（0~1 之間）
 */
export function ai_computeKishShrinkage(weights, k = 8) {
    const sumW = weights.reduce((a, b) => a + b, 0);
    const sumW2 = weights.reduce((a, b) => a + b * b, 0);
    
    // 防護：避免除以 0
    if (sumW2 === 0) return 0;
    
    const Neff = (sumW * sumW) / sumW2;
    const s = Neff / (Neff + k);
    return s;
}

/**
 * Percentile Rank 轉換（含低變異拉伸）
 * @param {Object} scores - { [num]: finalScore }
 * @param {number} clampMin - 最小趨勢分（預設 10）
 * @param {number} clampMax - 最大趨勢分（預設 98）
 * @param {number} lowVarianceThreshold - 低變異門檻（預設 0.15）
 * @param {number} stretchFactor - 拉伸係數（預設 1.8）
 * @returns {Object} - { [num]: trendScore (clampMin ~ clampMax) }
 */
export function ai_percentileRankTransform(scores, clampMin = 10, clampMax = 98, lowVarianceThreshold = 0.15, stretchFactor = 1.8) {
    const nums = Object.keys(scores).map(Number);
    const values = nums.map(n => scores[n]);
    
    // 防護：空陣列
    if (values.length === 0) return {};
    
    // 計算標準差
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, v) => a + Math.pow(v - mean, 2), 0) / values.length;
    const std = Math.sqrt(variance);
    
    // 低變異拉伸（以 mean 為中心，在 percentile 之前做）
    let processedScores = { ...scores };
    if (std < lowVarianceThreshold) {
        nums.forEach(n => {
            processedScores[n] = mean + stretchFactor * (scores[n] - mean);
        });
    }
    
    // Deterministic 排序（同分時用號碼 n 決定）
    const sortedNums = nums.sort((a, b) => {
        const diff = processedScores[a] - processedScores[b];
        if (Math.abs(diff) < 1e-10) return a - b; // tie-break: 號碼小的排前面
        return diff;
    });
    
    // Percentile Rank 轉換為趨勢分（線性映射 10~98）
    const trendScores = {};
    const rangeSpan = clampMax - clampMin; // 98 - 10 = 88
    
    sortedNums.forEach((n, rank) => {
        let trendScore;
        if (sortedNums.length === 1) {
            // 防護：只有 1 個號碼時給中間值
            trendScore = clampMin + Math.round(rangeSpan / 2);
        } else {
            // 線性映射：10 + (rank / (n-1)) * 88
            trendScore = clampMin + Math.round((rank / (sortedNums.length - 1)) * rangeSpan);
        }
        
        trendScores[n] = trendScore;
    });
    
    return trendScores;
}
