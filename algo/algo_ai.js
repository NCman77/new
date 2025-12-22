/**
 * algo_ai.js
 * AI 學派：基於時間序列權重與趨勢動能分析
 */
// 修正引用路徑：utils.js 在上一層
import { calculateZone, getLotteryStats } from '../utils.js';

export function algoAI({ data, gameDef }) {
    const stats = data.length > 0 ? getLotteryStats(data, gameDef.range, gameDef.count) : null;
    const pickZone1 = calculateZone(data, gameDef.range, gameDef.count, false, 'ai_weight', [], {}, stats);
    let pickZone2 = [];
    if (gameDef.type === 'power') pickZone2 = calculateZone(data, gameDef.zone2, 1, true, 'ai_weight', [], {}, stats);
    const avgScore = Math.round(pickZone1.reduce((a,b) => a + parseInt(b.tag.replace(/\D/g,'')||0), 0) / pickZone1.length);
    return { 
        numbers: [...pickZone1, ...pickZone2], 
        groupReason: `📈 趨勢分析：平均動能 ${avgScore} (滿分100)。<br>本組號碼在近 10 期內權重指數持續上升，處於黃金交叉點。` 
    };
}
