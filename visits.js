// ==========================================
// visits.js - إدارة الزيارات سحابياً ومحلياً 
// ==========================================
import { db } from './firebase-config.js';
import { collection, onSnapshot, doc, setDoc, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

let currentActivePreview = null;
const saveTimeouts = {}; 
let searchTimeout;
const LOGS_KEY = 'asgate_visits_logs_v1';
let visitsDataArray = [];
let isInitialLoad = true;
let activityLogs = JSON.parse(localStorage.getItem(LOGS_KEY) || '[]');
let currentPickerRowId = null;
let pendingBulkAction = '';

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

function escapeHTML(str) {
    if (typeof str !== 'string') return str || '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;');
}

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

// ==========================================
// دوال الملاحظات والتواريخ والتعديل
// ==========================================
function getLastNoteOnlyFromJSON(notesJson) {
    try {
        const arr = JSON.parse(notesJson || "[]");
        if (Array.isArray(arr) && arr.length > 0) {
            const last = arr[arr.length - 1];
            return last.text || last.note || '';
        }
    } catch(e) {
        if (typeof notesJson === 'string' && notesJson.trim() !== '' && notesJson !== '[]') {
            return notesJson;
        }
    }
    return '';
}

function parseEditDateHTML(editDateStr) {
    if (!editDateStr) return `<span class="edit-date-d">-</span>`;
    return `<span class="edit-date-d">${escapeHTML(editDateStr)}</span>`;
}

