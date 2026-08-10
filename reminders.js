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
    
    for (let i = 0; i < 12; i++) {
        const card = document.createElement('div');
        card.className = 'reminder-card';
        card.dataset.index = i;
        
        card.innerHTML = `
            <div class="card-header">
                <input type="text" class="card-title-input" placeholder="عنوان التذكير..." oninput="window.saveData()">
                <input type="text" class="card-date-input" readonly placeholder="التاريخ" onclick="window.openCustomCalendar(this)">
            </div>
            <div class="card-line"></div>
            <textarea class="card-textarea" placeholder="اكتب التذكير هنا..." oninput="window.saveData()"></textarea>
        `;
        grid.appendChild(card);
    }
}

/* ==========================================
   وظائف التقويم المتحرك المخصص
   ========================================== */

function setupCalendarEvents() {
    const overlay = document.getElementById('calendarOverlay');
    const prevMonth = document.getElementById('prevMonthBtn');
    const nextMonth = document.getElementById('nextMonthBtn');
    const prevYear = document.getElementById('prevYearBtn');
    const nextYear = document.getElementById('nextYearBtn');
    const cancelBtn = document.getElementById('calCancelBtn');
    const clearBtn = document.getElementById('calClearBtn');
    const nextBtn = document.getElementById('calNextBtn');

    if (!overlay) return;

    prevMonth?.addEventListener('click', () => changeMonth(-1));
    nextMonth?.addEventListener('click', () => changeMonth(1));
    prevYear?.addEventListener('click', () => changeYear(-1));
    nextYear?.addEventListener('click', () => changeYear(1));

    cancelBtn?.addEventListener('click', closeCalendar);
    
    clearBtn?.addEventListener('click', () => {
        if (activeInputTarget) {
            activeInputTarget.value = "";
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

function openCustomCalendar(inputEl) {
    activeInputTarget = inputEl;
    const val = inputEl.value;

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

    renderCalendarDays('none');
    document.getElementById('calendarOverlay')?.classList.add('active');
}

function closeCalendar() {
    document.getElementById('calendarOverlay')?.classList.remove('active');
    activeInputTarget = null;
}

function changeMonth(delta) {
    viewMonth += delta;
    if (viewMonth > 11) {
        viewMonth = 0;
        viewYear++;
    } else if (viewMonth < 0) {
        viewMonth = 11;
        viewYear--;
    }
    renderCalendarDays(delta > 0 ? 'left' : 'right');
}

function changeYear(delta) {
    viewYear += delta;
    renderCalendarDays(delta > 0 ? 'left' : 'right');
}

function renderCalendarDays(slideDirection) {
    const monthLabel = document.getElementById('calMonthLabel');
    const yearLabel = document.getElementById('calYearLabel');
    const grid = document.getElementById('calDaysGrid');

    if (!grid) return;

    monthLabel.textContent = MONTH_NAMES[viewMonth];
    yearLabel.textContent = viewYear;

    grid.innerHTML = '';
    grid.className = 'days-grid';

    if (slideDirection === 'left') {
        grid.classList.add('slide-left');
    } else if (slideDirection === 'right') {
        grid.classList.add('slide-right');
    }

    const firstDayIndex = new Date(viewYear, viewMonth, 1).getDay(); // 0: Sun, 5: Fri, 6: Sat
    const totalDays = new Date(viewYear, viewMonth + 1, 0).getDate();

    // مساحات فارغة قبل اليوم الأول من الشهر
    for (let i = 0; i < firstDayIndex; i++) {
        const emptySpan = document.createElement('span');
        grid.appendChild(emptySpan);
    }

    // توليد الأيام
    for (let day = 1; day <= totalDays; day++) {
        const daySpan = document.createElement('span');
        daySpan.textContent = day;
        daySpan.className = 'day-number';

        const dayOfWeek = (firstDayIndex + day - 1) % 7;
        const formattedMonth = String(viewMonth + 1).padStart(2, '0');
        const formattedDay = String(day).padStart(2, '0');
        const dateStr = `${viewYear}-${formattedMonth}-${formattedDay}`;

        // تحديد يومي الجمعة والسبت باللون الأحمر
        if (dayOfWeek === 5 || dayOfWeek === 6) {
            daySpan.classList.add('weekend-number');
        }

        // تحديد اليوم المحدد
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
   وظائف المنطق والحفظ المسبقة
   ========================================== */

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
    const localSaved = localStorage.getItem(STORAGE_KEY);
    if (localSaved) {
        try {
            const parsed = JSON.parse(localSaved);
            if (Array.isArray(parsed)) applyDataToCards(parsed);
        } catch (e) { console.error("خطأ في قراءة الذاكرة المحلية", e); }
    }
    
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

Object.assign(window, {
    saveData,
    handleDateChange,
    openCustomCalendar
});

document.addEventListener('DOMContentLoaded', initRemindersPage);
