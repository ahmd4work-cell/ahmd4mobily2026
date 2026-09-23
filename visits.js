// ==========================================
// visits.js - إدارة الزيارات سحابياً ومحلياً (النسخة المحسنة مع الوضع الليلي وسجل النشاط)
// ==========================================
import { db } from './firebase-config.js';
import { collection, onSnapshot, doc, setDoc, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

let currentActivePreview = null;
const saveTimeouts = {}; 
let searchTimeout;
const LOGS_KEY = 'asgate_visits_logs_v1';
let visitsDataArray = [];
let isInitialLoad = true;

// ==========================================
// إدارة تفعيل والتبديل للوضع الليلي
// ==========================================
function initDarkMode() {
    const toggleBtn = document.getElementById('darkModeToggle');
    const isDarkMode = localStorage.getItem('asgate_dark_mode') === 'true';

    if (isDarkMode) {
        document.body.classList.add('dark-mode');
        if (toggleBtn) {
            toggleBtn.innerHTML = '<i class="fas fa-sun"></i>';
            toggleBtn.title = 'تفعيل الوضع النهاري';
        }
    }

    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const active = document.body.classList.toggle('dark-mode');
            localStorage.setItem('asgate_dark_mode', active);
            toggleBtn.innerHTML = active ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
            toggleBtn.title = active ? 'تفعيل الوضع النهاري' : 'تفعيل الوضع الليلي';
        });
    }
}

// دالة تنظيف وحماية المدخلات لمنع كسر واجهة المستخدم (Escaping)
function escapeHTML(str) {
    if (typeof str !== 'string') return str || '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;');
}

// دوال مساعدة للتواريخ (نمط DD-MM-YYYY المعزز)
function getTodayFormatted() { 
    const d = new Date(); 
    return String(d.getDate()).padStart(2, '0') + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + d.getFullYear(); 
}
function getTimeFormatted() { 
    const d = new Date(); 
    return String(d.getHours()).padStart(2, '0') + ":" + String(d.getMinutes()).padStart(2, '0'); 
}
function formatAsDDMMYYYY(dateStr) {
     if (!dateStr) return '';
     if (dateStr.includes('-')) {
         const p = dateStr.split('-');
         if (p[0].length === 4) return `${p[2]}-${p[1]}-${p[0]}`; 
     }
     return dateStr;
}
function parseDate(dateStr) {
    if (!dateStr) return new Date(0);
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        if (parts[0].length === 4) return new Date(parts[0], parts[1]-1, parts[2]); 
        return new Date(parts[2], parts[1]-1, parts[0]); 
    }
    return new Date(0);
}

async function insertNewRow() {
    const newId = 'visit_' + Date.now();
    const today = getTodayFormatted();
    const timeStr = getTimeFormatted();
    
    const newVisit = {
        comp: '', address: '', mgr: '', mob: '', email: '', record: '',
        visitDate: today, curServ: '', oppValue: '0', notes: '[]',
        status: '', editDate: `${today} ${timeStr}`, owner: '', products: []
    };

    try {
        await setDoc(doc(db, "visits", newId), newVisit);
        addToActivityLog('إجراء', 'تمت إضافة زيارة جديدة', '', 'جديد');
    } catch (error) {
        console.error("خطأ في إضافة زيارة جديدة سحابياً:", error);
        if (typeof Swal !== 'undefined') {
            Swal.fire('خطأ', 'تعذر إضافة الزيارة في السحابة', 'error');
        }
    }
}

// الاستماع للتحديثات باستخدام docChanges لزيادة الأداء ومنع فقدان التركيز
function listenToVisits() {
    const visitsRef = collection(db, "visits");
    onSnapshot(visitsRef, (snapshot) => {
        const tbody = document.getElementById('tableBody');
        if (!tbody) return;

        let needsFullRender = false;

        snapshot.docChanges().forEach((change) => {
            const data = change.doc.data();
            data.id = change.doc.id;

            if (change.type === "added") {
                visitsDataArray.push(data);
                needsFullRender = true;
            }
            if (change.type === "modified") {
                const index = visitsDataArray.findIndex(v => v.id === data.id);
                if (index !== -1) {
                    visitsDataArray[index] = data;
                    updateRowDOM(data);
                }
            }
            if (change.type === "removed") {
                visitsDataArray = visitsDataArray.filter(v => v.id !== data.id);
                needsFullRender = true;
            }
        });

        if (needsFullRender || isInitialLoad) {
            fullTableRender();
            isInitialLoad = false;
        }

        updateStats();
        renderActivityLog();
    }, (error) => {
        console.error("مشكلة في مزامنة الزيارات من السحابة:", error);
    });
}

