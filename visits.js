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
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
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

function getLastNoteOnlyFromJSON(notesJson) {
    try {
        const arr = JSON.parse(notesJson || "[]");
        if (Array.isArray(arr) && arr.length > 0) {
            const last = arr[arr.length - 1];
            return last.text || last.note || '';
        }
    } catch(e) {
        if (typeof notesJson === 'string' && notesJson.trim() !== '' && notesJson !== '[]') return notesJson;
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
window.updateEditDateField = updateEditDateField;

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
window.insertNewRow = insertNewRow;

function listenToVisits() {
    const visitsRef = collection(db, "visits");
    onSnapshot(visitsRef, (snapshot) => {
        const tbody = document.getElementById('tableBody');
        if (!tbody) return;

        let needsFullRender = false;
        snapshot.docChanges().forEach((change) => {
            const data = change.doc.data();
            data.id = change.doc.id;
            if (change.type === "added") { visitsDataArray.push(data); needsFullRender = true; }
            if (change.type === "modified") {
                const index = visitsDataArray.findIndex(v => v.id === data.id);
                if (index !== -1) { visitsDataArray[index] = data; updateRowDOM(data); }
            }
            if (change.type === "removed") {
                visitsDataArray = visitsDataArray.filter(v => v.id !== data.id);
                needsFullRender = true;
            }
        });

        localStorage.setItem('crm_visits', JSON.stringify(visitsDataArray.map(v => ({ id: v.id, company: v.comp || '', responsible: v.mgr || '', phone: v.mob || '', email: v.email || '', record: v.record || '' }))));

        if (needsFullRender || isInitialLoad) { fullTableRender(); isInitialLoad = false; }
        updateStats(); renderActivityLog();
    }, (error) => { console.error("مشكلة في مزامنة الزيارات من السحابة:", error); });
}

function updateRowDOM(v) {
    const mainRow = document.getElementById(v.id);
    if (!mainRow) return;

    const safeUpdate = (selector, newVal) => {
        const el = mainRow.querySelector(selector);
        if (el && document.activeElement !== el) {
            if (el.tagName === 'INPUT' || el.tagName === 'SELECT') { el.value = newVal; el.dataset.old = newVal; } 
            else { el.innerHTML = newVal; }
        }
    };

    safeUpdate('td:nth-child(2) input', v.comp || '');
    safeUpdate('td:nth-child(3) input', v.address || '');
    safeUpdate('td:nth-child(4) input', v.mgr || '');
    safeUpdate('td:nth-child(5) input', v.mob || '');
    safeUpdate('td:nth-child(6) input', v.email || '');
    safeUpdate('td:nth-child(7) input', v.record || '');
    
    const visitDate = formatAsDDMMYYYY(v.visitDate || getTodayFormatted());
    safeUpdate('.visit-date-val', visitDate);
    safeUpdate('td:nth-child(8) input.readonly-input', visitDate);
    
    safeUpdate('.cur-serv-val', v.curServ || '');
    safeUpdate('.opp-value-input', v.oppValue || '');
    
    const statusSelect = mainRow.querySelector('.status-select');
    if (statusSelect && document.activeElement !== statusSelect) {
        statusSelect.value = v.status || ''; statusSelect.dataset.old = v.status || ''; applyStatusColor(statusSelect);
    }
    safeUpdate('td:nth-child(14) input', v.owner || '');
    
    const hiddenEditDate = mainRow.querySelector('.edit-date-val');
    if (hiddenEditDate) hiddenEditDate.value = v.editDate || '';
    const editMains = mainRow.querySelector('.edit-date-container-main');
    if (editMains) editMains.innerHTML = parseEditDateHTML(v.editDate || '');

    let notesJson = v.notes || "[]";
    const noteEl = mainRow.querySelector('.notes-preview');
    if (noteEl) { noteEl.setAttribute('data-full-notes', notesJson); noteEl.innerText = getLastNoteOnlyFromJSON(notesJson); }

    const subRow = document.getElementById('sub-' + v.id);
    if (subRow && !subRow.contains(document.activeElement)) {
         const tbody = subRow.querySelector('.product-body');
         tbody.innerHTML = '';
         if (v.products && v.products.length > 0) v.products.forEach(p => addProductRow(v.id, p));
         else addProductRow(v.id);
         const subEditContainer = subRow.querySelector('.edit-date-container-sub');
         if (subEditContainer) subEditContainer.innerHTML = parseEditDateHTML(v.editDate || '');
    }
}

function fullTableRender() {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;

    const expandedSubTables = new Set();
    document.querySelectorAll('.sub-table-row').forEach(row => { if (row.style.display === 'table-row') expandedSubTables.add(row.id); });

    tbody.innerHTML = '';
    
    visitsDataArray.sort((a, b) => parseDate(b.visitDate) - parseDate(a.visitDate));
    
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
}

function renderRow(v = {}) {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;
    
    const rowId = v.id || ('row-' + Date.now());
    const mainRow = document.createElement('tr'); mainRow.className = 'main-row'; mainRow.id = rowId;
    const subRow = document.createElement('tr'); subRow.className = 'sub-table-row'; subRow.id = 'sub-' + rowId; subRow.style.display = 'none';
    
    const visitDate = formatAsDDMMYYYY(v.visitDate || getTodayFormatted());
    let notesJson = v.notes || "[]";
    const editDateHTML = parseEditDateHTML(v.editDate || '');

    mainRow.innerHTML = `
        <td class="col-select">
            <input type="checkbox" class="select-check">
            <span class="toggle-arrow" onclick="toggleSubTable('${rowId}')"><i class="fas fa-caret-left"></i></span>
        </td>
        <td><input type="text" class="excel-input" value="${escapeHTML(v.comp || '')}" data-old="${escapeHTML(v.comp || '')}" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr'));" onchange="debouncedSaveSingleRow('${rowId}');" onblur="addToActivityLog('الشركة', this.dataset.old, this.value, this.value); this.dataset.old=this.value;"></td>
        <td><input type="text" class="excel-input" value="${escapeHTML(v.address || '')}" data-old="${escapeHTML(v.address || '')}" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr'));" onchange="debouncedSaveSingleRow('${rowId}');"></td>
        <td><input type="text" class="excel-input" value="${escapeHTML(v.mgr || '')}" data-old="${escapeHTML(v.mgr || '')}" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr'));" onchange="debouncedSaveSingleRow('${rowId}');"></td>
        <td>
            <div style="display:flex; align-items:center;">
                <a class="whatsapp-icon-btn" onclick="openWhatsAppChat(this)" title="مراسلة عبر واتساب"><i class="fa-brands fa-whatsapp"></i></a>
                <input type="text" class="excel-input" value="${escapeHTML(v.mob || '')}" data-old="${escapeHTML(v.mob || '')}" oninput="this.value = this.value.replace(/[^0-9]/g, '');" onkeyup="updateEditDateField(this.closest('tr'));" onchange="debouncedSaveSingleRow('${rowId}');">
            </div>
        </td>
        <td><input type="text" class="excel-input" value="${escapeHTML(v.email || '')}" data-old="${escapeHTML(v.email || '')}" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr'));" onchange="debouncedSaveSingleRow('${rowId}');"></td>
        <td><input type="text" class="excel-input" value="${escapeHTML(v.record || '')}" data-old="${escapeHTML(v.record || '')}" oninput="this.value = this.value.replace(/[^0-9]/g, '');" onkeyup="updateEditDateField(this.closest('tr'));" onchange="debouncedSaveSingleRow('${rowId}');"></td>
        <td>
            <input type="text" dir="ltr" class="excel-input readonly-input" value="${visitDate}" style="cursor: pointer;" readonly onclick="openDatePicker('${rowId}')">
            <input type="hidden" class="visit-date-val opp-date-val" value="${visitDate}">
        </td>
        <td><input type="text" class="excel-input cur-serv-val" value="${escapeHTML(v.curServ || '')}" data-old="${escapeHTML(v.curServ || '')}" onkeyup="updateEditDateField(this.closest('tr'));" onchange="debouncedSaveSingleRow('${rowId}');"></td>
        <td><input type="number" class="excel-input opp-value-input readonly-input" value="${v.oppValue || ''}" readonly style="color:var(--accent-blue); font-weight:800;"></td>
        <td><div class="notes-preview" onclick="openNote(this)" data-full-notes='${escapeHTML(notesJson)}'>${escapeHTML(getLastNoteOnlyFromJSON(notesJson))}</div></td>
        <td>
            <select class="excel-input status-select" data-old="${v.status || ''}" onchange="handleStatusChange(this, '${rowId}')">
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
        <td><div class="edit-date-container-main" style="line-height:1.2; text-align:center;">${editDateHTML}</div><input type="hidden" class="edit-date-val" value="${v.editDate || ''}"></td>
        <td><input type="text" class="excel-input" value="${escapeHTML(v.owner || '')}" data-old="${escapeHTML(v.owner || '')}" onkeyup="updateEditDateField(this.closest('tr'));" onchange="debouncedSaveSingleRow('${rowId}');"></td>
    `;

    subRow.innerHTML = `
        <td colspan="14" style="padding:15px 10px; background:#f8fafc;">
            <div style="display: flex; gap: 15px;">
                <table class="inner-table">
                    <thead><tr><th>المنتج</th><th>التفاصيل</th><th>العدد</th><th>الاشتراك</th><th>الإجمالي</th><th style="width:75px"><button class="header-plus-btn" type="button" onclick="addProductRow('${rowId}')"><i class="fas fa-plus"></i></button></th></tr></thead>
                    <tbody class="product-body"></tbody>
                </table>
                <div style="width: 250px; background: white; border: 1px solid var(--border-soft); border-radius: 8px; padding: 10px; text-align:center;">
                    <div style="font-weight:bold; margin-bottom:10px;">تاريخ التعديل:</div>
                    <div class="edit-date-container-sub">${parseEditDateHTML(v.editDate || '')}</div>
                </div>
            </div>
        </td>
    `;

    tbody.appendChild(mainRow); tbody.appendChild(subRow); 
    applyStatusColor(mainRow.querySelector('.status-select'));
    if (v.products && v.products.length > 0) v.products.forEach(p => addProductRow(rowId, p)); else addProductRow(rowId);
}

function addProductRow(rowId, data = {}) {
    const subRow = document.getElementById('sub-' + rowId);
    if (!subRow) return;
    const tbody = subRow.querySelector('.product-body');
    const row = tbody.insertRow();
    row.innerHTML = `
        <td><select onchange="updateEditDateField(this.closest('.sub-table-row').previousElementSibling); debouncedSaveSingleRow('${rowId}');"><option value="">-</option><option value="جوال" ${data.type === 'جوال' ? 'selected' : ''}>جوال</option><option value="بيانات" ${data.type === 'بيانات' ? 'selected' : ''}>بيانات</option><option value="هاتف" ${data.type === 'هاتف' ? 'selected' : ''}>هاتف</option><option value="فايبر نت" ${data.type === 'فايبر نت' ? 'selected' : ''}>فايبر نت</option></select></td>
        <td><input type="text" value="${escapeHTML(data.desc || '')}" onchange="debouncedSaveSingleRow('${rowId}');"></td>
        <td><input type="number" class="prod-qty" min="0" value="${data.qty || ''}" oninput="calculateMainVisitValue('${rowId}', false)" onchange="calculateMainVisitValue('${rowId}', true)"></td>
        <td><input type="number" class="prod-sub" min="0" value="${data.sub || ''}" oninput="calculateMainVisitValue('${rowId}', false)" onchange="calculateMainVisitValue('${rowId}', true)"></td>
        <td><input type="number" class="prod-total readonly-input" value="${data.total || ''}" readonly></td>
        <td><div style="text-align:center;"><button class="sub-action-btn" type="button" onclick="if(this.closest('tbody').rows.length > 1) { this.closest('tr').remove(); calculateMainVisitValue('${rowId}', true); }"><i class="fas fa-trash-alt"></i></button></div></td>
    `;
}
window.addProductRow = addProductRow;

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
window.calculateMainVisitValue = calculateMainVisitValue;

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

    const data = {
        comp: row.cells[1].querySelector('input').value,
        address: row.cells[2].querySelector('input').value,
        mgr: row.cells[3].querySelector('input').value,
        mob: row.cells[4].querySelector('input').value,
        email: row.cells[5].querySelector('input').value,
        record: row.cells[6].querySelector('input').value,
        visitDate: row.querySelector('.visit-date-val').value, 
        curServ: row.cells[8].querySelector('input').value,
        oppValue: row.cells[9].querySelector('input').value,
        notes: row.cells[10].querySelector('.notes-preview').getAttribute('data-full-notes') || '[]',
        status: row.cells[11].querySelector('select').value,
        editDate: row.querySelector('.edit-date-val')?.value || getTodayFormatted(),
        owner: row.cells[13].querySelector('input').value,
        products: products
    };

    try { await setDoc(doc(db, "visits", rowId), data, { merge: true }); } catch (e) { console.error("خطأ:", e); }
}

function debouncedSaveSingleRow(rowId) {
    if (saveTimeouts[rowId]) clearTimeout(saveTimeouts[rowId]);
    saveTimeouts[rowId] = setTimeout(() => { saveSingleRow(rowId); }, 600);
}
window.debouncedSaveSingleRow = debouncedSaveSingleRow;

window.handleStatusChange = async function(selectEl, rowId) {
    applyStatusColor(selectEl);
    debouncedSaveSingleRow(rowId);
};

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
        if (val === 'غير مهتم' || val === 'فقدان') tr.classList.add('closed-row');
        else tr.classList.remove('closed-row');
    }
}

