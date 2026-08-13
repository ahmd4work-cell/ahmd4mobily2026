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
    setupCalendarEvents();
    loadData();

    // ربط زر إضافة تذكير جديد
    document.getElementById('addReminderBtn')?.addEventListener('click', () => {
        const grid = document.getElementById('remindersGrid');
        if (grid) {
            grid.appendChild(createCardHTML());
            saveData();
        }
    });
}

// دالة لإنشاء عنصر مذكرة جديد ديناميكياً بدلاً من 12 مذكرة ثابتة
function createCardHTML(title = '', date = '', text = '') {
    const card = document.createElement('div');
    card.className = 'reminder-card';
    
    card.innerHTML = `
        <div class="card-header">
            <input type="text" class="card-title-input" placeholder="عنوان التذكير..." value="${title}" oninput="window.saveData()">
            <input type="text" class="card-date-input" readonly placeholder="التاريخ" value="${date}" onclick="window.openCustomCalendar(this)">
            <button class="delete-card-btn" onclick="window.deleteCard(this)" title="حذف التذكير"><i class="fas fa-trash"></i></button>
        </div>
        <div class="card-line"></div>
        <textarea class="card-textarea" placeholder="اكتب التذكير هنا..." oninput="window.saveData()">${text}</textarea>
    `;
    return card;
}

// دالة حذف مذكرة
function deleteCard(btnElement) {
    if (confirm("هل أنت متأكد من حذف هذا التذكير؟")) {
        const card = btnElement.closest('.reminder-card');
        if (card) {
            card.remove();
            saveData();
        }
    }
}

/* ==========================================
   وظائف التقويم المخصص والقوائم المنسدلة
   ========================================== */

function setupCalendarEvents() {
    const overlay = document.getElementById('calendarOverlay');
    const monthSelect = document.getElementById('calMonthSelect');
    const yearSelect = document.getElementById('calYearSelect');
    const clearBtn = document.getElementById('calClearBtn');
    const cancelBtn = document.getElementById('calCancelBtn');
    const nextBtn = document.getElementById('calNextBtn');

    if (!overlay) return;

    // تعبئة قائمة الأشهر
    monthSelect.innerHTML = '';
    MONTH_NAMES.forEach((name, index) => {
        const opt = document.createElement('option');
        opt.value = index;
        opt.textContent = name;
        monthSelect.appendChild(opt);
    });

    // عند تغيير الشهر أو السنة من القائمة
    monthSelect.addEventListener('change', (e) => {
        viewMonth = parseInt(e.target.value, 10);
        renderCalendarDays();
    });

    yearSelect.addEventListener('change', (e) => {
        viewYear = parseInt(e.target.value, 10);
        renderCalendarDays();
    });

    // زر إلغاء التقويم
    cancelBtn?.addEventListener('click', closeCalendar);

    // زر "مسح" لتفريغ التاريخ
    clearBtn?.addEventListener('click', () => {
        if (activeInputTarget) {
            activeInputTarget.value = ''; // تفريغ القيمة
            const card = activeInputTarget.closest('.reminder-card');
            if (card) {
                updateCardColor(card);
                saveData();
                sortCardsByDate();
            }
        }
        closeCalendar();
    });

    // زر موافق/التالي لاعتماد التاريخ
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

    // إغلاق التقويم عند الضغط بالخارج
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeCalendar();
    });
}

function populateYearSelect() {
    const yearSelect = document.getElementById('calYearSelect');
    if (!yearSelect) return;

    yearSelect.innerHTML = '';
    const currentYear = new Date().getFullYear();
    
    for (let i = 0; i <= 7; i++) {
        const yr = currentYear + i;
        const opt = document.createElement('option');
        opt.value = yr;
        opt.textContent = yr;
        yearSelect.appendChild(opt);
    }
}

function openCustomCalendar(inputEl) {
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
}

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
   وظائف الحفظ والترتيب
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
    const grid = document.getElementById('remindersGrid');
    if (!grid) return;
    
    grid.innerHTML = ''; // مسح الشبكة الحالية

    // إذا لم تكن هناك بيانات (صفحة جديدة)، أضف بطاقة فارغة واحدة كبداية
    if (!Array.isArray(data) || data.length === 0) {
        grid.appendChild(createCardHTML());
        return;
    }
    
    data.forEach((item) => {
        const card = createCardHTML(item.title || '', item.date || '', item.text || '');
        grid.appendChild(card);
        updateCardColor(card);
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
    
    // إعادة ترتيب الكروت بناءً على الفرز دون مسحها
    cardsArray.forEach(card => grid.appendChild(card));
}

// جعل الدوال متاحة على مستوى الـ Window لتستدعى من الـ HTML المولد برمجياً
Object.assign(window, {
    saveData,
    handleDateChange,
    openCustomCalendar,
    deleteCard
});

document.addEventListener('DOMContentLoaded', initRemindersPage);