function updateEditDateField(tr) {
    if (!tr) return;
    const today = getTodayFormatted();
    const time = getTimeFormatted();
    const fullStr = `${today} ${time}`;
    const hiddenInput = tr.querySelector('.edit-date-val');
    if (hiddenInput) hiddenInput.value = fullStr;
    const containerMain = tr.querySelector('.edit-date-container-main');
    if (containerMain) containerMain.innerHTML = parseEditDateHTML(fullStr);
    const subRow = document.getElementById('sub-' + tr.id);
    if (subRow) {
        const containerSub = subRow.querySelector('.edit-date-container-sub');
        if (containerSub) containerSub.innerHTML = parseEditDateHTML(fullStr);
    }
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
        Swal.fire('خطأ', 'تعذر إضافة الزيارة في السحابة', 'error');
    }
}

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
    const editDateHTML = parseEditDateHTML(v.editDate || '');

    mainRow.innerHTML = `
        <td class="col-select">
            <input type="checkbox" class="select-check">
            <span class="toggle-arrow" onclick="toggleSubTable('${rowId}')"><i class="fas fa-caret-left"></i></span>
        </td>
        <td>
            <div class="custom-tooltip-container" data-tooltip="${escapeHTML(v.comp || '')}">
                <input type="text" class="excel-input" value="${escapeHTML(v.comp || '')}" data-old="${escapeHTML(v.comp || '')}" onfocus="this.dataset.old=this.value" oninput="this.closest('.custom-tooltip-container').setAttribute('data-tooltip', this.value)" onkeyup="updateEditDateField(this.closest('tr'));" onchange="debouncedSaveSingleRow('${rowId}');" onblur="addToActivityLog('الشركة', this.dataset.old, this.value, this.value); this.dataset.old=this.value;">
            </div>
        </td>
        <td><input type="text" class="excel-input" value="${escapeHTML(v.address || '')}" data-old="${escapeHTML(v.address || '')}" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr'));" onchange="debouncedSaveSingleRow('${rowId}');" onblur="addToActivityLog('العنوان', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value); this.dataset.old=this.value;"></td>
        <td><input type="text" class="excel-input" value="${escapeHTML(v.mgr || '')}" data-old="${escapeHTML(v.mgr || '')}" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr'));" onchange="debouncedSaveSingleRow('${rowId}');" onblur="addToActivityLog('المسؤول', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value); this.dataset.old=this.value;"></td>
        <td>
            <div class="phone-cell-container">
                <a class="whatsapp-icon-btn" onclick="openWhatsAppChat(this)" title="مراسلة عبر واتساب"><i class="fa-brands fa-whatsapp"></i></a>
                <input type="text" class="excel-input" value="${escapeHTML(v.mob || '')}" data-old="${escapeHTML(v.mob || '')}" oninput="this.value = this.value.replace(/[^0-9]/g, '');" onkeyup="updateEditDateField(this.closest('tr'));" onchange="debouncedSaveSingleRow('${rowId}');" onfocus="this.dataset.old=this.value" onblur="addToActivityLog('رقم التواصل', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value); this.dataset.old=this.value;">
            </div>
        </td>
        <td><input type="text" class="excel-input" value="${escapeHTML(v.email || '')}" data-old="${escapeHTML(v.email || '')}" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr'));" onchange="debouncedSaveSingleRow('${rowId}');" onblur="addToActivityLog('الإيميل', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value); this.dataset.old=this.value;"></td>
        <td><input type="text" class="excel-input" value="${escapeHTML(v.record || '')}" data-old="${escapeHTML(v.record || '')}" oninput="this.value = this.value.replace(/[^0-9]/g, '');" onkeyup="updateEditDateField(this.closest('tr'));" onchange="debouncedSaveSingleRow('${rowId}');" onfocus="this.dataset.old=this.value" onblur="addToActivityLog('السجل', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value); this.dataset.old=this.value;"></td>
        <td>
            <input type="text" dir="ltr" class="excel-input readonly-input" value="${visitDate}" style="color:var(--text-muted); font-weight:700; unicode-bidi: isolate; cursor: pointer;" readonly onclick="openDatePicker('${rowId}')" title="انقر لتعديل التاريخ">
            <input type="hidden" class="visit-date-val opp-date-val" value="${visitDate}">
        </td>
        <td>
            <div class="custom-tooltip-container" data-tooltip="${escapeHTML(v.curServ || '')}">
                <input type="text" class="excel-input cur-serv-val" value="${escapeHTML(v.curServ || '')}" data-old="${escapeHTML(v.curServ || '')}" onfocus="this.dataset.old=this.value" oninput="this.closest('.custom-tooltip-container').setAttribute('data-tooltip', this.value)" onkeyup="updateEditDateField(this.closest('tr'));" onchange="debouncedSaveSingleRow('${rowId}');" onblur="addToActivityLog('الخدمة', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value); this.dataset.old=this.value;">
            </div>
        </td>
        <td><input type="number" class="excel-input opp-value-input readonly-input" value="${v.oppValue || ''}" readonly style="color:var(--accent-blue); font-weight:800; cursor:not-allowed; background: transparent;"></td>
        <td><div class="notes-preview" onclick="openNote(this)" data-full-notes='${escapeHTML(notesJson)}' id="preview-${Date.now()}">${escapeHTML(lastNoteText)}</div></td>
        <td>
            <select class="excel-input status-select" data-old="${v.status || ''}" onfocus="this.dataset.old=this.value" onchange="handleStatusChange(this, '${rowId}')">
                <option value="" ${v.status === '' ? 'selected' : ''}>-</option>
                <option value="تأهيل لفرصة" ${v.status === 'تأهيل لفرصة' ? 'selected' : ''}>تأهيل لفرصة</option>
                <option value="متابعة" ${v.status === 'متابعة' ? 'selected' : ''}>متابعة</option>
                <option value="عرض سعر" ${v.status === 'عرض سعر' ? 'selected' : ''}>عرض سعر</option>
                <option value="زيارة" ${v.status === 'زيارة' ? 'selected' : ''}>زيارة</option>
                <option value="اتصال" ${v.status === 'اتصال' ? 'selected' : ''}>اتصال</option>
                <option value="غير مهتم" ${v.status === 'غير مهتم' ? 'selected' : ''}>غير مهتم</option>
                <option value="فقدان" ${v.status === 'فقدان' ? 'selected' : ''}>فقدان</option>
            </select>
        </td>
        <td>
            <div class="edit-date-container-main" style="line-height:1.2; display:flex; flex-direction:column; align-items:center;">${editDateHTML}</div>
            <input type="hidden" class="edit-date-val" value="${v.editDate || ''}">
        </td>
        <td><input type="text" class="excel-input" value="${escapeHTML(v.owner || '')}" data-old="${escapeHTML(v.owner || '')}" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr'));" onchange="debouncedSaveSingleRow('${rowId}');" onblur="addToActivityLog('المالك', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value); this.dataset.old=this.value;"></td>
    `;

    subRow.innerHTML = `
        <td colspan="14" style="padding:15px 10px; background:#f8fafc; box-shadow: inset 0 2px 4px rgba(0,0,0,.02);">
            <div style="display: flex; gap: 15px; align-items: stretch;">
                <div class="sub-table-container" style="flex: 0 0 50%; padding: 0;">
                    <table class="inner-table" style="width: 100%;">
                        <thead>
                            <tr>
                                <th>المنتج</th><th>التفاصيل</th><th>العدد</th><th>الاشتراك</th><th>الإجمالي</th>
                                <th style="width:75px"><button class="header-plus-btn" onclick="addProductRow('${rowId}')" title="إضافة منتج"><i class="fas fa-plus"></i></button></th>
                            </tr>
                        </thead>
                        <tbody class="product-body"></tbody>
                    </table>
                </div>
                <div style="width: 250px; background: white; border: 1px solid var(--border-soft); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; justify-content: center; align-items: center; box-shadow: 0 4px 6px rgba(0,0,0,.05);">
                    <div style="font-weight:bold; color:#2e1065; margin-bottom:10px; font-size:12px;">تاريخ التعديل:</div>
                    <div class="edit-date-container-sub" style="display:flex; flex-direction:column; align-items:center;">${parseEditDateHTML(v.editDate || '')}</div>
                </div>
            </div>
        </td>
    `;

    tbody.appendChild(mainRow); 
    tbody.appendChild(subRow); 
    applyStatusColor(mainRow.querySelector('.status-select'));
    if (v.products && v.products.length > 0) v.products.forEach(p => addProductRow(rowId, p)); else addProductRow(rowId);
    calculateMainVisitValue(rowId, false);
}

