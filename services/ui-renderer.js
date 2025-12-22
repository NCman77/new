/**
 * ui-renderer.js
 * UI 渲染服務
 * 負責: 遊戲按鈕、歷史列表、統計資訊、預測結果等 UI 渲染
 */

import { GAME_CONFIG } from '../game_config.js';

export const UIRenderer = {
    /**
     * 渲染遊戲按鈕
     */
    renderGameButtons(currentGame, onGameSelect) {
        const container = document.getElementById('game-btn-container');
        container.innerHTML = '';

        GAME_CONFIG.ORDER.forEach(gameName => {
            const btn = document.createElement('div');
            btn.className = `game-tab-btn ${gameName === currentGame ? 'active' : ''}`;
            btn.innerText = gameName;
            btn.onclick = () => onGameSelect(gameName);
            container.appendChild(btn);
        });
    },

    /**
     * 渲染開獎順序控制按鈕
     */
    renderDrawOrderControls(currentOrder, onOrderChange) {
        const container = document.getElementById('draw-order-controls');
        if (!container) return;

        container.classList.remove('hidden');
        container.innerHTML = `
            <button onclick="app.UIRenderer.handleOrderChange('size')" class="order-btn ${currentOrder === 'size' ? 'active' : ''}">大小順序</button>
            <button onclick="app.UIRenderer.handleOrderChange('appear')" class="order-btn ${currentOrder === 'appear' ? 'active' : ''}">開出順序</button>
        `;

        // 儲存回調函式
        this._orderChangeCallback = onOrderChange;

        // 注入樣式(只注入一次)
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

    /**
     * 處理順序變更(供 HTML onclick 使用)
     */
    handleOrderChange(order) {
        if (this._orderChangeCallback) {
            this._orderChangeCallback(order);
        }
    },

    /**
     * 渲染子模式 UI
     */
    renderSubModeUI(gameDef, gameName, currentSubMode, rawJackpots, onSubModeChange) {
        const area = document.getElementById('submode-area');
        const container = document.getElementById('submode-tabs');
        const rulesContent = document.getElementById('game-rules-content');

        area.classList.remove('hidden');
        rulesContent.classList.add('hidden');
        container.innerHTML = '';

        // 強制過濾:3星/4星 不渲染 Tab
        if (gameDef.subModes && !['3星彩', '4星彩'].includes(gameName)) {
            gameDef.subModes.forEach(mode => {
                const tab = document.createElement('div');
                tab.className = `submode-tab ${currentSubMode === mode.id ? 'active' : ''}`;
                tab.innerText = mode.name;
                tab.onclick = () => onSubModeChange(mode.id);
                container.appendChild(tab);
            });
        } else {
            // 渲染資訊卡片(獎金 + 日期)
            let jackpotText = "累計中";
            if (rawJackpots && rawJackpots[gameName]) {
                jackpotText = `$${Number(rawJackpots[gameName]).toLocaleString()}`;
            }

            const nextDate = this.getNextDrawDate(gameDef.drawDays);

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

    /**
     * 計算下期開獎日期
     */
    getNextDrawDate(drawDays) {
        if (!drawDays || drawDays.length === 0) return "--";

        const today = new Date();
        const currentDay = today.getDay();

        let nextDay = drawDays.find(d => d > currentDay);
        let daysToAdd = 0;

        if (nextDay !== undefined) {
            daysToAdd = nextDay - currentDay;
        } else {
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

    /**
     * 渲染歷史開獎列表
     */
    renderHistoryList(data, gameDef, currentGame, drawOrder) {
        const list = document.getElementById('history-list');
        list.innerHTML = '';

        data.forEach(item => {
            let numsHtml = "";

            const sourceNumbers =
                drawOrder === 'size' &&
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

    /**
     * 渲染熱門號碼統計
     */
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

    /**
     * 渲染預測結果
     */
    renderPredictionRow(resultObj, index, currentSchool, currentGame, label = null) {
        const container = document.getElementById('prediction-output');
        const colors = {
            stat: 'bg-stone-200 text-stone-700',
            pattern: 'bg-purple-100 text-purple-700',
            balance: 'bg-emerald-100 text-emerald-800',
            ai: 'bg-amber-100 text-amber-800',
            wuxing: 'bg-pink-100 text-pink-800'
        };
        const colorClass = colors[currentSchool] || 'bg-stone-200';
        const displayLabel = label ? label : `SET ${index}`;

        // 位數名稱對應
        const posNameMapByGame = {
            '3星彩': ['佰位', '拾位', '個位'],
            '4星彩': ['仟位', '佰位', '拾位', '個位']
        };
        const posNames = posNameMapByGame[currentGame] || null;

        let html = `
          <div class="flex flex-col gap-2 p-4 bg-white rounded-xl border border-stone-200 shadow-sm animate-fade-in hover:shadow-md transition">
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
    }
};

// 掛載到 window 供 HTML onclick 使用
window.UIRendererHelper = {
    handleOrderChange: (order) => UIRenderer.handleOrderChange(order)
};
