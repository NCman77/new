import json
import os
import requests
import zipfile
import io
import datetime
import re
import time
import urllib3

# 關閉 SSL 警告
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# === 設定區 ===
# [FIX] 使用絕對路徑指向上一層的 data 資料夾
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')
OUTPUT_FILE = os.path.join(DATA_DIR, 'lottery-data.json')

# 修改：支援到 2050 年 (2021 到 2050)
HISTORY_YEARS = list(range(2021, 2051))
API_BASE = 'https://api.taiwanlottery.com/TLCAPIWeB/Lottery'

# 遊戲代碼對照表
GAMES = {
    '大樂透': 'Lotto649',
    '威力彩': 'SuperLotto638',
    '今彩539': 'Daily539',
    '雙贏彩': 'Lotto1224',
    '3星彩': '3D',
    '4星彩': '4D'
}

# API回應中對應的鍵名
API_RESPONSE_KEYS = {
    'SuperLotto638': 'superLotto638Res',
    'Lotto649': 'lotto649Res',
    'Daily539': 'daily539Res',
    'Lotto1224': 'lotto1224Res',
    '3D': 'lotto3DRes',
    '4D': 'lotto4DRes'
}

# 頭獎爬蟲目標網址
JACKPOT_URLS = {
    '大樂透': 'https://www.taiwanlottery.com/lotto/result/lotto649',
    '威力彩': 'https://www.taiwanlottery.com/lotto/result/super_lotto638'
}

# Header
HEADERS = {
    'User-Agent': 'Mozilla/5.0',
    'Referer': 'https://www.taiwanlottery.com/'
}

def ensure_dir():
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR)
    print(f"Data directory: {DATA_DIR}")

def get_api_date_range():
    """ 計算 API 需要的 startMonth 和 endMonth (當前月份往前推3個月) """
    today = datetime.date.today()
    
    # 結束月份為當前月份
    end_month_str = f"{today.year}-{today.month:02d}"
    
    # 開始月份為當前月份 - 2 (包含當月共3個月)
    start_year = today.year
    start_month = today.month - 2
    
    if start_month <= 0:
        start_month += 12
        start_year -= 1
        
    start_month_str = f"{start_year}-{start_month:02d}"
    return start_month_str, end_month_str

def get_jackpot_amount(game_name):
    """ 從網頁 HTML 爬取目前頭獎累積金額 """
    if game_name not in JACKPOT_URLS: return None
    url = JACKPOT_URLS[game_name]
    print(f"Scraping jackpot for {game_name}...")
    try:
        res = requests.get(url, headers=HEADERS, timeout=20, verify=False)
        if res.status_code != 200: return None
        matches = re.findall(r'class="amount-number"[^>]*>(\d)</div>', res.text)
        if matches:
            return "{:,}".format(int("".join(matches)))
        return "更新中" if "更新中" in res.text else None
    except Exception as e:
        print(f"Jackpot error: {e}")
        return None

def parse_csv_line(line):
    """ 解析歷史 ZIP 檔 """
    line = line.replace('\ufeff', '').strip()
    if not line: return None
    cols = [c.strip().replace('"', '') for c in line.split(',')]
    if len(cols) < 5: return None
    
    game_name = cols[0].strip()
    matched_game = None
    for g in GAMES:
        if g in game_name:
            matched_game = g
            break
    if not matched_game: return None

    # 日期解析
    match = re.search(r'(\d{3,4})/-./-.', cols[2].strip())
    final_date = ""
    if match:
        y, m, d = int(match.group(1)), int(match.group(2)), int(match.group(3))
        if y < 1911: y += 1911
        final_date = f"{y}-{m:02d}-{d:02d}"
    else: return None

    try:
        numbers = []
        for i in range(5, len(cols)):
            val = cols[i].strip()
            if val.isdigit():
                n = int(val)
                if 0 <= n <= 99: numbers.append(n)
        
        if len(numbers) < 2: return None
        
        # 區分大小順序與開出順序 (目前歷史檔通常已排序，若有開出順序欄位需另外解析，此處維持原樣)
        return {'game': matched_game, 'data': {'date': final_date, 'period': cols[1], 'numbers': numbers, 'source': 'history'}}
    except: return None

