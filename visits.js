// ==========================================
// visits.js - إدارة الزيارات سحابياً ومحلياً 
// ==========================================
import { db } from './firebase-config.js';
import { collection, onSnapshot, doc, setDoc, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

let visitsDataArray = [];
let activityLogs = JSON.parse(localStorage.getItem('asgate_visits_logs_v1') || '[]');
let isInitialLoad = true;
let currentPickerRowId = null;
let currentNoteRowId = null;
let pendingDeleteRowId = null;
let pendingBulkAction = '';
let pendingBulkIds = [];
const saveTimeouts = {};
let searchTimeout = null;

// تهيئة العناصر والأحداث عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', () => {
    initDarkMode();
    listenToVisits();
    initGlobalSearch();

    // إغلاق القوائم المنسدلة عند النقر في أي مكان خارجها
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.bulk-action-wrapper')) {
            document.querySelectorAll('.dropdown-menu.show').forEach(m => m.classList.remove('show'));
        }
    });
});

// ------------------------------------------
// 1. الوضع الليلي والمساعدات (Helpers)
// ------------------------------------------
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

// ------------------------------------------
// 2. القوائم والإجراءات الجماعية (Bulk Actions)
// ------------------------------------------
function toggleDropdown(event, element) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    const wrapper = element.closest('.bulk-action-wrapper');
    const dropdown = wrapper ? wrapper.querySelector('.dropdown-menu') : null;
    if (!dropdown) return;
    
    document.querySelectorAll('.dropdown-menu.show').forEach(menu => {
        if (menu !== dropdown) menu.classList.remove('show');
    });

    dropdown.classList.toggle('show');
}
window.toggleDropdown = toggleDropdown;

function handleBulkAction(action) {
    document.querySelectorAll('.dropdown-menu.show').forEach(menu => menu.classList.remove('show'));
    
    const selectedCheckboxes = document.querySelectorAll('#tableBody .select-check:checked');
    if (selectedCheckboxes.length === 0) {
        Swal.fire({ title: 'تنبيه', text: 'يرجى تحديد عنصر واحد على الأقل', icon: 'warning', confirmButtonText: 'حسناً' });
        return;
    }

    const selectedIds = Array.from(selectedCheckboxes).map(cb => cb.closest('tr').id);

    if (action === 'حذف') {
        pendingBulkAction = 'bulk_delete';
        pendingBulkIds = selectedIds;
        const msg = document.getElementById('deleteModalMessage');
        if (msg) msg.innerText = `هل أنت متأكد من رغبتك في حذف ${selectedIds.length} عنصر/عناصر؟`;
        const modal = document.getElementById('deleteModal');
        if (modal) modal.style.display = 'flex';
    } else if (action === 'تغيير المالك') {
        Swal.fire({
            title: 'تغيير المالك',
            input: 'text',
            inputPlaceholder: 'أدخل اسم المالك الجديد',
            showCancelButton: true,
            confirmButtonText: 'حفظ',
            cancelButtonText: 'إلغاء'
        }).then(async (result) => {
            if (result.isConfirmed && result.value) {
                try {
                    const batch = writeBatch(db);
                    selectedIds.forEach(id => {
                        const docRef = doc(db, "visits", id);
                        batch.update(docRef, { owner: result.value });
                    });
                    await batch.commit();
                    addToActivityLog('إجراء جماعي', 'تغيير المالك', '', `تم تغيير المالك لعدد ${selectedIds.length} عنصر إلى ${result.value}`);
                    Swal.fire('تم', 'تم تحديث المالك بنجاح', 'success');
                } catch (e) {
                    console.error("خطأ في تحديث المالك الجماعي:", e);
                    Swal.fire('خطأ', 'تعذر تحديث المالك', 'error');
                }
            }
        });
    } else if (action === 'طباعة') {
        window.print();
    } else if (action === 'تصدير') {
        Swal.fire('تصدير', 'جاري تجهيز بيانات الزيارات للتحميل...', 'info');
    }
}
window.handleBulkAction = handleBulkAction;

