/**
 * algo_name.js
 * 【純姓名學模組】
 * 職責：接收權重並根據姓名筆畫五行進行權重修改
 * 依賴：不依賴其他 algo 檔
 */
export function applyNameLogic(wuxingWeights, wuxingTagMap, gameDef, profile) {
    if (profile && profile.fortune2025) {
        const nameData = profile.fortune2025.name_analysis;
        if (nameData && nameData.lucky_elements) {
            // 姓名學邏輯：木(1,2) 火(3,4) 土(5,6) 金(7,8) 水(9,0)
            const eleMap = { "木": [1,2], "火": [3,4], "土": [5,6], "金": [7,8], "水": [9,0] };
            nameData.lucky_elements.forEach(ele => {
                const targets = eleMap[ele] || [];
                targets.forEach(t => {
                    for(let i=1; i<=gameDef.range; i++) {
                        if (i % 10 === t) {
                            wuxingWeights[i] += 40; // 姓名權重高
                            if (!wuxingTagMap[i].includes("化祿")) wuxingTagMap[i] = `📛姓名補${ele}`;
                        }
                    }
                });
            });
        }
    }
}