window.toggleSubTable = function(rowId) {
    const subRow = document.getElementById('sub-' + rowId);
    const mainRow = document.getElementById(rowId);
    if (!subRow || !mainRow) return;
    const arrow = mainRow.querySelector('.toggle-arrow i');
    if (subRow.style.display === 'none' || !subRow.style.display) {
        subRow.style.display = 'table-row'; if (arrow) arrow.className = 'fas fa-caret-down';
    } else {
        subRow.style.display = 'none'; if (arrow) arrow.className = 'fas fa-caret-left';
    }
};

window.openNote = function(el) {
    currentActivePreview = el;
    const modal = document.getElementById('noteModal');
    const historyLog = document.getElementById('historyLog');
    document.getElementById('modalTextArea').value = '';
    
    let notesJson = el.getAttribute('data-full-notes') || '[]';
    try {
        const parsed = JSON.parse(notesJson);
        if (Array.isArray(parsed)) {
            historyLog.innerHTML = parsed.map((n, idx) => `
                <div style="background:white; padding:10px; margin-bottom:10px; border-radius:8px;">
                    <div style="display:flex; justify-content:space-between; color:#64748b; font-size:10px; margin-bottom:5px;">
                        <span>${escapeHTML(n.user || 'مستخدم')} | ${escapeHTML(n.date || '')}</span>
                        <i class="fas fa-trash-alt" style="color:#ef4444; cursor:pointer;" onclick="deleteNoteItem(${idx})"></i>
                    </div>
                    <div style="font-weight:bold;">${escapeHTML(n.text || '')}</div>
                </div>
            `).join('');
        }
    } catch(e) {}
    if (modal) modal.style.display = 'flex';
};

