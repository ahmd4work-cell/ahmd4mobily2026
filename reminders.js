// ==========================================
// reminders.js - إدارة المذكرات والتنبيهات
// ==========================================

import { db } from './firebase-config.js';
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const STORAGE_KEY = 'asgate_reminders_data_v1';
let saveTimeout = null; 

function initRemindersPage() {
    renderGrid();
    loadData();
}

function renderGrid() {
    const grid = document.getElementById('remindersGrid');
    if (!grid) return;
    
    grid.innerHTML = '';
    
    for (let i = 0; i < 12; i++) {
        const card = document.createElement('div');
        card.className = 'reminder-card';
        card.dataset.index = i;
        
        card.innerHTML = `
            <div class="card-header">
                <input type="text" class="card-title-input" placeholder="عنوان التذكير..." oninput="window.saveData()">
                <input type="date" class="card-date-input" onchange="window.handleDateChange(this)">
            </div>
            <div class="card-line"></div>
            <textarea class="card-textarea" placeholder="اكتب التذكير هنا..." oninput="window.saveData()"></textarea>
        `;
        grid.appendChild(card);
    }
}

function handleDateChange(input) {
    const card = input.closest('.reminder-card');
    if (!card) return;
    
    updateCardColor(card);
    saveData();
    sortCardsByDate();
}

function updateCardColor(card) {
    const dateInput = card.querySelector('.card-date-input');
    const dateVal = dateInput ? dateInput.value : '';
    
    card.classList.remove('status-yellow', 'status-green', 'status-red');
    
    if (!dateVal) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const targetDate = new Date(dateVal);
    targetDate.setHours(0, 0, 0, 0);

    const diffTime = targetDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
        card.classList.add('status-red'); 
    } else if (diffDays === 0) {
        card.classList.add('status-green'); 
    } else if (diffDays <= 3) {
        card.classList.add('status-yellow'); 
    }
}

function saveData() {
    const cards = document.querySelectorAll('.reminder-card');
    const data = [];
    
    cards.forEach(card => {
        data.push({
            title: card.querySelector('.card-title-input').value,
            date: card.querySelector('.card-date-input').value,
            text: card.querySelector('.card-textarea').value
        });
    });
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
        try {
            const docRef = doc(db, "reminders", "all_reminders");
            await setDoc(docRef, { data: data }, { merge: true });
            console.log("[Cloud] تم حفظ التذكيرات سحابياً بنجاح");
        } catch (error) {
            console.error("[Cloud] خطأ في الحفظ السحابي:", error);
        }
    }, 1500); 
}

async function loadData() {
    // 1. التحميل من הذاكرة المحلية مع فحص الأمان
    const localSaved = localStorage.getItem(STORAGE_KEY);
    if (localSaved) {
        try {
            const parsed = JSON.parse(localSaved);
            if (Array.isArray(parsed)) applyDataToCards(parsed);
        } catch (e) { console.error("خطأ في قراءة الذاكرة المحلية", e); }
    }
    
    // 2. التحميل من السحابة مع فحص الأمان
    try {
        const docRef = doc(db, "reminders", "all_reminders");
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            const cloudData = docSnap.data().data;
            if (Array.isArray(cloudData)) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(cloudData));
                applyDataToCards(cloudData);
                console.log("[Cloud] تم جلب التذكيرات من السحابة");
            }
        }
    } catch (error) {
        console.error("[Cloud] خطأ في جلب التذكيرات:", error);
    }
}

function applyDataToCards(data) {
    if (!Array.isArray(data)) return; // حماية لعدم تعطل الكود إذا كانت البيانات ليست مصفوفة
    
    const cards = document.querySelectorAll('.reminder-card');
    data.forEach((item, i) => {
        if (cards[i] && item) {
            cards[i].querySelector('.card-title-input').value = item.title || '';
            cards[i].querySelector('.card-date-input').value = item.date || '';
            cards[i].querySelector('.card-textarea').value = item.text || '';
            updateCardColor(cards[i]);
        }
    });
    sortCardsByDate();
}

function sortCardsByDate() {
    const grid = document.getElementById('remindersGrid');
    if (!grid) return;

    const cardsArray = Array.from(grid.querySelectorAll('.reminder-card'));
    
    cardsArray.sort((a, b) => {
        const dateA = a.querySelector('.card-date-input').value;
        const dateB = b.querySelector('.card-date-input').value;
        
        if (!dateA && !dateB) return 0;
        if (!dateA) return 1; 
        if (!dateB) return -1;
        
        return new Date(dateA) - new Date(dateB); 
    });
    
    cardsArray.forEach(card => grid.appendChild(card));
}

Object.assign(window, {
    saveData,
    handleDateChange
});

document.addEventListener('DOMContentLoaded', initRemindersPage);