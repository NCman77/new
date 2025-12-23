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

        const isRandom = (mode === 'random');
        const isPack = (mode.startsWith('pack'));
        const school = state.currentSchool;

        // --- 學派邏輯執行 ---
        // 為了支援「獨立包牌」，我們不再統一收集號碼，而是讓學派直接回傳多注結果
        const count = isPack ? 1 : 5; // 如果是包牌模式，由學派內部決定注數
        const excludeSet = new Set();
        const allowDuplicates = (gameDef.type === 'digit');

        for (let i = 0; i < count; i++) {
            const params = {
                data,
                gameDef,
                subModeId: state.currentSubMode,
                excludeNumbers: allowDuplicates ? new Set() : excludeSet,
                random: isRandom,
                mode: isRandom ? 'random' : 'strict',
                setIndex: i,
                packMode: isPack ? mode : null,
                targetCount: 5 // 預設產出 5 注
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
                    if (isRandom) {
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
    }
};
