// ==========================================
// opportunities.js - إدارة الفرص البيعية سحابياً ومحلياً (حماية مزدوجة)
// ==========================================
import { db } from './firebase-config.js';
import { collection, onSnapshot, doc, setDoc, deleteDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

let currentActivePreview = null;
let saveTimeout;
let searchTimeout;
let initialScrollDone = false; 
const LOGS_KEY = 'asgate_opportunities_activity_logs_v1';
const OPP_LOCAL_KEY = 'asgate_opportunities_local_cache_v1';

let logsDataList = [];

// دوال حماية البيانات والتحقق الفوري
function escapeHTML(str) { 
    return String(str || '').replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag])); 
}

function safe(value, fallback = '-') { 
    return escapeHTML(value && String(value).trim() ? String(value).trim() : fallback); 
}

function getFullDateString() {
    const d = new Date();
    const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    return `${days[d.getDay()]} ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDateToDisplay(dateStr) {
    if (!dateStr) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const parts = dateStr.split('-');
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return dateStr;
}

function saveLogsLocalBackup() {
    try {
        localStorage.setItem(LOGS_KEY, JSON.stringify(logsDataList));
    } catch (e) {
        console.error("Local Storage Error Logs: ", e);
    }
}

async function loadLogsData() {
    const localLogs = localStorage.getItem(LOGS_KEY);
    if (localLogs) {
        try { logsDataList = JSON.parse(localLogs); } catch(e){}
    }
    renderLogs(logsDataList);

    try {
        const logsSnapshot = await getDocs(collection(db, "opportunities_activity_logs"));
        const freshLogs = [];
        logsSnapshot.forEach((docSnap) => {
            freshLogs.push(docSnap.data());
        });
        
        freshLogs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        logsDataList = freshLogs;

        saveLogsLocalBackup();
        renderLogs(logsDataList);
    } catch (error) {
        console.error("Error loading logs from Cloud: ", error);
    }
}

// عرض سجل النشاط العام مع التوافق البصري الجديد
function renderLogs(list) {
    const logsBody = document.getElementById('activityList');
    if (!logsBody) return;
    logsBody.innerHTML = '';
    if (!list || !list.length) {
        logsBody.innerHTML = `<div style="text-align:center;padding:28px;color:#6b7280;font-weight:700;">لا يوجد سجل نشاط بعد</div>`;
        return;
    }
    list.slice(0, 30).forEach(log => {
        logsBody.innerHTML += `
            <div class="log-entry">
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <span class="log-badge-user"><i class="fas fa-user"></i> ${safe(log.user || 'المستخدم')}</span>
                    <span class="log-divider">|</span>
                    <span class="log-timestamp"><i class="far fa-clock"></i> ${safe(log.date)}</span>
                </div>
                <div class="log-action">${safe(log.action)}</div>
            </div>
        `;
    });
}

async function addToActivityLog(fieldName, oldVal, newVal, companyName, ownerName) { 
    if (oldVal === newVal) return; 
    const cleanCompany = companyName || 'شركة غير مسماة'; 
    let actionText = fieldName === 'إجراء' 
        ? `${oldVal} لفرصة شركة ( ${cleanCompany} )` 
        : `تعديل ${fieldName} من [${oldVal || 'فارغ'}] إلى [${newVal || 'فارغ'}] لفرصة العميل ( ${cleanCompany} )`; 
    
    const user = ownerName && ownerName.trim() ? ownerName.trim() : 'المستخدم';
    const logEntry = {
        user: user,
        date: getFullDateString(),
        action: actionText,
        timestamp: Date.now()
    };

    logsDataList.unshift(logEntry);
    saveLogsLocalBackup();
    renderLogs(logsDataList);

    try {
        await setDoc(doc(db, "opportunities_activity_logs", Date.now().toString()), logEntry);
    } catch (e) {
        console.error("خطأ بالحفظ السحابي لسجل النشاط:", e);
    }
}

function saveRowLocally(rowId) {
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
        id: rowId,
        comp: row.cells[1].querySelector('input')?.value || '',
        address: row.cells[2].querySelector('input')?.value || '',
        mgr: row.cells[3].querySelector('input')?.value || '',
        mob: row.cells[4].querySelector('input')?.value || '',
        email: row.cells[5].querySelector('input')?.value || '',
        record: row.cells[6].querySelector('input')?.value || '',
        oppDate: row.querySelector('.opp-date-val')?.value || '',
        curServ: row.cells[8].querySelector('input')?.value || '',
        oppValue: row.cells[9].querySelector('.opp-value-input')?.value || '',
        notes: row.cells[10].querySelector('.notes-preview')?.getAttribute('data-full-notes') || '[]',
        status: row.cells[11].querySelector('select')?.value || '',
        expDate: row.cells[12].querySelector('.exp-date-input')?.value || '',
        editDate: row.querySelector('.edit-date-val')?.value || getTodayFormatted(),
        owner: row.cells[13].querySelector('input')?.value || '',
        products: products
    };

    try {
        let localCache = JSON.parse(localStorage.getItem(OPP_LOCAL_KEY) || '{}');
        localCache[rowId] = data;
        localStorage.setItem(OPP_LOCAL_KEY, JSON.stringify(localCache));
    } catch (e) {
        console.error("خطأ بالحفظ المحلي الفوري للفرصة:", e);
    }
}

function listenToOpportunities() {
    const oppsRef = collection(db, "opportunities");
    onSnapshot(oppsRef, (snapshot) => {
        const tbody = document.getElementById('tableBody');
        if (!tbody) return;

        let openSubTables = [];
        document.querySelectorAll('.sub-table-row').forEach(row => {
            if (row.style.display === 'table-row') openSubTables.push(row.id);
        });

        let activeId = null;
        let activeClass = null;
        let activeTag = null;
        let activeIndex = 0;
        let selectionStart = 0;
        
        if (document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
            const tr = document.activeElement.closest('tr');
            if (tr) {
                activeId = tr.id;
                activeClass = document.activeElement.className;
                activeTag = document.activeElement.tagName;
                const elements = tr.querySelectorAll(`${activeTag}[class="${activeClass}"]`);
                elements.forEach((el, index) => {
                    if (el === document.activeElement) activeIndex = index;
                });
                try { selectionStart = document.activeElement.selectionStart; } catch(e){}
            }
        }

        tbody.innerHTML = '';
        if (!snapshot.empty) {
            snapshot.forEach((docSnapshot) => {
                const data = docSnapshot.data();
                data.id = docSnapshot.id;
                renderRow(data, false);
                saveRowLocally(data.id); 
            });
        } else {
            try {
                const localCache = JSON.parse(localStorage.getItem(OPP_LOCAL_KEY) || '{}');
                const localIds = Object.keys(localCache);
                if (localIds.length > 0) {
                    localIds.forEach(id => { renderRow(localCache[id], false); });
                }
            } catch(e) { console.error("خطأ في قراءة التخزين المحلي:", e); }
        }
        
        reorderRows();
        updateStats();

        openSubTables.forEach(id => {
            const sub = document.getElementById(id);
            if (sub) {
                sub.style.display = 'table-row';
                const mainId = id.replace('sub-', '');
                const arrows = document.querySelectorAll(`#${mainId} .toggle-arrow i`);
                arrows.forEach(arrow => arrow.className = 'fas fa-caret-down'); 
            }
        });

        if (activeId && activeClass && activeTag) {
            const activeRow = document.getElementById(activeId);
            if (activeRow) {
                const elements = activeRow.querySelectorAll(`${activeTag}[class="${activeClass}"]`);
                const elToFocus = elements[activeIndex] || elements[0];
                if (elToFocus) {
                    elToFocus.focus();
                    try { elToFocus.setSelectionRange(selectionStart, selectionStart); } catch(e){}
                }
            }
        }
    });
}

