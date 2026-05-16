// --- タブ切り替え制御 ---
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.target).classList.add('active');
        if(btn.dataset.target === 'analysis') renderChart();
    });
});

// --- 時計（デジタル・アナログ）処理 ---
function updateClocks() {
    const now = new Date();
    
    // デジタル時計
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    document.getElementById('digital-clock').textContent = `${h}:${m}:${s}`;
    
    // アナログ時計
    const secDeg = now.getSeconds() * 6;
    const minDeg = now.getMinutes() * 6 + now.getSeconds() * 0.1;
    const hourDeg = (now.getHours() % 12) * 30 + now.getMinutes() * 0.5;
    
    document.getElementById('second-hand').style.transform = `translateX(-50%) rotate(${secDeg}deg)`;
    document.getElementById('minute-hand').style.transform = `translateX(-50%) rotate(${minDeg}deg)`;
    document.getElementById('hour-hand').style.transform = `translateX(-50%) rotate(${hourDeg}deg)`;
}
setInterval(updateClocks, 1000);
updateClocks();

// --- データ管理（LocalStorage） ---
let learningData = JSON.parse(localStorage.getItem('lifeStudyData')) || [];

function saveData() {
    localStorage.setItem('lifeStudyData', JSON.stringify(learningData));
    updateDashboard();
    renderTable();
}

// --- ダッシュボード更新 ---
function updateDashboard() {
    const today = new Date().toISOString().split('T')[0];
    let todayTime = 0;
    let weekTime = 0;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    learningData.forEach(item => {
        if (item.date === today) todayTime += parseInt(item.duration);
        if (new Date(item.date) >= sevenDaysAgo) weekTime += parseInt(item.duration);
    });

    document.getElementById('today-time').textContent = `${todayTime} 分`;
    document.getElementById('week-time').textContent = `${weekTime} 分`;
}

// --- 記録フォーム処理 ---
document.getElementById('record-date').value = new Date().toISOString().split('T')[0];

document.getElementById('record-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const newData = {
        id: Date.now(),
        date: document.getElementById('record-date').value,
        subject: document.getElementById('record-subject').value,
        duration: document.getElementById('record-duration').value,
        understanding: document.getElementById('record-understanding').value,
    };
    learningData.push(newData);
    saveData();
    alert('学習記録を保存しました！');
    e.target.reset();
    document.getElementById('record-date').value = new Date().toISOString().split('T')[0];
});

function renderTable() {
    const tbody = document.getElementById('record-list');
    tbody.innerHTML = '';
    const recentData = [...learningData].reverse().slice(0, 5); // 最新5件
    recentData.forEach(item => {
        tbody.innerHTML += `
            <tr>
                <td>${item.date}</td>
                <td>${item.subject}</td>
                <td>${item.duration}分</td>
                <td>${'⭐'.repeat(item.understanding)}</td>
            </tr>
        `;
    });
}

// --- タイマー機能 ＆ 背景変更 ＆ 砂時計 ---
let timerInterval;
let timeLeft = 25 * 60; // 初期25分
let isTimerRunning = false;
const timerDisplay = document.getElementById('timer-display');
const hourglass = document.getElementById('hourglass');
const timerCard = document.getElementById('timer-container');

// 背景画像アップロード
document.getElementById('bg-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(event) {
            timerCard.style.backgroundImage = `url(${event.target.result})`;
            timerCard.style.backgroundSize = 'cover';
            timerCard.style.backgroundPosition = 'center';
            timerCard.classList.add('has-bg');
        };
        reader.readAsDataURL(file);
    }
});

function formatTime(seconds) {
    const m = String(Math.floor(seconds / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    return `${m}:${s}`;
}

document.getElementById('btn-start').addEventListener('click', () => {
    if (isTimerRunning) return;
    isTimerRunning = true;
    hourglass.classList.add('running'); // 砂時計アニメーション開始
    
    timerInterval = setInterval(() => {
        timeLeft--;
        timerDisplay.textContent = formatTime(timeLeft);
        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            isTimerRunning = false;
            hourglass.classList.remove('running');
            alert('お疲れ様でした！学習を記録しましょう。');
            document.querySelector('[data-target="record"]').click();
        }
    }, 1000);
});

document.getElementById('btn-stop').addEventListener('click', () => {
    clearInterval(timerInterval);
    isTimerRunning = false;
    hourglass.classList.remove('running');
});

document.getElementById('btn-reset').addEventListener('click', () => {
    clearInterval(timerInterval);
    isTimerRunning = false;
    timeLeft = 25 * 60;
    timerDisplay.textContent = formatTime(timeLeft);
    hourglass.classList.remove('running');
});

// --- 分析グラフ (Chart.js) ---
let chartInstance = null;
function renderChart() {
    const ctx = document.getElementById('learningChart').getContext('2d');
    
    // 直近7日間のデータ集計
    const dates = [];
    const times = [];
    for(let i=6; i>=0; i--){
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        dates.push(d.getMonth()+1 + '/' + d.getDate());
        
        const dayTotal = learningData
            .filter(item => item.date === dateStr)
            .reduce((sum, item) => sum + parseInt(item.duration), 0);
        times.push(dayTotal);
    }

    if(chartInstance) chartInstance.destroy();
    
    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: dates,
            datasets: [{
                label: '学習時間 (分)',
                data: times,
                backgroundColor: '#00e676',
                borderRadius: 5
            }]
        },
        options: {
            responsive: true,
            scales: { y: { beginAtZero: true, grid: { color: '#333' } }, x: { grid: { color: '#333' } } },
            plugins: { legend: { labels: { color: '#fff' } } }
        }
    });
}

// 初期化実行
updateDashboard();
renderTable();