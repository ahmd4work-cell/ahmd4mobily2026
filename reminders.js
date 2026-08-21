// ==========================================
// reminders.js - إدارة المذكرات والتنبيهات والتقويم المتحرك
// ==========================================

import { db } from './firebase-config.js';
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const STORAGE_KEY = 'asgate_reminders_data_v1';
let saveTimeout = null; 

// متغيّرات إدارة التقويم
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
let activeInputTarget = null;
let viewYear = new Date().getFullYear();
let viewMonth = new Date().getMonth();
let tempSelectedDateStr = "";

function initRemindersPage() {
    renderGrid();
    setupCalendarEvents();
    loadData();
}

function renderGrid() {
    const grid = document.getElementById('remindersGrid');
    if (!grid) return;
    
    grid.innerHTML = '';
    
    // إنشاء 12 مذكرة فعلية
    for (let i = 0; i < 12; i++) {
        const card = document.createElement('div');
        card.className = 'reminder-card';
        card.dataset.index = i;
        
        card.innerHTML = `
            <div class="card-header">
                <input type="text" class="card-title-input" placeholder="عنوان التذكير..." oninput="window.saveData()">
                <div style="display:flex; align-items:center; gap:6px;">
                    <i class="fas fa-trash-alt delete-note-btn" title="مسح المذكرة بالكامل" onclick="window.clearNote(this)"></i>
                    <input type="text" class="card-date-input" readonly placeholder="التاريخ" onclick="window.openCustomCalendar(this)">
                </div>
            </div>
            <div class="card-line"></div>
            <textarea class="card-textarea" placeholder="اكتب التذكير هنا..." oninput="window.saveData()"></textarea>
        `;
        grid.appendChild(card);
    }
}

/* ==========================================
   وظائف مسح المذكرات
   ========================================== */

window.clearNote = function(btnElement) {
    const card = btnElement.closest('.reminder-card');
    if (card) {
        card.querySelector('.card-title-input').value = '';
        card.querySelector('.card-date-input').value = '';
        card.querySelector('.card-textarea').value = '';
        updateCardColor(card);
        saveData();
        sortCardsByDate(); // إعادة الترتيب بعد المسح
    }
};

/* ==========================================
   وظائف التقويم المخصص والقوائم المنسدلة
   ========================================== */

function setupCalendarEvents() {
    const overlay = document.getElementById('calendarOverlay');
    const monthSelect = document.getElementById('calMonthSelect');
    const yearSelect = document.getElementById('calYearSelect');
    const cancelBtn = document.getElementById('calCancelBtn');
    const nextBtn = document.getElementById('calNextBtn');
    const clearBtn = document.getElementById('calClearBtn');

    if (!overlay) return;

    // تعبئة قائمة الأشهر
    monthSelect.innerHTML = '';
    MONTH_NAMES.forEach((name, index) => {
        const opt = document.createElement('option');
        opt.value = index;
        opt.textContent = name;
        monthSelect.appendChild(opt);
    });

    monthSelect.addEventListener('change', (e) => {
        viewMonth = parseInt(e.target.value, 10);
        renderCalendarDays();
    });

    yearSelect.addEventListener('change', (e) => {
        viewYear = parseInt(e.target.value, 10);
        renderCalendarDays();
    });

    cancelBtn?.addEventListener('click', closeCalendar);

    // زر مسح التاريخ
    clearBtn?.addEventListener('click', () => {
        if (activeInputTarget) {
            activeInputTarget.value = '';
            const card = activeInputTarget.closest('.reminder-card');
            if (card) {
                updateCardColor(card);
                saveData();
                sortCardsByDate();
            }
        }
        closeCalendar();
    });

    nextBtn?.addEventListener('click', () => {
        if (activeInputTarget && tempSelectedDateStr) {
            activeInputTarget.value = tempSelectedDateStr;
            const card = activeInputTarget.closest('.reminder-card');
            if (card) {
                updateCardColor(card);
                saveData();
                sortCardsByDate();
            }
        }
        closeCalendar();
    });

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeCalendar();
    });
}

function populateYearSelect() {
    const yearSelect = document.getElementById('calYearSelect');
    if (!yearSelect) return;

    yearSelect.innerHTML = '';
    const currentYear = new Date().getFullYear();
    
    // السنة الحالية + 7 سنوات قادمة
    for (let i = 0; i <= 7; i++) {
        const yr = currentYear + i;
        const opt = document.createElement('option');
        opt.value = yr;
        opt.textContent = yr;
        yearSelect.appendChild(opt);
    }
}

window.openCustomCalendar = function(inputEl) {
    activeInputTarget = inputEl;
    const val = inputEl.value;

    populateYearSelect();

    if (val && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
        const parts = val.split('-');
        viewYear = parseInt(parts[0], 10);
        viewMonth = parseInt(parts[1], 10) - 1;
        tempSelectedDateStr = val;
    } else {
        const today = new Date();
        viewYear = today.getFullYear();
        viewMonth = today.getMonth();
        tempSelectedDateStr = "";
    }

    const monthSelect = document.getElementById('calMonthSelect');
    const yearSelect = document.getElementById('calYearSelect');
    if (monthSelect) monthSelect.value = viewMonth;
    if (yearSelect) yearSelect.value = viewYear;

    renderCalendarDays();
    document.getElementById('calendarOverlay')?.classList.add('active');
};

