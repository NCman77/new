/**
 * app.js
 * 核心邏輯層:負責資料處理、演算法運算、DOM 渲染與事件綁定
 * V27.0 重構版:模組化架構,拆分 Firebase、Profile、UI 渲染服務
 */

import { GAME_CONFIG } from './game_config.js';
import {
    monteCarloSim, calculateZone,
    fetchAndParseZip, mergeLotteryData, fetchLiveLotteryData,
    saveToCache, loadFromCache
} from './utils.js';

// 服務模組
import { FirebaseService } from './services/firebase.js';
import { ProfileService } from './services/profile.js';
import { UIRenderer } from './services/ui-renderer.js';
import { PredictionEngine } from './services/prediction-engine.js';

// 學派演算法(統計 / 關聯 / 平衡 / AI)
import { algoStat } from './algo/algo_stat.js';
import { algoPattern } from './algo/algo_pattern.js';
import { algoBalance } from './algo/algo_balance.js';
import { algoAI } from './algo/algo_ai.js';

// 五行學派子系統(紫微 / 姓名 / 星盤 / 五行生肖)
import { applyZiweiLogic } from './algo/algo_Ziwei.js';
import { applyNameLogic } from './algo/algo_name.js';
import { applyStarsignLogic } from './algo/algo_starsign.js';
import { applyWuxingLogic } from './algo/algo_wuxing.js';

// 動態產生 ZIP URL (只到當下年份)
const currentYear = new Date().getFullYear();
const zipUrls = [];
for (let y = 2021; y <= currentYear; y++) {
    zipUrls.push(`data/${y}.zip`);
}

const CONFIG = {
    JSON_URL: 'data/lottery-data.json',
    ZIP_URLS: zipUrls
};

