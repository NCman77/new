/**
 * prediction-engine.js
 * 學派預測引擎 - 統一管理所有學派的選號邏輯
 * 解決痛點: 新增學派不需修改 app.js,只需在此檔案新增 case
 */

import { GAME_CONFIG } from '../game_config.js';
import { monteCarloSim, calculateZone } from '../utils.js';

// 學派演算法
import { algoStat } from '../algo/algo_stat.js';
import { algoPattern } from '../algo/algo_pattern.js';
import { algoBalance } from '../algo/algo_balance.js';
import { algoAI } from '../algo/algo_ai.js';

// 五行學派子系統
import { applyZiweiLogic } from '../algo/algo_Ziwei.js';
import { applyNameLogic } from '../algo/algo_name.js';
import { applyStarsignLogic } from '../algo/algo_starsign.js';
import { applyWuxingLogic } from '../algo/algo_wuxing.js';

export const PredictionEngine = {
    /**
     * 主要預測入口
     * @param {Object} context - 包含所有依賴的上下文物件
     * @param {Object} context.state - App 狀態
     * @param {Function} context.renderRow - 渲染單行結果的回調函式
     * @param {Object} context.ProfileService - Profile 服務
     */
    runPrediction(context) {
        const { state, renderRow, ProfileService } = context;

        const gameName = state.currentGame;
        const gameDef = GAME_CONFIG.GAMES[gameName];
        let data = state.rawData[gameName] || [];

        if (!gameDef) return;

        const modeInput = document.querySelector('input[name="count"]:checked');
        const mode = modeInput ? modeInput.value : 'strict';

        const container = document.getElementById('prediction-output');
        container.innerHTML = '';
        document.getElementById('result-area').classList.remove('hidden');

        // --- 互動式包牌判斷 ---
        // 需求：威力彩/數位型在包牌模式下，先跑 5 組嚴選供使用者挑選
        const isInteractivePack = isPack && (gameDef.type === 'power' || gameDef.type === 'digit');

        // 如果是互動式包牌，第一階段跑 5 注嚴選
        const count = (isPack && !isInteractivePack) ? 1 : 5;
        const excludeSet = new Set();
        const allowDuplicates = (gameDef.type === 'digit');

        for (let i = 0; i < count; i++) {
            const params = {
                data,
                gameDef,
                subModeId: state.currentSubMode,
                excludeNumbers: allowDuplicates ? new Set() : excludeSet,
                random: isRandom,
                mode: (isRandom || isInteractivePack) ? (isRandom ? 'random' : 'strict') : mode,
                setIndex: i,
                packMode: (isPack && !isInteractivePack) ? mode : null,
                targetCount: 5
            };

            let result = null;

            // 學派選擇
            switch (school) {
                case 'balance':
                    result = algoBalance(params);
                    break;
                case 'stat':
                    result = algoStat(params);
                    break;
                case 'pattern':
                    result = algoPattern(params);
                    break;
                case 'ai':
                    result = algoAI(params);
                    break;
                case 'wuxing':
                    result = this.runWuxingAlgo({ params, gameDef, ProfileService });
                    break;
            }

            // 處理結果渲染
            if (result) {
                // 如果學派回傳的是陣列 (代表它已經獨立處理了包牌結果)
                if (Array.isArray(result)) {
                    result.forEach((res, idx) => {
                        const label = isPack ? `<span class="text-purple-600 font-bold">🎯 包牌組合 ${idx + 1}</span>` : `SET ${idx + 1}`;
                        renderRow(res, idx + 1, label);
                    });
                    break; // 包牌模式一次渲染完即結束
                }

                // 單注模式渲染
                if (result.numbers) {
                    if (!monteCarloSim(result.numbers, gameDef)) { /* fallback */ }

                    // 更新排除集合 (用於單注連選)
                    result.numbers.forEach(n => {
                        if (!allowDuplicates) excludeSet.add(n.val);
                    });

                    let rankLabel = `SET ${i + 1}`;
                    if (isInteractivePack) {
                        // 互動式包牌標籤：呈現嚴選品質，但註記可點擊
                        const titles = ["👑 系統首選", "🥈 次佳組合", "🥉 潛力組合", "🛡️ 補位組合", "🛡️ 補位組合"];
                        rankLabel = `<span class="text-purple-600 font-bold">💡 點擊展開包牌: ${titles[i] || `組合 ${i + 1}`}</span>`;
                        // 注入候選標記
                        result.metadata = result.metadata || {};
                        result.metadata.isCandidate = true;
                    } else if (isRandom) {
                        rankLabel = `<span class="text-amber-600">🎲 隨機推薦 ${i + 1}</span>`;
                    } else {
                        if (i === 0) rankLabel = `<span class="text-yellow-600">👑 系統首選</span>`;
                        else if (i === 1) rankLabel = `<span class="text-stone-500">🥈 次佳組合</span>`;
                        else if (i === 2) rankLabel = `<span class="text-amber-700">🥉 潛力組合</span>`;
                        else rankLabel = `<span class="text-stone-400">🛡️ 補位組合</span>`;
                    }
                    renderRow(result, i + 1, rankLabel);
                }
            }
        }
    },

    /**
     * 五行學派整合邏輯
     * @param {Object} context
     * @param {Object} context.params - 演算法參數
     * @param {Object} context.gameDef - 遊戲定義
     * @param {Object} context.ProfileService - Profile 服務
     */
    runWuxingAlgo({ params, gameDef, ProfileService }) {
        const wuxingWeights = {};
        const wuxingTagMap = {};
        const min = (gameDef.type === 'digit' ? 0 : 1);

        for (let k = min; k <= gameDef.range; k++) {
            wuxingWeights[k] = 10;
            wuxingTagMap[k] = "基礎運數";
        }

        // 取得當前選中的 Profile
        const pid = document.getElementById('profile-select').value;
        const profiles = ProfileService.getProfiles();
        const profile = profiles.find(p => p.id == pid);

        // 取得勾選的五行選項
        const useZiwei = document.getElementById('check-purple')?.checked;
        const useAstro = document.getElementById('check-astro')?.checked;
        const useName = document.getElementById('check-name')?.checked;
        const useZodiac = document.getElementById('check-zodiac')?.checked;

        // 應用各五行子系統
        if (useZiwei) applyZiweiLogic(wuxingWeights, wuxingTagMap, gameDef, profile);
        if (useAstro) applyStarsignLogic(wuxingWeights, wuxingTagMap, gameDef, profile);
        if (useName) applyNameLogic(wuxingWeights, wuxingTagMap, gameDef, profile);
        if (useZodiac) applyWuxingLogic(wuxingWeights, wuxingTagMap, gameDef, profile);

        const wuxingContext = { tagMap: wuxingTagMap };

        // 第一區選號
        const pickZone1 = calculateZone(
            [], gameDef.range, gameDef.count,
            false, 'wuxing',
            [], wuxingWeights, null, wuxingContext
        );

        // 第二區選號(僅威力彩)
        let pickZone2 = [];
        if (gameDef.type === 'power') {
            pickZone2 = calculateZone(
                [], gameDef.zone2, 1,
                true, 'wuxing',
                [], wuxingWeights, null, wuxingContext
            );
        }

        // 找出主導標籤
        const tags = [...pickZone1, ...pickZone2].map(o => o.tag);
        const dominant = tags.sort((a, b) =>
            tags.filter(v => v === a).length - tags.filter(v => v === b).length
        ).pop();

        return {
            numbers: [...pickZone1, ...pickZone2],
            groupReason: `💡 流年格局:[${dominant}] 主導。`
        };
    },

    /**
     * 擴展包牌結果 (第二階段)
     */
    expandPack(selectedNumbers, gameDef) {
        const tickets = [];

        if (gameDef.type === 'power') {
            // 威力彩：第一區鎖定，第二區 01-08
            const zone1 = selectedNumbers.slice(0, 6);
            for (let z2 = 1; z2 <= 8; z2++) {
                tickets.push({
                    numbers: [
                        ...zone1.map(n => ({ ...n, tag: '連動' })),
                        { val: z2, tag: '全包' }
                    ],
                    groupReason: `二區全包策略 (第 ${z2} 注)`
                });
            }
        } else if (gameDef.type === 'digit') {
            // 數位型：全排列 (例如 123 -> 123, 132, 213, 231, 312, 321)
            const rawNums = selectedNumbers.map(n => n.val);

            // 取得全排列
            const permutations = (arr) => {
                if (arr.length <= 1) return [arr];
                let results = [];
                for (let i = 0; i < arr.length; i++) {
                    const first = arr[i];
                    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
                    const innerPerms = permutations(rest);
                    for (let p of innerPerms) {
                        results.push([first, ...p]);
                    }
                }
                return results;
            };

            const allCombos = permutations(rawNums);
            // 去重 (處理如 112 的情況)
            const uniqueSigs = new Set();
            const uniqueCombos = [];
            allCombos.forEach(c => {
                const sig = c.join(',');
                if (!uniqueSigs.has(sig)) {
                    uniqueSigs.add(sig);
                    uniqueCombos.push(c);
                }
            });

            uniqueCombos.forEach((combo, idx) => {
                const gameName = Object.keys(GAME_CONFIG.GAMES).find(k => GAME_CONFIG.GAMES[k] === gameDef);
                const posNameMap = {
                    '3星彩': ['佰位', '拾位', '個位'],
                    '4星彩': ['仟位', '佰位', '拾位', '個位']
                };
                const labels = posNameMap[gameName] || [];

                tickets.push({
                    numbers: combo.map((val, pos) => ({
                        val,
                        tag: labels[pos] || `位${pos + 1}`
                    })),
                    groupReason: `強勢排列策略 (${idx + 1}/${uniqueCombos.length})`
                });
            });
        }

        return tickets;
    }
};