window.closeNote = function() {
    const modal = document.getElementById('noteModal');
    if (modal) modal.style.display = 'none';
};

window.saveNote = function() {
    if (!currentActivePreview) return;
    const text = document.getElementById('modalTextArea').value.trim();
    if (!text) return;

    let notesJson = currentActivePreview.getAttribute('data-full-notes') || '[]';
    let arr = []; try { arr = JSON.parse(notesJson); if (!Array.isArray(arr)) arr = []; } catch(e) { arr = []; }

    arr.push({ text: text, date: `${getTodayFormatted()} ${getTimeFormatted()}`, user: 'مستخدم النظام' });
    const newJson = JSON.stringify(arr);
    
    currentActivePreview.setAttribute('data-full-notes', newJson);
    currentActivePreview.innerText = getLastNoteOnlyFromJSON(newJson);

    const mainRow = currentActivePreview.closest('tr.main-row');
    if (mainRow) { updateEditDateField(mainRow); debouncedSaveSingleRow(mainRow.id); }
    closeNote();
};

window.deleteNoteItem = function(idx) {
    if (!currentActivePreview) return;
    let arr = JSON.parse(currentActivePreview.getAttribute('data-full-notes') || '[]');
    arr.splice(idx, 1);
    const newJson = JSON.stringify(arr);
    currentActivePreview.setAttribute('data-full-notes', newJson);
    currentActivePreview.innerText = getLastNoteOnlyFromJSON(newJson);
    
    const mainRow = currentActivePreview.closest('tr.main-row');
    if (mainRow) { updateEditDateField(mainRow); debouncedSaveSingleRow(mainRow.id); }
    window.openNote(currentActivePreview);
};