function addProductRow(rowId, data = {}) {
    const subRow = document.getElementById('sub-' + rowId);
    if (!subRow) return;
    const tbody = subRow.querySelector('.product-body');
    const row = tbody.insertRow();
    row.innerHTML = `
        <td><select onchange="updateEditDateField(this.closest('.sub-table-row').previousElementSibling); debouncedSaveSingleRow('${rowId}');"><option value="">-</option><option value="جوال" ${data.type === 'جوال' ? 'selected' : ''}>جوال</option><option value="بيانات" ${data.type === 'بيانات' ? 'selected' : ''}>بيانات</option><option value="هاتف" ${data.type === 'هاتف' ? 'selected' : ''}>هاتف</option><option value="فايبر نت" ${data.type === 'فايبر نت' ? 'selected' : ''}>فايبر نت</option><option value="DIA" ${data.type === 'DIA' ? 'selected' : ''}>DIA</option><option value="IPVPN" ${data.type === 'IPVPN' ? 'selected' : ''}>IPVPN</option><option value="SIP" ${data.type === 'SIP' ? 'selected' : ''}>SIP</option></select></td>
        <td><input type="text" value="${escapeHTML(data.desc || '')}" onkeyup="updateEditDateField(this.closest('.sub-table-row').previousElementSibling);" onchange="debouncedSaveSingleRow('${rowId}');"></td>
        <td><input type="number" class="prod-qty" min="0" value="${data.qty || ''}" onkeyup="updateEditDateField(this.closest('.sub-table-row').previousElementSibling);" oninput="calculateMainVisitValue('${rowId}', false)" onchange="calculateMainVisitValue('${rowId}', true)"></td>
        <td><input type="number" class="prod-sub" min="0" value="${data.sub || ''}" onkeyup="updateEditDateField(this.closest('.sub-table-row').previousElementSibling);" oninput="calculateMainVisitValue('${rowId}', false)" onchange="calculateMainVisitValue('${rowId}', true)"></td>
        <td><input type="number" class="prod-total readonly-input" value="${data.total || ''}" readonly style="color:var(--text-muted); font-weight:700; cursor:not-allowed;"></td>
        <td><div style="display:flex; justify-content:center;"><button class="sub-action-btn" title="حذف" onclick="if(this.closest('tbody').rows.length > 1) { const main = this.closest('.sub-table-row').previousElementSibling; updateEditDateField(main); this.closest('tr').remove(); calculateMainVisitValue('${rowId}', true); }"><i class="fas fa-trash-alt" style="font-size:10px;"></i></button></div></td>
    `;
}

function calculateMainVisitValue(rowId, shouldSave = true) {
    const subRow = document.getElementById('sub-' + rowId);
    if (!subRow) return;
    let grandTotal = 0;
    subRow.querySelectorAll('.product-body tr').forEach(pRow => {
        const qty = parseFloat(pRow.querySelector('.prod-qty').value) || 0;
        const sub = parseFloat(pRow.querySelector('.prod-sub').value) || 0;
        const rowTotal = qty * sub;
        pRow.querySelector('.prod-total').value = rowTotal > 0 ? rowTotal : '';
        grandTotal += rowTotal;
    });
    const mainRow = document.getElementById(rowId);
    if (mainRow) {
        const oppVal = mainRow.querySelector('.opp-value-input');
        if (oppVal) oppVal.value = grandTotal > 0 ? grandTotal : '';
    }
    if (shouldSave) debouncedSaveSingleRow(rowId);
}