function toggleAllCheckboxes(master) {
    const checkboxes = document.querySelectorAll('#tableBody .select-check');
    checkboxes.forEach(cb => cb.checked = master.checked);
}
window.toggleAllCheckboxes = toggleAllCheckboxes;

// ------------------------------------------
// 3. التفاعل مع قاعدة بيانات Firebase
// ------------------------------------------
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

function debouncedSaveSingleRow(rowId) {
    if (saveTimeouts[rowId]) clearTimeout(saveTimeouts[rowId]);
    saveTimeouts[rowId] = setTimeout(() => saveSingleRow(rowId), 800);
}
window.debouncedSaveSingleRow = debouncedSaveSingleRow;

async function saveSingleRow(rowId) {
    const tr = document.getElementById(rowId);
    if (!tr) return;

    const subRow = document.getElementById('sub-' + rowId);
    const products = [];
    if (subRow) {
        subRow.querySelectorAll('.product-body tr').forEach(pRow => {
            const pInputs = pRow.querySelectorAll('input, select');
            if (pInputs.length >= 3) {
                products.push({
                    name: pInputs[0].value,
                    val: pInputs[1].value,
                    type: pInputs[2].value
                });
            }
        });
    }

    const editDateInput = tr.querySelector('.edit-date-val');
    const updatedVisit = {
        comp: tr.querySelector('td:nth-child(2) input')?.value || '',
        address: tr.querySelector('td:nth-child(3) input')?.value || '',
        mgr: tr.querySelector('td:nth-child(4) input')?.value || '',
        mob: tr.querySelector('td:nth-child(5) input')?.value || '',
        email: tr.querySelector('td:nth-child(6) input')?.value || '',
        record: tr.querySelector('td:nth-child(7) input')?.value || '',
        visitDate: tr.querySelector('.visit-date-val')?.value || getTodayFormatted(),
        curServ: tr.querySelector('.cur-serv-val')?.value || '',
        oppValue: tr.querySelector('.opp-value-input')?.value || '0',
        status: tr.querySelector('.status-select')?.value || '',
        owner: tr.querySelector('td:nth-child(14) input')?.value || '',
        editDate: editDateInput?.value || `${getTodayFormatted()} ${getTimeFormatted()}`,
        notes: tr.querySelector('.notes-preview')?.getAttribute('data-full-notes') || '[]',
        products: products
    };

    try {
        await setDoc(doc(db, "visits", rowId), updatedVisit, { merge: true });
    } catch (e) {
        console.error("خطأ أثناء حفظ الزيارة:", e);
    }
}
window.saveSingleRow = saveSingleRow;

// ------------------------------------------
// 4. عرض الجداول والصفوف (Rendering)
// ------------------------------------------
function updateRowDOM(v) {
    const mainRow = document.getElementById(v.id);
    if (!mainRow) return;

    mainRow.classList.remove('row-uninterested', 'row-lost');
    if (v.status === 'غير مهتم') mainRow.classList.add('row-uninterested');
    else if (v.status === 'فقدان') mainRow.classList.add('row-lost');

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
         if (tbody) {
             tbody.innerHTML = '';
             if (v.products && v.products.length > 0) v.products.forEach(p => addProductRow(v.id, p));
             else addProductRow(v.id);
         }
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
            const arrow = document.querySelector(`#${mainRowId} .toggle-arrow`);
            if (arrow) arrow.classList.add('arrow-open');
        }
    });
}

