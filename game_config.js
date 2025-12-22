/**
 * game_config.js
 * 存放遊戲定義、規則文字、玩法選項等靜態資料
 * 包含：標準型(lotto)、雙區型(power)、數字型(digit) 的區分
 */

export const GAME_CONFIG = {
    // 遊戲定義
GAMES: {
        '大樂透': {
            type: 'lotto',
            range: 49,
            count: 6,
            special: true,
            drawDays: [2, 5],
            desc: "在01~49中選取6個號碼，每週二、五開獎。",
            subModes: null,
            article: `
                <div class="space-y-4 text-sm text-stone-600 leading-relaxed">
                    <h5 class="font-bold text-stone-800 text-lg">大樂透玩法規則</h5>
                    <p>您必須從01~49中任選6個號碼進行投注。開獎時，開獎單位將隨機開出六個號碼加一個特別號。</p>
                    <div class="overflow-x-auto rounded-lg border border-stone-200">
                        <table class="w-full text-left text-sm text-stone-600">
                            <thead class="bg-stone-100 text-stone-700 font-bold uppercase text-xs">
                                <tr>
                                    <th class="px-3 py-3">獎項</th>
                                    <th class="px-3 py-3">中獎方式</th>
                                    <th class="px-3 py-3 text-right">獎金</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-stone-100 bg-white">
                                <tr><td class="px-3 py-3 font-bold text-rose-600">頭獎</td><td class="px-3 py-3">6個獎號完全相同</td><td class="px-3 py-3 text-right">獎金分配</td></tr>
                                <tr><td class="px-3 py-3 font-bold text-stone-700">貳獎</td><td class="px-3 py-3">任5碼 ＋ 特別號</td><td class="px-3 py-3 text-right">獎金分配</td></tr>
                                <tr><td class="px-3 py-3 font-bold text-stone-700">參獎</td><td class="px-3 py-3">任5碼</td><td class="px-3 py-3 text-right">獎金分配</td></tr>
                                <tr><td class="px-3 py-3 font-bold text-stone-700">肆獎</td><td class="px-3 py-3">任4碼 ＋ 特別號</td><td class="px-3 py-3 text-right">獎金分配</td></tr>
                                <tr><td class="px-3 py-3 font-bold text-stone-700">伍獎</td><td class="px-3 py-3">任4碼</td><td class="px-3 py-3 text-right">$2,000</td></tr>
                                <tr><td class="px-3 py-3 font-bold text-stone-700">陸獎</td><td class="px-3 py-3">任3碼 ＋ 特別號</td><td class="px-3 py-3 text-right">$1,000</td></tr>
                                <tr><td class="px-3 py-3 font-bold text-stone-700">柒獎</td><td class="px-3 py-3">任2碼 ＋ 特別號</td><td class="px-3 py-3 text-right">$400</td></tr>
                                <tr><td class="px-3 py-3 font-bold text-stone-700">普獎</td><td class="px-3 py-3">任3碼</td><td class="px-3 py-3 text-right">$400</td></tr>
                            </tbody>
                        </table>
                    </div>
                    <div class="text-[10px] text-stone-400 bg-stone-50 p-2 rounded">
                        註：頭獎中獎率約1/1,398萬，總中獎率約1/32。若伍獎至普獎中獎人數過多，將改為均分。
                    </div>
                </div>
            `
        },
        '威力彩': {
            type: 'power',
            range: 38,
            count: 6,
            zone2: 8,
            drawDays: [1, 4],
            desc: "第一區01~38選6個，第二區01~08選1個。",
            subModes: null,
            article: `
                <div class="space-y-4 text-sm text-stone-600 leading-relaxed">
                    <h5 class="font-bold text-stone-800 text-lg">威力彩玩法規則</h5>
                    <p>第1區(01~38)選6個，第2區(01~08)選1個。兩種區塊皆對中即有機會獲獎。</p>
                    <div class="overflow-x-auto rounded-lg border border-stone-200">
                        <table class="w-full text-left text-sm text-stone-600">
                            <thead class="bg-stone-100 text-stone-700 font-bold uppercase text-xs">
                                <tr>
                                    <th class="px-3 py-3">獎項</th>
                                    <th class="px-3 py-3">第1區</th>
                                    <th class="px-3 py-3">第2區</th>
                                    <th class="px-3 py-3 text-right">獎金</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-stone-100 bg-white">
                                <tr><td class="px-3 py-3 font-bold text-rose-600">頭獎</td><td class="px-3 py-3">6碼全中</td><td class="px-3 py-3">對中</td><td class="px-3 py-3 text-right">獎金分配</td></tr>
                                <tr><td class="px-3 py-3 font-bold text-stone-700">貳獎</td><td class="px-3 py-3">6碼全中</td><td class="px-3 py-3"><span class="text-stone-300">未中</span></td><td class="px-3 py-3 text-right">獎金分配</td></tr>
                                <tr><td class="px-3 py-3 font-bold text-stone-700">參獎</td><td class="px-3 py-3">任5碼</td><td class="px-3 py-3">對中</td><td class="px-3 py-3 text-right">$150,000</td></tr>
                                <tr><td class="px-3 py-3 font-bold text-stone-700">肆獎</td><td class="px-3 py-3">任5碼</td><td class="px-3 py-3"><span class="text-stone-300">未中</span></td><td class="px-3 py-3 text-right">$20,000</td></tr>
                                <tr><td class="px-3 py-3 font-bold text-stone-700">伍獎</td><td class="px-3 py-3">任4碼</td><td class="px-3 py-3">對中</td><td class="px-3 py-3 text-right">$4,000</td></tr>
                                <tr><td class="px-3 py-3 font-bold text-stone-700">陸獎</td><td class="px-3 py-3">任4碼</td><td class="px-3 py-3"><span class="text-stone-300">未中</span></td><td class="px-3 py-3 text-right">$800</td></tr>
                                <tr><td class="px-3 py-3 font-bold text-stone-700">柒獎</td><td class="px-3 py-3">任3碼</td><td class="px-3 py-3">對中</td><td class="px-3 py-3 text-right">$400</td></tr>
                                <tr><td class="px-3 py-3 font-bold text-stone-700">捌獎</td><td class="px-3 py-3">任2碼</td><td class="px-3 py-3">對中</td><td class="px-3 py-3 text-right">$200</td></tr>
                                <tr><td class="px-3 py-3 font-bold text-stone-700">玖獎</td><td class="px-3 py-3">任3碼</td><td class="px-3 py-3"><span class="text-stone-300">未中</span></td><td class="px-3 py-3 text-right">$100</td></tr>
                                <tr><td class="px-3 py-3 font-bold text-stone-700">普獎</td><td class="px-3 py-3">任1碼</td><td class="px-3 py-3">對中</td><td class="px-3 py-3 text-right">$100</td></tr>
                            </tbody>
                        </table>
                    </div>
                    <div class="text-[10px] text-stone-400 bg-stone-50 p-2 rounded">
                        註：頭獎中獎率約1/2,209萬，總中獎率約1/9。
                    </div>
                </div>
            `
        },
        '今彩539': {
            type: 'lotto',
            range: 39,
            count: 5,
            special: false,
            drawDays: [1, 2, 3, 4, 5, 6],
            desc: "01~39選5個，每週一至六開獎。",
            subModes: null,
            article: `
                <div class="space-y-4 text-sm text-stone-600 leading-relaxed">
                    <h5 class="font-bold text-stone-800 text-lg">今彩539玩法規則</h5>
                    <p>從01~39的號碼中任選5個號碼進行投注。如有二個以上（含二個號碼）對中當期開出之五個號碼，即為中獎。</p>
                    <div class="overflow-x-auto rounded-lg border border-stone-200">
                        <table class="w-full text-left text-sm text-stone-600">
                            <thead class="bg-stone-100 text-stone-700 font-bold uppercase text-xs">
                                <tr>
                                    <th class="px-3 py-3">獎項</th>
                                    <th class="px-3 py-3">中獎條件</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-stone-100 bg-white">
                                <tr><td class="px-3 py-3 font-bold text-rose-600">頭獎</td><td class="px-3 py-3">與當期五個中獎號碼完全相同者</td></tr>
                                <tr><td class="px-3 py-3 font-bold text-stone-700">貳獎</td><td class="px-3 py-3">對中當期獎號之其中任四碼</td></tr>
                                <tr><td class="px-3 py-3 font-bold text-stone-700">參獎</td><td class="px-3 py-3">對中當期獎號之其中任三碼</td></tr>
                                <tr><td class="px-3 py-3 font-bold text-stone-700">肆獎</td><td class="px-3 py-3">對中當期獎號之其中任二碼</td></tr>
                            </tbody>
                        </table>
                    </div>
                    <div class="text-[10px] text-stone-400 bg-stone-50 p-2 rounded">
                        註：頭獎中獎率約1/58萬，總中獎率約1/9。
                    </div>
                </div>
            `
        },
        '3星彩': {
            type: 'digit',
            range: 9,
            count: 3,
            drawDays: [1, 2, 3, 4, 5, 6], // 新增
            desc: "從000~999中選號，選取3位數字。",
            subModes: null,
            article: `
                <div class="space-y-4 text-sm text-stone-600 leading-relaxed">
                    <h5 class="font-bold text-stone-800 text-lg">3星彩玩法規則</h5>
                    <p>3星彩是一種三位數字(佰、拾、個位數)遊戲，您必須從000~999中選出一組三位數進行投注。開獎時，開獎單位將從000~999中隨機開出一組三位數號碼，該組號碼就是該期3星彩的中獎號碼，也稱為「獎號」。如您的選號符合該期任一種中獎情形，即為中獎，並可依規定兌領獎金。</p>
                    <div class="overflow-x-auto rounded-lg border border-stone-200">
                        <table class="w-full text-left text-sm text-stone-600">
                            <tbody class="divide-y divide-stone-100 bg-white">
                                <tr><td class="px-3 py-3 font-bold text-rose-600">壹獎</td><td class="px-3 py-3">三位數全部對中</td></tr>
                                <tr><td class="px-3 py-3 font-bold text-stone-700">貳獎</td><td class="px-3 py-3">對中拾位數和個位數，且佰位數未對中</td></tr>
                                <tr><td class="px-3 py-3 font-bold text-stone-700">參獎</td><td class="px-3 py-3">對中個位數，且佰位數和拾位數均未對中</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            `
        },
        '4星彩': {
            type: 'digit',
            range: 9,
            count: 4,
            drawDays: [1, 2, 3, 4, 5, 6], // 新增
            desc: "從0000~9999中選號，選取4位數字。",
            subModes: null,
article: `
                <div class="space-y-4 text-sm text-stone-600 leading-relaxed">
                    <h5 class="font-bold text-stone-800 text-lg">4星彩玩法規則</h5>
                    <p>4星彩是一種四位數字(仟、佰、拾、個位數)遊戲，您必須從0000~9999中選出一組四位數進行投注。開獎時，開獎單位將從0000~9999中隨機開出一組四位數號碼，該組號碼就是該期4星彩的中獎號碼，也稱為「獎號」。如您的選號符合該期任一種中獎情形，即為中獎，並可依規定兌領獎金。</p>
                    <div class="overflow-x-auto rounded-lg border border-stone-200">
                        <table class="w-full text-left text-sm text-stone-600">
                            <tbody class="divide-y divide-stone-100 bg-white">
                                <tr><td class="px-3 py-3 font-bold text-rose-600">壹獎</td><td class="px-3 py-3">四位數全部對中</td></tr>
                                <tr><td class="px-3 py-3 font-bold text-stone-700">貳獎</td><td class="px-3 py-3">對中佰位數、拾位數和個位數，且仟位數未對中</td></tr>
                                <tr><td class="px-3 py-3 font-bold text-stone-700">參獎</td><td class="px-3 py-3">對中拾位數和個位數，且仟位數和佰位數未對中</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            `
        }
    },
    ORDER: ['大樂透', '威力彩', '今彩539', '3星彩', '4星彩'],
    
    // 學派說明 (包含開合詳細資訊)
    SCHOOLS: {
        balance: { 
            color: "border-school-balance", 
            title: "結構平衡學派", 
            desc: `
                <div>
                    <span class="font-bold text-school-balance block mb-1 text-sm">核心策略：</span>
                    <p class="text-justify leading-relaxed text-stone-600 text-sm">基於常態分佈理論。計算AC值(複雜度)與和值區間，排除全奇/全偶等極端組合，專攻機率最高的「黃金結構」。</p>
                </div>
                <details class="mt-3 group">
                    <summary class="cursor-pointer font-bold text-school-balance text-sm list-none flex items-center gap-2 transition-all hover:opacity-80">
                        <span>▶ 混合算法 (Logic Mix)：</span>
                    </summary>
                    <div class="mt-2 pl-3 text-xs text-stone-500 space-y-2 border-l-2 border-school-balance">
                        <p>1. 試誤過濾法 (Trial & Error)：系統不直接選號，而是先隨機生成大量組合，再透過濾網篩選。</p>
                        <p>2. AC 值 (Arithmetic Complexity) 檢測：(針對樂透型) 計算號碼組中所有數字兩兩相減的「差值數」。程式碼設定門檻為 AC >= 4，確保選出的號碼結構夠複雜，避免簡單排列（如 01, 02, 03, 04, 05, 06）。</p>
                        <p>3. 黃金和值 (Golden Sum)：(針對 3星/4星 組彩) 計算數字總和，強制鎖定在 10 ~ 20 這個機率分佈最高的區間。</p>
                        <p>4. 屬性標記：分析每個號碼的數學屬性（大小、奇偶）。</p>
                        <div class="mt-2 pt-2 border-t border-stone-200">
                            <span class="font-bold text-red-500">🔴 證據顯示 (Tag)：</span>
                            <p class="mt-1">大號/奇數、小號/偶數：直接標示該號碼在平衡結構中的角色。<br>AC值 6 優化：(組合理由) 顯示該組牌的複雜度指標。</p>
                        </div>
                    </div>
                </details>
            ` 
        },
        stat: { 
            color: "border-school-stat", 
            title: "統計學派", 
            desc: `
                <div>
                    <span class="font-bold text-school-stat block mb-1 text-sm">核心策略：</span>
                    <p class="text-justify leading-relaxed text-stone-600 text-sm">大數據慣性分析。加入「極限遺漏」回補機制，在熱號恆熱與冷號反彈間取得最佳期望值。</p>
                </div>
                <details class="mt-3 group">
                    <summary class="cursor-pointer font-bold text-school-stat text-sm list-none flex items-center gap-2 transition-all hover:opacity-80">
                        <span>▶ 混合算法 (Logic Mix)：</span>
                    </summary>
                    <div class="mt-2 pl-3 text-xs text-stone-500 space-y-2 border-l-2 border-school-stat">
                        <p>1. 頻率累加演算法：遍歷歷史資料庫，計算每個號碼的出現次數。基礎權重 10，每出現一次 +10。</p>
                        <p>2. 遺漏值 (Missing Value) 追蹤：計算每個號碼距離上次開出已經過了多少期。</p>
                        <p>3. 卜瓦松檢定概念 (Poisson-inspired)：在程式碼中設定了具體的閥值（近30期出現 > 5 次判定為熱；遺漏 > 15 期判定為冷），模擬統計學上的顯著性檢定。</p>
                        <p>4. 極限回補機制 (Extreme Rebound)：(針對威力彩第二區) 強制給予隨機冷號極高權重 (500分)，模擬「賭冷門牌反彈」的策略。</p>
                        <div class="mt-2 pt-2 border-t border-stone-200">
                            <span class="font-bold text-red-500">🔴 證據顯示 (Tag)：</span>
                            <p class="mt-1">近30期8次：(熱號) 用具體數據證明其熱度。<br>遺漏24期：(冷號) 用具體數據證明其回補機率。<br>常態選號：(中性) 符合平均機率的號碼。</p>
                        </div>
                    </div>
                </details>
            ` 
        },
        pattern: { 
            color: "border-school-pattern", 
            title: "關聯學派", 
            desc: `
                <div>
                    <span class="font-bold text-school-pattern block mb-1 text-sm">核心策略：</span>
                    <p class="text-justify leading-relaxed text-stone-600 text-sm">捕捉號碼間的隱形連結。分析上期獎號的「拖牌效應」與「尾數連動」，預測版路的下一個落點。</p>
                </div>
                <details class="mt-3 group">
                    <summary class="cursor-pointer font-bold text-school-pattern text-sm list-none flex items-center gap-2 transition-all hover:opacity-80">
                        <span>▶ 混合算法 (Logic Mix)：</span>
                    </summary>
                    <div class="mt-2 pl-3 text-xs text-stone-500 space-y-2 border-l-2 border-school-pattern">
                        <p>1. 條件機率矩陣：鎖定「上一期 (Last Draw)」號碼作為種子。</p>
                        <p>2. 拖牌權重 (Drag Weight)：若某號碼是上一期的開獎號，權重 +20 (賭連莊)。</p>
                        <p>3. 鄰號效應 (Neighbor Effect)：若某號碼是上一期號碼的左右鄰居 (如上期開 05，則 04, 06 加分)，權重 +15。</p>
                        <p>4. 尾數群聚分析：分析號碼的個位數 (Mod 10)，判斷是否與上期尾數相同。</p>
                        <div class="mt-2 pt-2 border-t border-stone-200">
                            <span class="font-bold text-red-500">🔴 證據顯示 (Tag)：</span>
                            <p class="mt-1">連莊強勢：直指該號碼為上期重覆號。<br>05鄰號：明確指出是因為鄰近 05 而被選中。<br>3尾群聚：指出該號碼符合特定的尾數規律。</p>
                        </div>
                    </div>
                </details>
            ` 
        },
        ai: { 
            color: "border-school-ai", 
            title: "AI 學派", 
            desc: `
                <div>
                    <span class="font-bold text-school-ai block mb-1 text-sm">核心策略：</span>
                    <p class="text-justify leading-relaxed text-stone-600 text-sm">時間序列加權運算。將開獎視為時間軸，距離現在越近的數據影響力越大。</p>
                </div>
                <details class="mt-3 group">
                    <summary class="cursor-pointer font-bold text-school-ai text-sm list-none flex items-center gap-2 transition-all hover:opacity-80">
                        <span>▶ 混合算法 (Logic Mix)：</span>
                    </summary>
                    <div class="mt-2 pl-3 text-xs text-stone-500 space-y-2 border-l-2 border-school-ai">
                        <p>1. 時間衰減函數 (Time Decay)：只取近 10~20 期資料。權重公式為 20 - index (越近分數越高，越遠分數越低)，模擬神經網路對近期特徵的敏感度。</p>
                        <p>2. 歸一化評分 (Normalization)：將計算出的權重分數轉換為 0-100 的「動能/趨勢分」，讓使用者能直觀比較強弱。</p>
                        <div class="mt-2 pt-2 border-t border-stone-200">
                            <span class="font-bold text-red-500">🔴 證據顯示 (Tag)：</span>
                            <p class="mt-1">趨勢分98：直接量化該號碼在近期趨勢中的強度 (滿分100)。</p>
                        </div>
                    </div>
                </details>
            ` 
        },
        wuxing: {
            color: "border-school-wuxing",
            title: "五行生肖學派",
            desc: `
                <div>
                    <span class="font-bold text-school-wuxing block mb-1 text-sm">核心策略：</span>
                    <p class="text-justify leading-relaxed text-stone-600 text-sm">AI 命理轉譯引擎。不再使用通用公式，而是由 AI 擔任「雲端命理師」，解析您的紫微命盤與流年飛星，將玄學能量轉譯為數學權重。</p>
                </div>
                <details class="mt-3 group">
                    <summary class="cursor-pointer font-bold text-school-wuxing text-sm list-none flex items-center gap-2 transition-all hover:opacity-80">
                        <span>▶ 混合算法 (Logic Mix)：</span>
                    </summary>
                    <div class="mt-2 pl-3 text-xs text-stone-500 space-y-2 border-l-2 border-school-wuxing">
                        <p>1. AI 命盤結構解析：系統讀取使用者 Profile 中的星曜分布，判斷命宮、財帛宮與田宅宮的先天強弱。</p>
                        <p>2. 流年飛星推演：自動抓取當下年份（如 2025 乙巳年），計算流年四化（祿、權、科、忌）對財位的引動。</p>
                        <p>3. 河圖洛書數值化：將「星曜屬性」（如武曲屬金、貪狼屬木）依據河圖洛書原理轉換為樂透選號。</p>
                        <p>4. 趨吉避凶權重：遇「化祿」給予極高權重，遇「化忌」則動態排除或視為「破財擋災」的特殊選號。</p>
                        <div class="mt-2 pt-2 border-t border-stone-200">
                            <span class="font-bold text-red-500">🔴 證據顯示 (Tag)：</span>
                            <p class="mt-1">武曲化祿：(正財星)<br>貪狼偏財：(機會財)<br>流年財星：(時間運)</p>
                        </div>
                    </div>
                </details>
            `
        }
    }
};