async function saveSingleRow(rowId) {
    const row = document.getElementById(rowId);
    if (!row) return;

    const subRow = document.getElementById('sub-' + rowId);
    const products = [];
    if (subRow) {
        subRow.querySelectorAll('.product-body tr').forEach(pRow => {
            const inputs = pRow.querySelectorAll('input, select');
            if (inputs.length >= 5) products.push({ type: inputs[0].value, desc: inputs[1].value, qty: inputs[2].value, sub: inputs[3].value, total: inputs[4].value });
        });
    }

    const compVal = row.cells[1].querySelector('input').value;
    const servVal = row.cells[8].querySelector('input').value;

    const data = {
        comp: compVal,
        address: row.cells[2].querySelector('input').value,
        mgr: row.cells[3].querySelector('input').value,
        mob: row.cells[4].querySelector('input').value,
        email: row.cells[5].querySelector('input').value,
        record: row.cells[6].querySelector('input').value,
        visitDate: row.querySelector('.visit-date-val').value, 
        curServ: servVal,
        oppValue: row.cells[9].querySelector('input').value,
        notes: row.cells[10].querySelector('.notes-preview').getAttribute('data-full-notes') || '[]',
        status: row.cells[11].querySelector('select').value,
        editDate: row.querySelector('.edit-date-val')?.value || getTodayFormatted(),
        owner: row.cells[13].querySelector('input').value,
        products: products
    };

    try {
        await setDoc(doc(db, "visits", rowId), data, { merge: true });
    } catch (e) {
        console.error("خطأ بالحفظ السحابي للزيارة:", e);
    }
}

function debouncedSaveSingleRow(rowId) {
    if (saveTimeouts[rowId]) {
        clearTimeout(saveTimeouts[rowId]);
    }
    saveTimeouts[rowId] = setTimeout(() => { saveSingleRow(rowId); }, 600);
}

async function handleStatusChange(selectEl, rowId) {
    applyStatusColor(selectEl);
    debouncedSaveSingleRow(rowId);
}

function applyStatusColor(selectEl) {
    if (!selectEl) return;
    selectEl.className = 'excel-input status-select';
    const val = selectEl.value;
    if (val === 'تأهيل لفرصة') selectEl.classList.add('status-green');
    else if (val === 'متابعة') selectEl.classList.add('status-yellow-fff');
    else if (val === 'عرض سعر') selectEl.classList.add('status-yellow-ffc');
    else if (val === 'غير مهتم') selectEl.classList.add('status-gray-a5');
    else if (val === 'فقدان') selectEl.classList.add('status-red-c00');
    
    const tr = selectEl.closest('tr');
    if (tr) {
        if (val === 'غير مهتم' || val === 'فقدان') {
            tr.classList.add('closed-row');
        } else {
            tr.classList.remove('closed-row');
        }
    }
}

function toggleSubTable(rowId) {
    const subRow = document.getElementById('sub-' + rowId);
    const mainRow = document.getElementById(rowId);
    if (!subRow || !mainRow) return;
    const arrow = mainRow.querySelector('.toggle-arrow i');
    if (subRow.style.display === 'none' || !subRow.style.display) {
        subRow.style.display = 'table-row';
        if (arrow) arrow.className = 'fas fa-caret-down';
    } else {
        subRow.style.display = 'none';
        if (arrow) arrow.className = 'fas fa-caret-left';
    }
}

// ==========================================
// إدارة الملاحظات والنافذة المنبثقة
// ==========================================
window.openNote = function(el) {
    currentActivePreview = el;
    const modal = document.getElementById('noteModal');
    const historyLog = document.getElementById('historyLog');
    const textarea = document.getElementById('modalTextArea');
    if (textarea) textarea.value = '';
    
    let notesJson = el.getAttribute('data-full-notes') || '[]';
    try {
        const parsed = JSON.parse(notesJson);
        if (Array.isArray(parsed)) {
            historyLog.innerHTML = parsed.map((n, idx) => `
                <div class="note-item">
                    <div class="note-header">
                        <div class="note-meta">
                            <span class="note-user"><i class="fas fa-user-circle"></i> ${escapeHTML(n.user || 'مستخدم')}</span>
                            <span><i class="fas fa-clock"></i> ${escapeHTML(n.date || '')}</span>
                        </div>
                        <i class="fas fa-trash-alt delete-note-btn" onclick="deleteNoteItem(${idx})" title="حذف الملاحظة"></i>
                    </div>
                    <div class="note-body">${escapeHTML(n.text || '')}</div>
                </div>
            `).join('') || '<div style="color:var(--text-muted); text-align:center;">لا توجد ملاحظات سابقة</div>';
        }
    } catch(e) {
        historyLog.innerHTML = '<div style="color:var(--text-muted); text-align:center;">لا توجد ملاحظات سابقة</div>';
    }
    if (modal) modal.style.display = 'flex';
};