function updateRowDOM(v) {
    const mainRow = document.getElementById(v.id);
    if (!mainRow) return;

    const safeUpdate = (selector, newVal) => {
        const el = mainRow.querySelector(selector);
        if (el && document.activeElement !== el) {
            if (el.tagName === 'INPUT' || el.tagName === 'SELECT') {
                el.value = newVal;
                el.dataset.old = newVal;
            } else {
                el.innerHTML = newVal;
            }
        }
    };

    safeUpdate('td:nth-child(2) input', v.comp || '');
    const ttContainer = mainRow.querySelector('td:nth-child(2) .custom-tooltip-container');
    if (ttContainer) ttContainer.setAttribute('data-tooltip', v.comp || '');

    safeUpdate('td:nth-child(3) input', v.address || '');
    safeUpdate('td:nth-child(4) input', v.mgr || '');
    safeUpdate('td:nth-child(5) input', v.mob || '');
    safeUpdate('td:nth-child(6) input', v.email || '');
    safeUpdate('td:nth-child(7) input', v.record || '');
    
    const visitDate = formatAsDDMMYYYY(v.visitDate || getTodayFormatted());
    safeUpdate('.visit-date-val', visitDate);
    safeUpdate('td:nth-child(8) input.readonly-input', visitDate);
    
    safeUpdate('.cur-serv-val', v.curServ || '');
    const servTtContainer = mainRow.querySelector('td:nth-child(9) .custom-tooltip-container');
    if (servTtContainer) servTtContainer.setAttribute('data-tooltip', v.curServ || '');

    safeUpdate('.opp-value-input', v.oppValue || '');
    
    const statusSelect = mainRow.querySelector('.status-select');
    if (statusSelect && document.activeElement !== statusSelect) {
        statusSelect.value = v.status || '';
        statusSelect.dataset.old = v.status || '';
        applyStatusColor(statusSelect);
    }

    safeUpdate('td:nth-child(14) input', v.owner || '');
    
    const hiddenEditDate = mainRow.querySelector('.edit-date-val');
    if (hiddenEditDate) hiddenEditDate.value = v.editDate || '';
    const editMains = mainRow.querySelector('.edit-date-container-main');
    if (editMains) editMains.innerHTML = parseEditDateHTML(v.editDate || '');

    let notesJson = v.notes || "[]";
    if (v.id) {
        try {
            const localNotes = localStorage.getItem('visit_notes_local_' + v.id);
            if (localNotes) {
                const cloudArr = JSON.parse(v.notes || "[]");
                const localArr = JSON.parse(localNotes || "[]");
                if (localArr.length >= cloudArr.length) {
                    notesJson = localNotes;
                }
            }
        } catch(e) {}
    }
    const lastNoteText = getLastNoteOnlyFromJSON(notesJson);
    const noteEl = mainRow.querySelector('.notes-preview');
    if (noteEl) {
        noteEl.setAttribute('data-full-notes', notesJson);
        noteEl.innerText = lastNoteText;
    }

    const subRow = document.getElementById('sub-' + v.id);
    if (subRow && !subRow.contains(document.activeElement)) {
         const tbody = subRow.querySelector('.product-body');
         tbody.innerHTML = '';
         if (v.products && v.products.length > 0) {
             v.products.forEach(p => addProductRow(v.id, p));
         } else {
             addProductRow(v.id);
         }
         const subEditContainer = subRow.querySelector('.edit-date-container-sub');
         if (subEditContainer) subEditContainer.innerHTML = parseEditDateHTML(v.editDate || '');
    }
}