function renderRow(v = {}, prepend = false) {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;
    const rowId = v.id || ('row-' + Date.now() + Math.random().toString(36).substr(2, 5));
    const mainRow = document.createElement('tr');
    mainRow.className = 'main-row';
    mainRow.id = rowId;
    
    const subRow = document.createElement('tr');
    subRow.className = 'sub-table-row';
    subRow.id = 'sub-' + rowId;
    subRow.style.display = 'none';
    const today = getTodayFormatted();
    
    const oppDate = v.oppDate || v.visitDate || today; 
    const notesJson = v.notes || "[]";
    const lastNoteText = getLastNoteOnlyFromJSON(notesJson);

    mainRow.innerHTML = `
        <td class="col-select">
            <input type="checkbox" class="select-check">
            <span class="toggle-arrow" onclick="toggleSubTable('${rowId}')"><i class="fas fa-caret-left"></i></span>
        </td>
        <td><input type="text" class="excel-input" value="${v.comp || ''}" data-old="${v.comp || ''}" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr')); debouncedSaveSingleRow('${rowId}');" onblur="addToActivityLog('الشركة', this.dataset.old, this.value, this.value, this.closest('tr').cells[13].querySelector('input').value); this.dataset.old=this.value;" onmouseenter="showStatusTooltip(this)" onmouseleave="hideStatusTooltip()"></td>
        <td><input type="text" class="excel-input" value="${v.address || ''}" data-old="${v.address || ''}" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr')); debouncedSaveSingleRow('${rowId}');" onblur="addToActivityLog('العنوان', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value, this.closest('tr').cells[13].querySelector('input').value); this.dataset.old=this.value;"></td>
        <td><input type="text" class="excel-input" value="${v.mgr || ''}" data-old="${v.mgr || ''}" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr')); debouncedSaveSingleRow('${rowId}');" onblur="addToActivityLog('المسؤول', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value, this.closest('tr').cells[13].querySelector('input').value); this.dataset.old=this.value;"></td>
        <td>
            <div class="phone-cell-container">
                <a class="whatsapp-icon-btn" onclick="openWhatsAppChat(this)" title="مراسلة عبر واتساب"><i class="fa-brands fa-whatsapp"></i></a>
                <input type="text" class="excel-input" value="${v.mob || ''}" data-old="${v.mob || ''}" oninput="this.value = this.value.replace(/[^0-9]/g, ''); debouncedSaveSingleRow('${rowId}');" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr'));" onblur="addToActivityLog('رقم التواصل', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value, this.closest('tr').cells[13].querySelector('input').value); this.dataset.old=this.value;">
            </div>
        </td>
        <td><input type="text" class="excel-input" value="${v.email || ''}" data-old="${v.email || ''}" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr')); debouncedSaveSingleRow('${rowId}');" onblur="addToActivityLog('الإيميل', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value, this.closest('tr').cells[13].querySelector('input').value); this.dataset.old=this.value;"></td>
        <td><input type="text" class="excel-input" value="${v.record || ''}" data-old="${v.record || ''}" oninput="this.value = this.value.replace(/[^0-9]/g, ''); debouncedSaveSingleRow('${rowId}');" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr'));" onblur="addToActivityLog('السجل', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value, this.closest('tr').cells[13].querySelector('input').value); this.dataset.old=this.value;"></td>
        <td>
            <input type="text" class="excel-input readonly-input" value="${formatDateToDisplay(oppDate)}" style="color:var(--text-muted); font-weight:700;" readonly>
            <input type="hidden" class="opp-date-val" value="${oppDate}">
        </td>
        <td><input type="text" class="excel-input cur-serv-val" value="${v.curServ || ''}" data-old="${v.curServ || ''}" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr')); debouncedSaveSingleRow('${rowId}');" onblur="addToActivityLog('الخدمة', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value, this.closest('tr').cells[13].querySelector('input').value); this.dataset.old=this.value;" onmouseenter="showStatusTooltip(this)" onmouseleave="hideStatusTooltip()"></td>
        <td><input type="number" class="excel-input opp-value-input readonly-input" value="${v.oppValue || ''}" readonly style="color:var(--accent-blue); font-weight:800; cursor:not-allowed; background: transparent;"></td>
        <td><div class="notes-preview" onclick="openNote(this)" data-full-notes='${notesJson.replace(/'/g, "&apos;")}' id="preview-${Date.now()}">${lastNoteText}</div></td>
        <td>
            <select class="excel-input status-select" data-old="${v.status || ''}" onfocus="this.dataset.old=this.value" onchange="handleStatusChange(this, '${rowId}')">
                <option value="" ${v.status === '' ? 'selected' : ''}>-</option>
                <option value="مهتم" ${v.status === 'مهتم' || v.status === 'تأهيل لفرصة' ? 'selected' : ''}>مهتم</option>
                <option value="رابح" ${v.status === 'رابح' ? 'selected' : ''}>رابح</option>
                <option value="فقدان" ${v.status === 'فقدان' ? 'selected' : ''}>فقدان</option>
            </select>
        </td>
        <td>
            <input type="text" class="excel-input exp-date-input-display readonly-input" value="${formatDateToDisplay(v.expDate || '')}" readonly style="cursor:pointer;" onclick="openCustomDatePicker(event, this, '${rowId}')" placeholder="اختر التاريخ">
            <input type="hidden" class="exp-date-input" value="${v.expDate || ''}" data-old="${v.expDate || ''}">
            <input type="hidden" class="edit-date-val" value="${v.editDate || ''}">
        </td>
        <td><input type="text" class="excel-input" value="${v.owner || ''}" data-old="${v.owner || ''}" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr')); debouncedSaveSingleRow('${rowId}');" onblur="addToActivityLog('المالك', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value, this.value); this.dataset.old=this.value;"></td>
    `;

    subRow.innerHTML = `
        <td colspan="14" style="padding:15px 10px; background:#f8fafc; box-shadow: inset 0 2px 4px rgba(0,0,0,.02);">
            <div style="display: flex; gap: 15px; align-items: stretch;">
                <div class="sub-table-container" style="flex: 0 0 50%; padding: 0;">
                    <table class="inner-table" style="width: 100%;">
                        <thead>
                            <tr>
                                <th>المنتج</th><th>التفاصيل</th><th>العدد</th><th>الاشتراك</th><th>الإجمالي</th>
                                <style type="text/css">.header-plus-btn { background: #3b82f6; color: white; border: none; border-radius: 4px; padding: 2px 8px; cursor: pointer; }</style>
                                <th style="width:75px"><button class="header-plus-btn" onclick="addProductRow('${rowId}')" title="إضافة منتج"><i class="fas fa-plus"></i></button></th>
                            </tr>
                        </thead>
                        <tbody class="product-body"></tbody>
                    </table>
                </div>
                <div style="width: 250px; background: white; border: 1px solid var(--border-soft); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; justify-content: center; align-items: center; box-shadow: 0 4px 6px rgba(0,0,0,.05);">
                    <div style="font-weight:bold; color:#2e1065; margin-bottom:10px; font-size:12px;">تفاصيل التعديل والوقت:</div>
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
        <td><input type="text" value="${data.desc || ''}" onkeyup="updateEditDateField(this.closest('.sub-table-row').previousElementSibling); debouncedSaveSingleRow('${rowId}');"></td>
        <td><input type="number" class="prod-qty" min="0" value="${data.qty || ''}" onkeyup="updateEditDateField(this.closest('.sub-table-row').previousElementSibling); calculateMainVisitValue('${rowId}')" oninput="calculateMainVisitValue('${rowId}')"></td>
        <td><input type="number" class="prod-sub" min="0" value="${data.sub || ''}" onkeyup="updateEditDateField(this.closest('.sub-table-row').previousElementSibling); calculateMainVisitValue('${rowId}')" oninput="calculateMainVisitValue('${rowId}')"></td>
        <td><input type="number" class="prod-total readonly-input" value="${data.total || ''}" readonly style="color:var(--text-muted); font-weight:700; cursor:not-allowed;"></td>
        <td><div style="display:flex; justify-content:center;"><button class="sub-action-btn" title="حذف" onclick="if(this.closest('tbody').rows.length > 1) { const main = this.closest('.sub-table-row').previousElementSibling; updateEditDateField(main); this.closest('tr').remove(); calculateMainVisitValue('${rowId}'); }"><i class="fas fa-trash-alt" style="font-size:10px;"></i></button></div></td>
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
    saveRowLocally(rowId);
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
        oppDate: row.querySelector('.opp-date-val').value,
        curServ: row.cells[8].querySelector('input').value,
        oppValue: row.cells[9].querySelector('input').value,
        notes: row.cells[10].querySelector('.notes-preview').getAttribute('data-full-notes') || '[]',
        status: row.cells[11].querySelector('select').value,
        expDate: row.cells[12].querySelector('.exp-date-input').value,
        editDate: row.querySelector('.edit-date-val')?.value || getTodayFormatted(),
        owner: row.cells[13].querySelector('input').value,
        products: products
    };

    try {
        await setDoc(doc(db, "opportunities", rowId), data, { merge: true });
        updateStats();
    } catch (e) {
        console.error("خطأ بالحفظ السحابي للفرصة:", e);
    }
}

function debouncedSaveSingleRow(rowId) {
    saveRowLocally(rowId); 
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => { saveSingleRow(rowId); }, 5000); 
}

async function handleBulkAction(action) {
    const selected = document.querySelectorAll('.select-check:checked');
    if (selected.length === 0) { Swal.fire({icon: 'info', text: 'يرجى تحديد صف واحد على الأقل', confirmButtonText: 'حسناً', confirmButtonColor: '#3b82f6'}); return; }
    if (action === 'حذف') {
        const result = await Swal.fire({ title: 'تأكيد الحذف؟', text: "سيتم حذف الفرص المحددة نهائياً!", icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#94a3b8', confirmButtonText: 'نعم، احذف', cancelButtonText: 'إلغاء' });
        if (result.isConfirmed) {
            for (let chk of selected) {
                const row = chk.closest('tr');
                if (row && row.id) {
                    await deleteDoc(doc(db, "opportunities", row.id));
                    try {
                        let localCache = JSON.parse(localStorage.getItem(OPP_LOCAL_KEY) || '{}');
                        delete localCache[row.id];
                        localStorage.setItem(OPP_LOCAL_KEY, JSON.stringify(localCache));
                    } catch(e){}
                }
            }
            Swal.fire({icon: 'success', title: 'تم الحذف', showConfirmButton: false, timer: 1500});
        }
    }
}

function handleStatusChange(selectEl, rowId) {
    const newVal = selectEl.value; 
    const oldVal = selectEl.dataset.old; 
    const companyName = selectEl.closest('tr').cells[1].querySelector('input').value;
    const ownerName = selectEl.closest('tr').cells[13].querySelector('input').value;
    
    applyStatusColor(selectEl); 
    addToActivityLog('الحالة', oldVal, newVal, companyName, ownerName); 
    updateEditDateField(selectEl.closest('tr')); 
    saveSingleRow(rowId); 
    updateStats(); 
    selectEl.dataset.old = newVal;
}

function applyStatusColor(selectEl) { 
    if (!selectEl) return; 
    const val = selectEl.value; 
    const mainRow = selectEl.closest('.main-row'); 
    
    selectEl.classList.remove('status-yellow', 'status-green', 'status-red'); 
    if (mainRow) mainRow.classList.remove('closed-row'); 
    
    if (val === 'مهتم' || val === 'تأهيل لفرصة') {
        selectEl.classList.add('status-yellow'); 
    } else if (val === 'رابح') {
        selectEl.classList.add('status-green'); 
        if (mainRow) mainRow.classList.add('closed-row'); 
    } else if (val === 'فقدان') { 
        selectEl.classList.add('status-red'); 
        if (mainRow) mainRow.classList.add('closed-row'); 
    } 
    updateAllDateColors(); 
}

function updateAllDateColors() {
    const todayStr = getTodayFormatted();
    const todayObj = new Date(todayStr);

    document.querySelectorAll('#tableBody .main-row').forEach(row => {
        const hiddenInput = row.querySelector('.exp-date-input');
        const displayInput = row.querySelector('.exp-date-input-display');
        if(!hiddenInput || !displayInput) return;
        
        const status = row.querySelector('.status-select').value;

        displayInput.classList.remove('date-today', 'date-warning', 'date-past');
        if (status === 'رابح' || status === 'فقدان') return;

        const dVal = hiddenInput.value;
        if (!dVal) return;

        const expDateObj = new Date(dVal);
        const diffDays = Math.round((expDateObj - todayObj) / (1000 * 60 * 60 * 24));

        if (diffDays < 0) displayInput.classList.add('date-past');       
        else if (diffDays === 0) displayInput.classList.add('date-today');      
        else if (diffDays > 0 && diffDays <= 3) displayInput.classList.add('date-warning');    
    });
}

// عرض الملاحظات داخل النافذة المنبثقة مع التوافق البصري الجديد
function openNote(el) {
    currentActivePreview = el;
    let arr = []; try { arr = JSON.parse(el.getAttribute('data-full-notes') || "[]"); } catch(e) {}
    const historyLog = document.getElementById('historyLog');
    const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

    if (historyLog) {
        historyLog.innerHTML = arr.map((msg, index) => {
            let msgDateObj = new Date(msg.date);
            let dayStr = isNaN(msgDateObj) ? '' : days[msgDateObj.getDay()] + ' ';
            let userName = msg.user && msg.user !== "المستخدم" ? msg.user : "المستخدم";

            return `
            <div class="log-entry">
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <span class="log-badge-user"><i class="fas fa-user-circle"></i> ${userName}</span>
                    <span class="log-divider">|</span>
                    <span class="log-timestamp"><i class="fas fa-clock"></i> ${dayStr}${msg.date} ${msg.time}</span>
                    <i class="fas fa-trash-alt delete-note-btn" onclick="deleteNote(${index})" title="حذف الملاحظة"></i>
                </div>
                <div class="log-action">${msg.text}</div>
            </div>
            `;
        }).join('') || '<div style="color:#64748b; text-align:center; font-size:10px; padding:20px; font-weight:700;">لا توجد ملاحظات سابقة</div>';
    }
    
    const noteModal = document.getElementById('noteModal');
    if (noteModal) noteModal.style.display = "flex";
    const modalTextArea = document.getElementById('modalTextArea');
    if (modalTextArea) { modalTextArea.value = ""; modalTextArea.focus(); }
}

async function deleteNote(index) {
    if (!currentActivePreview) return;
    const result = await Swal.fire({
        title: 'تأكيد الحذف؟',
        text: "هل أنت تأكد من حذف هذه الملاحظة؟",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#94a3b8',
        confirmButtonText: 'نعم، احذف',
        cancelButtonText: 'إلغاء'
    });

    if (result.isConfirmed) {
        let arr = [];
        try { arr = JSON.parse(currentActivePreview.getAttribute('data-full-notes') || "[]"); } catch(e) {}
        arr.splice(index, 1);
        const jsonStr = JSON.stringify(arr);
        currentActivePreview.setAttribute('data-full-notes', jsonStr);
        currentActivePreview.innerText = getLastNoteOnlyFromJSON(jsonStr);

        const mainRow = currentActivePreview.closest('.main-row');
        if (mainRow) {
            updateEditDateField(mainRow);
            saveSingleRow(mainRow.id);
        }

        openNote(currentActivePreview);
    }
}

function saveNote() {
    const txt = document.getElementById('modalTextArea').value.trim();
    if (txt && currentActivePreview) {
        let arr = []; try { arr = JSON.parse(currentActivePreview.getAttribute('data-full-notes') || "[]"); } catch(e) {}
        let username = "المستخدم"; const mainRow = currentActivePreview.closest('.main-row');
        if (mainRow) { const ownerInput = mainRow.cells[13]?.querySelector('input'); if (ownerInput && ownerInput.value.trim()) username = ownerInput.value.trim(); }
        arr.push({ user: username, date: getTodayFormatted(), time: getTimeFormatted(), text: txt });
        currentActivePreview.setAttribute('data-full-notes', JSON.stringify(arr)); currentActivePreview.innerText = txt;
        if (mainRow) { updateEditDateField(mainRow); saveSingleRow(mainRow.id); }
    }
    closeNote();
}

function closeNote() { document.getElementById('noteModal').style.display = "none"; }
function showStatusTooltip(el) { const val = el.value || "فارغ"; let tooltip = document.getElementById('status-custom-tooltip'); if(!tooltip) { tooltip = document.createElement('div'); tooltip.id = 'status-custom-tooltip'; Object.assign(tooltip.style, {position:'absolute', background:'#1e293b', color:'#fff', padding:'5px 10px', borderRadius:'4px', fontSize:'11px', zIndex:'3000', pointerEvents:'none'}); document.body.appendChild(tooltip); } tooltip.innerText = val; tooltip.style.display = 'block'; const rect = el.getBoundingClientRect(); tooltip.style.top = (rect.top + window.scrollY - tooltip.offsetHeight - 6) + 'px'; tooltip.style.left = (rect.left + window.scrollX + (rect.width/2) - (tooltip.offsetWidth/2)) + 'px'; }
function hideStatusTooltip() { const tooltip = document.getElementById('status-custom-tooltip'); if(tooltip) tooltip.style.display = 'none'; }

function updateEditDateField(row) {
    if (!row) return; const dateFormatted = getTodayFormatted(); const time24 = getTimeFormatted(); const fullDateTime = `${dateFormatted} ${time24}`;
    const hiddenInput = row.querySelector('.edit-date-val');
    if (hiddenInput) hiddenInput.value = fullDateTime;
    const subRow = document.getElementById('sub-' + row.id);
    if (subRow) { const subContainer = subRow.querySelector('.edit-date-container-sub'); if (subContainer) subContainer.innerHTML = `<span class="edit-date-d">${dateFormatted}</span><span class="edit-date-t">${time24}</span>`; }
}

function parseEditDateHTML(fullDateTime) { if (!fullDateTime || !fullDateTime.includes(' ')) return `<span class="edit-date-d">${fullDateTime || ''}</span><span class="edit-date-t"></span>`; const parts = fullDateTime.split(' '); return `<span class="edit-date-d">${parts[0]}</span><span class="edit-date-t">${parts[1]}</span>`; }
function toggleSubTable(rowId) { const sub = document.getElementById('sub-' + rowId); const arrows = document.querySelectorAll(`#${rowId} .toggle-arrow i`); if (!sub) return; const isOpen = sub.style.display === 'table-row'; sub.style.display = isOpen ? 'none' : 'table-row'; arrows.forEach(arrow => arrow.className = isOpen ? 'fas fa-caret-left' : 'fas fa-caret-down'); }

function toggleLogExpansion() { 
    const logSection = document.getElementById('activityLogSection'); 
    const toggleBtn = document.getElementById('toggleExpandBtn'); 
    if(!logSection || !toggleBtn) return;
    if (logSection.classList.contains('expanded')) { 
        logSection.classList.remove('expanded'); 
        toggleBtn.innerHTML = '<i class="fas fa-expand-alt"></i>'; 
    } else { 
        logSection.classList.add('expanded'); 
        toggleBtn.innerHTML = '<i class="fas fa-compress-alt"></i>'; 
    } 
}

function reorderRows() { 
    const tbody = document.getElementById('tableBody'); 
    if (!tbody) return; 
    const rows = Array.from(tbody.querySelectorAll('.main-row')); 
    const today = getTodayFormatted(), currentMonth = today.substring(0, 7); 
    
    const rowsData = rows.map(row => {
        const expInput = row.querySelector('.exp-date-input');
        let dateVal = expInput ? expInput.value : '';
        const isEmptyDate = (!dateVal || dateVal.trim() === '');
        
        // التعديل الجديد: إذا كان التاريخ فارغاً يتم إعطاؤه قيمة فرز وهمية 
        // ليكون دائماً الأكبر في الشهر الحالي وبالتالي يظهر في أعلى الجدول
        if (isEmptyDate) {
            dateVal = `${currentMonth}-99`; 
        }

        return {
            row: row, 
            subRow: document.getElementById('sub-' + row.id), 
            date: dateVal,
            isEmptyDate: isEmptyDate
        };
    }); 
    
    // فرز تنازلي (الأحدث/الأكبر بالأعلى)
    rowsData.sort((a, b) => {
        return b.date.localeCompare(a.date);
    }); 
    
    const groups = {}; 
    rowsData.forEach(item => { 
        const month = item.date.substring(0, 7); 
        if (!groups[month]) groups[month] = []; 
        groups[month].push(item); 
    }); 
    
    tbody.innerHTML = ''; 
    const fragment = document.createDocumentFragment(); 
    
    const sortedMonths = Object.keys(groups).sort((a, b) => {
        return b.localeCompare(a);
    });

    sortedMonths.forEach(month => { 
        const sepRow = document.createElement('tr'); 
        sepRow.className = 'month-separator'; 
        const isCurrentMonth = (month === currentMonth); 

        const sepStyle = isCurrentMonth 
            ? 'background-color: #a855f7 !important; color:#fff !important; box-shadow: 0 2px 4px rgba(168,85,247,0.3);' 
            : 'background-color: #3b82f6 !important; color:#fff !important; box-shadow: 0 2px 4px rgba(59,130,246,0.3);'; 
        
        const monthText = isCurrentMonth ? `الفرص المتوقعة لشهر ${month} (الفرص المضافة حديثاً بالأعلى)` : `الفرص المتوقعة لشهر ${month}`;

        sepRow.innerHTML = `<td colspan="14"><div class="sep-text" style="${sepStyle}"><i class="far fa-calendar-alt"></i> ${monthText}</div></td>`; 
        
        if (isCurrentMonth) {
            sepRow.id = 'current-month-separator';
        }

        fragment.appendChild(sepRow); 

        groups[month].forEach(item => { 
            // إضافة تنبيه بصري للفرص الجديدة التي تحتاج تحديد تاريخ
            const displayInput = item.row.querySelector('.exp-date-input-display');
            if(displayInput) {
                if(item.isEmptyDate) {
                    displayInput.placeholder = "حدد التاريخ المتوقع ⚠️";
                    displayInput.style.boxShadow = "inset 0 0 0 1.5px #f59e0b";
                    displayInput.style.backgroundColor = "#fffbeb";
                    displayInput.style.color = "#d97706";
                } else {
                    displayInput.placeholder = "اختر التاريخ";
                    displayInput.style.boxShadow = "none";
                    displayInput.style.backgroundColor = "transparent";
                    displayInput.style.color = "inherit";
                }
            }

            fragment.appendChild(item.row); 
            if (item.subRow) fragment.appendChild(item.subRow); 
        }); 
    }); 
    
    tbody.appendChild(fragment); 
    updateAllDateColors();

    if (!initialScrollDone && rows.length > 0) {
        const tableWrapper = document.querySelector('.table-wrapper');
        setTimeout(() => {
            const currentMonthSep = document.getElementById('current-month-separator');
            if (currentMonthSep && tableWrapper) {
                const wrapperRect = tableWrapper.getBoundingClientRect();
                const sepRect = currentMonthSep.getBoundingClientRect();
                const topPos = tableWrapper.scrollTop + (sepRect.top - wrapperRect.top) - 42; 
                tableWrapper.scrollTo({ top: topPos, behavior: 'smooth' });
                initialScrollDone = true; 
            } else if (tableWrapper) {
                initialScrollDone = true;
            }
        }, 500); 
    }
}

function updateStats() { 
    const rows = document.querySelectorAll('#tableBody .main-row'); 
    const today = getTodayFormatted(), currentMonth = today.substring(0, 7); 
    
    let total = 0;    
    let tMonth = 0;   
    let tDay = 0;     
    let valTotal = 0; 
    let valMonth = 0; 
    
    rows.forEach(row => { 
        const statusSelect = row.querySelector('.status-select');
        const status = statusSelect ? statusSelect.value : '';
        const isInterested = (status === 'مهتم' || status === 'تأهيل لفرصة');

        if (isInterested) {
            total++;
            const visitValInput = row.querySelector('.opp-value-input'); 
            const visitVal = visitValInput ? parseFloat(visitValInput.value) || 0 : 0; 
            valTotal += visitVal;

            const oppDateInput = row.querySelector('.opp-date-val'); 
            if (oppDateInput && oppDateInput.value) { 
                const oppDate = oppDateInput.value; 
                if (oppDate === today) tDay++; 
                if (oppDate.startsWith(currentMonth)) tMonth++; 
            تم إجراء التعديل المطلوب برمجياً داخل ملف الجافاسكريبت `opportunities.js`[cite: 3]. 

**التعديلات التي تمت:**
*   داخل الدالة `renderRow`، تمت إضافة دالة صغرى تقوم بالتقاط السنة والشهر الحاليين، وتوليد تاريخ يمثل **اليوم الأول من الشهر الحالي** (مثال: `2026-09-01`).
*   تم ربط هذا التاريخ ليكون القيمة الافتراضية لحقل "التاريخ المتوقع" `expDate` في حال كانت الفرصة جديدة (مرحلة من الزيارات) ولا تحتوي على تاريخ مسبق.
*   بهذا التعديل، ستظهر الفرص المرحلة تلقائياً في مجموعة الشهر الحالي وفي أعلى القائمة (لأن تاريخها سيكون يوم 1 في الشهر)، مما يسهل عليك الانتباه لها وتغيير تاريخها لاحقاً.

إليك كود `opportunities.js` المحدث بالكامل:

```javascript
// ==========================================
// opportunities.js - إدارة الفرص البيعية سحابياً ومحلياً (حماية مزدوجة)
// ==========================================
import { db } from './firebase-config.js';
import { collection, onSnapshot, doc, setDoc, deleteDoc, getDocs } from "[https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js](https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js)";

let currentActivePreview = null;
let saveTimeout;
let searchTimeout;
let initialScrollDone = false; 
const LOGS_KEY = 'asgate_opportunities_activity_logs_v1';
const OPP_LOCAL_KEY = 'asgate_opportunities_local_cache_v1';

let logsDataList = [];

// دوال حماية البيانات والتحقق الفوري
function escapeHTML(str) { 
    return String(str || '').replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag])); 
}

function safe(value, fallback = '-') { 
    return escapeHTML(value && String(value).trim() ? String(value).trim() : fallback); 
}

function getFullDateString() {
    const d = new Date();
    const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    return `${days[d.getDay()]} ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDateToDisplay(dateStr) {
    if (!dateStr) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const parts = dateStr.split('-');
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return dateStr;
}

function saveLogsLocalBackup() {
    try {
        localStorage.setItem(LOGS_KEY, JSON.stringify(logsDataList));
    } catch (e) {
        console.error("Local Storage Error Logs: ", e);
    }
}

async function loadLogsData() {
    const localLogs = localStorage.getItem(LOGS_KEY);
    if (localLogs) {
        try { logsDataList = JSON.parse(localLogs); } catch(e){}
    }
    renderLogs(logsDataList);

    try {
        const logsSnapshot = await getDocs(collection(db, "opportunities_activity_logs"));
        const freshLogs = [];
        logsSnapshot.forEach((docSnap) => {
            freshLogs.push(docSnap.data());
        });
        
        freshLogs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        logsDataList = freshLogs;

        saveLogsLocalBackup();
        renderLogs(logsDataList);
    } catch (error) {
        console.error("Error loading logs from Cloud: ", error);
    }
}

// عرض سجل النشاط العام مع التوافق البصري الجديد
function renderLogs(list) {
    const logsBody = document.getElementById('activityList');
    if (!logsBody) return;
    logsBody.innerHTML = '';
    if (!list || !list.length) {
        logsBody.innerHTML = `<div style="text-align:center;padding:28px;color:#6b7280;font-weight:700;">لا يوجد سجل نشاط بعد</div>`;
        return;
    }
    list.slice(0, 30).forEach(log => {
        logsBody.innerHTML += `
            <div class="log-entry">
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <span class="log-badge-user"><i class="fas fa-user"></i> ${safe(log.user || 'المستخدم')}</span>
                    <span class="log-divider">|</span>
                    <span class="log-timestamp"><i class="far fa-clock"></i> ${safe(log.date)}</span>
                </div>
                <div class="log-action">${safe(log.action)}</div>
            </div>
        `;
    });
}

async function addToActivityLog(fieldName, oldVal, newVal, companyName, ownerName) { 
    if (oldVal === newVal) return; 
    const cleanCompany = companyName || 'شركة غير مسماة'; 
    let actionText = fieldName === 'إجراء' 
        ? `${oldVal} لفرصة شركة ( ${cleanCompany} )` 
        : `تعديل ${fieldName} من [${oldVal || 'فارغ'}] إلى [${newVal || 'فارغ'}] لفرصة العميل ( ${cleanCompany} )`; 
    
    const user = ownerName && ownerName.trim() ? ownerName.trim() : 'المستخدم';
    const logEntry = {
        user: user,
        date: getFullDateString(),
        action: actionText,
        timestamp: Date.now()
    };

    logsDataList.unshift(logEntry);
    saveLogsLocalBackup();
    renderLogs(logsDataList);

    try {
        await setDoc(doc(db, "opportunities_activity_logs", Date.now().toString()), logEntry);
    } catch (e) {
        console.error("خطأ بالحفظ السحابي لسجل النشاط:", e);
    }
}

function saveRowLocally(rowId) {
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
        id: rowId,
        comp: row.cells[1].querySelector('input')?.value || '',
        address: row.cells[2].querySelector('input')?.value || '',
        mgr: row.cells[3].querySelector('input')?.value || '',
        mob: row.cells[4].querySelector('input')?.value || '',
        email: row.cells[5].querySelector('input')?.value || '',
        record: row.cells[6].querySelector('input')?.value || '',
        oppDate: row.querySelector('.opp-date-val')?.value || '',
        curServ: row.cells[8].querySelector('input')?.value || '',
        oppValue: row.cells[9].querySelector('.opp-value-input')?.value || '',
        notes: row.cells[10].querySelector('.notes-preview')?.getAttribute('data-full-notes') || '[]',
        status: row.cells[11].querySelector('select')?.value || '',
        expDate: row.cells[12].querySelector('.exp-date-input')?.value || '',
        editDate: row.querySelector('.edit-date-val')?.value || getTodayFormatted(),
        owner: row.cells[13].querySelector('input')?.value || '',
        products: products
    };

    try {
        let localCache = JSON.parse(localStorage.getItem(OPP_LOCAL_KEY) || '{}');
        localCache[rowId] = data;
        localStorage.setItem(OPP_LOCAL_KEY, JSON.stringify(localCache));
    } catch (e) {
        console.error("خطأ بالحفظ المحلي الفوري للفرصة:", e);
    }
}

function listenToOpportunities() {
    const oppsRef = collection(db, "opportunities");
    onSnapshot(oppsRef, (snapshot) => {
        const tbody = document.getElementById('tableBody');
        if (!tbody) return;

        let openSubTables = [];
        document.querySelectorAll('.sub-table-row').forEach(row => {
            if (row.style.display === 'table-row') openSubTables.push(row.id);
        });

        let activeId = null;
        let activeClass = null;
        let activeTag = null;
        let activeIndex = 0;
        let selectionStart = 0;
        
        if (document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
            const tr = document.activeElement.closest('tr');
            if (tr) {
                activeId = tr.id;
                activeClass = document.activeElement.className;
                activeTag = document.activeElement.tagName;
                const elements = tr.querySelectorAll(`${activeTag}[class="${activeClass}"]`);
                elements.forEach((el, index) => {
                    if (el === document.activeElement) activeIndex = index;
                });
                try { selectionStart = document.activeElement.selectionStart; } catch(e){}
            }
        }

        tbody.innerHTML = '';
        if (!snapshot.empty) {
            snapshot.forEach((docSnapshot) => {
                const data = docSnapshot.data();
                data.id = docSnapshot.id;
                renderRow(data, false);
                saveRowLocally(data.id); 
            });
        } else {
            try {
                const localCache = JSON.parse(localStorage.getItem(OPP_LOCAL_KEY) || '{}');
                const localIds = Object.keys(localCache);
                if (localIds.length > 0) {
                    localIds.forEach(id => { renderRow(localCache[id], false); });
                }
            } catch(e) { console.error("خطأ في قراءة التخزين المحلي:", e); }
        }
        
        reorderRows();
        updateStats();

        openSubTables.forEach(id => {
            const sub = document.getElementById(id);
            if (sub) {
                sub.style.display = 'table-row';
                const mainId = id.replace('sub-', '');
                const arrows = document.querySelectorAll(`#${mainId} .toggle-arrow i`);
                arrows.forEach(arrow => arrow.className = 'fas fa-caret-down'); 
            }
        });

        if (activeId && activeClass && activeTag) {
            const activeRow = document.getElementById(activeId);
            if (activeRow) {
                const elements = activeRow.querySelectorAll(`${activeTag}[class="${activeClass}"]`);
                const elToFocus = elements[activeIndex] || elements[0];
                if (elToFocus) {
                    elToFocus.focus();
                    try { elToFocus.setSelectionRange(selectionStart, selectionStart); } catch(e){}
                }
            }
        }
    });
}

function renderRow(v = {}, prepend = false) {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;
    const rowId = v.id || ('row-' + Date.now() + Math.random().toString(36).substr(2, 5));
    const mainRow = document.createElement('tr');
    mainRow.className = 'main-row';
    mainRow.id = rowId;
    
    const subRow = document.createElement('tr');
    subRow.className = 'sub-table-row';
    subRow.id = 'sub-' + rowId;
    subRow.style.display = 'none';
    const today = getTodayFormatted();
    
    const oppDate = v.oppDate || v.visitDate || today; 
    
    // إعداد بداية الشهر الحالي للفرص المُرحّلة التي لا تحتوي على تاريخ متوقع
    const todayObjForMonth = new Date();
    const firstDayOfCurrentMonth = `${todayObjForMonth.getFullYear()}-${String(todayObjForMonth.getMonth() + 1).padStart(2, '0')}-01`;
    const defaultExpDate = v.expDate || firstDayOfCurrentMonth;

    const notesJson = v.notes || "[]";
    const lastNoteText = getLastNoteOnlyFromJSON(notesJson);

    mainRow.innerHTML = `
        <td class="col-select">
            <input type="checkbox" class="select-check">
            <span class="toggle-arrow" onclick="toggleSubTable('${rowId}')"><i class="fas fa-caret-left"></i></span>
        </td>
        <td><input type="text" class="excel-input" value="${v.comp || ''}" data-old="${v.comp || ''}" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr')); debouncedSaveSingleRow('${rowId}');" onblur="addToActivityLog('الشركة', this.dataset.old, this.value, this.value, this.closest('tr').cells[13].querySelector('input').value); this.dataset.old=this.value;" onmouseenter="showStatusTooltip(this)" onmouseleave="hideStatusTooltip()"></td>
        <td><input type="text" class="excel-input" value="${v.address || ''}" data-old="${v.address || ''}" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr')); debouncedSaveSingleRow('${rowId}');" onblur="addToActivityLog('العنوان', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value, this.closest('tr').cells[13].querySelector('input').value); this.dataset.old=this.value;"></td>
        <td><input type="text" class="excel-input" value="${v.mgr || ''}" data-old="${v.mgr || ''}" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr')); debouncedSaveSingleRow('${rowId}');" onblur="addToActivityLog('المسؤول', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value, this.closest('tr').cells[13].querySelector('input').value); this.dataset.old=this.value;"></td>
        <td>
            <div class="phone-cell-container">
                <a class="whatsapp-icon-btn" onclick="openWhatsAppChat(this)" title="مراسلة عبر واتساب"><i class="fa-brands fa-whatsapp"></i></a>
                <input type="text" class="excel-input" value="${v.mob || ''}" data-old="${v.mob || ''}" oninput="this.value = this.value.replace(/[^0-9]/g, ''); debouncedSaveSingleRow('${rowId}');" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr'));" onblur="addToActivityLog('رقم التواصل', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value, this.closest('tr').cells[13].querySelector('input').value); this.dataset.old=this.value;">
            </div>
        </td>
        <td><input type="text" class="excel-input" value="${v.email || ''}" data-old="${v.email || ''}" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr')); debouncedSaveSingleRow('${rowId}');" onblur="addToActivityLog('الإيميل', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value, this.closest('tr').cells[13].querySelector('input').value); this.dataset.old=this.value;"></td>
        <td><input type="text" class="excel-input" value="${v.record || ''}" data-old="${v.record || ''}" oninput="this.value = this.value.replace(/[^0-9]/g, ''); debouncedSaveSingleRow('${rowId}');" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr'));" onblur="addToActivityLog('السجل', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value, this.closest('tr').cells[13].querySelector('input').value); this.dataset.old=this.value;"></td>
        <td>
            <input type="text" class="excel-input readonly-input" value="${formatDateToDisplay(oppDate)}" style="color:var(--text-muted); font-weight:700;" readonly>
            <input type="hidden" class="opp-date-val" value="${oppDate}">
        </td>
        <td><input type="text" class="excel-input cur-serv-val" value="${v.curServ || ''}" data-old="${v.curServ || ''}" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr')); debouncedSaveSingleRow('${rowId}');" onblur="addToActivityLog('الخدمة', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value, this.closest('tr').cells[13].querySelector('input').value); this.dataset.old=this.value;" onmouseenter="showStatusTooltip(this)" onmouseleave="hideStatusTooltip()"></td>
        <td><input type="number" class="excel-input opp-value-input readonly-input" value="${v.oppValue || ''}" readonly style="color:var(--accent-blue); font-weight:800; cursor:not-allowed; background: transparent;"></td>
        <td><div class="notes-preview" onclick="openNote(this)" data-full-notes='${notesJson.replace(/'/g, "&apos;")}' id="preview-${Date.now()}">${lastNoteText}</div></td>
        <td>
            <select class="excel-input status-select" data-old="${v.status || ''}" onfocus="this.dataset.old=this.value" onchange="handleStatusChange(this, '${rowId}')">
                <option value="" ${v.status === '' ? 'selected' : ''}>-</option>
                <option value="مهتم" ${v.status === 'مهتم' || v.status === 'تأهيل لفرصة' ? 'selected' : ''}>مهتم</option>
                <option value="رابح" ${v.status === 'رابح' ? 'selected' : ''}>رابح</option>
                <option value="فقدان" ${v.status === 'فقدان' ? 'selected' : ''}>فقدان</option>
            </select>
        </td>
        <td>
            <input type="text" class="excel-input exp-date-input-display readonly-input" value="${formatDateToDisplay(defaultExpDate)}" readonly style="cursor:pointer;" onclick="openCustomDatePicker(event, this, '${rowId}')" placeholder="اختر التاريخ">
            <input type="hidden" class="exp-date-input" value="${defaultExpDate}" data-old="${defaultExpDate}">
            <input type="hidden" class="edit-date-val" value="${v.editDate || ''}">
        </td>
        <td><input type="text" class="excel-input" value="${v.owner || ''}" data-old="${v.owner || ''}" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr')); debouncedSaveSingleRow('${rowId}');" onblur="addToActivityLog('المالك', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value, this.value); this.dataset.old=this.value;"></td>
    `;

    subRow.innerHTML = `
        <td colspan="14" style="padding:15px 10px; background:#f8fafc; box-shadow: inset 0 2px 4px rgba(0,0,0,.02);">
            <div style="display: flex; gap: 15px; align-items: stretch;">
                <div class="sub-table-container" style="flex: 0 0 50%; padding: 0;">
                    <table class="inner-table" style="width: 100%;">
                        <thead>
                            <tr>
                                <th>المنتج</th><th>التفاصيل</th><th>العدد</th><th>الاشتراك</th><th>الإجمالي</th>
                                <style type="text/css">.header-plus-btn { background: #3b82f6; color: white; border: none; border-radius: 4px; padding: 2px 8px; cursor: pointer; }</style>
                                <th style="width:75px"><button class="header-plus-btn" onclick="addProductRow('${rowId}')" title="إضافة منتج"><i class="fas fa-plus"></i></button></th>
                            </tr>
                        </thead>
                        <tbody class="product-body"></tbody>
                    </table>
                </div>
                <div style="width: 250px; background: white; border: 1px solid var(--border-soft); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; justify-content: center; align-items: center; box-shadow: 0 4px 6px rgba(0,0,0,.05);">
                    <div style="font-weight:bold; color:#2e1065; margin-bottom:10px; font-size:12px;">تفاصيل التعديل والوقت:</div>
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
        <td><input type="text" value="${data.desc || ''}" onkeyup="updateEditDateField(this.closest('.sub-table-row').previousElementSibling); debouncedSaveSingleRow('${rowId}');"></td>
        <td><input type="number" class="prod-qty" min="0" value="${data.qty || ''}" onkeyup="updateEditDateField(this.closest('.sub-table-row').previousElementSibling); calculateMainVisitValue('${rowId}')" oninput="calculateMainVisitValue('${rowId}')"></td>
        <td><input type="number" class="prod-sub" min="0" value="${data.sub || ''}" onkeyup="updateEditDateField(this.closest('.sub-table-row').previousElementSibling); calculateMainVisitValue('${rowId}')" oninput="calculateMainVisitValue('${rowId}')"></td>
        <td><input type="number" class="prod-total readonly-input" value="${data.total || ''}" readonly style="color:var(--text-muted); font-weight:700; cursor:not-allowed;"></td>
        <td><div style="display:flex; justify-content:center;"><button class="sub-action-btn" title="حذف" onclick="if(this.closest('tbody').rows.length > 1) { const main = this.closest('.sub-table-row').previousElementSibling; updateEditDateField(main); this.closest('tr').remove(); calculateMainVisitValue('${rowId}'); }"><i class="fas fa-trash-alt" style="font-size:10px;"></i></button></div></td>
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
    saveRowLocally(rowId);
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
        oppDate: row.querySelector('.opp-date-val').value,
        curServ: row.cells[8].querySelector('input').value,
        oppValue: row.cells[9].querySelector('input').value,
        notes: row.cells[10].querySelector('.notes-preview').getAttribute('data-full-notes') || '[]',
        status: row.cells[11].querySelector('select').value,
        expDate: row.cells[12].querySelector('.exp-date-input').value,
        editDate: row.querySelector('.edit-date-val')?.value || getTodayFormatted(),
        owner: row.cells[13].querySelector('input').value,
        products: products
    };

    try {
        await setDoc(doc(db, "opportunities", rowId), data, { merge: true });
        updateStats();
    } catch (e) {
        console.error("خطأ بالحفظ السحابي للفرصة:", e);
    }
}

function debouncedSaveSingleRow(rowId) {
    saveRowLocally(rowId); 
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => { saveSingleRow(rowId); }, 5000); 
}

async function handleBulkAction(action) {
    const selected = document.querySelectorAll('.select-check:checked');
    if (selected.length === 0) { Swal.fire({icon: 'info', text: 'يرجى تحديد صف واحد على الأقل', confirmButtonText: 'حسناً', confirmButtonColor: '#3b82f6'}); return; }
    if (action === 'حذف') {
        const result = await Swal.fire({ title: 'تأكيد الحذف؟', text: "سيتم حذف الفرص المحددة نهائياً!", icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#94a3b8', confirmButtonText: 'نعم، احذف', cancelButtonText: 'إلغاء' });
        if (result.isConfirmed) {
            for (let chk of selected) {
                const row = chk.closest('tr');
                if (row && row.id) {
                    await deleteDoc(doc(db, "opportunities", row.id));
                    try {
                        let localCache = JSON.parse(localStorage.getItem(OPP_LOCAL_KEY) || '{}');
                        delete localCache[row.id];
                        localStorage.setItem(OPP_LOCAL_KEY, JSON.stringify(localCache));
                    } catch(e){}
                }
            }
            Swal.fire({icon: 'success', title: 'تم الحذف', showConfirmButton: false, timer: 1500});
        }
    }
}

function handleStatusChange(selectEl, rowId) {
    const newVal = selectEl.value; 
    const oldVal = selectEl.dataset.old; 
    const companyName = selectEl.closest('tr').cells[1].querySelector('input').value;
    const ownerName = selectEl.closest('tr').cells[13].querySelector('input').value;
    
    applyStatusColor(selectEl); 
    addToActivityLog('الحالة', oldVal, newVal, companyName, ownerName); 
    updateEditDateField(selectEl.closest('tr')); 
    saveSingleRow(rowId); 
    updateStats(); 
    selectEl.dataset.old = newVal;
}

function applyStatusColor(selectEl) { 
    if (!selectEl) return; 
    const val = selectEl.value; 
    const mainRow = selectEl.closest('.main-row'); 
    
    selectEl.classList.remove('status-yellow', 'status-green', 'status-red'); 
    if (mainRow) mainRow.classList.remove('closed-row'); 
    
    if (val === 'مهتم' || val === 'تأهيل لفرصة') {
        selectEl.classList.add('status-yellow'); 
    } else if (val === 'رابح') {
        selectEl.classList.add('status-green'); 
        if (mainRow) mainRow.classList.add('closed-row'); 
    } else if (val === 'فقدان') { 
        selectEl.classList.add('status-red'); 
        if (mainRow) mainRow.classList.add('closed-row'); 
    } 
    updateAllDateColors(); 
}

function updateAllDateColors() {
    const todayStr = getTodayFormatted();
    const todayObj = new Date(todayStr);

    document.querySelectorAll('#tableBody .main-row').forEach(row => {
        const hiddenInput = row.querySelector('.exp-date-input');
        const displayInput = row.querySelector('.exp-date-input-display');
        if(!hiddenInput || !displayInput) return;
        
        const status = row.querySelector('.status-select').value;

        displayInput.classList.remove('date-today', 'date-warning', 'date-past');
        if (status === 'رابح' || status === 'فقدان') return;

        const dVal = hiddenInput.value;
        if (!dVal) return;

        const expDateObj = new Date(dVal);
        const diffDays = Math.round((expDateObj - todayObj) / (1000 * 60 * 60 * 24));

        if (diffDays < 0) displayInput.classList.add('date-past');       
        else if (diffDays === 0) displayInput.classList.add('date-today');      
        else if (diffDays > 0 && diffDays <= 3) displayInput.classList.add('date-warning');    
    });
}

// عرض الملاحظات داخل النافذة المنبثقة مع التوافق البصري الجديد
function openNote(el) {
    currentActivePreview = el;
    let arr = []; try { arr = JSON.parse(el.getAttribute('data-full-notes') || "[]"); } catch(e) {}
    const historyLog = document.getElementById('historyLog');
    const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

    if (historyLog) {
        historyLog.innerHTML = arr.map((msg, index) => {
            let msgDateObj = new Date(msg.date);
            let dayStr = isNaN(msgDateObj) ? '' : days[msgDateObj.getDay()] + ' ';
            let userName = msg.user && msg.user !== "المستخدم" ? msg.user : "المستخدم";

            return `
            <div class="log-entry">
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <span class="log-badge-user"><i class="fas fa-user-circle"></i> ${userName}</span>
                    <span class="log-divider">|</span>
                    <span class="log-timestamp"><i class="fas fa-clock"></i> ${dayStr}${msg.date} ${msg.time}</span>
                    <i class="fas fa-trash-alt delete-note-btn" onclick="deleteNote(${index})" title="حذف الملاحظة"></i>
                </div>
                <div class="log-action">${msg.text}</div>
            </div>
            `;
        }).join('') || '<div style="color:#64748b; text-align:center; font-size:10px; padding:20px; font-weight:700;">لا توجد ملاحظات سابقة</div>';
    }
    
    const noteModal = document.getElementById('noteModal');
    if (noteModal) noteModal.style.display = "flex";
    const modalTextArea = document.getElementById('modalTextArea');
    if (modalTextArea) { modalTextArea.value = ""; modalTextArea.focus(); }
}

async function deleteNote(index) {
    if (!currentActivePreview) return;
    const result = await Swal.fire({
        title: 'تأكيد الحذف؟',
        text: "هل أنت تأكد من حذف هذه الملاحظة؟",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#94a3b8',
        confirmButtonText: 'نعم، احذف',
        cancelButtonText: 'إلغاء'
    });

    if (result.isConfirmed) {
        let arr = [];
        try { arr = JSON.parse(currentActivePreview.getAttribute('data-full-notes') || "[]"); } catch(e) {}
        arr.splice(index, 1);
        const jsonStr = JSON.stringify(arr);
        currentActivePreview.setAttribute('data-full-notes', jsonStr);
        currentActivePreview.innerText = getLastNoteOnlyFromJSON(jsonStr);

        const mainRow = currentActivePreview.closest('.main-row');
        if (mainRow) {
            updateEditDateField(mainRow);
            saveSingleRow(mainRow.id);
        }

        openNote(currentActivePreview);
    }
}

function saveNote() {
    const txt = document.getElementById('modalTextArea').value.trim();
    if (txt && currentActivePreview) {
        let arr = []; try { arr = JSON.parse(currentActivePreview.getAttribute('data-full-notes') || "[]"); } catch(e) {}
        let username = "المستخدم"; const mainRow = currentActivePreview.closest('.main-row');
        if (mainRow) { const ownerInput = mainRow.cells[13]?.querySelector('input'); if (ownerInput && ownerInput.value.trim()) username = ownerInput.value.trim(); }
        arr.push({ user: username, date: getTodayFormatted(), time: getTimeFormatted(), text: txt });
        currentActivePreview.setAttribute('data-full-notes', JSON.stringify(arr)); currentActivePreview.innerText = txt;
        if (mainRow) { updateEditDateField(mainRow); saveSingleRow(mainRow.id); }
    }
    closeNote();
}

function closeNote() { document.getElementById('noteModal').style.display = "none"; }
function showStatusTooltip(el) { const val = el.value || "فارغ"; let tooltip = document.getElementById('status-custom-tooltip'); if(!tooltip) { tooltip = document.createElement('div'); tooltip.id = 'status-custom-tooltip'; Object.assign(tooltip.style, {position:'absolute', background:'#1e293b', color:'#fff', padding:'5px 10px', borderRadius:'4px', fontSize:'11px', zIndex:'3000', pointerEvents:'none'}); document.body.appendChild(tooltip); } tooltip.innerText = val; tooltip.style.display = 'block'; const rect = el.getBoundingClientRect(); tooltip.style.top = (rect.top + window.scrollY - tooltip.offsetHeight - 6) + 'px'; tooltip.style.left = (rect.left + window.scrollX + (rect.width/2) - (tooltip.offsetWidth/2)) + 'px'; }
function hideStatusTooltip() { const tooltip = document.getElementById('status-custom-tooltip'); if(tooltip) tooltip.style.display = 'none'; }

function updateEditDateField(row) {
    if (!row) return; const dateFormatted = getTodayFormatted(); const time24 = getTimeFormatted(); const fullDateTime = `${dateFormatted} ${time24}`;
    const hiddenInput = row.querySelector('.edit-date-val');
    if (hiddenInput) hiddenInput.value = fullDateTime;
    const subRow = document.getElementById('sub-' + row.id);
    if (subRow) { const subContainer = subRow.querySelector('.edit-date-container-sub'); if (subContainer) subContainer.innerHTML = `<span class="edit-date-d">${dateFormatted}</span><span class="edit-date-t">${time24}</span>`; }
}

function parseEditDateHTML(fullDateTime) { if (!fullDateTime || !fullDateTime.includes(' ')) return `<span class="edit-date-d">${fullDateTime || ''}</span><span class="edit-date-t"></span>`; const parts = fullDateTime.split(' '); return `<span class="edit-date-d">${parts[0]}</span><span class="edit-date-t">${parts[1]}</span>`; }
function toggleSubTable(rowId) { const sub = document.getElementById('sub-' + rowId); const arrows = document.querySelectorAll(`#${rowId} .toggle-arrow i`); if (!sub) return; const isOpen = sub.style.display === 'table-row'; sub.style.display = isOpen ? 'none' : 'table-row'; arrows.forEach(arrow => arrow.className = isOpen ? 'fas fa-caret-left' : 'fas fa-caret-down'); }

function toggleLogExpansion() { 
    const logSection = document.getElementById('activityLogSection'); 
    const toggleBtn = document.getElementById('toggleExpandBtn'); 
    if(!logSection || !toggleBtn) return;
    if (logSection.classList.contains('expanded')) { 
        logSection.classList.remove('expanded'); 
        toggleBtn.innerHTML = '<i class="fas fa-expand-alt"></i>'; 
    } else { 
        logSection.classList.add('expanded'); 
        toggleBtn.innerHTML = '<i class="fas fa-compress-alt"></i>'; 
    } 
}

function reorderRows() { 
    const tbody = document.getElementById('tableBody'); if (!tbody) return; 
    const rows = Array.from(tbody.querySelectorAll('.main-row')); 
    const today = getTodayFormatted(), currentMonth = today.substring(0, 7); 
    
    const rowsData = rows.map(row => {
        const expInput = row.querySelector('.exp-date-input');
        return {
            row: row, 
            subRow: document.getElementById('sub-' + row.id), 
            date: (expInput && expInput.value) ? expInput.value : '9999-12-31'
        };
    }); 
    
    rowsData.sort((a, b) => {
        if (a.date === '9999-12-31' && b.date !== '9999-12-31') return 1;
        if (b.date === '9999-12-31' && a.date !== '9999-12-31') return -1;
        return b.date.localeCompare(a.date);
    }); 
    
    const groups = {}; 
    rowsData.forEach(item => { 
        const month = item.date === '9999-12-31' ? 'بدون تاريخ متوقع' : item.date.substring(0, 7); 
        if (!groups[month]) groups[month] = []; 
        groups[month].push(item); 
    }); 
    
    tbody.innerHTML = ''; 
    const fragment = document.createDocumentFragment(); 
    
    const sortedMonths = Object.keys(groups).sort((a, b) => {
        if (a === 'بدون تاريخ متوقع') return 1;
        if (b === 'بدون تاريخ متوقع') return -1;
        return b.localeCompare(a);
    });

    sortedMonths.forEach(month => { 
        const sepRow = document.createElement('tr'); 
        sepRow.className = 'month-separator'; 
        const isCurrentMonth = (month === currentMonth); 
        const isNoDate = (month === 'بدون تاريخ متوقع');

        const sepStyle = isCurrentMonth 
            ? 'background-color: #a855f7 !important; color:#fff !important; box-shadow: 0 2px 4px rgba(168,85,247,0.3);' 
            : isNoDate
            ? 'background-color: #f59e0b !important; color:#fff !important; box-shadow: 0 2px 4px rgba(245,158,11,0.3);'
            : 'background-color: #3b82f6 !important; color:#fff !important; box-shadow: 0 2px 4px rgba(59,130,246,0.3);'; 
        
        const monthText = month === 'بدون تاريخ متوقع' ? 'فرص مؤهلة حديثاً (تحتاج تحديد تاريخ)' : `الفرص المتوقعة لشهر ${month}`;

        sepRow.innerHTML = `<td colspan="14"><div class="sep-text" style="${sepStyle}"><i class="far fa-calendar-alt"></i> ${monthText}</div></td>`; 
        
        if (isCurrentMonth) {
            sepRow.id = 'current-month-separator';
        }

        fragment.appendChild(sepRow); 
        groups[month].forEach(item => { fragment.appendChild(item.row); if (item.subRow) fragment.appendChild(item.subRow); }); 
    }); 
    tbody.appendChild(fragment); 
    updateAllDateColors();

    if (!initialScrollDone && rows.length > 0) {
        const tableWrapper = document.querySelector('.table-wrapper');
        setTimeout(() => {
            const currentMonthSep = document.getElementById('current-month-separator');
            if (currentMonthSep && tableWrapper) {
                const wrapperRect = tableWrapper.getBoundingClientRect();
                const sepRect = currentMonthSep.getBoundingClientRect();
                const topPos = tableWrapper.scrollTop + (sepRect.top - wrapperRect.top) - 42; 
                tableWrapper.scrollTo({ top: topPos, behavior: 'smooth' });
                initialScrollDone = true; 
            } else if (tableWrapper) {
                initialScrollDone = true;
            }
        }, 500); 
    }
}

function updateStats() { 
    const rows = document.querySelectorAll('#tableBody .main-row'); 
    const today = getTodayFormatted(), currentMonth = today.substring(0, 7); 
    
    let total = 0;    
    let tMonth = 0;   
    let tDay = 0;     
    let valTotal = 0; 
    let valMonth = 0; 
    
    rows.forEach(row => { 
        const statusSelect = row.querySelector('.status-select');
        const status = statusSelect ? statusSelect.value : '';
        const isInterested = (status === 'مهتم' || status === 'تأهيل لفرصة');

        if (isInterested) {
            total++;
            const visitValInput = row.querySelector('.opp-value-input'); 
            const visitVal = visitValInput ? parseFloat(visitValInput.value) || 0 : 0; 
            valTotal += visitVal;

            const oppDateInput = row.querySelector('.opp-date-val'); 
            if (oppDateInput && oppDateInput.value) { 
                const oppDate = oppDateInput.value; 
                if (oppDate === today) tDay++; 
                if (oppDate.startsWith(currentMonth)) tMonth++; 
            }

            const expDateInput = row.querySelector('.exp-date-input');
            if (expDateInput && expDateInput.value) {
                const expDate = expDateInput.value;
                if (expDate.startsWith(currentMonth)) {
                    valMonth += visitVal;
                }
            }
        }
    }); 
    
    if (document.getElementById('stat-total')) document.getElementById('stat-total').innerText = total; 
    if (document.getElementById('stat-today')) document.getElementById('stat-today').innerText = tDay; 
    if (document.getElementById('stat-month')) document.getElementById('stat-month').innerText = tMonth; 
    if (document.getElementById('stat-value-total')) document.getElementById('stat-value-total').innerText = valTotal.toLocaleString() + ' ر.س'; 
    if (document.getElementById('stat-value-month')) document.getElementById('stat-value-month').innerText = valMonth.toLocaleString() + ' ر.س'; 
}

function getTodayFormatted() { return new Date().toISOString().split('T')[0]; } 
function getTimeFormatted() { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ":" + String(d.getMinutes()).padStart(2, '0'); } 
function getLastNoteOnlyFromJSON(jsonStr) { try { const arr = JSON.parse(jsonStr); return arr.length > 0 ? arr[arr.length - 1].text : "أضف ملاحظة..."; } catch(e) { return "أضف ملاحظة..."; } }

function openWhatsAppChat(el) { const inputEl = el.closest('.phone-cell-container').querySelector('input'); let rawPhone = inputEl.value.trim(); if (!rawPhone) { Swal.fire({icon: 'warning', title: 'تنبيه', text: 'يرجى إدخال رقم الجوال أولاً', confirmButtonText: 'حسناً', confirmButtonColor: '#3b82f6'}); return; } let cleanNumber = rawPhone.replace(/\D/g, ''); if (cleanNumber.startsWith('00966')) cleanNumber = cleanNumber.substring(2); else if (cleanNumber.startsWith('05')) cleanNumber = '966' + cleanNumber.substring(1); else if (cleanNumber.startsWith('5') && cleanNumber.length === 9) cleanNumber = '966' + cleanNumber; window.open("[https://wa.me/](https://wa.me/)" + cleanNumber, '_blank'); }

function toggleAllCheckboxes(source) { document.querySelectorAll('.select-check').forEach(chk => chk.checked = source.checked); }
function toggleDropdown(e, btn) { e.stopPropagation(); const menu = btn.nextElementSibling; document.querySelectorAll('.dropdown-menu').forEach(m => { if(m !== menu) m.classList.remove('show'); }); menu.classList.toggle('show'); }
function debouncedFilterTable() { clearTimeout(searchTimeout); searchTimeout = setTimeout(() => {
    const q = document.getElementById('searchInput').value.toLowerCase().trim();
    document.querySelectorAll('.main-row').forEach(row => {
        const text = Array.from(row.cells).slice(1, 7).map(c => c.querySelector('input')?.value.toLowerCase() || '').join(' ');
        const subRow = document.getElementById('sub-' + row.id);
        if (text.includes(q)) { row.style.display = 'table-row'; } else { row.style.display = 'none'; if(subRow) subRow.style.display = 'none'; }
    });
}, 300); }

/* ==========================================
   Date Picker Functions 
   ========================================== */
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
let activeInputTarget = null;
let activeInputDisplayTarget = null;
let activeRowTargetId = null;
let viewYear = new Date().getFullYear();
let viewMonth = new Date().getMonth();
let tempSelectedDateStr = "";

function initDatePicker() {
    const overlay = document.getElementById('calendarOverlay');
    const monthSelect = document.getElementById('calMonthSelect');
    const yearSelect = document.getElementById('calYearSelect');
    const cancelBtn = document.getElementById('calCancelBtn');
    const nextBtn = document.getElementById('calNextBtn');

    if (!overlay) return;

    monthSelect.innerHTML = '';
    MONTH_NAMES.forEach((name, index) => {
        const opt = document.createElement('option');
        opt.value = index;
        opt.textContent = name;
        monthSelect.appendChild(opt);
    });

    monthSelect.addEventListener('change', (e) => {
        viewMonth = parseInt(e.target.value, 10);
        renderCustomCalendarDays();
    });

    yearSelect.addEventListener('change', (e) => {
        viewYear = parseInt(e.target.value, 10);
        renderCustomCalendarDays();
    });

    cancelBtn?.addEventListener('click', closeCustomDatePicker);

    nextBtn?.addEventListener('click', () => {
        if (activeInputTarget && tempSelectedDateStr) {
            applySelectedDate(tempSelectedDateStr);
        } else {
            closeCustomDatePicker();
        }
    });

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeCustomDatePicker();
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

function renderCustomCalendarDays() {
    const grid = document.getElementById('calDaysGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const firstDayIndex = new Date(viewYear, viewMonth, 1).getDay();
    const totalDays = new Date(viewYear, viewMonth + 1, 0).getDate();
    const todayStr = getTodayFormatted(); 

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

function openCustomDatePicker(e, displayEl, rowId) {
    if(e) e.stopPropagation(); 
    activeInputDisplayTarget = displayEl;
    const hiddenEl = displayEl.closest('td').querySelector('.exp-date-input');
    activeInputTarget = hiddenEl; 
    activeRowTargetId = rowId;
    const val = hiddenEl.value;

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

    renderCustomCalendarDays();
    document.getElementById('calendarOverlay')?.classList.add('active');
}

function closeCustomDatePicker() {
    document.getElementById('calendarOverlay')?.classList.remove('active');
    activeInputTarget = null;
    activeInputDisplayTarget = null;
    activeRowTargetId = null;
}

function applySelectedDate(dateStr) {
    if (!activeInputTarget) return;
    const oldVal = activeInputTarget.dataset.old || ''; 
    activeInputTarget.value = dateStr;
    activeInputDisplayTarget.value = formatDateToDisplay(dateStr);
    const mainRow = document.getElementById(activeRowTargetId);
    if (mainRow) {
        const companyName = mainRow.cells[1].querySelector('input').value;
        const ownerName = mainRow.cells[13].querySelector('input').value;
        addToActivityLog('التاريخ المتوقع', formatDateToDisplay(oldVal), formatDateToDisplay(dateStr), companyName, ownerName);
        activeInputTarget.dataset.old = dateStr; 
        updateEditDateField(mainRow); 
        saveSingleRow(activeRowTargetId); 
        updateAllDateColors(); 
        reorderRows(); 
    }
    closeCustomDatePicker();
}

Object.assign(window, {
    toggleSubTable, addProductRow, calculateMainVisitValue, openNote, closeNote, saveNote, deleteNote, handleStatusChange,
    toggleAllCheckboxes, toggleDropdown, handleBulkAction, toggleLogExpansion, debouncedFilterTable, openWhatsAppChat,
    openCustomDatePicker, showStatusTooltip, hideStatusTooltip, renderLogs,
    updateEditDateField, addToActivityLog, debouncedSaveSingleRow 
});

document.addEventListener('DOMContentLoaded', () => {
    initDatePicker();
    loadLogsData();
    listenToOpportunities();
});