function addToActivityLog(action, oldVal, newVal, company) {
    if (oldVal === newVal && action !== 'إجراء') return;
    activityLogs.unshift({ date: `${getTodayFormatted()} ${getTimeFormatted()}`, action, oldVal: oldVal||'', newVal: newVal||'', company: company||'عام' });
    if (activityLogs.length > 50) activityLogs.pop();
    localStorage.setItem(LOGS_KEY, JSON.stringify(activityLogs));
    renderActivityLog();
}
window.addToActivityLog = addToActivityLog;

function renderActivityLog() {
    const listEl = document.getElementById('activityList');
    if (!listEl) return;
    listEl.innerHTML = activityLogs.slice(0, 30).map(log => `
        <div class="log-entry">
            <span style="color:#475569;">${log.date} | <b style="color:var(--accent-blue)">${escapeHTML(log.company)}</b></span>
            <span>تم التعديل على <b>${escapeHTML(log.action)}</b> من (${escapeHTML(log.oldVal)}) إلى (${escapeHTML(log.newVal)})</span>
        </div>
    `).join('');
}

window.toggleLogExpansion = function() {
    const section = document.getElementById('activityLogSection');
    if (section) section.classList.toggle('expanded');
};

function updateStats() {
    document.getElementById('stat-total').innerText = visitsDataArray.length;
    let totalValue = visitsDataArray.reduce((acc, v) => acc + (parseFloat(v.oppValue) || 0), 0);
    document.getElementById('stat-value-total').innerText = totalValue.toLocaleString();
}