function fullTableRender() {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;

    const expandedSubTables = new Set();
    document.querySelectorAll('.sub-table-row').forEach(row => {
        if (row.style.display === 'table-row') expandedSubTables.add(row.id);
    });

    let activeElementData = null;
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT')) {
        const el = document.activeElement;
        const subTableRow = el.closest('.sub-table-row');
        if (subTableRow) {
            const productRow = el.closest('tr');
            const productTd = el.closest('td');
            if (productRow && productTd) activeElementData = { type: 'sub', subId: subTableRow.id, rowIndex: productRow.rowIndex, cellIndex: productTd.cellIndex, selectionStart: el.selectionStart || 0 };
        } else {
            const tr = el.closest('tr.main-row');
            const td = el.closest('td');
            if (tr && td) activeElementData = { type: 'main', mainId: tr.id, cellIndex: td.cellIndex, selectionStart: el.selectionStart || 0 };
        }
    }

    tbody.innerHTML = '';
    
    visitsDataArray.sort((a, b) => {
        let dateDiff = parseDate(b.visitDate) - parseDate(a.visitDate);
        if (dateDiff === 0) {
            const idA = a.id ? parseInt(a.id.replace(/\D/g, '')) || 0 : 0;
            const idB = b.id ? parseInt(b.id.replace(/\D/g, '')) || 0 : 0;
            return idB - idA;
        }
        return dateDiff;
    });
    
    let currentMonthGroup = "";
    visitsDataArray.forEach((v) => {
        let d = parseDate(v.visitDate);
        let m = String(d.getMonth() + 1).padStart(2, '0');
        let y = d.getFullYear();
        let group = m + '-' + y;
        
        if (group !== currentMonthGroup && !isNaN(d.getTime())) {
            currentMonthGroup = group;
            const sepRow = document.createElement('tr');
            sepRow.className = 'month-separator';
            sepRow.innerHTML = `<td colspan="14"><div class="sep-text" dir="rtl">( زيارات شهر ${group} )</div></td>`;
            tbody.appendChild(sepRow);
        }
        renderRow(v);
    });

    expandedSubTables.forEach(subId => {
        const subRow = document.getElementById(subId);
        if (subRow) {
            subRow.style.display = 'table-row';
            const mainRowId = subId.replace('sub-', '');
            const arrows = document.querySelectorAll(`#${mainRowId} .toggle-arrow i`);
            arrows.forEach(arrow => arrow.className = 'fas fa-caret-down');
        }
    });

    if (activeElementData) {
        if (activeElementData.type === 'main') {
            const activeRow = document.getElementById(activeElementData.mainId);
            if (activeRow && activeRow.cells[activeElementData.cellIndex]) {
                const inputToFocus = activeRow.cells[activeElementData.cellIndex].querySelector('input, select');
                if (inputToFocus) { inputToFocus.focus(); try { inputToFocus.setSelectionRange(activeElementData.selectionStart, activeElementData.selectionStart); } catch(e){} }
            }
        } else if (activeElementData.type === 'sub') {
            const subRow = document.getElementById(activeElementData.subId);
            if (subRow) {
                const innerTable = subRow.querySelector('.inner-table');
                if (innerTable && innerTable.rows[activeElementData.rowIndex]) {
                    const targetRow = innerTable.rows[activeElementData.rowIndex];
                    if (targetRow && targetRow.cells[activeElementData.cellIndex]) {
                         const inputToFocus = targetRow.cells[activeElementData.cellIndex].querySelector('input, select');
                         if (inputToFocus) { inputToFocus.focus(); try { inputToFocus.setSelectionRange(activeElementData.selectionStart, activeElementData.selectionStart); } catch(e){} }
                    }
                }
            }
        }
    }
}

