// 【最終修正方案】
// 徹底重構程式碼結構，分離變數、函式和事件綁定，確保執行順序的絕對可靠性。

import { GoogleGenerativeAI } from "https://cdn.jsdelivr.net/npm/@google/genai/+esm";
import { openDB } from "https://cdn.jsdelivr.net/npm/idb@7/+esm";

// --- 靜態配置 ---
const API_KEY = "AIzaSyBOHdA5hSrJj3euMWUWHtU9c1AlAHcb-5Q";
const CHAT_MODEL_NAME = "gemini-2.5-pro";
const JSON_MODEL_NAME = "gemini-2.5-pro";

// --- 全域變數定義 ---
let genAI, chatModel, jsonModel, db;
let conversationHistory = [];
const DB_NAME = 'travel-app-db';
const DB_VERSION = 1;

// --- 全域 DOM 元素變數 (先宣告，後賦值) ---
let messageList, chatInput, sendBtn, generateTripBtn, loadingIndicator, showTripsBtn, tripListModal, tripListContent, closeTripListBtn;

// --- 初始化函式 ---
function initializeGemini() {
    try {
        genAI = new GoogleGenerativeAI(API_KEY);
        chatModel = genAI.getGenerativeModel({
            model: CHAT_MODEL_NAME,
            tools: [{ googleSearch: {} }],
        });
        jsonModel = genAI.getGenerativeModel({
            model: JSON_MODEL_NAME,
            generationConfig: { responseMimeType: "application/json" },
        });
        console.log(`AI 初始化成功！模型: ${CHAT_MODEL_NAME}`);
        return true;
    } catch (error) {
        console.error("AI 初始化失敗:", error);
        alert(`AI 初始化失敗: ${error.message}`);
        return false;
    }
}

async function initDB() {
    if (db) return;
    db = await openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
            if (!db.objectStoreNames.contains('trips')) {
                db.createObjectStore('trips', { keyPath: 'id', autoIncrement: true }).createIndex('name', 'name');
            }
            if (!db.objectStoreNames.contains('dailyPlans')) {
                db.createObjectStore('dailyPlans', { keyPath: 'id', autoIncrement: true }).createIndex('tripId', 'tripId');
            }
            if (!db.objectStoreNames.contains('tripItems')) {
                db.createObjectStore('tripItems', { keyPath: 'id', autoIncrement: true }).createIndex('dailyPlanId', 'dailyPlanId');
            }
        },
    });
    console.log("資料庫初始化成功");
}

// --- 核心功能函式 ---
async function chatWithAI(prompt) {
    if (!chatModel) throw new Error("聊天模型未初始化");
    const result = await chatModel.generateContent(prompt);
    return (await result.response).text();
}

async function generateTripJson(userPromptContext) {
    if (!jsonModel) throw new Error("JSON 模型未初始化");
    const prompt = `請根據以下使用者需求和對話內容，為我生成一個完整的旅遊行程計畫的 JSON 資料。JSON 的根物件應包含一個 "trip" 物件和一個 "dailyPlans" 陣列。"trip" 物件應包含: "name" (行程名稱, string), "country" (國家, string), "startDate" (開始日期, 'YYYY-MM-DD' string), "endDate" (結束日期, 'YYYY-MM-DD' string)。"dailyPlans" 陣列包含多個每日計畫物件。每個每日計畫物件應包含: "date" ('YYYY-MM-DD' string), "notes" (當日總結, string, 可選), 和一個 "items" 陣列。每個 "items" 行程項目物件應包含: "name" (名稱, string), "type" (類型, string，可為 '景點', '交通', '住宿', '餐飲', '其他'), "cost" (預估花費, number, 可選), "timeEstimate" (預估時間(小時), number, 可選), "notes" (備註, string，可包含網址或圖片URL, 可選)。所有可選欄位若無確切資訊可留空或省略。使用者需求與對話上下文：\n---\n${userPromptContext}\n---`;
    const result = await jsonModel.generateContent(prompt);
    return JSON.parse((await result.response).text());
}

async function saveGeneratedTrip(tripData) {
    if (!db) await initDB();
    const tx = db.transaction(['trips', 'dailyPlans', 'tripItems'], 'readwrite');
    const tripId = await tx.objectStore('trips').add(tripData.trip);
    for (const plan of tripData.dailyPlans) {
        const dailyPlanId = await tx.objectStore('dailyPlans').add({ tripId, date: plan.date, notes: plan.notes || "" });
        if (plan.items && plan.items.length > 0) {
            for (const item of plan.items) { await tx.objectStore('tripItems').add({ dailyPlanId, ...item }); }
        }
    }
    await tx.done;
    return tripId;
}

async function getAllTrips() {
    if (!db) await initDB();
    return db.getAll('trips');
}