function closeCalendar() {
    document.getElementById('calendarOverlay')?.classList.remove('active');
    activeInputTarget = null;
}

function renderCalendarDays() {
    const grid = document.getElementById('calDaysGrid');
    if (!grid) return;

    grid.innerHTML = '';

    const firstDayIndex = new Date(viewYear, viewMonth, 1).getDay();
    const totalDays = new Date(viewYear, viewMonth + 1, 0).getDate();
    
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    for (let i = 0; i < firstDayIndex; i++) {
        const emptySpan = document.createElement('span');
        grid.appendChild(emptySpan);
    }

    for (let day = 1; day <= totalDays; day++) {
        const daySpan = document.createElement('span');
        daySpan.textContent = day;
        daySpan.className = 'day-number';

        const dayOfWeek = (firstDayIndex + day - 1) % 7;
        const formattedMonth = String(viewMonth + 1).padStart(2, '0');
        const formattedDay = String(day).padStart(2, '0');
        const dateStr = `${viewYear}-${formattedMonth}-${formattedDay}`;

        if (dayOfWeek === 5 || dayOfWeek === 6) {
            daySpan.classList.add('weekend-number');
        }

        if (dateStr === todayStr) {
            daySpan.classList.add('today-day');
        }

        if (tempSelectedDateStr === dateStr) {
            daySpan.classList.add('selected-day');
        }

        daySpan.addEventListener('click', () => {
            grid.querySelectorAll('.day-number').forEach(s => s.classList.remove('selected-day'));
            daySpan.classList.add('selected-day');
            tempSelectedDateStr = dateStr;
        });

        grid.appendChild(daySpan);
    }
}

/* ==========================================
   وظائف الحفظ المحدثة (محلي وسحابي) والترتيب
   ========================================== */

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

window.saveData = function() {
    const cards = document.querySelectorAll('.reminder-card');
    const data = [];
    
    cards.forEach(card => {
        data.push({
            title: card.querySelector('.card-title-input').value,
            date: card.querySelector('.card-date-input').value,
            text: card.querySelector('.card-textarea').value
        });
    });
    
    // 1. الحفظ المحلي الفوري
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        console.error("خطأ في التخزين المحلي:", e);
    }

    // تحديث مؤشر الحفظ إن وجد في الواجهة
    updateSyncStatus('saving');

    // 2. الحفظ السحابي المؤجل (Debounce) مع إضافة الطابع الزمني
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
        try {
            const docRef = doc(db, "reminders", "all_reminders");
            await setDoc(docRef, { 
                data: data,
                updatedAt: new Date().toISOString()
            }, { merge: true });
            console.log("[Cloud] تم حفظ التذكيرات سحابياً بنجاح");
            updateSyncStatus('saved');
        } catch (error) {
            console.error("[Cloud] خطأ في الحفظ السحابي:", error);
            updateSyncStatus('error');
        }
    }, 1500); 
}

async function loadData() {
    // 1. التحميل المحلي أولاً لضمان السرعة الفورية للعرض
    const localSaved = localStorage.getItem(STORAGE_KEY);
    if (localSaved) {
        try {
            const parsed = JSON.parse(localSaved);
            if (Array.isArray(parsed)) {
                applyDataToCards(parsed);
            }
        } catch (e) { 
            console.error("خطأ في قراءة الذاكرة المحلية", e); 
        }
    }
    
    // 2. المزامنة وجلب الأحدث من السحابة
    try {
        updateSyncStatus('loading');
        const docRef = doc(db, "reminders", "all_reminders");
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            const cloudData = docSnap.data().data;
            if (Array.isArray(cloudData)) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(cloudData));
                applyDataToCards(cloudData);
                console.log("[Cloud] تم جلب التذكيرات من السحابة وتحديث التخزين المحلي");
                updateSyncStatus('saved');
            }
        } else {
            updateSyncStatus('saved');
        }
    } catch (error) {
        console.error("[Cloud] خطأ في جلب التذكيرات:", error);
        updateSyncStatus('error');
    }
}

// دالة مساعدة لتحديث حالة المزامنة في واجهة المستخدم (تتطابق مع الصفحات الأخرى إن وجدت العناصر)
function updateSyncStatus(status) {
    const statusEl = document.getElementById('syncStatus') || document.getElementById('cloudStatus');
    if (!statusEl) return;
    
    switch(status) {
        case 'saving':
            statusEl.textContent = 'جاري الحفظ...';
            statusEl.className = 'sync-saving';
            break;
        case 'saved':
            statusEl.textContent = 'تم الحفظ';
            statusEl.className = 'sync-saved';
            break;
        case 'loading':
            statusEl.textContent = 'جاري التحديث...';
            statusEl.className = 'sync-loading';
            break;
        case 'error':
            statusEl.textContent = 'خطأ في الاتصال';
            statusEl.className = 'sync-error';
            break;
    }
}

function applyDataToCards(data) {
    if (!Array.isArray(data)) return;
    
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

document.addEventListener('DOMContentLoaded', initRemindersPage);