function renderRow(v = {}) {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;
    
    const rowId = v.id || ('row-' + Date.now());
    const mainRow = document.createElement('tr');
    mainRow.className = 'main-row';
    mainRow.id = rowId;
    
    const subRow = document.createElement('tr');
    subRow.className = 'sub-table-row';
    subRow.id = 'sub-' + rowId;
    subRow.style.display = 'none';
    
    const today = getTodayFormatted();
    const visitDate = formatAsDDMMYYYY(v.visitDate || today);
    
    let notesJson = v.notes || "[]";
    if (v.id) {
        try {
            const localNotes = localStorage.getItem('visit_notes_local_' + v.id);
            if (localNotes) {
                const cloudArr = JSON.parse(v.notes || "[]");
                const localArr = JSON.parse(localNotes || "[]");
                if (localArr.length >= cloudArr.length) {
                    notesJson = localNotes;
                }
            }
        } catch(e) {}
    }
    const lastNoteText = getLastNoteOnlyFromJSON(notesJson);
    
    let editHtml = parseEditDateHTML(v.editDate || '');

    mainRow.innerHTML = `
        <td class="col-select"><input type="checkbox" class="select-check"></td>
        <td class="col-company" style="font-weight:700;"><div class="custom-tooltip-container" data-tooltip="${escapeHTML(v.comp || '')}"><input type="text" class="excel-input company-input" value="${escapeHTML(v.comp || '')}" placeholder="..." autocomplete="off"></div></td>
        <td class="col-address"><input type="text" class="excel-input" value="${escapeHTML(v.address || '')}" placeholder="..." autocomplete="off"></td>
        <td class="col-manager"><input type="text" class="excel-input" value="${escapeHTML(v.mgr || '')}" placeholder="..." autocomplete="off"></td>
        <td class="col-mobile" style="font-weight:700;">
            <div class="phone-cell-container">
                <input type="text" class="excel-input phone-input" value="${escapeHTML(v.mob || '')}" placeholder="..." autocomplete="off" style="width: 70%;">
                <a class="whatsapp-icon-btn" onclick="if(typeof openWhatsApp === 'function') openWhatsApp(this)"><i class="fab fa-whatsapp"></i></a>
            </div>
        </td>
        <td class="col-email"><input type="text" class="excel-input" value="${escapeHTML(v.email || '')}" placeholder="..." autocomplete="off"></td>
        <td class="col-record" style="font-weight:700;"><input type="text" class="excel-input" value="${escapeHTML(v.record || '')}" placeholder="..." autocomplete="off"></td>
        <td class="col-date" onclick="if(typeof openDatePicker === 'function') openDatePicker('${rowId}', this)">
            <input type="hidden" class="visit-date-val" value="${visitDate}">
            <input type="text" class="excel-input readonly-input" value="${visitDate}" readonly style="cursor: pointer;">
        </td>
        <td class="col-service">
            <input type="hidden" class="cur-serv-val" value="${escapeHTML(v.curServ || '')}">
            <div class="custom-tooltip-container" data-tooltip="${escapeHTML(v.curServ || '')}">
                <div class="toggle-arrow" onclick="if(typeof toggleSubTable === 'function') toggleSubTable('${rowId}')"><i class="fas fa-caret-left"></i></div>
            </div>
        </td>
        <td class="col-val"><input type="number" class="excel-input opp-value-input" value="${v.oppValue || ''}" placeholder="0" autocomplete="off" oninput="calculateMainVisitValue('${rowId}')"></td>
        <td class="col-notes"><div class="notes-preview" data-full-notes='${notesJson.replace(/'/g, "&#39;")}' onclick="if(typeof openNoteModal === 'function') openNoteModal('${rowId}', this)">${escapeHTML(lastNoteText)}</div></td>
        <td class="col-status">
            <select class="excel-input status-select" onchange="applyStatusColor(this)">
                <option value=""></option>
                <option value="معلق" ${v.status === 'معلق' ? 'selected' : ''}>معلق</option>
                <option value="تمت الزيارة" ${v.status === 'تمت الزيارة' ? 'selected' : ''}>تمت الزيارة</option>
                <option value="لم يتم الرد" ${v.status === 'لم يتم الرد' ? 'selected' : ''}>لم يتم الرد</option>
                <option value="غير مهتم" ${v.status === 'غير مهتم' ? 'selected' : ''}>غير مهتم</option>
                <option value="تم الاتفاق" ${v.status === 'تم الاتفاق' ? 'selected' : ''}>تم الاتفاق</option>
                <option value="تأجيل الزيارة" ${v.status === 'تأجيل الزيارة' ? 'selected' : ''}>تأجيل الزيارة</option>
                <option value="ملغاة" ${v.status === 'ملغاة' ? 'selected' : ''}>ملغاة</option>
                <option value="مجدولة" ${v.status === 'مجدولة' ? 'selected' : ''}>مجدولة</option>
                <option value="متابعة" ${v.status === 'متابعة' ? 'selected' : ''}>متابعة</option>
                <option value="في الانتظار" ${v.status === 'في الانتظار' ? 'selected' : ''}>في الانتظار</option>
                <option value="قيد الدراسة" ${v.status === 'قيد الدراسة' ? 'selected' : ''}>قيد الدراسة</option>
                <option value="تم الرفض" ${v.status === 'تم الرفض' ? 'selected' : ''}>تم الرفض</option>
                <option value="غير صالح" ${v.status === 'غير صالح' ? 'selected' : ''}>غير صالح</option>
                <option value="مكتمل جزئياً" ${v.status === 'مكتمل جزئياً' ? 'selected' : ''}>مكتمل جزئياً</option>
                <option value="تحديث بيانات" ${v.status === 'تحديث بيانات' ? 'selected' : ''}>تحديث بيانات</option>
            </select>
        </td>
        <td class="col-edit">
            <input type="hidden" class="edit-date-val" value="${escapeHTML(v.editDate || '')}">
            <div class="edit-date-container-main" style="height:100%; display:flex; align-items:center; justify-content:center;">${editHtml}</div>
        </td>
        <td class="col-owner"><input type="text" class="excel-input" value="${escapeHTML(v.owner || '')}" placeholder="..." autocomplete="off"></td>
    `;
    
    subRow.innerHTML = `
        <td colspan="14" class="sub-table-container">
            <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:5px;">
                <button class="header-plus-btn" onclick="addProductRow('${rowId}')" title="إضافة منتج/خدمة">+</button>
                <div class="edit-date-container-sub" style="font-size:10px; color:#64748b; font-weight:700;">${editHtml}</div>
            </div>
            <table class="inner-table">
                <thead>
                    <tr>
                        <th style="width:30%;">الخدمة / المنتج</th>
                        <th style="width:15%;">الكمية</th>
                        <th style="width:20%;">السعر</th>
                        <th style="width:25%;">الإجمالي</th>
                        <th style="width:10%;">إجراء</th>
                    </tr>
                </thead>
                <tbody class="product-body"></tbody>
            </table>
        </td>
    `;
    
    tbody.appendChild(mainRow);
    tbody.appendChild(subRow);
    
    const prodBody = subRow.querySelector('.product-body');
    if (v.products && v.products.length > 0) {
        v.products.forEach(p => addProductRow(rowId, p));
    } else {
        addProductRow(rowId);
    }
    
    const statusSelect = mainRow.querySelector('.status-select');
    statusSelect.dataset.old = statusSelect.value;
    applyStatusColor(statusSelect);
    
    const inputs = mainRow.querySelectorAll('input:not(.select-check):not([readonly]), select');
    inputs.forEach(input => {
        input.dataset.old = input.value;
        input.addEventListener('change', () => handleInputChange(input, rowId));
    });

    calculateMainVisitValue(rowId, false);
}