window.closeNote = function() {
    const modal = document.getElementById('noteModal');
    if (modal) modal.style.display = 'none';
    currentActivePreview = null;
};

window.saveNote = function() {
    if (!currentActivePreview) return;
    const textarea = document.getElementById('modalTextArea');
    const text = textarea.value.trim();
    if (!text) return;

    let notesJson = currentActivePreview.getAttribute('data-full-notes') || '[]';
    let arr = [];
    try { arr = JSON.parse(notesJson); if (!Array.isArray(arr)) arr = []; } catch(e) { arr = []; }

    const today = getTodayFormatted();
    const time = getTimeFormatted();
    arr.push({
        text: text,
        date: `${today} ${time}`,
        user: 'مستخدم النظام'
    });

    const newJson = JSON.stringify(arr);
    currentActivePreview.setAttribute('data-full-notes', newJson);
    currentActivePreview.innerText = getLastNoteOnlyFromJSON(newJson);

    const mainRow = currentActivePreview.closest('tr.main-row');
    if (mainRow) {
        updateEditDateField(mainRow);
        debouncedSaveSingleRow(mainRow.id);
        localStorage.setItem('visit_notes_local_' + mainRow.id, newJson);
    }

    addToActivityLog('ملاحظة', 'إضافة ملاحظة جديدة', text, mainRow ? mainRow.cells[1].querySelector('input').value : '');
    closeNote();
};

window.deleteNoteItem = function(idx) {
    if (!currentActivePreview) return;
    let notesJson = currentActivePreview.getAttribute('data-full-notes') || '[]';
    let arr = [];
    try { arr = JSON.parse(notesJson); } catch(e) { return; }
    arr.splice(idx, 1);
    const newJson = JSON.stringify(arr);
    currentActivePreview.setAttribute('data-full-notes', newJson);
    currentActivePreview.innerText = getLastNoteOnlyFromJSON(newJson);
    
    const mainRow = currentActivePreview.closest('tr.main-row');
    if (mainRow) {
        updateEditDateField(mainRow);
        debouncedSaveSingleRow(mainRow.id);
        localStorage.setItem('visit_notes_local_' + mainRow.id, newJson);
    }
    window.openNote(currentActivePreview);
};

// ==========================================
// سجل النشاط والإحصائيات
// ==========================================
function addToActivityLog(action, oldVal, newVal, company) {
    if (oldVal === newVal && action !== 'إجراء') return;
    const logItem = {
        date: `${getTodayFormatted()} ${getTimeFormatted()}`,
        action: action,
        oldVal: oldVal || '',
        newVal: newVal || '',
        company: company || 'عام'
    };
    activityLogs.unshift(logItem);
    if (activityLogs.length > 50) activityLogs.pop();
    localStorage.setItem(LOGS_KEY, JSON.stringify(activityLogs));
    renderActivityLog();
}

function renderActivityLog() {
    const listEl = document.getElementById('activityList');
    if (!listEl) return;
    if (activityLogs.length === 0) {
        listEl.innerHTML = `<div style="color:var(--text-muted); text-align:center; padding:10px; font-size:9px;">لا توجد أنشطة مسجلة بعد</div>`;
        return;
    }
    listEl.innerHTML = activityLogs.slice(0, 30).map(log => `
        <div class="log-entry">
            <div class="log-header-info">
                <span><i class="fas fa-clock"></i> ${log.date}</span>
                <span class="log-sep">|</span>
                <span style="color:var(--accent-blue);">${escapeHTML(log.company)}</span>
            </div>
            <span class="log-sep">›</span>
            <span class="log-action">تم التعديل على <b>${escapeHTML(log.action)}</b> من (${escapeHTML(log.oldVal)}) إلى (${escapeHTML(log.newVal)})</span>
        </div>
    `).join('');
}