// -----------------------------------------------------
// معالجة النواقص في الكود المقطوع (البحث، التقويم، واتساب)
// -----------------------------------------------------

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
        const email = row.cells[5].querySelector('input')?.value.toLowerCase() || '';
        const record = row.cells[6].querySelector('input')?.value.toLowerCase() || '';
        
        // دمج كافة النصوص للبحث الشامل في السطر الواحد
        const fullText = `${comp} ${address} ${mgr} ${mob} ${email} ${record}`;

        if (fullText.includes(filter)) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
            // إخفاء صف التفاصيل (المنتجات) الخاص به أيضاً
            const subRow = document.getElementById('sub-' + row.id);
            if (subRow) subRow.style.display = 'none';
        }
    });
}
window.filterTable = filterTable;

window.openWhatsAppChat = function(btn) {
    const row = btn.closest('tr');
    let phone = row.cells[4].querySelector('input').value.replace(/[^0-9]/g, '');
    
    if (!phone) {
        Swal.fire('تنبيه', 'لا يوجد رقم تواصل صالح للفتح في واتساب', 'warning');
        return;
    }
    
    // إضافة مفتاح الدولة (السعودية كمثال) في حال بدأ الرقم بـ 05
    if (phone.startsWith('05')) {
        phone = '966' + phone.substring(1);
    }
    
    window.open(`https://wa.me/${phone}`, '_blank');
};

// دوال التحكم بالتقويم (DatePicker) المفقودة
window.openDatePicker = function(rowId) {
    currentPickerRowId = rowId;
    const overlay = document.getElementById('customDatePicker');
    if (overlay) overlay.classList.add('active');
};

window.closeDatePicker = function() {
    currentPickerRowId = null;
    const overlay = document.getElementById('customDatePicker');
    if (overlay) overlay.classList.remove('active');
};

window.setTodayDate = function() {
    if (currentPickerRowId) {
        const row = document.getElementById(currentPickerRowId);
        if (row) {
            const today = getTodayFormatted();
            const dateInputVal = row.querySelector('.visit-date-val');
            const displayInput = row.cells[7].querySelector('input.readonly-input');
            
            if (dateInputVal) dateInputVal.value = today;
            if (displayInput) displayInput.value = formatAsDDMMYYYY(today);
            
            updateEditDateField(row);
            debouncedSaveSingleRow(currentPickerRowId);
        }
    }
    closeDatePicker();
};

// إعدادات البداية عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', () => {
    initDarkMode();
    listenToVisits();
    
    // إخفاء القوائم المنسدلة عند النقر خارجها
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.bulk-action-wrapper')) {
            document.querySelectorAll('.dropdown-menu').forEach(d => d.classList.remove('show'));
        }
    });
});