function parseEditDateHTML(editDateStr) {
    if (!editDateStr) return '';
    let parts = editDateStr.split(' ');
    if (parts.length >= 2) return `<span class="edit-date-d">${parts[0]}</span>`;
    return `<span class="edit-date-d">${editDateStr}</span>`;
}

function getLastNoteOnlyFromJSON(jsonStr) {
    if (!jsonStr) return "إضافة ملاحظة...";
    try {
        let arr = JSON.parse(jsonStr);
        if (Array.isArray(arr) && arr.length > 0) {
            let last = arr[arr.length - 1];
            let clean = last.text.replace(/[\n\r]/g, ' ');
            if (clean.length > 25) clean = clean.substring(0, 25) + '...';
            return clean;
        }
        return "إضافة ملاحظة...";
    } catch(e) {
        return "إضافة ملاحظة...";
    }
}

// ==========================================
// دوال إدارة المنتجات والقيم
// ==========================================
function addProductRow(rowId, product = {}) {
    const subRow = document.getElementById('sub-' + rowId);
    if (!subRow) return;
    
    const tbody = subRow.querySelector('.product-body');
    if (!tbody) return;

    const tr = document.createElement('tr');
    
    const name = product.name || '';
    const qty = product.qty || 1;
    const price = product.price || 0;
    const total = qty * price;

    tr.innerHTML = `
        <td><input type="text" class="excel-input prod-name" value="${escapeHTML(name)}" placeholder="اسم الخدمة/المنتج" onchange="handleInputChange(this, '${rowId}')"></td>
        <td><input type="number" class="excel-input prod-qty" value="${qty}" min="1" oninput="calculateMainVisitValue('${rowId}')"></td>
        <td><input type="number" class="excel-input prod-price" value="${price}" min="0" oninput="calculateMainVisitValue('${rowId}')"></td>
        <td><input type="number" class="excel-input prod-total" value="${total}" readonly></td>
        <td><button class="delete-btn" onclick="this.closest('tr').remove(); calculateMainVisitValue('${rowId}')"><i class="fas fa-trash"></i></button></td>
    `;
    
    tbody.appendChild(tr);
}