def load_history():
    print("=== Loading History ZIPs ===")
    db = {g: [] for g in GAMES}
    for year in HISTORY_YEARS:
        zip_path = os.path.join(DATA_DIR, f'{year}.zip')
        if not os.path.exists(zip_path): 
            # print(f"ZIP not found: {zip_path}") # Optional: debug
            continue
            
        print(f"Reading {year}.zip...")
        try:
            with zipfile.ZipFile(zip_path, 'r') as z:
                for filename in z.namelist():
                    if filename.lower().endswith('.csv') and not filename.startswith('__'):
                        with z.open(filename) as f:
                            raw = f.read()
                            content = ""
                            for enc in ['cp950', 'utf-8-sig', 'utf-8', 'big5']:
                                try: content = raw.decode(enc); break
                                except: continue
                            
                            if content:
                                for line in content.splitlines():
                                    parsed = parse_csv_line(line)
                                    if parsed: db[parsed['game']].append(parsed['data'])
        except Exception as e: print(f"Error reading {year}.zip: {e}")
    return db

def fetch_api(db):
    print("=== Fetching Live API ===")
    start_month, end_month = get_api_date_range()
    print(f"Target Range: {start_month} to {end_month}")
    
    for game_name, code in GAMES.items():
        existing_keys = set(f"{d['date']}*{d['period']}" for d in db[game_name])
        print(f"Processing {game_name} ({code})...")
        
        # 修改API網址格式，使用區間參數
        url = f"{API_BASE}/{code}Result?period&startMonth={start_month}&endMonth={end_month}&pageNum=1&pageSize=200"
        
        try:
            res = requests.get(url, headers=HEADERS, timeout=30, verify=False)
            if res.status_code != 200:
                print(f" [Fail] {res.status_code}")
                continue
            
            try:
                data = res.json()
            except Exception as e:
                print(f" [JSON Error]: {e}")
                continue

            rt_code = data.get('rtCode', -1)
            if rt_code != 0:
                print(f" [API Error]: rtCode={rt_code}")
                continue
            
            if 'content' not in data: continue
            
            response_key = API_RESPONSE_KEYS.get(code)
            if not response_key: continue
            
            records = data['content'].get(response_key, [])
            if not records: continue
            
            count = 0
            for item in records:
                date_raw = item.get('lotteryDate', '')
                date_str = date_raw.split('T')[0] if 'T' in date_raw else date_raw
                if not date_str: continue
                
                period = str(item.get('period', ''))
                key = f"{date_str}*{period}"
                
                if key not in existing_keys:
                    numbers = []
                    # 優先使用 drawNumberSize (大小順序)
                    draw_numbers_size = item.get('drawNumberSize', [])
                    # 備用 drawNumberAppear (開出順序)
                    draw_numbers_appear = item.get('drawNumberAppear', [])
                    
                    # 這裡抓取後端邏輯主要存一組 numbers，通常存大小順序以便統計
                    target_list = draw_numbers_size if draw_numbers_size else draw_numbers_appear
                    
                    if target_list:
                        numbers = [int(n) for n in target_list if isinstance(n, (int, float, str)) and str(n).isdigit()]
                    
                    if not numbers: continue
                    
                    db[game_name].append({
                        'date': date_str,
                        'period': period,
                        'numbers': numbers, # 預設存大小順序
                        'source': 'api'
                    })
                    existing_keys.add(key)
                    count += 1
            
            if count > 0: print(f" + API: Found {count} new records")
            time.sleep(0.5)
            
        except Exception as e: print(f" [Error] {game_name}: {str(e)}")

def save_data(db):
    print("=== Saving Data ===")
    jackpots = {}
    for game in JACKPOT_URLS:
        amt = get_jackpot_amount(game)
        if amt: jackpots[game] = amt
    
    for game in db:
        db[game].sort(key=lambda x: x['date'], reverse=True)
        print(f" {game}: {len(db[game])} records")
    
    total_records = sum(len(db[game]) for game in db)
    final_output = {
        "last_updated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "total_records": total_records,
        "jackpots": jackpots,
        "games": db
    }
    
    try:
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(final_output, f, ensure_ascii=False, separators=(',', ':'))
        print(f"Saved to {OUTPUT_FILE}")
    except Exception as e: print(f"Error saving data: {e}")

def main():
    try:
        ensure_dir()
        db = load_history()
        fetch_api(db)
        save_data(db)
    except Exception as e:
        print(f"Critical error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    main()