window.toggleLogExpansion = function() {
    const section = document.getElementById('activityLogSection');
    const btn = document.getElementById('toggleExpandBtn');
    if (section) {
        section.classList.toggle('expanded');
        if (section.classList.contains('expanded')) {
            btn.innerHTML = '<i class="fas fa-compress-alt"></i>';
        } else {
            btn.innerHTML = '<i class="fas fa-expand-alt"></i>';
        }
    }
};

function updateStats() {
    const total = visitsDataArray.length;
    let monthCount = 0;
    let todayCount = 0;
    let totalValue = 0;
    let monthValue = 0;

    const today = getTodayFormatted();
    const d = new Date();
    const currentMonth = String(d.getMonth() + 1).padStart(2, '0');
    const currentYear = d.getFullYear();

    visitsDataArray.forEach(v => {
        const val = parseFloat(v.oppValue) || 0;
        totalValue += val;

        const vDate = v.visitDate || '';
        const parsed = parseDate(vDate);
        if (!isNaN(parsed.getTime())) {
            const m = String(parsed.getMonth() + 1).padStart(2, '0');
            const y = parsed.getFullYear();
            if (m === currentMonth && y === currentYear) {
                monthCount++;
                monthValue += val;
            }
        }

        if (formatAsDDMMYYYY(vDate) === today || vDate === today) {
            todayCount++;
        }
    });

    const elTotal = document.getElementById('stat-total');
    const elMonth = document.getElementById('stat-month');
    const elToday = document.getElementById('stat-today');
    const elValTotal = document.getElementById('stat-value-total');
    const elValMonth = document.getElementById('stat-value-month');

    if (elTotal) elTotal.innerText = total;
    if (elMonth) elMonth.innerText = monthCount;
    if (elToday) elToday.innerText = todayCount;
    if (elValTotal) elValTotal.innerText = totalValue.toLocaleString();
    if (elValMonth) elValMonth.innerText = monthValue.toLocaleString();
}

// ==========================================
// الإجراءات الجماعية والبحث والتصفية والتقويم
// ==========================================
window.toggleAllCheckboxes = function(master) {
    document.querySelectorAll('#tableBody .select-check').forEach(chk => {
        chk.checked = master.checked;
    });
};

window.toggleDropdown = function(e, btn) {
    e.stopPropagation();
    const dropdown = btn.nextElementSibling;
    document.querySelectorAll('.dropdown-menu').forEach(d => {
        if (d !== dropdown) d.classList.remove('show');
    });
    if (dropdown) dropdown.classList.toggle('show');
};

window.handleBulkAction = function(action) {
    pendingBulkAction = action;
    const selected = Array.from(document.querySelectorAll('#tableBody .select-check:checked')).map(chk => chk.closest('tr.main-row').id);
    if (selected.length === 0) {
        Swal.fire('تنبيه', 'يرجى تحديد زيارة واحدة على الأقل', 'warning');
        return;
    }

    if (action === 'حذف') {
        const msg = document.getElementById('deleteModalMessage');
        if (msg) msg.innerText = `هل أنت متأكد من رغبتك في حذف ${selected.length} زيارة محددة؟`;
        const modal = document.getElementById('deleteModal');
        if (modal) modal.style.display = 'flex';
    } else if (action === 'تغيير المالك') {
        Swal.fire({
            title: 'تحديد المالك الجديد',
            input: 'text',
            inputPlaceholder: 'أدخل اسم المالك...',
            showCancelButton: true,
            confirmButtonText: 'تحديث',
            cancelButtonText: 'إلغاء'
        }).then(async (result) => {
            if (result.isConfirmed && result.value) {
                const newOwner = result.value;
                const batch = writeBatch(db);
                selected.forEach(id => {
                    const row = document.getElementById(id);
                    if (row) {
                        const ownerInput = row.cells[13].querySelector('input');
                        if (ownerInput) ownerInput.value = newOwner;
                        batch.set(doc(db, "visits", id), { owner: newOwner }, { merge: true });
                    }
                });
                await batch.commit();
                Swal.fire('تم', 'تم تحديث المالك بنجاح', 'success');
            }
        });
    } else if (action === 'تصدير') {
        Swal.fire('تصدير', 'تم تصدير البيانات بنجاح', 'success');
    } else if (action === 'طباعة') {
        window.print();
    }
};

window.closeDeleteModal = function() {
    const modal = document.getElementById('deleteModal');
    if (modal) modal.style.display = 'none';
    pendingBulkAction = '';
};