function calculateMainVisitValue(rowId, triggerSave = true) {
    const subRow = document.getElementById('sub-' + rowId);
    const mainRow = document.getElementById(rowId);
    if (!subRow || !mainRow) return;

    let totalValue = 0;
    const rows = subRow.querySelectorAll('.product-body tr');
    rows.forEach(tr => {
        const qtyInput = tr.querySelector('.prod-qty');
        const priceInput = tr.querySelector('.prod-price');
        const totalInput = tr.querySelector('.prod-total');
        
        if (qtyInput && priceInput && totalInput) {
            const qty = parseFloat(qtyInput.value) || 0;
            const price = parseFloat(priceInput.value) || 0;
            const lineTotal = qty * price;
            totalInput.value = lineTotal;
            totalValue += lineTotal;
        }
    });

    const oppInput = mainRow.querySelector('.opp-value-input');
    if (oppInput && oppInput.value !== totalValue.toString()) {
        oppInput.value = totalValue;
        if (triggerSave) {
             handleInputChange(oppInput, rowId);
        }
    }
}

// ==========================================
// دوال سجل النشاط والإحصائيات
// ==========================================
function addToActivityLog(type, description, user = '', details = '') {
    try {
        let logs = [];
        const stored = localStorage.getItem(LOGS_KEY);
        if (stored) {
            logs = JSON.parse(stored);
        }
        const newLog = {
            id: 'log_' + Date.now(),
            date: getTodayFormatted() + ' ' + getTimeFormatted(),
            type: type || 'إجراء',
            desc: description || '',
            user: user || 'مستخدم النظام',
            details: details || ''
        };
        logs.unshift(newLog);
        if (logs.length > 100) logs = logs.slice(0, 100);
        localStorage.setItem(LOGS_KEY, JSON.stringify(logs));
        renderActivityLog();
    } catch (e) {
        console.error("خطأ في حفظ سجل النشاط:", e);
    }
}

function renderActivityLog() {
    const logContainer = document.getElementById('activityLogBody') || document.getElementById('activityLogContainer');
    if (!logContainer) return;

    try {
        let logs = [];
        const stored = localStorage.getItem(LOGS_KEY);
        if (stored) {
            logs = JSON.parse(stored);
        }

        if (logs.length === 0) {
            logContainer.innerHTML = `<div class="no-logs" style="padding: 10px; text-align: center; color: #64748b;">لا توجد نشاطات مسجلة بعد</div>`;
            return;
        }

        logContainer.innerHTML = logs.map(log => `
            <div class="activity-item" style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-size: 12px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                    <span style="font-weight: bold; color: #1e293b;">${escapeHTML(log.desc)}</span>
                    <span style="color: #64748b; font-size: 10px;">${escapeHTML(log.date)}</span>
                </div>
                <div style="color: #475569; display: flex; gap: 10px;">
                    <span><i class="fas fa-tag"></i> ${escapeHTML(log.type)}</span>
                    ${log.details ? `<span><i class="fas fa-info-circle"></i> ${escapeHTML(log.details)}</span>` : ''}
                </div>
            </div>
        `).join('');
    } catch (e) {
        console.error("خطأ في عرض سجل النشاط:", e);
    }
}