function renderRow(v = {}) {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;
    
    const rowId = v.id || ('visit_' + Date.now());
    const mainRow = document.createElement('tr'); mainRow.className = 'main-row'; mainRow.id = rowId;
    if (v.status === 'غير مهتم') mainRow.classList.add('row-uninterested');
    else if (v.status === 'فقدان') mainRow.classList.add('row-lost');

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
            <div class="phone-cell-container">
                <input type="text" class="excel-input" value="${escapeHTML(v.mob || '')}" data-old="${escapeHTML(v.mob || '')}" onkeyup="updateEditDateField(this.closest('tr'));" onchange="debouncedSaveSingleRow('${rowId}');">
                <a class="whatsapp-icon-btn" onclick="window.open('https://wa.me/'+'${v.mob || ''}'.replace(/[^0-9]/g,''),'_blank')" title="واتساب"><i class="fab fa-whatsapp"></i></a>
            </div>
        </td>
        <td><input type="text" class="excel-input" value="${escapeHTML(v.email || '')}" data-old="${escapeHTML(v.email || '')}" onkeyup="updateEditDateField(this.closest('tr'));" onchange="debouncedSaveSingleRow('${rowId}');"></td>
        <td><input type="text" class="excel-input" value="${escapeHTML(v.record || '')}" data-old="${escapeHTML(v.record || '')}" onkeyup="updateEditDateField(this.closest('tr'));" onchange="debouncedSaveSingleRow('${rowId}');"></td>
        <td>
            <input type="text" class="excel-input readonly-input" value="${escapeHTML(visitDate)}" readonly onclick="openDatePicker('${rowId}')">
            <input type="hidden" class="visit-date-val" value="${escapeHTML(visitDate)}">
        </td>
        <td><input type="text" class="excel-input cur-serv-val" value="${escapeHTML(v.curServ || '')}" onkeyup="updateEditDateField(this.closest('tr'));" onchange="debouncedSaveSingleRow('${rowId}');"></td>
        <td><input type="number" class="excel-input opp-value-input" value="${escapeHTML(v.oppValue || '0')}" onkeyup="updateEditDateField(this.closest('tr'));" onchange="debouncedSaveSingleRow('${rowId}');"></td>
        <td><span class="notes-preview" data-full-notes='${notesJson}' onclick="openNoteModal('${rowId}')">${escapeHTML(getLastNoteOnlyFromJSON(notesJson))}</span></td>
        <td>
            <select class="excel-input status-select" data-old="${escapeHTML(v.status || '')}" onchange="handleStatusChange(this, '${rowId}')">
                <option value="">اختر...</option>
                <option value="تأهيل لفرصة" ${v.status === 'تأهيل لفرصة' ? 'selected' : ''}>تأهيل لفرصة</option>
                <option value="متابعة" ${v.status === 'متابعة' ? 'selected' : ''}>متابعة</option>
                <option value="عرض سعر" ${v.status === 'عرض سعر' ? 'selected' : ''}>عرض سعر</option>
                <option value="غير مهتم" ${v.status === 'غير مهتم' ? 'selected' : ''}>غير مهتم</option>
                <option value="فقدان" ${v.status === 'فقدان' ? 'selected' : ''}>فقدان</option>
            </select>
        </td>
        <td>
            <div class="edit-date-container edit-date-container-main">${editDateHTML}</div>
            <input type="hidden" class="edit-date-val" value="${escapeHTML(v.editDate || '')}">
        </td>
        <td><input type="text" class="excel-input" value="${escapeHTML(v.owner || '')}" onkeyup="updateEditDateField(this.closest('tr'));" onchange="debouncedSaveSingleRow('${rowId}');"></td>
    `;

    subRow.innerHTML = `
        <td colspan="14" class="sub-table-container">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div class="inner-table">
                    <table>
                        <thead>
                            <tr>
                                <th>اسم المنتج / الخدمة</th>
                                <th>القيمة المتوقعة</th>
                                <th>النوع</th>
                                <th><button class="header-plus-btn" onclick="addProductRow('${rowId}')">+</button></th>
                            </tr>
                        </thead>
                        <tbody class="product-body"></tbody>
                    </table>
                </div>
                <div style="text-align:left;">
                    <button class="sub-action-btn" onclick="openDeleteModal('${rowId}')" title="حذف الزيارة"><i class="fas fa-trash-alt"></i></button>
                </div>
            </div>
        </td>
    `;

    tbody.appendChild(mainRow);
    tbody.appendChild(subRow);

    const statusSel = mainRow.querySelector('.status-select');
    if (statusSel) applyStatusColor(statusSel);

    if (v.products && v.products.length > 0) {
        v.products.forEach(p => addProductRow(rowId, p));
    } else {
        addProductRow(rowId);
    }
}

// دالة لمعالجة تغيير الحالة مع ميزة نقل الزيارة للفرص
async function handleStatusChange(selectEl, rowId) {
    const oldVal = selectEl.dataset.old;
    const newVal = selectEl.value;
    
    applyStatusColor(selectEl);
    updateEditDateField(selectEl.closest('tr'));
    
    if (newVal === 'تأهيل لفرصة') {
        Swal.fire({
            title: 'تأكيد النقل',
            text: 'هل تريد نقل هذه الزيارة إلى قائمة الفرص البيعية؟',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'نعم، انقلها',
            cancelButtonText: 'إلغاء',
            confirmButtonColor: '#10b981'
        }).then(async (result) => {
            if (result.isConfirmed) {
                const tr = document.getElementById(rowId);
                if (!tr) return;

                // تجميع البيانات الحالية للصف مباشرة لضمان عدم ضياع أي تعديلات قبل النقل
                const subRow = document.getElementById('sub-' + rowId);
                const products = [];
                if (subRow) {
                    subRow.querySelectorAll('.product-body tr').forEach(pRow => {
                        const pInputs = pRow.querySelectorAll('input, select');
                        if (pInputs.length >= 3) {
                            products.push({
                                name: pInputs[0].value,
                                val: pInputs[1].value,
                                type: pInputs[2].value
                            });
                        }
                    });
                }

                const editDateInput = tr.querySelector('.edit-date-val');
                const oppData = {
                    comp: tr.querySelector('td:nth-child(2) input')?.value || '',
                    address: tr.querySelector('td:nth-child(3) input')?.value || '',
                    mgr: tr.querySelector('td:nth-child(4) input')?.value || '',
                    mob: tr.querySelector('td:nth-child(5) input')?.value || '',
                    email: tr.querySelector('td:nth-child(6) input')?.value || '',
                    record: tr.querySelector('td:nth-child(7) input')?.value || '',
                    visitDate: tr.querySelector('.visit-date-val')?.value || getTodayFormatted(),
                    curServ: tr.querySelector('.cur-serv-val')?.value || '',
                    oppValue: tr.querySelector('.opp-value-input')?.value || '0',
                    status: 'تأهيل لفرصة',
                    owner: tr.querySelector('td:nth-child(14) input')?.value || '',
                    editDate: editDateInput?.value || `${getTodayFormatted()} ${getTimeFormatted()}`,
                    notes: tr.querySelector('.notes-preview')?.getAttribute('data-full-notes') || '[]',
                    products: products,
                    createdAt: `${getTodayFormatted()} ${getTimeFormatted()}`
                };

                try {
                    const batch = writeBatch(db);
                    
                    let oppId = rowId;
                    if (rowId.startsWith('visit_')) {
                        oppId = rowId.replace('visit_', 'opp_');
                    } else {
                        oppId = 'opp_' + Date.now();
                    }
                    
                    // الإضافة إلى جدول/مجموعة الفرص
                    batch.set(doc(db, "opportunities", oppId), oppData);
                    
                    // حذفها من مجموعة الزيارات لكي "تنتقل"
                    batch.delete(doc(db, "visits", rowId));
                    
                    await batch.commit();
                    
                    Swal.fire('نجاح', 'تم نقل الزيارة إلى الفرص البيعية بنجاح', 'success');
                    addToActivityLog('الفرص البيعية', 'زيارة', 'فرصة', 'تم تأهيل الزيارة ونقلها بنجاح للفرص البيعية');
                } catch (error) {
                    console.error("خطأ في النقل للفرص:", error);
                    Swal.fire('خطأ', 'حدث خطأ أثناء نقل الزيارة', 'error');
                    // التراجع عن تغيير القائمة إذا فشل النقل
                    selectEl.value = oldVal;
                    applyStatusColor(selectEl);
                    selectEl.dataset.old = oldVal;
                }
            } else {
                // تراجع المستخدم في نافذة التأكيد
                selectEl.value = oldVal;
                applyStatusColor(selectEl);
                selectEl.dataset.old = oldVal;
            }
        });
    } else {
        // إجراء الحفظ الطبيعي لأي حالة أخرى غير "تأهيل لفرصة"
        debouncedSaveSingleRow(rowId);
        addToActivityLog('الحالة', oldVal, newVal, newVal);
        selectEl.dataset.old = newVal;
    }
}
window.handleStatusChange = handleStatusChange;

function toggleSubTable(rowId) {
    const subRow = document.getElementById('sub-' + rowId);
    const mainRow = document.getElementById(rowId);
    if (!subRow || !mainRow) return;

    const arrow = mainRow.querySelector('.toggle-arrow');
    if (subRow.style.display === 'none' || !subRow.style.display) {
        subRow.style.display = 'table-row';
        if (arrow) arrow.classList.add('arrow-open');
    } else {
        subRow.style.display = 'none';
        if (arrow) arrow.classList.remove('arrow-open');
    }
}
window.toggleSubTable = toggleSubTable;

function addProductRow(rowId, productData = { name: '', val: '0', type: '' }) {
    const subRow = document.getElementById('sub-' + rowId);
    if (!subRow) return;
    const tbody = subRow.querySelector('.product-body');
    if (!tbody) return;

    const pTr = document.createElement('tr');
    pTr.innerHTML = `
        <td><input type="text" value="${escapeHTML(productData.name || '')}" onchange="debouncedSaveSingleRow('${rowId}')"></td>
        <td><input type="number" value="${escapeHTML(productData.val || '0')}" onchange="debouncedSaveSingleRow('${rowId}')"></td>
        <td>
            <select onchange="debouncedSaveSingleRow('${rowId}')">
                <option value="">اختر...</option>
                <option value="خدمة" ${productData.type === 'خدمة' ? 'selected' : ''}>خدمة</option>
                <option value="منتج" ${productData.type === 'منتج' ? 'selected' : ''}>منتج</option>
            </select>
        </td>
        <td><button class="sub-action-btn" onclick="deleteProductRow(this, '${rowId}')">×</button></td>
    `;
    tbody.appendChild(pTr);
}
window.addProductRow = addProductRow;

function deleteProductRow(btn, rowId) {
    const pTr = btn.closest('tr');
    if (pTr) {
        pTr.remove();
        debouncedSaveSingleRow(rowId);
    }
}
window.deleteProductRow = deleteProductRow;

function applyStatusColor(selectEl) {
    if (!selectEl) return;
    selectEl.classList.remove('status-green', 'status-yellow-fff', 'status-yellow-ffc', 'status-gray-a5', 'status-red-c00');
    const tr = selectEl.closest('tr');
    if (tr) tr.classList.remove('row-lost', 'row-uninterested');

    const val = selectEl.value;
    if (val === 'تأهيل لفرصة') {
        selectEl.classList.add('status-green');
    } else if (val === 'متابعة') {
        selectEl.classList.add('status-yellow-fff');
    } else if (val === 'عرض سعر') {
        selectEl.classList.add('status-yellow-ffc');
    } else if (val === 'غير مهتم') {
        selectEl.classList.add('status-gray-a5');
        if (tr) tr.classList.add('row-uninterested');
    } else if (val === 'فقدان') {
        selectEl.classList.add('status-red-c00');
        if (tr) tr.classList.add('row-lost');
    }
}
window.applyStatusColor = applyStatusColor;

// ------------------------------------------
// 5. الملاحظات والحذف والتقويم
// ------------------------------------------
function openNoteModal(rowId) {
    currentNoteRowId = rowId;
    const tr = document.getElementById(rowId);
    if (!tr) return;
    const preview = tr.querySelector('.notes-preview');
    const notesJson = preview ? preview.getAttribute('data-full-notes') : '[]';
    
    const historyLog = document.getElementById('historyLog');
    historyLog.innerHTML = '';
    
    try {
        const notes = JSON.parse(notesJson || '[]');
        if (Array.isArray(notes) && notes.length > 0) {
            notes.forEach(n => {
                const item = document.createElement('div');
                item.className = 'note-item';
                item.innerHTML = `
                    <div class="note-header">
                        <div class="note-meta">
                            <span class="note-user"><i class="fas fa-user"></i> ${escapeHTML(n.user || 'مستخدم')}</span>
                            <span><i class="far fa-clock"></i> ${escapeHTML(n.date || '')}</span>
                        </div>
                    </div>
                    <div class="note-body">${escapeHTML(n.text || n.note || '')}</div>
                `;
                historyLog.appendChild(item);
            });
        } else {
            historyLog.innerHTML = '<div style="text-align:center; color:#94a3b8;">لا توجد ملاحظات سابقة</div>';
        }
    } catch(e) {
        historyLog.innerHTML = `<div class="note-item"><div class="note-body">${escapeHTML(notesJson)}</div></div>`;
    }

    document.getElementById('modalTextArea').value = '';
    document.getElementById('noteModal').style.display = 'flex';
}
window.openNoteModal = openNoteModal;

function closeNote() {
    document.getElementById('noteModal').style.display = 'none';
    currentNoteRowId = null;
}
window.closeNote = closeNote;

async function saveNote() {
    if (!currentNoteRowId) return;
    const text = document.getElementById('modalTextArea').value.trim();
    if (!text) { closeNote(); return; }

    const tr = document.getElementById(currentNoteRowId);
    if (!tr) return;
    const preview = tr.querySelector('.notes-preview');
    let notes = [];
    try {
        notes = JSON.parse(preview.getAttribute('data-full-notes') || '[]');
    } catch(e) { notes = []; }

    notes.push({
        text: text,
        user: 'المالك',
        date: `${getTodayFormatted()} ${getTimeFormatted()}`
    });

    const newJson = JSON.stringify(notes);
    preview.setAttribute('data-full-notes', newJson);
    preview.innerText = text;

    updateEditDateField(tr);
    await saveSingleRow(currentNoteRowId);
    addToActivityLog('ملاحظة', '', text, `إضافة ملاحظة جديدة: ${text}`);
    closeNote();
}
window.saveNote = saveNote;

function openDeleteModal(rowId) {
    pendingDeleteRowId = rowId;
    pendingBulkAction = 'single_delete';
    const msg = document.getElementById('deleteModalMessage');
    if (msg) msg.innerText = 'هل أنت متأكد من رغبتك في حذف هذه الزيارة؟';
    document.getElementById('deleteModal').style.display = 'flex';
}
window.openDeleteModal = openDeleteModal;

function closeDeleteModal() {
    document.getElementById('deleteModal').style.display = 'none';
    pendingDeleteRowId = null;
    pendingBulkAction = '';
    pendingBulkIds = [];
}
window.closeDeleteModal = closeDeleteModal;

async function confirmDelete() {
    if (pendingBulkAction === 'single_delete' && pendingDeleteRowId) {
        try {
            await deleteDoc(doc(db, "visits", pendingDeleteRowId));
            addToActivityLog('حذف', 'زيارة', '', 'تم حذف الزيارة بنجاح');
        } catch (e) {
            console.error("خطأ أثناء حذف الزيارة:", e);
        }
    } else if (pendingBulkAction === 'bulk_delete' && pendingBulkIds.length > 0) {
        try {
            const batch = writeBatch(db);
            pendingBulkIds.forEach(id => batch.delete(doc(db, "visits", id)));
            await batch.commit();
            addToActivityLog('حذف جماعي', '', '', `تم حذف عدد ${pendingBulkIds.length} زيارة`);
        } catch (e) {
            console.error("خطأ أثناء الحذف الجماعي:", e);
        }
    }
    closeDeleteModal();
}
window.confirmDelete = confirmDelete;

// DatePicker
function openDatePicker(rowId) {
    currentPickerRowId = rowId;
    const overlay = document.getElementById('customDatePicker');
    if (overlay) overlay.classList.add('active');
    populateDatePicker();
}
window.openDatePicker = openDatePicker;

function closeDatePicker() {
    const overlay = document.getElementById('customDatePicker');
    if (overlay) overlay.classList.remove('active');
    currentPickerRowId = null;
}
window.closeDatePicker = closeDatePicker;

function populateDatePicker() {
    const dpMonth = document.getElementById('dpMonth');
    const dpYear = document.getElementById('dpYear');
    if (!dpMonth || !dpYear) return;

    const now = new Date();
    dpMonth.innerHTML = ''; dpYear.innerHTML = '';

    const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    months.forEach((m, idx) => {
        const opt = document.createElement('option');
        opt.value = idx; opt.innerText = m;
        if (idx === now.getMonth()) opt.selected = true;
        dpMonth.appendChild(opt);
    });

    for (let y = now.getFullYear() - 5; y <= now.getFullYear() + 5; y++) {
        const opt = document.createElement('option');
        opt.value = y; opt.innerText = y;
        if (y === now.getFullYear()) opt.selected = true;
        dpYear.appendChild(opt);
    }

    renderDaysGrid();
    dpMonth.onchange = renderDaysGrid;
    dpYear.onchange = renderDaysGrid;
}

function renderDaysGrid() {
    const dpDays = document.getElementById('dpDays');
    const dpMonth = document.getElementById('dpMonth');
    const dpYear = document.getElementById('dpYear');
    if (!dpDays || !dpMonth || !dpYear) return;

    dpDays.innerHTML = '';
    const m = parseInt(dpMonth.value);
    const y = parseInt(dpYear.value);

    const firstDayIndex = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();

    for (let i = 0; i < firstDayIndex; i++) {
        const blank = document.createElement('div');
        dpDays.appendChild(blank);
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const dayEl = document.createElement('div');
        dayEl.className = 'day-number';
        dayEl.innerText = d;
        dayEl.onclick = () => selectDate(d, m + 1, y);
        dpDays.appendChild(dayEl);
    }
}

function selectDate(d, m, y) {
    if (!currentPickerRowId) return;
    const formatted = `${String(d).padStart(2,'0')}-${String(m).padStart(2,'0')}-${y}`;
    const tr = document.getElementById(currentPickerRowId);
    if (tr) {
        const readonlyInput = tr.querySelector('td:nth-child(8) input.readonly-input');
        const hiddenInput = tr.querySelector('.visit-date-val');
        if (readonlyInput) readonlyInput.value = formatted;
        if (hiddenInput) hiddenInput.value = formatted;
        updateEditDateField(tr);
        debouncedSaveSingleRow(currentPickerRowId);
    }
    closeDatePicker();
}

function setTodayDate() {
    if (!currentPickerRowId) return;
    const today = getTodayFormatted();
    const tr = document.getElementById(currentPickerRowId);
    if (tr) {
        const readonlyInput = tr.querySelector('td:nth-child(8) input.readonly-input');
        const hiddenInput = tr.querySelector('.visit-date-val');
        if (readonlyInput) readonlyInput.value = today;
        if (hiddenInput) hiddenInput.value = today;
        updateEditDateField(tr);
        debouncedSaveSingleRow(currentPickerRowId);
    }
    closeDatePicker();
}
window.setTodayDate = setTodayDate;

// ------------------------------------------
// 6. البحث والإحصائيات وسجل النشاط
// ------------------------------------------
function debouncedFilterTable() {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(filterTable, 300);
}
window.debouncedFilterTable = debouncedFilterTable;

function filterTable() {
    const term = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
    const rows = document.querySelectorAll('#tableBody tr.main-row');

    rows.forEach(r => {
        const text = r.innerText.toLowerCase();
        const subRow = document.getElementById('sub-' + r.id);
        if (!term || text.includes(term)) {
            r.style.display = 'table-row';
        } else {
            r.style.display = 'none';
            if (subRow) subRow.style.display = 'none';
        }
    });
}
window.filterTable = filterTable;

function updateStats() {
    const totalCount = visitsDataArray.length;
    const today = getTodayFormatted();
    const currentMonthYear = today.substring(3);

    let monthCount = 0;
    let todayCount = 0;
    let totalVal = 0;
    let monthVal = 0;

    visitsDataArray.forEach(v => {
        const vDate = formatAsDDMMYYYY(v.visitDate || '');
        const val = parseFloat(v.oppValue || 0) || 0;
        totalVal += val;

        if (vDate === today) todayCount++;
        if (vDate.endsWith(currentMonthYear)) {
            monthCount++;
            monthVal += val;
        }
    });

    const setElText = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.innerText = val;
    };

    setElText('stat-total', totalCount);
    setElText('stat-month', monthCount);
    setElText('stat-today', todayCount);
    setElText('stat-value-total', totalVal.toLocaleString());
    setElText('stat-value-month', monthVal.toLocaleString());
}

function addToActivityLog(field, oldVal, newVal, details) {
    const entry = {
        time: `${getTodayFormatted()} ${getTimeFormatted()}`,
        user: 'المالك',
        action: details || `تم تعديل ${field} من "${oldVal}" إلى "${newVal}"`
    };
    activityLogs.unshift(entry);
    if (activityLogs.length > 50) activityLogs.pop();
    localStorage.setItem('asgate_visits_logs_v1', JSON.stringify(activityLogs));
    renderActivityLog();
}
window.addToActivityLog = addToActivityLog;

function renderActivityLog() {
    const list = document.getElementById('activityList');
    if (!list) return;
    list.innerHTML = '';
    activityLogs.forEach(log => {
        const div = document.createElement('div');
        div.className = 'log-entry';
        div.innerHTML = `
            <div class="log-header-info">
                <span><i class="far fa-clock"></i> ${escapeHTML(log.time)}</span>
                <span class="log-sep">|</span>
                <span><i class="fas fa-user"></i> ${escapeHTML(log.user)}</span>
            </div>
            <div class="log-action">${escapeHTML(log.action)}</div>
        `;
        list.appendChild(div);
    });
}

function toggleLogExpansion() {
    const sec = document.getElementById('activityLogSection');
    const btn = document.getElementById('toggleExpandBtn');
    if (!sec || !btn) return;
    sec.classList.toggle('expanded');
    btn.innerHTML = sec.classList.contains('expanded') ? '<i class="fas fa-compress-alt"></i>' : '<i class="fas fa-expand-alt"></i>';
}
window.toggleLogExpansion = toggleLogExpansion;

function initGlobalSearch() {
    const input = document.getElementById('globalSearchInput');
    const dropdown = document.getElementById('searchResults');
    if (!input || !dropdown) return;

    input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        if (!q) {
            dropdown.classList.remove('show');
            dropdown.innerHTML = '';
            return;
        }

        const matches = visitsDataArray.filter(v => 
            (v.comp || '').toLowerCase().includes(q) ||
            (v.mgr || '').toLowerCase().includes(q) ||
            (v.mob || '').toLowerCase().includes(q) ||
            (v.record || '').toLowerCase().includes(q)
        ).slice(0, 5);

        if (matches.length === 0) {
            dropdown.innerHTML = '<div class="search-no-results">لا توجد نتائج مطابقة</div>';
        } else {
            dropdown.innerHTML = matches.map(m => `
                <div class="search-result-item" onclick="document.getElementById('${m.id}')?.scrollIntoView({behavior:'smooth'}); document.getElementById('globalSearchInput').value=''; document.getElementById('searchResults').classList.remove('show');">
                    <div class="result-header">
                        <span class="result-title">${escapeHTML(m.comp || 'بدون اسم')}</span>
                        <span class="result-badge badge-visits">زيارة</span>
                    </div>
                    <div class="result-details">
                        <span><i class="fas fa-user"></i> ${escapeHTML(m.mgr || '-')}</span>
                        <span><i class="fas fa-phone"></i> ${escapeHTML(m.mob || '-')}</span>
                    </div>
                </div>
            `).join('');
        }
        dropdown.classList.add('show');
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.nav-search-container')) {
            dropdown.classList.remove('show');
        }
    });
}