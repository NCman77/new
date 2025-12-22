/**
 * firebase.js
 * Firebase 認證與雲端儲存服務
 * 負責: 初始化、登入/登出、雲端資料存取
 */

export const FirebaseService = {
    db: null,
    user: null,

    /**
     * 初始化 Firebase
     * @returns {Promise<void>}
     */
    async init() {
        if (typeof window.firebaseModules === 'undefined') {
            console.warn('[Firebase] Firebase modules not loaded, using local storage only');
            return;
        }

        const { initializeApp, getAuth, onAuthStateChanged, getFirestore } = window.firebaseModules;

        const firebaseConfig = {
            apiKey: "AIzaSyBatltfrvZ5AXixdZBcruClqYrA-9ihsI0",
            authDomain: "lottery-app-bd106.firebaseapp.com",
            projectId: "lottery-app-bd106",
            storageBucket: "lottery-app-bd106.firebasestorage.app",
            messagingSenderId: "13138331714",
            appId: "1:13138331714:web:194ac3ff9513d19d9845db"
        };

        try {
            const app = initializeApp(firebaseConfig);
            const auth = getAuth(app);
            this.db = getFirestore(app);

            // 監聽認證狀態變化
            onAuthStateChanged(auth, async (user) => {
                this.user = user;
                // 觸發自定義事件,通知其他模組
                window.dispatchEvent(new CustomEvent('authStateChanged', { detail: { user } }));
            });

            console.log('[Firebase] Initialized successfully');
        } catch (e) {
            console.error('[Firebase] Init Error:', e);
        }
    },

    /**
     * Google 登入
     */
    async loginGoogle() {
        try {
            const { getAuth, signInWithPopup, GoogleAuthProvider } = window.firebaseModules;
            await signInWithPopup(getAuth(), new GoogleAuthProvider());
        } catch (e) {
            alert("登入失敗:可能是瀏覽器阻擋了第三方 Cookies");
            console.error('[Firebase] Login Error:', e);
        }
    },

    /**
     * 登出
     */
    async logout() {
        try {
            await window.firebaseModules.signOut(window.firebaseModules.getAuth());
        } catch (e) {
            console.error('[Firebase] Logout Error:', e);
        }
    },

    /**
     * 從雲端載入使用者資料
     * @param {string} collection - 集合名稱
     * @param {string} docPath - 文件路徑
     * @returns {Promise<any>}
     */
    async loadCloudData(collection, docPath) {
        if (!this.db || !this.user) return null;

        try {
            const { doc, getDoc } = window.firebaseModules;
            const ref = doc(this.db, 'artifacts', 'lottery-app', 'users', this.user.uid, collection, docPath);
            const snap = await getDoc(ref);
            return snap.exists() ? snap.data() : null;
        } catch (e) {
            console.warn('[Firebase] Load Cloud Data Failed:', e);
            return null;
        }
    },

    /**
     * 儲存資料到雲端
     * @param {string} collection - 集合名稱
     * @param {string} docPath - 文件路徑
     * @param {any} data - 要儲存的資料
     */
    async saveCloudData(collection, docPath, data) {
        if (!this.db || !this.user) {
            console.warn('[Firebase] Cannot save: not authenticated');
            return;
        }

        try {
            const { doc, setDoc } = window.firebaseModules;
            const ref = doc(this.db, 'artifacts', 'lottery-app', 'users', this.user.uid, collection, docPath);
            await setDoc(ref, data);
            console.log('[Firebase] Data saved successfully');
        } catch (e) {
            console.warn('[Firebase] Save Cloud Data Failed:', e);
        }
    },

    /**
     * 取得當前使用者
     * @returns {object|null}
     */
    getCurrentUser() {
        return this.user;
    },

    /**
     * 取得 Firestore 實例
     * @returns {object|null}
     */
    getDB() {
        return this.db;
    }
};