window.confirmDelete = async function() {
    const selected = Array.from(document.querySelectorAll('#tableBody .select-check:checked')).map(chk => chk.closest('tr.main-row').id);
    closeDeleteModal();
    if (selected.length === 0) return;

    try {
        const batch = writeBatch(db);
        selected.forEach(id => {
            batch.delete(doc(db, "visits", id));
            const mainRow = document.getElementById(id);
            const subRow = document.getElementById('sub-' + id);
            if (mainRow) mainRow.remove();
            if (subRow) subRow.remove();
        });
        await batch.commit();
        addToActivityLog('حذف', 'زيارات', `حذف ${selected.length} زيارة`, 'مجموعة');
        Swal.fire('تم', 'تم حذف العناصر المحددة بنجاح', 'success');
    } catch(e) {
        console.error("خطأ في الحذف الجماعي:", e);
        Swal.fire('خطأ', 'تعذر حذف العناصر', 'error');
    }
};

window.debouncedFilterTable = function() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => { filterTable(); }, 300);
};

function filterTable() {
    const input = document.getElementById('searchInput');
    if (!input) return;
    const filter = input.value.toLowerCase();
    document.querySelectorAll('#tableBody tr.main-row').forEach(row => {
        const comp = row.cells[1].querySelector('input')?.value.toLowerCase() || '';
        const address = row.cells[2].querySelector('input')?.value.toLowerCase() || '';
        const mgr = row.cells[3].querySelector('input')?.value.toLowerCase() || '';
        const mob = row.cells[4].querySelector('input')?.value.toLowerCase() || '';
        const owner = row.cells[13].querySelector('input')?.value.toLowerCase() || '';
        
        const subRow = document.getElementById('sub-' + row.id);
        let matchSub = false;
        if (subRow) {
            subRow.querySelectorAll('.product-body tr').forEach(pRow => {
                const pType = pRow.cells[0].querySelector('select')?.value.toLowerCase() || '';
                const pDesc = pRow.cells[1].querySelector('input')?.value.toLowerCase() || '';
                if (pType.includes(filter) || pDesc.includes(filter)) matchSub = true;
            });
        }

        if (comp.includes(filter) || address.includes(filter) || mgr.includes(filter) || mob.includes(filter) || owner.includes(filter) || matchSub) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
            if (subRow) subRow.style.display = 'none';
        }
    });
}

window.openDatePicker = function(rowId) {
    currentPickerRowId = rowId;
    const overlay = document.getElementById('customDatePicker');
    if (overlay) overlay.classList.add('active');
    initCalendarSelects();
};

window.closeDatePicker = function() {
    const overlay = document.getElementById('customDatePicker');
    if (overlay) overlay.classList.remove('active');
    currentPickerRowId = null;
};

window.setTodayDate = function() {
    if (!currentPickerRowId) return;
    const today = getTodayFormatted();
    applyDateToRow(currentPickerRowId, today);
    closeDatePicker();
};

function applyDateToRow(rowId, dateStr) {
    const row = document.getElementById(rowId);
    if (!row) return;
    const formatted = formatAsDDMMYYYY(dateStr);
    const dateInput = row.cells[7].querySelector('input.excel-input');
    if (dateInput) dateInput.value = formatted;
    const hiddenVal = row.querySelector('.visit-date-val');
    if (hiddenVal) hiddenVal.value = dateStr;
    updateEditDateField(row);
    debouncedSaveSingleRow(rowId);
}

function initCalendarSelects() {
    const monthSelect = document.getElementById('dpMonth');
    const yearSelect = document.getElementById('dpYear');
    const daysGrid = document.getElementById('dpDays');
    if (!monthSelect || !yearSelect || !daysGrid) return;

    const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    const d = new Date();
    const curMonth = d.getMonth();
    const curYear = d.getFullYear();

    if (monthSelect.children.length === 0) {
        monthSelect.innerHTML = months.map((m, i) => `<option value="${i}" ${i === curMonth ? 'selected' : ''}>${m}</option>`).join('');
        let yearsHTML = '';
        for (let y = curYear - 5; y <= curYear + 5; y++) {
            yearsHTML += `<option value="${y}" ${y === curYear ? 'selected' : ''}>${y}</option>`;
        }
        yearSelect.innerHTML = yearsHTML;

        monthSelect.addEventListener('change', renderCalendarDays);
        yearSelect.addEventListener('change', renderCalendarDays);
    }
    renderCalendarDays();
}