const App = {
    state: {
        rawData: {},
        rawJackpots: {},
        currentGame: "",
        currentSubMode: null,
        currentSchool: "balance",
        filterPeriod: "",
        filterYear: "",
        filterMonth: "",
        drawOrder: 'size' // 預設用大小順序顯示
    },

    // 服務模組引用(供外部訪問)
    FirebaseService,
    ProfileService,
    UIRenderer,

    async init() {
        await FirebaseService.init();
        await ProfileService.init();
        this.setupAuthListener();
        this.selectSchool('balance');
        this.populateYearSelect();
        this.populateMonthSelect();
        this.initFetch();
        this.bindEvents();
    },

    setupAuthListener() {
        window.addEventListener('authStateChanged', (e) => {
            this.updateAuthUI(e.detail.user);
        });
    },

    bindEvents() {
        const periodInput = document.getElementById('search-period');
        if (periodInput) {
            periodInput.addEventListener('input', (e) => {
                this.state.filterPeriod = e.target.value.trim();
                this.updateDashboard();
            });
        }
        document.getElementById('search-year')
            .addEventListener('change', (e) => {
                this.state.filterYear = e.target.value;
                this.updateDashboard();
            });
        document.getElementById('search-month')
            .addEventListener('change', (e) => {
                this.state.filterMonth = e.target.value;
                this.updateDashboard();
            });
    },

    // ================= 認證 UI 更新 =================
    updateAuthUI(user) {
        const loginBtn = document.getElementById('btn-login');
        const userInfo = document.getElementById('user-info');
        const userName = document.getElementById('user-name');
        const dot = document.getElementById('login-status-dot');

        if (user) {
            loginBtn.classList.add('hidden');
            userInfo.classList.remove('hidden');
            userName.innerText = `Hi, ${user.displayName}`;
            dot.classList.remove('bg-stone-300');
            dot.classList.add('bg-green-500');
        } else {
            loginBtn.classList.remove('hidden');
            userInfo.classList.add('hidden');
            dot.classList.remove('bg-green-500');
            dot.classList.add('bg-stone-300');
        }
    },

    // ================= 核心資料載入流程 =================
    async initFetch() {
        this.setSystemStatus('loading');

        try {
            // Phase 1：靜態 JSON + ZIP + Local Cache
            const jsonRes = await fetch(`${CONFIG.JSON_URL}?t=${new Date().getTime()}`);
            let baseData = {};
            if (jsonRes.ok) {
                const jsonData = await jsonRes.json();
                baseData = jsonData.games || jsonData;
                this.state.rawJackpots = jsonData.jackpots || {};
                if (jsonData.last_updated) {
                    document.getElementById('last-update-time').innerText =
                        jsonData.last_updated.split(' ')[0];
                }
            }

            const zipPromises = CONFIG.ZIP_URLS.map(async (url) => {
                try {
                    return await fetchAndParseZip(url);
                } catch (e) {
                    console.warn(`ZIP 載入失敗: ${url}`, e);
                    return {};
                }
            });
            const zipResults = await Promise.all(zipPromises);

            const localCache = loadFromCache()?.data || {};

            const initialData = mergeLotteryData(
                { games: baseData },
                zipResults,
                localCache,
                null
            );
            this.processAndRender(initialData);

            // Phase 2：Live API
            const liveData = await fetchLiveLotteryData();

            if (liveData && Object.keys(liveData).length > 0) {
                // [新增邏輯] 從 Live Data 更新累積獎金 (取最新一期的 jackpot)
                for (const game in liveData) {
                    if (liveData[game].length > 0) {
                        // 確保排序是新的在前面
                        const sorted = liveData[game].sort((a, b) => new Date(b.date) - new Date(a.date));
                        const latest = sorted[0];
                        if (latest.jackpot && latest.jackpot > 0) {
                            this.state.rawJackpots[game] = latest.jackpot;
                        }
                    }
                }

                const finalData = mergeLotteryData(
                    { games: baseData },
                    zipResults,
                    liveData,
                    null
                );
                this.processAndRender(finalData);
                if (this.state.currentGame) {
                    this.updateDashboard();
                }
                try {
                    saveToCache(liveData);
                } catch (e) {
                    console.warn("Local Cache 寫入失敗:", e);
                }
            }

            this.checkSystemStatus();
        } catch (e) {
            console.error("Critical Data Error:", e);
            this.checkSystemStatus();
            this.renderGameButtons();
        }
    },

    processAndRender(mergedData) {
        this.state.rawData = mergedData.games || {};
        for (let game in this.state.rawData) {
            this.state.rawData[game] = this.state.rawData[game]
                .map(item => {
                    const gameDef = GAME_CONFIG.GAMES[game];
                    // [Fix] 侵略性清洗 + 強制整形：解決資料長度不符導致的驗證失敗
                    // 1. 基礎清洗：轉型 Number 並剔除無效值（digit 允許 0，其餘玩法不允許 0）
                    const minValid = (gameDef && gameDef.type === 'digit') ? 0 : 1;
                    const clean = (arr) => Array.isArray(arr)
                        ? arr.map(n => Number(n)).filter(n => !isNaN(n) && n >= minValid)
                        : [];

                    let nums = clean(item.numbers);
                    let numsSize = clean(item.numbers_size);




                    // 2. 強制整形：針對 'today' (今彩539) 與 'digit' (星彩) 執行嚴格切割
                    // 這能確保即便原始資料有雜訊 (如6碼)，也會被強制修正為正確長度 (如5碼)
                    if (gameDef) {
                        if (gameDef.type === 'today') {
                            nums = nums.slice(0, 5); // 539 嚴格 5 碼
                            numsSize = numsSize.slice(0, 5);
                        } else if (gameDef.type === 'digit') {
                            nums = nums.slice(0, gameDef.count); // 星彩嚴格 N 碼
                            numsSize = numsSize.slice(0, gameDef.count);
                        }
                        // Lotto/Power 類型通常允許 6 或 7 碼 (含特別號)，故不強制切為 6
                    }

                    return {
                        ...item,
                        date: new Date(item.date),
                        numbers: nums,
                        numbers_size: numsSize
                    };
                });
        }
        this.renderGameButtons();
    },

    setSystemStatus(status, dateStr = "") {
        const text = document.getElementById('system-status-text');
        const icon = document.getElementById('system-status-icon');
        if (status === 'loading') {
            text.innerText = "連線更新中...";
            text.className = "text-yellow-600 font-bold";
            icon.className = "w-2 h-2 rounded-full bg-yellow-500 animate-pulse";
        } else if (status === 'success') {
            text.innerText = "系統連線正常";
            text.className = "text-green-600 font-bold";
            icon.className = "w-2 h-2 rounded-full bg-green-500";
        } else {
            text.innerText = `資料過期 ${dateStr ? `(${dateStr})` : ""}`;
            text.className = "text-red-600 font-bold";
            icon.className = "w-2 h-2 rounded-full bg-red-500";
        }
    },

    checkSystemStatus() {
        let hasLatestData = false;
        let latestDateObj = null;
        const today = new Date();
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(today.getDate() - 3);

        for (let game in this.state.rawData) {
            if (this.state.rawData[game].length > 0) {
                const lastDate = this.state.rawData[game][0].date;
                if (!latestDateObj || lastDate > latestDateObj) {
                    latestDateObj = lastDate;
                }
                if (lastDate >= threeDaysAgo) {
                    hasLatestData = true;
                }
            }
        }

        const dataCount = Object.values(this.state.rawData)
            .reduce((acc, curr) => acc + curr.length, 0);
        const dateStr = latestDateObj ? latestDateObj.toLocaleDateString() : "無資料";

        if (dataCount === 0 || !hasLatestData) {
            this.setSystemStatus('error', dateStr);
        } else {
            this.setSystemStatus('success');
        }
    },

    // ================== UI：遊戲 & 歷史 & 學派 ==================
    renderGameButtons() {
        const container = document.getElementById('game-btn-container');
        container.innerHTML = '';
        GAME_CONFIG.ORDER.forEach(gameName => {
            const btn = document.createElement('div');
            btn.className = `game-tab-btn ${gameName === this.state.currentGame ? 'active' : ''}`;
            btn.innerText = gameName;
            btn.onclick = () => {
                this.state.currentGame = gameName;
                this.state.currentSubMode = null;
                this.resetFilter();
                document.querySelectorAll('.game-tab-btn')
                    .forEach(el => el.classList.remove('active'));
                btn.classList.add('active');
                this.updateDashboard();
            };
            container.appendChild(btn);
        });
        if (!this.state.currentGame && GAME_CONFIG.ORDER.length > 0) {
            this.state.currentGame = GAME_CONFIG.ORDER[0];
            container.querySelector('.game-tab-btn')?.classList.add('active');
            this.updateDashboard();
        }
    },

    updateDashboard() {
        const gameName = this.state.currentGame;
        const gameDef = GAME_CONFIG.GAMES[gameName];
        let data = this.state.rawData[gameName] || [];

        // [新增] 動態調整包牌按鈕文字 (pack_1)
        const pack1Text = document.getElementById('btn-pack-1-text');
        if (pack1Text) {
            if (gameDef.type === 'power') {
                pack1Text.innerText = "🔒 二區包牌";
            } else if (gameDef.type === 'digit') {
                pack1Text.innerText = "🔥 強勢包牌";
            } else {
                pack1Text.innerText = "🔒 智能包牌";
            }
        }

        if (this.state.filterPeriod) {
            data = data.filter(item => String(item.period).includes(this.state.filterPeriod));
        }
        if (this.state.filterYear) {
            data = data.filter(item => item.date.getFullYear() === parseInt(this.state.filterYear));
        }
        if (this.state.filterMonth) {
            data = data.filter(item => (item.date.getMonth() + 1) === parseInt(this.state.filterMonth));
        }

        document.getElementById('current-game-title').innerText = gameName;
        document.getElementById('total-count').innerText = data.length;
        document.getElementById('latest-period').innerText =
            data.length > 0 ? `${data[0].period}期` : "--期";

        const jackpotContainer = document.getElementById('jackpot-container');
        if (jackpotContainer) jackpotContainer.classList.add('hidden');

        this.renderSubModeUI(gameDef);
        this.renderHotStats('stat-year', data);
        this.renderHotStats('stat-month', data.slice(0, 30));
        this.renderHotStats('stat-recent', data.slice(0, 10));
        document.getElementById('no-result-msg')
            .classList.toggle('hidden', data.length > 0);

        this.renderDrawOrderControls();
        this.renderHistoryList(data.slice(0, 5));
    },

    getNextDrawDate(drawDays) {
        if (!drawDays || drawDays.length === 0) return "--";
        const today = new Date();
        const currentDay = today.getDay(); // 0(週日) - 6(週六)

        // 尋找本週是否還有開獎日
        let nextDay = drawDays.find(d => d > currentDay);
        let daysToAdd = 0;

        if (nextDay !== undefined) {
            daysToAdd = nextDay - currentDay;
        } else {
            // 本週已過，找下週的第一個開獎日
            nextDay = drawDays[0];
            daysToAdd = (7 - currentDay) + nextDay;
        }

        const nextDate = new Date(today);
        nextDate.setDate(today.getDate() + daysToAdd);

        const y = nextDate.getFullYear();
        const m = String(nextDate.getMonth() + 1).padStart(2, '0');
        const d = String(nextDate.getDate()).padStart(2, '0');
        const weekMap = ['日', '一', '二', '三', '四', '五', '六'];

        return `${y}/${m}/${d} (${weekMap[nextDate.getDay()]})`;
    },

    renderDrawOrderControls() {
        const container = document.getElementById('draw-order-controls');
        if (!container) return;
        container.classList.remove('hidden');
        container.innerHTML = `
            <button onclick="app.setDrawOrder('size')" class="order-btn ${this.state.drawOrder === 'size' ? 'active' : ''}">大小順序</button>
            <button onclick="app.setDrawOrder('appear')" class="order-btn ${this.state.drawOrder === 'appear' ? 'active' : ''}">開出順序</button>
        `;
        if (!document.getElementById('order-btn-style')) {
            document.head.insertAdjacentHTML('beforeend', `
                <style id="order-btn-style">
                    .order-btn {
                        padding: 2px 8px;
                        font-size: 15px;
                        border-radius: 9999px;
                        border: 1px solid #d6d3d1;
                        color: #57534e;
                        transition: all 150ms;
                    }
                    .order-btn.active {
                        background-color: #10b981;
                        border-color: #10b981;
                        color: white;
                        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
                    }
                </style>
            `);
        }
    },

    setDrawOrder(order) {
        if (this.state.drawOrder === order) return;
        this.state.drawOrder = order;
        this.renderDrawOrderControls();
        this.updateDashboard();
    },

    renderSubModeUI(gameDef) {
        const area = document.getElementById('submode-area');
        const container = document.getElementById('submode-tabs');
        const rulesContent = document.getElementById('game-rules-content');
        const gameName = this.state.currentGame;

        // 總是顯示區域
        area.classList.remove('hidden');
        rulesContent.classList.add('hidden'); // 預設隱藏規則內容
        container.innerHTML = ''; // 清空容器

        // 1. 強制過濾：即使 Config 有定義，針對 3星/4星 也強制不渲染 Tab，只保留規則
        if (gameDef.subModes && !['3星彩', '4星彩'].includes(gameName)) {
            if (!this.state.currentSubMode) {
                this.state.currentSubMode = gameDef.subModes[0].id;
            }
            gameDef.subModes.forEach(mode => {
                const tab = document.createElement('div');
                tab.className = `submode-tab ${this.state.currentSubMode === mode.id ? 'active' : ''}`;
                tab.innerText = mode.name;
                tab.onclick = () => {
                    this.state.currentSubMode = mode.id;
                    document.querySelectorAll('.submode-tab').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                };
                container.appendChild(tab);
            });
        }
        // 2. 如果沒有 subModes 或被強制過濾 (如 3星彩, 4星彩, 大樂透, 威力彩)，渲染資訊卡片 (獎金 + 日期)
        else {
            this.state.currentSubMode = null;

            // 抓取累積獎金 (若無資料顯示累計中)
            let jackpotText = "累計中";
            if (this.state.rawJackpots && this.state.rawJackpots[gameName]) {
                // 簡單格式化數字加逗號
                jackpotText = `$${Number(this.state.rawJackpots[gameName]).toLocaleString()}`;
            }

            // 計算下期開獎
            const nextDate = this.getNextDrawDate(gameDef.drawDays);

            // 只有大樂透和威力彩顯示獎金，其他顯示一般資訊
            if (['lotto', 'power', 'digit'].includes(gameDef.type)) {
                container.innerHTML = `
                    <div class="flex items-center gap-3 text-xs md:text-sm">
                        ${['大樂透', '威力彩'].includes(gameName) ? `
                        <div class="px-3 py-1 bg-yellow-50 text-yellow-700 rounded-lg border border-yellow-200 font-bold flex items-center gap-1 shadow-sm">
                            <span>💰</span> 累積: ${jackpotText}
                        </div>
                        ` : ''}
                        <div class="px-3 py-1 bg-blue-50 text-blue-700 rounded-lg border border-blue-200 font-bold flex items-center gap-1 shadow-sm">
                            <span>📅</span> 下期: ${nextDate}
                        </div>
                    </div>
                `;
            }
        }

        rulesContent.innerHTML = gameDef.article || "暫無說明";
    },

    toggleRules() {
        document.getElementById('game-rules-content')
            .classList.toggle('hidden');
    },

    renderHistoryList(data) {
        const list = document.getElementById('history-list');
        list.innerHTML = '';
        data.forEach(item => {
            let numsHtml = "";
            const gameDef = GAME_CONFIG.GAMES[this.state.currentGame];

            const sourceNumbers =
                this.state.drawOrder === 'size' &&
                    item.numbers_size && item.numbers_size.length > 0
                    ? item.numbers_size
                    : item.numbers || [];

            const numbers = sourceNumbers.filter(n => typeof n === 'number');

            if (gameDef.type === 'digit') {
                numsHtml = numbers
                    .map(n => `<span class="ball-sm">${n}</span>`)
                    .join('');
            } else {
                const len = numbers.length;
                let normal = [], special = null;
                if ((gameDef.type === 'power' || gameDef.special) && len > gameDef.count) {
                    special = numbers[len - 1];
                    normal = numbers.slice(0, len - 1);
                } else {
                    normal = numbers;
                }
                numsHtml = normal
                    .filter(n => typeof n === 'number')
                    .map(n => `<span class="ball-sm">${n}</span>`)
                    .join('');
                if (special !== null && typeof special === 'number') {
                    numsHtml += `<span class="ball-sm ball-special ml-2 font-black border-none">${special}</span>`;
                }
            }

            list.innerHTML += `
              <tr class="table-row">
                <td class="px-5 py-3 border-b border-stone-100">
                  <div class="font-bold text-stone-700">No. ${item.period}</div>
                  <div class="text-[10px] text-stone-400">${item.date.toLocaleDateString()}</div>
                </td>
                <td class="px-5 py-3 border-b border-stone-100 flex flex-wrap gap-1">
                  ${numsHtml}
                </td>
              </tr>`;
        });
    },

    renderHotStats(elId, dataset) {
        const el = document.getElementById(elId);
        if (!dataset || dataset.length === 0) {
            el.innerHTML = '<span class="text-stone-300 text-[10px]">無數據</span>';
            return;
        }
        const freq = {};
        dataset.forEach(d =>
            d.numbers.forEach(n => {
                freq[n] = (freq[n] || 0) + 1;
            })
        );
        const sorted = Object.entries(freq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
        el.innerHTML = sorted.map(([n, c]) => `
            <div class="flex flex-col items-center">
              <div class="ball ball-hot mb-1 scale-75">${n}</div>
              <div class="text-sm text-stone-600 font-black">${c}</div>
            </div>
        `).join('');
    },

    selectSchool(school) {
        this.state.currentSchool = school;
        const info = GAME_CONFIG.SCHOOLS[school];
        document.querySelectorAll('.school-card').forEach(el => {
            el.classList.remove('active');
            Object.values(GAME_CONFIG.SCHOOLS).forEach(s => {
                if (s.color) el.classList.remove(s.color);
            });
        });
        const activeCard = document.querySelector(`.school-${school}`);
        if (activeCard) {
            activeCard.classList.add('active');
            activeCard.classList.add(info.color);
        }
        const container = document.getElementById('school-description');
        container.className =
            `text-sm leading-relaxed text-stone-600 bg-stone-50 p-5 rounded-xl border-l-4 ${info.color}`;
        container.innerHTML =
            `<h4 class="base font-bold mb-3 text-stone-800">${info.title}</h4>${info.desc}`;
        document.getElementById('wuxing-options')
            .classList.toggle('hidden', school !== 'wuxing');
    },

    // ================= 學派預測入口 (整合 PredictionEngine) =================
    runPrediction() {
        PredictionEngine.runPrediction({
            state: this.state,
            renderRow: (obj, idx, label) => this.renderRow(obj, idx, label),
            ProfileService
        });
    },

    // 五行學派包裝器 (供 PredictionEngine 呼叫)
    algoWuxing(params) {
        return PredictionEngine.runWuxingAlgo({
            params,
            gameDef: params.gameDef,
            ProfileService
        });
    },



    renderRow(resultObj, index, label = null) {
        const container = document.getElementById('prediction-output');
        const colors = {
            stat: 'bg-stone-200 text-stone-700',
            pattern: 'bg-purple-100 text-purple-700',
            balance: 'bg-emerald-100 text-emerald-800',
            ai: 'bg-amber-100 text-amber-800',
            wuxing: 'bg-pink-100 text-pink-800'
        };
        const colorClass = colors[this.state.currentSchool] || 'bg-stone-200';

        const displayLabel = label ? label : `SET ${index}`;

        // ===== 只改 UI 顯示：Pos1/Pos2/... 轉成「位數」名稱（不動演算法輸出）=====
        const posNameMapByGame = {
            '3星彩': ['佰位', '拾位', '個位'],
            '4星彩': ['仟位', '佰位', '拾位', '個位']
        };
        const posNames = posNameMapByGame[this.state.currentGame] || null;

        const isCandidate = resultObj.metadata?.isCandidate;
        const clickAttr = isCandidate ? `onclick="app.handleCandidateClick(${JSON.stringify(resultObj.numbers).replace(/"/g, '&quot;')})"` : '';
        const hoverClass = isCandidate ? 'cursor-pointer hover:bg-stone-50 active:scale-95 border-purple-200' : 'border-stone-200';

        let html = `
          <div ${clickAttr} class="flex flex-col gap-2 p-4 bg-white rounded-xl border ${hoverClass} shadow-sm animate-fade-in hover:shadow-md transition">
            <div class="flex items-center gap-3">
              <span class="text-[10px] font-black text-stone-300 tracking-widest uppercase">${displayLabel}</span>
              <div class="flex flex-wrap gap-2">
        `;

        resultObj.numbers.forEach(item => {
            let displayTag = item.tag;

            // 只在 3/4 星彩把 PosX 轉成位數名稱
            if (posNames && typeof displayTag === 'string') {
                const m = displayTag.match(/^Pos(\d+)$/);
                if (m) {
                    const idx = parseInt(m[1], 10) - 1;
                    if (idx >= 0 && idx < posNames.length) {
                        displayTag = posNames[idx];
                    }
                }
            }

            html += `
              <div class="flex flex-col items-center">
                <div class="ball-sm ${colorClass}" style="box-shadow: none;">${item.val}</div>
                ${displayTag ? `<div class="reason-tag">${displayTag}</div>` : ''}
              </div>
            `;
        });

        html += `
              </div>
            </div>
        `;

        if (resultObj.groupReason) {
            html += `
              <div class="text-[10px] text-stone-500 font-medium bg-stone-50 px-2 py-1.5 rounded border border-stone-100 flex items-center gap-1">
                <span class="text-sm">💡</span> ${resultObj.groupReason}
              </div>
            `;
        }

        html += `</div>`;
        container.innerHTML += html;
    },

    /**
     * 處理候選號碼點擊 (互動式包牌第二階段)
     */
    handleCandidateClick(numbers) {
        console.log('🎯 執行包牌擴展...', numbers);
        const gameDef = GAME_CONFIG.GAMES[this.state.currentGame];
        const container = document.getElementById('prediction-output');

        // 1. 取得擴展注數
        const expandedTickets = PredictionEngine.expandPack(numbers, gameDef);

        if (expandedTickets.length > 0) {
            // 2. 清空候選區並重新渲染最終結果
            container.innerHTML = `
                <div class="mb-4 p-4 bg-purple-50 rounded-xl border border-purple-100 flex items-center justify-between">
                    <div class="text-purple-800 font-bold text-sm">✨ 已根據選定號碼生成包牌成果 (${expandedTickets.length} 注)</div>
                    <button onclick="app.runPrediction()" class="text-xs bg-white text-purple-600 px-3 py-1 rounded-lg border border-purple-200 hover:bg-purple-600 hover:text-white transition">返回選號</button>
                </div>
            `;

            expandedTickets.forEach((res, idx) => {
                this.renderRow(res, idx + 1, `<span class="text-purple-600 font-bold">🎯 包牌組合 ${idx + 1}</span>`);
            });

            // 滾動到頂部
            document.getElementById('result-area').scrollIntoView({ behavior: 'smooth' });
        }
    },


    populateYearSelect() {
        const yearSelect = document.getElementById('search-year');
        const cy = new Date().getFullYear();
        for (let y = 2021; y <= cy; y++) {
            const opt = document.createElement('option');
            opt.value = y;
            opt.innerText = `${y}`;
            yearSelect.appendChild(opt);
        }
    },

    populateMonthSelect() {
        const monthSelect = document.getElementById('search-month');
        for (let m = 1; m <= 12; m++) {
            const opt = document.createElement('option');
            opt.value = m;
            opt.innerText = `${m} 月`;
            monthSelect.appendChild(opt);
        }
    },

    resetFilter() {
        this.state.filterPeriod = "";
        this.state.filterYear = "";
        this.state.filterMonth = "";
        const pInput = document.getElementById('search-period');
        if (pInput) pInput.value = "";
        document.getElementById('search-year').value = "";
        document.getElementById('search-month').value = "";
        this.updateDashboard();
    },

    toggleHistory() {
        const c = document.getElementById('history-container');
        const a = document.getElementById('history-arrow');
        const t = document.getElementById('history-toggle-text');
        if (c.classList.contains('max-h-0')) {
            c.classList.remove('max-h-0');
            c.classList.add('max-h-[1000px]');
            a.classList.add('rotate-180');
            t.innerText = "隱藏近 5 期";
        } else {
            c.classList.add('max-h-0');
            c.classList.remove('max-h-[1000px]');
            a.classList.remove('rotate-180');
            t.innerText = "顯示近 5 期";
        }
    }
};

// ==================== HTML 橋接函式 (供 onclick 使用) ====================
window.appBridge = {
    // Firebase 認證
    loginGoogle: () => FirebaseService.loginGoogle(),
    logoutGoogle: () => FirebaseService.logout(),

    // Profile 管理
    addProfile: () => ProfileService.addProfile(),
    deleteProfile: (id) => ProfileService.deleteProfile(id),
    deleteCurrentProfile: () => ProfileService.deleteCurrentProfile(),
    toggleProfileModal: () => ProfileService.toggleProfileModal(),
    onProfileChange: () => ProfileService.onProfileChange(),
    generateAIFortune: () => ProfileService.generateAIFortune(),
    clearFortune: () => ProfileService.clearFortune(),
    saveApiKey: () => ProfileService.saveApiKey(),

    // UI 順序控制
    setDrawOrder: (order) => App.setDrawOrder(order)
};

// ==================== 暴露 App 到全域 (讓 HTML onclick 能訪問) ====================
// 將 appBridge 的方法注入到 App 物件 (為了兼容 HTML onclick="app.xxx()")
Object.assign(App, window.appBridge);
window.app = App;

// ==================== 初始化應用程式 ====================
window.onload = () => {
    console.log('🚀 應用程式初始化中...');
    App.init();
};