function toggleLogExpansion() {
    const logPanel = document.getElementById('activityLogPanel') || document.getElementById('activityLogContainer') || document.querySelector('.activity-log-sidebar');
    if (logPanel) {
        logPanel.classList.toggle('expanded');
        logPanel.classList.toggle('show');
        if (logPanel.style.display === 'none' || !logPanel.style.display) {
            logPanel.style.display = 'block';
        } else {
            logPanel.style.display = 'none';
        }
    } else {
        const altPanel = document.getElementById('activityLog');
        if (altPanel) {
            altPanel.classList.toggle('active');
        }
    }
}

function updateStats() {
    const totalVisitsEl = document.getElementById('totalVisitsCount');
    if (totalVisitsEl && visitsDataArray) {
        totalVisitsEl.innerText = visitsDataArray.length;
    }
}

function applyStatusColor(selectEl) {
    if (!selectEl) return;
    const val = selectEl.value;
    selectEl.className = 'excel-input status-select';
    if (val === 'تمت الزيارة' || val === 'تم الاتفاق') {
        selectEl.style.backgroundColor = '#d1fae5';
        selectEl.style.color = '#065f46';
    } else if (val === 'ملغاة' || val === 'تم الرفض' || val === 'غير مهتم') {
        selectEl.style.backgroundColor = '#fee2e2';
        selectEl.style.color = '#991b1b';
    } else if (val === 'معلق' || val === 'قيد الدراسة') {
        selectEl.style.backgroundColor = '#fef3c7';
        selectEl.style.color = '#92400e';
    } else {
        selectEl.style.backgroundColor = '';
        selectEl.style.color = '';
    }
}

function handleInputChange(inputEl, rowId) {
    if (!inputEl) return;
    const val = inputEl.value;
    const oldVal = inputEl.dataset.old;
    if (val === oldVal) return;
    
    inputEl.dataset.old = val;
    
    const mainRow = document.getElementById(rowId);
    if (!mainRow) return;
    
    const today = getTodayFormatted();
    const timeStr = getTimeFormatted();
    const editDateStr = `${today} ${timeStr}`;
    
    const editValEl = mainRow.querySelector('.edit-date-val');
    if (editValEl) editValEl.value = editDateStr;
    const editContainer = mainRow.querySelector('.edit-date-container-main');
    if (editContainer) editContainer.innerHTML = parseEditDateHTML(editDateStr);
    
    const visitObj = visitsDataArray.find(v => v.id === rowId);
    if (visitObj) {
        visitObj.editDate = editDateStr;
        if (inputEl.classList.contains('company-input')) visitObj.comp = val;
        else if (inputEl.classList.contains('phone-input')) visitObj.mob = val;
        else if (inputEl.classList.contains('opp-value-input')) visitObj.oppValue = val;
        else if (inputEl.classList.contains('status-select')) visitObj.status = val;
        
        localStorage.setItem('crm_visits', JSON.stringify(visitsDataArray));
    }
    
    addToActivityLog('تحديث', 'تم تحديث بيانات الزيارة', '', rowId);
}

