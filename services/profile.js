/**
 * profile.js
 * 使用者個人檔案管理服務
 * 負責: Profile CRUD、AI 流年解讀、API Key 管理
 */

import { FirebaseService } from './firebase.js';

export const ProfileService = {
    profiles: [],
    apiKey: "",

    /**
     * 初始化 Profile 服務
     */
    async init() {
        // 監聽認證狀態變化
        window.addEventListener('authStateChanged', async (e) => {
            const { user } = e.detail;
            if (user) {
                await this.loadProfilesCloud(user.uid);
                await this.loadApiKey(user.uid);
            } else {
                this.loadProfilesLocal();
                this.loadApiKeyLocal();
            }
        });

        // 初次載入
        if (FirebaseService.getCurrentUser()) {
            await this.loadProfilesCloud(FirebaseService.getCurrentUser().uid);
            await this.loadApiKey(FirebaseService.getCurrentUser().uid);
        } else {
            this.loadProfilesLocal();
            this.loadApiKeyLocal();
        }
    },

    /**
     * 從雲端載入 Profiles
     */
    async loadProfilesCloud(uid) {
        const data = await FirebaseService.loadCloudData('profiles', 'main');
        this.profiles = data?.list || [];
        this.renderProfileSelect();
        this.renderProfileList();
    },

    /**
     * 儲存 Profiles 到雲端
     */
    async saveProfilesCloud() {
        await FirebaseService.saveCloudData('profiles', 'main', { list: this.profiles });
    },

    /**
     * 從本地載入 Profiles
     */
    loadProfilesLocal() {
        try {
            const stored = localStorage.getItem('lottery_profiles');
            if (stored) this.profiles = JSON.parse(stored);
        } catch (e) {
            console.warn("[Profile] Local Storage Read Blocked");
        }
        this.renderProfileSelect();
        this.renderProfileList();
    },

    /**
     * 儲存 Profiles
     */
    saveProfiles() {
        if (FirebaseService.getCurrentUser()) {
            this.saveProfilesCloud();
        }
        try {
            localStorage.setItem('lottery_profiles', JSON.stringify(this.profiles));
        } catch (e) {
            console.warn("[Profile] Local Storage Write Blocked");
        }
        this.renderProfileSelect();
        this.renderProfileList();
    },

    /**
     * 新增 Profile
     */
    addProfile() {
        const name = document.getElementById('new-name').value.trim();
        if (!name) return;

        this.profiles.push({
            id: Date.now(),
            name,
            realname: document.getElementById('new-realname').value,
            ziwei: document.getElementById('new-ziwei').value,
            astro: document.getElementById('new-astro').value
        });

        this.saveProfiles();
        this.toggleProfileModal();
    },

    /**
     * 刪除 Profile
     */
    deleteProfile(id) {
        if (confirm('刪除?')) {
            this.profiles = this.profiles.filter(p => p.id !== id);
            this.saveProfiles();
        }
    },

    /**
     * 刪除當前選中的 Profile
     */
    deleteCurrentProfile() {
        const pid = document.getElementById('profile-select').value;
        if (pid && confirm('刪除?')) {
            this.deleteProfile(Number(pid));
            document.getElementById('profile-select').value = "";
            this.onProfileChange();
        }
    },

    /**
     * 切換 Profile Modal
     */
    toggleProfileModal() {
        const m = document.getElementById('profile-modal');
        const c = document.getElementById('profile-modal-content');
        if (m.classList.contains('hidden')) {
            m.classList.remove('hidden');
            setTimeout(() => c.classList.remove('scale-95', 'opacity-0'), 10);
        } else {
            c.classList.add('scale-95', 'opacity-0');
            setTimeout(() => m.classList.add('hidden'), 200);
        }
    },

    /**
     * 渲染 Profile 列表
     */
    renderProfileList() {
        document.getElementById('profile-list').innerHTML = this.profiles
            .map(p => `
                <div class="flex justify-between p-2 bg-stone-50 border rounded">
                  <div class="font-bold text-stone-700 text-xs">${p.name}</div>
                  <button onclick="app.ProfileService.deleteProfile(${p.id})" class="text-red-400 text-xs">刪除</button>
                </div>
            `).join('');
    },

    /**
     * 渲染 Profile 下拉選單
     */
    renderProfileSelect() {
        document.getElementById('profile-select').innerHTML =
            '<option value="">請新增...</option>' +
            this.profiles.map(p =>
                `<option value="${p.id}">${p.name}</option>`
            ).join('');
    },

    /**
     * Profile 選擇變更事件
     */
    onProfileChange() {
        const pid = document.getElementById('profile-select').value;
        const s = document.getElementById('ai-fortune-section');

        if (!pid) {
            s.classList.add('hidden');
            return;
        }

        s.classList.remove('hidden');
        const p = this.profiles.find(x => x.id == pid);
        const d = document.getElementById('ai-result-display');

        if (p && p.fortune2025) {
            d.classList.remove('hidden');
            let html = `<div class="font-bold mb-1">📅 流年運勢:</div><p>${p.fortune2025.year_analysis}</p>`;
            if (p.fortune2025.name_analysis) {
                html += `
                  <div class="mt-2 pt-2 border-t border-pink-100">
                    <div class="font-bold mb-1">✍️ 姓名靈動:</div>
                    <p class="text-[10px]">${p.fortune2025.name_analysis.rationale}</p>
                  </div>`;
            }
            d.innerHTML = html;
            document.getElementById('btn-calc-ai').innerText = "🔄 重新批算";
            document.getElementById('btn-clear-ai').classList.remove('hidden');
        } else {
            d.classList.add('hidden');
            document.getElementById('btn-calc-ai').innerText = "✨ 大師批流年";
            document.getElementById('btn-clear-ai').classList.add('hidden');
        }
    },

    /**
     * 清除流年解讀
     */
    clearFortune() {
        const pid = document.getElementById('profile-select').value;
        const p = this.profiles.find(x => x.id == pid);
        if (p) {
            delete p.fortune2025;
            this.saveProfiles();
            this.onProfileChange();
        }
    },

    /**
     * 生成 AI 流年解讀
     */
    async generateAIFortune() {
        const pid = document.getElementById('profile-select').value;
        if (!pid || !this.apiKey) return alert("請選主角並設定Key");

        document.getElementById('ai-loading').classList.remove('hidden');
        document.getElementById('btn-calc-ai').disabled = true;

        const p = this.profiles.find(x => x.id == pid);
        const currentYear = new Date().getFullYear();

        // 使用 utils.js 的函式
        const { getGanZhi } = await import('../utils.js');
        const ganZhi = getGanZhi(currentYear);

        const useName = document.getElementById('check-name')
            ? document.getElementById('check-name').checked
            : false;

        let prompt = `你現在是資深的國學易經術數領域專家,擅長紫微斗數、姓名學、星座命理與生肖五行。\n\n請為以下人物進行 ${currentYear} 年(${ganZhi.gan}${ganZhi.zhi})的流年命理分析:\n\n【基本資料】\n姓名: ${p.name}\n命盤主星: ${p.ziwei || '未提供'}\n星座: ${p.astro || '未提供'}\n\n`;

        if (useName) {
            prompt += `【姓名學特別指令】\n請額外分析姓名「${p.realname || p.name}」的筆畫靈動數,並結合流年天干地支,給出姓名對財運的影響。\n\n`;
        }

        prompt += `請務必回傳純 JSON 格式 (不需要 markdown 標記),格式如下:\n{\n  "year_analysis": "300字內的流年總論",\n  "name_analysis": ${useName ? '{ "rationale": "姓名學分析" }' : 'null'}\n}`;

        try {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${this.apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
                }
            );
            const d = await res.json();
            const text = d.candidates[0].content.parts[0].text;
            p.fortune2025 = JSON.parse(text.replace(/```json|```/g, '').trim());
            this.saveProfiles();
            this.onProfileChange();
        } catch (e) {
            alert("AI 分析失敗");
            console.error(e);
        } finally {
            document.getElementById('ai-loading').classList.add('hidden');
            document.getElementById('btn-calc-ai').disabled = false;
        }
    },

    /**
     * 儲存 API Key
     */
    async saveApiKey() {
        const key = document.getElementById('gemini-api-key').value.trim();
        if (!key) return alert("請輸入 Key");

        this.apiKey = key;

        if (FirebaseService.getCurrentUser()) {
            await FirebaseService.saveCloudData('settings', 'api', { key });
        } else {
            try {
                localStorage.setItem('gemini_key', key);
            } catch (e) {
                console.warn("[Profile] Local storage save key failed");
            }
        }
        alert("已儲存");
    },

    /**
     * 載入 API Key (雲端)
     */
    async loadApiKey(uid) {
        const data = await FirebaseService.loadCloudData('settings', 'api');
        if (data?.key) {
            this.apiKey = data.key;
            document.getElementById('gemini-api-key').value = this.apiKey;
        }
    },

    /**
     * 載入 API Key (本地)
     */
    loadApiKeyLocal() {
        try {
            const key = localStorage.getItem('gemini_key');
            if (key) {
                this.apiKey = key;
                document.getElementById('gemini-api-key').value = key;
            }
        } catch (e) {
            console.warn("[Profile] Local storage read key failed");
        }
    },

    /**
     * 取得所有 Profiles
     */
    getProfiles() {
        return this.profiles;
    },

    /**
     * 根據 ID 取得 Profile
     */
    getProfileById(id) {
        return this.profiles.find(p => p.id == id);
    }
};