// --- 畫面互動與事件處理函式 ---
const toggleLoading = (isLoading) => {
    loadingIndicator.classList.toggle('hidden', !isLoading);
    generateTripBtn.disabled = isLoading;
    sendBtn.disabled = isLoading;
    chatInput.disabled = isLoading;
};

const displayMessage = (sender, text) => {
    const messageEl = document.createElement('div');
    messageEl.classList.add('message', sender);
    messageEl.innerHTML = self.marked.parse(text);
    messageList.appendChild(messageEl);
    messageList.scrollTop = messageList.scrollHeight;
};

const handleSendMessage = async () => {
    const prompt = chatInput.value.trim();
    if (!prompt) return;
    displayMessage('user', prompt);
    conversationHistory.push({ role: 'user', parts: [{ text: prompt }] });
    chatInput.value = '';
    chatInput.style.height = 'auto';
    toggleLoading(true);
    try {
        const contextForAI = conversationHistory.map(msg => `${msg.role === 'user' ? '使用者' : 'AI'}: ${msg.parts[0].text}`).join('\n');
        const aiResponse = await chatWithAI(contextForAI);
        displayMessage('ai', aiResponse);
        conversationHistory.push({ role: 'model', parts: [{ text: aiResponse }] });
    } catch (error) {
        console.error("AI 對話出錯:", error);
        displayMessage('ai', `糟糕，發生錯誤了：${error.message}`);
    } finally {
        toggleLoading(false);
    }
};

const handleGenerateTrip = async () => {
    if (conversationHistory.length === 0) {
        alert("請先和 AI 對話，描述您的旅遊需求！");
        return;
    }
    toggleLoading(true);
    displayMessage('ai', '好的，我正在為您整理完整的行程計畫，並將它存檔...');
    try {
        const conversationContext = conversationHistory.map(msg => `${msg.role === 'user' ? '使用者' : 'AI'}: ${msg.parts[0].text}`).join('\n');
        const tripData = await generateTripJson(conversationContext);
        if (tripData && tripData.trip && tripData.dailyPlans) {
            await saveGeneratedTrip(tripData);
            displayMessage('ai', `✅ 太棒了！您的行程 **${tripData.trip.name}** 已成功儲存！`);
            conversationHistory = [];
        } else {
            displayMessage('ai', '⚠️ AI 未能成功生成結構化的行程 JSON。');
        }
    } catch (error) {
        console.error("生成行程出錯:", error);
        displayMessage('ai', `儲存行程時發生嚴重錯誤：${error.message}`);
    } finally {
        toggleLoading(false);
    }
};

const showTrips = async () => {
    tripListContent.innerHTML = '';
    try {
        const trips = await getAllTrips();
        if (trips.length === 0) {
            tripListContent.innerHTML = '<p>您還沒有儲存任何行程喔！</p>';
        } else {
            for (const trip of trips) {
                const card = document.createElement('div');
                card.className = 'trip-card';
                card.innerHTML = `<h3>${trip.name || '未命名行程'}</h3><p><strong>國家:</strong> ${trip.country || '未指定'}</p><p><strong>日期:</strong> ${trip.startDate || '?'} 到 ${trip.endDate || '?'}</p>`;
                tripListContent.appendChild(card);
            }
        }
        tripListModal.classList.remove('hidden');
    } catch (error) {
        console.error('讀取行程列表失敗:', error);
        alert('讀取行程列表失敗！');
    }
};

// --- App 啟動流程 ---
async function startApp() {
    if (initializeGemini()) {
        await initDB();
        displayMessage('ai', "哈囉！我是您的專屬旅遊規劃助理，想去哪裡旅行呢？");
    } else {
        displayMessage('ai', "應用程式初始化失敗，請檢查瀏覽器主控台中的錯誤訊息。");
    }
}

// ===================================================================
// --- 主執行區：等待 DOM 載入後，才獲取元素並綁定事件 ---
// ===================================================================
document.addEventListener('DOMContentLoaded', () => {
    // 1. 獲取所有 DOM 元素並賦值給全域變數
    messageList = document.getElementById('message-list');
    chatInput = document.getElementById('chat-input');
    sendBtn = document.getElementById('send-btn');
    generateTripBtn = document.getElementById('generate-trip-btn');
    loadingIndicator = document.getElementById('loading-indicator');
    showTripsBtn = document.getElementById('show-trips-btn');
    tripListModal = document.getElementById('trip-list-modal');
    tripListContent = document.getElementById('trip-list-content');
    closeTripListBtn = tripListModal.querySelector('.close-btn');

    // 2. 綁定所有事件監聽器
    sendBtn.addEventListener('click', handleSendMessage);
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
    });
    chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = chatInput.scrollHeight + 'px';
    });
    generateTripBtn.addEventListener('click', handleGenerateTrip);
    showTripsBtn.addEventListener('click', showTrips);
    closeTripListBtn.addEventListener('click', () => tripListModal.classList.add('hidden'));

    // 3. 呼叫啟動函式
    startApp();
});