function renderCalendarDays() {
    const monthSelect = document.getElementById('dpMonth');
    const yearSelect = document.getElementById('dpYear');
    const daysGrid = document.getElementById('dpDays');
    if (!monthSelect || !yearSelect || !daysGrid) return;

    const m = parseInt(monthSelect.value);
    const y = parseInt(yearSelect.value);
    daysGrid.innerHTML = '';

    const firstDay = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();

    for (let i = 0; i < firstDay; i++) {
        daysGrid.appendChild(document.createElement('div'));
    }

    const todayObj = new Date();
    const todayStr = String(todayObj.getDate()).padStart(2, '0') + '-' + String(todayObj.getMonth() + 1).padStart(2, '0') + '-' + todayObj.getFullYear();

    for (let day = 1; day <= daysInMonth; day++) {
        const dayDiv = document.createElement('div');
        dayDiv.className = 'day-number';
        dayDiv.innerText = day;
        const dateStr = String(day).padStart(2, '0') + '-' + String(m + 1).padStart(2, '0') + '-' + y;
        const formattedDate = formatAsDDMMYYYY(dateStr);

        if (dateStr === todayStr || formattedDate === todayStr) {
            dayDiv.classList.add('today-day');
        }

        dayDiv.addEventListener('click', () => {
            if (currentPickerRowId) {
                applyDateToRow(currentPickerRowId, dateStr);
                closeDatePicker();
            }
        });
        daysGrid.appendChild(dayDiv);
    }
}

window.openWhatsAppChat = function(el) {
    const row = el.closest('tr.main-row');
    if (!row) return;
    const mobInput = row.cells[4].querySelector('input');
    if (!mobInput) return;
    let mob = mobInput.value.replace(/[^0-9]/g, '');
    if (!mob) {
        Swal.fire('تنبيه', 'رقم التواصل غير متوفر', 'warning');
        return;
    }
    if (mob.startsWith('0')) mob = '966' + mob.substring(1);
    window.open(`https://wa.me/${mob}`, '_blank');
};

// ==========================================
// التهيئة عند تحميل الصفحة و نظام البحث الشامل
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initDarkMode();
    if(typeof listenToVisits === 'function') listenToVisits();

    const searchInput = document.getElementById('globalSearchInput');
    const searchResults = document.getElementById('searchResults');

    const getSystemData = () => {
        return {
            visits: JSON.parse(localStorage.getItem('crm_visits') || '[]'),
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
                    const company = (item.company || item.الشركة || '').toString();
                    const responsible = (item.responsible || item.المسؤول || '').toString();
                    const phone = (item.phone || item.رقم_التواصل || '').toString();
                    const email = (item.email || item.البريد_الإلكتروني || '').toString();
                    const masterRecord = (item.masterRecord || item.السجل_الرئيسي || '').toString();
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

            renderResults(matches);
        });
    }

    function renderResults(results) {
        if (results.length === 0) {
            searchResults.innerHTML = `<div class="search-no-results"><i class="fas fa-exclamation-circle"></i> لا توجد نتائج مطابقة</div>`;
        } else {
            searchResults.innerHTML = results.map(item => {
                const meta = pageMeta[item.pageKey];
                const targetUrl = `${meta.url}?id=${encodeURIComponent(item.id || item.customerCode || item.orderNumber)}`;

                return `
                    <a href="${targetUrl}" class="search-result-item">
                        <div class="result-header">
                            <span class="result-title">${item.company || 'بدون اسم شركة'}</span>
                            <span class="result-badge ${meta.badgeClass}">${meta.title}</span>
                        </div>
                        <div class="result-details">
                            ${item.responsible ? `<span><i class="fas fa-user"></i> ${item.responsible}</span>` : ''}
                            ${item.customerCode ? `<span><i class="fas fa-id-badge"></i> كود: ${item.customerCode}</span>` : ''}
                            ${item.orderNumber ? `<span><i class="fas fa-file-invoice"></i> طلب: ${item.orderNumber}</span>` : ''}
                            ${item.phone ? `<span><i class="fas fa-phone"></i> ${item.phone}</span>` : ''}
                        </div>
                    </a>
                `;
            }).join('');
        }
        searchResults.classList.add('show');
    }

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.nav-search-container') && searchResults) {
            searchResults.classList.remove('show');
        }
        document.querySelectorAll('.dropdown-menu').forEach(d => d.classList.remove('show'));
    });
});