// ==========================================
// محرك البحث الشامل وإدارة النتائج
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initDarkMode();
    renderActivityLog();

    const searchInput = document.getElementById('globalSearchInput');
    const searchResults = document.getElementById('searchResults');

    const getSystemData = () => {
        return {
            visits: visitsDataArray || JSON.parse(localStorage.getItem('crm_visits') || '[]'),
            opportunities: JSON.parse(localStorage.getItem('crm_opportunities') || '[]'),
            customers: JSON.parse(localStorage.getItem('crm_customers') || '[]'),
            sales: JSON.parse(localStorage.getItem('crm_sales') || '[]')
        };
    };

    const pageMeta = {
        visits: { title: 'الزيارات', url: 'visits.html', badgeClass: 'badge-visits' },
        opportunities: { title: 'الفرص البيعية', url: 'opportunities.html', badgeClass: 'badge-opportunities' },
        customers: { title: 'العملاء', url: 'customers.html', badgeClass: 'badge-customers' },
        sales: { title: 'المبيعات', url: 'sales.html', badgeClass: 'badge-sales' }
    };

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim().toLowerCase();
            
            if (query.length < 1) {
                searchResults.classList.remove('show');
                searchResults.innerHTML = '';
                return;
            }

            const data = getSystemData();
            const matches = [];

            Object.keys(pageMeta).forEach(pageKey => {
                const records = data[pageKey] || [];
                
                records.forEach(item => {
                    const company = (item.comp || item.company || item.الشركة || '').toString();
                    const responsible = (item.mgr || item.responsible || item.المسؤول || '').toString();
                    const phone = (item.mob || item.phone || item.رقم_التواصل || '').toString();
                    const email = (item.email || item.البريد_الإلكتروني || '').toString();
                    const masterRecord = (item.record || item.masterRecord || item.السجل_الرئيسي || '').toString();
                    const customerCode = (item.customerCode || item.كود_العميل || '').toString();
                    const orderNumber = (item.orderNumber || item.رقم_الطلب || '').toString();

                    const isMatch = [company, responsible, phone, email, masterRecord, customerCode, orderNumber]
                        .some(field => field.toLowerCase().includes(query));

                    if (isMatch) {
                        matches.push({
                            pageKey: pageKey,
                            id: item.id || '',
                            company: company,
                            responsible: responsible,
                            phone: phone,
                            email: email,
                            customerCode: customerCode,
                            orderNumber: orderNumber,
                            masterRecord: masterRecord
                        });
                    }
                });
            });

            renderSearchResults(matches);
        });
    }

    function renderSearchResults(results) {
        if (results.length === 0) {
            searchResults.innerHTML = `<div class="search-no-results"><i class="fas fa-exclamation-circle"></i> لا توجد نتائج مطابقة</div>`;
        } else {
            searchResults.innerHTML = results.map(item => {
                const meta = pageMeta[item.pageKey];
                const targetUrl = `${meta.url}?id=${encodeURIComponent(item.id || item.customerCode || item.orderNumber)}`;

                return `
                    <a href="${targetUrl}" class="search-result-item">
                        <div class="result-header">
                            <span class="result-title">${escapeHTML(item.company || 'بدون اسم شركة')}</span>
                            <span class="result-badge ${meta.badgeClass}">${meta.title}</span>
                        </div>
                        <div class="result-details">
                            ${item.responsible ? `<span><i class="fas fa-user"></i> ${escapeHTML(item.responsible)}</span>` : ''}
                            ${item.customerCode ? `<span><i class="fas fa-id-badge"></i> كود: ${escapeHTML(item.customerCode)}</span>` : ''}
                            ${item.orderNumber ? `<span><i class="fas fa-file-invoice"></i> طلب: ${escapeHTML(item.orderNumber)}</span>` : ''}
                            ${item.phone ? `<span><i class="fas fa-phone"></i> ${escapeHTML(item.phone)}</span>` : ''}
                        </div>
                    </a>
                `;
            }).join('');
        }
        searchResults.classList.add('show');
    }

    document.addEventListener('click', (e) => {
        if (searchResults && !e.target.closest('.nav-search-container')) {
            searchResults.classList.remove('show');
        }
    });

    listenToVisits();
});

// ==========================================
// ربط الدوال بـ window للاستدعاء المباشر من HTML
// ==========================================
window.insertNewRow = insertNewRow;
window.escapeHTML = escapeHTML;
window.getTodayFormatted = getTodayFormatted;
window.getTimeFormatted = getTimeFormatted;
window.addProductRow = addProductRow;
window.calculateMainVisitValue = calculateMainVisitValue;
window.addToActivityLog = addToActivityLog;
window.renderActivityLog = renderActivityLog;
window.toggleLogExpansion = toggleLogExpansion;
window.applyStatusColor = applyStatusColor;
window.handleInputChange = handleInputChange;