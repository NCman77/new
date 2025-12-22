/**
 * algo_Ziwei.js
 * 【純紫微斗數模組】
 * 職責：接收權重並根據紫微流年四化與 Profile 進行權重修改
 * 依賴：僅依賴 utils.js (修正為上一層)
 */
import { getGanZhi, getFlyingStars, getHeTuNumbers } from '../utils.js';

export function applyZiweiLogic(wuxingWeights, wuxingTagMap, gameDef, profile) {
    const currentYear = new Date().getFullYear();
    const ganZhi = getGanZhi(currentYear);
    const flyingStars = getFlyingStars(ganZhi.gan);

    // 2. 流年化祿加權
    const luNums = getHeTuNumbers(flyingStars.lu);
    luNums.forEach(tail => {
        for(let i=1; i<=gameDef.range; i++) {
            if (i % 10 === tail || i % 10 === (tail === 0 ? 0 : 5)) {
                wuxingWeights[i] += 50;
                wuxingTagMap[i] = `${flyingStars.lu}化祿`; 
            }
        }
    });

    // 3. Profile 加權 - 紫微/流年尾數
    if (profile && profile.fortune2025) {
        const mData = profile.fortune2025.monthly_elements?.[0];
        if(mData && mData.lucky_tails) { 
            mData.lucky_tails.forEach(t => { 
                for(let i=1; i<=gameDef.range; i++) {
                    if (i % 10 === t) {
                        wuxingWeights[i] += 30;
                        if (!wuxingTagMap[i].includes("化祿")) wuxingTagMap[i] = "本命旺數";
                    }
                }
            }); 
        }
    }
}
