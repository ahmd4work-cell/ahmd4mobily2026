// ==========================================
// visits.js - إدارة الزيارات سحابياً
// ==========================================
import { db } from './firebase-config.js';
import { collection, onSnapshot, doc, setDoc, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

let currentActivePreview = null;
let saveTimeout;
let searchTimeout;
const LOGS_KEY = 'asgate_visits_logs_v1';

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
        Swal.fire('خطأ', 'تعذر إضافة الزيارة في السحابة', 'error');
    }
}

function listenToVisits() {
    const visitsRef = collection(db, "visits");
    onSnapshot(visitsRef, (snapshot) => {
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
        let visitsData = [];
        if (!snapshot.empty) {
            snapshot.forEach((docSnapshot) => {
                const data = docSnapshot.data();
                data.id = docSnapshot.id;
                visitsData.push(data);
            });
        }
        
        visitsData.sort((a, b) => parseDate(b.visitDate) - parseDate(a.visitDate));
        
        let currentMonthGroup = "";
        visitsData.forEach((v) => {
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
        
        updateStats();
        renderActivityLog();

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
    });
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
    const notesJson = v.notes || "[]";
    const lastNoteText = getLastNoteOnlyFromJSON(notesJson);
    const editDateHTML = parseEditDateHTML(v.editDate || '');

    mainRow.innerHTML = `
        <td class="col-select">
            <input type="checkbox" class="select-check">
            <span class="toggle-arrow" onclick="toggleSubTable('${rowId}')"><i class="fas fa-caret-left"></i></span>
        </td>
        <td>
            <div class="custom-tooltip-container" data-tooltip="${v.comp || ''}">
                <input type="text" class="excel-input" value="${v.comp || ''}" data-old="${v.comp || ''}" onfocus="this.dataset.old=this.value" oninput="this.closest('.custom-tooltip-container').setAttribute('data-tooltip', this.value)" onkeyup="updateEditDateField(this.closest('tr'));" onchange="saveSingleRow('${rowId}');" onblur="addToActivityLog('الشركة', this.dataset.old, this.value, this.value); this.dataset.old=this.value;">
            </div>
        </td>
        <td><input type="text" class="excel-input" value="${v.address || ''}" data-old="${v.address || ''}" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr'));" onchange="saveSingleRow('${rowId}');" onblur="addToActivityLog('العنوان', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value); this.dataset.old=this.value;"></td>
        <td><input type="text" class="excel-input" value="${v.mgr || ''}" data-old="${v.mgr || ''}" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr'));" onchange="saveSingleRow('${rowId}');" onblur="addToActivityLog('المسؤول', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value); this.dataset.old=this.value;"></td>
        <td>
            <div class="phone-cell-container">
                <a class="whatsapp-icon-btn" onclick="openWhatsAppChat(this)" title="مراسلة عبر واتساب"><i class="fa-brands fa-whatsapp"></i></a>
                <input type="text" class="excel-input" value="${v.mob || ''}" data-old="${v.mob || ''}" oninput="this.value = this.value.replace(/[^0-9]/g, '');" onkeyup="updateEditDateField(this.closest('tr'));" onchange="saveSingleRow('${rowId}');" onfocus="this.dataset.old=this.value" onblur="addToActivityLog('رقم التواصل', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value); this.dataset.old=this.value;">
            </div>
        </td>
        <td><input type="text" class="excel-input" value="${v.email || ''}" data-old="${v.email || ''}" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr'));" onchange="saveSingleRow('${rowId}');" onblur="addToActivityLog('الإيميل', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value); this.dataset.old=this.value;"></td>
        <td><input type="text" class="excel-input" value="${v.record || ''}" data-old="${v.record || ''}" oninput="this.value = this.value.replace(/[^0-9]/g, '');" onkeyup="updateEditDateField(this.closest('tr'));" onchange="saveSingleRow('${rowId}');" onfocus="this.dataset.old=this.value" onblur="addToActivityLog('السجل', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value); this.dataset.old=this.value;"></td>
        <td>
            <input type="text" dir="ltr" class="excel-input readonly-input" value="${visitDate}" style="color:var(--text-muted); font-weight:700; unicode-bidi: isolate; cursor: pointer;" readonly onclick="openDatePicker('${rowId}')" title="انقر لتعديل التاريخ">
            <input type="hidden" class="visit-date-val opp-date-val" value="${visitDate}">
        </td>
        <td>
            <div class="custom-tooltip-container" data-tooltip="${v.curServ || ''}">
                <input type="text" class="excel-input cur-serv-val" value="${v.curServ || ''}" data-old="${v.curServ || ''}" onfocus="this.dataset.old=this.value" oninput="this.closest('.custom-tooltip-container').setAttribute('data-tooltip', this.value)" onkeyup="updateEditDateField(this.closest('tr'));" onchange="saveSingleRow('${rowId}');" onblur="addToActivityLog('الخدمة', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value); this.dataset.old=this.value;">
            </div>
        </td>
        <td><input type="number" class="excel-input opp-value-input readonly-input" value="${v.oppValue || ''}" readonly style="color:var(--accent-blue); font-weight:800; cursor:not-allowed; background: transparent;"></td>
        <td><div class="notes-preview" onclick="openNote(this)" data-full-notes='${notesJson.replace(/'/g, "&apos;")}' id="preview-${Date.now()}">${lastNoteText}</div></td>
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
        <td><input type="text" class="excel-input" value="${v.owner || ''}" data-old="${v.owner || ''}" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr'));" onchange="saveSingleRow('${rowId}');" onblur="addToActivityLog('المالك', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value); this.dataset.old=this.value;"></td>
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
        <td><select onchange="updateEditDateField(this.closest('.sub-table-row').previousElementSibling); saveSingleRow('${rowId}');"><option value="">-</option><option value="جوال" ${data.type === 'جوال' ? 'selected' : ''}>جوال</option><option value="بيانات" ${data.type === 'بيانات' ? 'selected' : ''}>بيانات</option><option value="هاتف" ${data.type === 'هاتف' ? 'selected' : ''}>هاتف</option><option value="فايبر نت" ${data.type === 'فايبر نت' ? 'selected' : ''}>فايبر نت</option><option value="DIA" ${data.type === 'DIA' ? 'selected' : ''}>DIA</option><option value="IPVPN" ${data.type === 'IPVPN' ? 'selected' : ''}>IPVPN</option><option value="SIP" ${data.type === 'SIP' ? 'selected' : ''}>SIP</option></select></td>
        <td><input type="text" value="${data.desc || ''}" onkeyup="updateEditDateField(this.closest('.sub-table-row').previousElementSibling);" onchange="saveSingleRow('${rowId}');"></td>
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
    if (shouldSave) saveSingleRow(rowId);
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
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => { saveSingleRow(rowId); }, 600);
}

async function handleStatusChange(selectEl, rowId) {
    const newVal = selectEl.value; 
    const oldVal = selectEl.dataset.old; 
    const mainRow = selectEl.closest('tr');
    const companyName = mainRow.cells[1].querySelector('input').value;
    
    applyStatusColor(selectEl); 
    addToActivityLog('الحالة', oldVal, newVal, companyName); 
    updateEditDateField(mainRow); 
    saveSingleRow(rowId); 

    if (newVal === 'تأهيل لفرصة' && oldVal !== 'تأهيل لفرصة') {
        const confirm = await Swal.fire({
            title: 'تأهيل لفرصة بيعية؟',
            text: 'هل تريد نقل هذا العميل تلقائياً إلى الفرص البيعية؟',
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#3b82f6',
            cancelButtonColor: '#94a3b8',
            confirmButtonText: 'نعم، قم بالنقل',
            cancelButtonText: 'إلغاء'
        });

        if (confirm.isConfirmed) {
            const subRow = document.getElementById('sub-' + rowId); 
            const products = [];
            if (subRow) { subRow.querySelectorAll('.product-body tr').forEach(pRow => { const inputs = pRow.querySelectorAll('input, select'); if (inputs.length >= 5) products.push({ type: inputs[0].value, desc: inputs[1].value, qty: inputs[2].value, sub: inputs[3].value, total: inputs[4].value }); }); }
            
            const oppData = { 
                comp: mainRow.cells[1].querySelector('input').value, 
                address: mainRow.cells[2].querySelector('input').value, 
                mgr: mainRow.cells[3].querySelector('input').value, 
                mob: mainRow.cells[4].querySelector('input').value, 
                email: mainRow.cells[5].querySelector('input').value, 
                record: mainRow.cells[6].querySelector('input').value, 
                oppDate: mainRow.querySelector('.visit-date-val').value, 
                curServ: mainRow.cells[8].querySelector('input').value, 
                oppValue: mainRow.cells[9].querySelector('input').value, 
                notes: mainRow.cells[10].querySelector('.notes-preview').getAttribute('data-full-notes') || '[]', 
                status: 'مهتم', 
                expDate: '', 
                editDate: getTodayFormatted() + ' ' + getTimeFormatted(), 
                owner: mainRow.cells[13].querySelector('input').value, 
                products: products 
            };

            try {
                // استخدام writeBatch لضمان نقل آمن دون فقدان بيانات
                const batch = writeBatch(db);
                batch.set(doc(db, "opportunities", rowId), oppData);
                batch.delete(doc(db, "visits", rowId));
                await batch.commit();

                Swal.fire({icon: 'success', title: 'تم النقل بنجاح', text: 'تمت إضافة العميل لقائمة الفرص بنجاح.', timer: 2000, showConfirmButton: false});
            } catch(e) {
                console.error("خطأ أثناء النقل:", e);
                Swal.fire('خطأ', 'تعذر نقل العميل، يرجى المحاولة مجدداً.', 'error');
            }
        } else {
            selectEl.value = oldVal;
            applyStatusColor(selectEl);
            return;
        }
    }
    
    updateStats(); 
    selectEl.dataset.old = newVal;
}

function applyStatusColor(selectEl) { 
    if (!selectEl) return; 
    const val = selectEl.value; 
    const mainRow = selectEl.closest('.main-row'); 
    
    selectEl.classList.remove('status-green', 'status-yellow-ffc', 'status-yellow-fff', 'status-gray-a5', 'status-red-c00'); 
    if (mainRow) mainRow.classList.remove('row-shrink'); 
    
    if (val === 'تأهيل لفرصة') {
        selectEl.classList.add('status-green'); 
    } else if (val === 'متابعة') {
        selectEl.classList.add('status-yellow-fff'); 
    } else if (val === 'عرض سعر') {
        selectEl.classList.add('status-yellow-ffc'); 
    } else if (val === 'غير مهتم') { 
        selectEl.classList.add('status-gray-a5'); 
        if (mainRow) mainRow.classList.add('row-shrink'); 
    } else if (val === 'فقدان') { 
        selectEl.classList.add('status-red-c00'); 
        if (mainRow) mainRow.classList.add('row-shrink'); 
    } 
}

function openNote(el) {
    currentActivePreview = el; 
    let arr = []; try { arr = JSON.parse(el.getAttribute('data-full-notes') || "[]"); } catch(e) {}
    const historyLog = document.getElementById('historyLog'); 
    const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    
    if (historyLog) { 
        historyLog.innerHTML = arr.map(msg => { 
            let msgDateObj = parseDate(msg.date); 
            let dayStr = isNaN(msgDateObj) ? '' : days[msgDateObj.getDay()] + ' '; 
            let userName = msg.user && msg.user !== "المستخدم" ? msg.user : "المستخدم"; 
            return `<div class="log-entry" style="display: block; line-height: 1.6;"><div style="margin-bottom: 4px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;"><span class="log-badge-user"><i class="fas fa-user-circle"></i> ${userName}</span><span class="log-divider">|</span><span class="log-timestamp" dir="ltr">${msg.time} <i class="fas fa-clock"></i> ${dayStr}${msg.date}</span></div><div class="log-action" style="padding-right: 5px; color: #0f172a; font-size: 11px; font-weight: 700; white-space: pre-wrap;">${msg.text}</div></div>`; 
        }).join('') || '<div style="color:#64748b; text-align:center; font-size:10px; padding:20px; font-weight:700;">لا توجد ملاحظات سابقة</div>'; 
    }
    const noteModal = document.getElementById('noteModal'); if (noteModal) noteModal.style.display = "flex"; 
    const modalTextArea = document.getElementById('modalTextArea'); if (modalTextArea) { modalTextArea.value = ""; modalTextArea.focus(); }
}

function saveNote() { 
    const txt = document.getElementById('modalTextArea').value.trim(); 
    if (txt && currentActivePreview) { 
        let arr = []; try { arr = JSON.parse(currentActivePreview.getAttribute('data-full-notes') || "[]"); } catch(e) {} 
        let username = "المستخدم"; 
        const mainRow = currentActivePreview.closest('.main-row'); 
        if (mainRow) { const ownerInput = mainRow.cells[13]?.querySelector('input'); if (ownerInput && ownerInput.value.trim()) username = ownerInput.value.trim(); } 
        arr.push({ user: username, date: getTodayFormatted(), time: getTimeFormatted(), text: txt }); 
        currentActivePreview.setAttribute('data-full-notes', JSON.stringify(arr)); 
        currentActivePreview.innerText = txt; 
        if (mainRow) { updateEditDateField(mainRow); saveSingleRow(mainRow.id); } 
    } 
    closeNote(); 
}

function closeNote() { document.getElementById('noteModal').style.display = "none"; }

function updateEditDateField(row) { 
    if (!row) return; 
    const dateFormatted = getTodayFormatted(); 
    const time24 = getTimeFormatted(); 
    const hiddenInput = row.querySelector('.edit-date-val'); 
    
    if (hiddenInput) hiddenInput.value = `${dateFormatted} ${time24}`; 
    
    const editMains = row.querySelector('.edit-date-container-main'); 
    if(editMains) editMains.innerHTML = `<span class="edit-date-d" dir="ltr">${dateFormatted}</span>`; 
    
    const subRow = document.getElementById('sub-' + row.id); 
    if (subRow) { 
        const subContainer = subRow.querySelector('.edit-date-container-sub'); 
        if (subContainer) subContainer.innerHTML = `<span class="edit-date-d" dir="ltr">${dateFormatted}</span>`; 
    } 
}

function parseEditDateHTML(fullDateTime) { 
    if (!fullDateTime) return `<span class="edit-date-d" dir="ltr"></span>`;
    if (!fullDateTime.includes(' ')) return `<span class="edit-date-d" dir="ltr">${formatAsDDMMYYYY(fullDateTime) || ''}</span>`; 
    
    const parts = fullDateTime.split(' '); 
    return `<span class="edit-date-d" dir="ltr">${formatAsDDMMYYYY(parts[0])}</span>`; 
}

function toggleSubTable(rowId) { const sub = document.getElementById('sub-' + rowId); const arrows = document.querySelectorAll(`#${rowId} .toggle-arrow i`); if (!sub) return; const isOpen = sub.style.display === 'table-row'; sub.style.display = isOpen ? 'none' : 'table-row'; arrows.forEach(arrow => arrow.className = isOpen ? 'fas fa-caret-left' : 'fas fa-caret-down'); }
function toggleLogExpansion() { const logSection = document.getElementById('activityLogSection'); const toggleBtn = document.getElementById('toggleExpandBtn'); if (logSection.classList.contains('expanded')) { logSection.classList.remove('expanded'); toggleBtn.innerHTML = '<i class="fas fa-expand-alt"></i>'; } else { logSection.classList.add('expanded'); toggleBtn.innerHTML = '<i class="fas fa-compress-alt"></i>'; } }
function toggleAllCheckboxes(source) { document.querySelectorAll('.select-check').forEach(chk => chk.checked = source.checked); }
function toggleDropdown(e, btn) { e.stopPropagation(); const menu = btn.nextElementSibling; document.querySelectorAll('.dropdown-menu').forEach(m => { if(m !== menu) m.classList.remove('show'); }); menu.classList.toggle('show'); }

async function handleBulkAction(action) {
    const selected = document.querySelectorAll('.select-check:checked');
    if (selected.length === 0) { Swal.fire({icon: 'info', text: 'يرجى تحديد صف واحد على الأقل', confirmButtonText: 'حسناً', confirmButtonColor: '#3b82f6'}); return; }
    
    if (action === 'حذف') {
        const result = await Swal.fire({ title: 'تأكيد الحذف؟', text: "سيتم حذف الزيارات المحددة نهائياً!", icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#94a3b8', confirmButtonText: 'نعم، احذف', cancelButtonText: 'إلغاء' });
        
        if (result.isConfirmed) {
            try {
                // استخدام writeBatch للحذف الجماعي لضمان معالجة خالية من الأخطاء
                const batch = writeBatch(db);
                for (let chk of selected) {
                    const row = chk.closest('tr');
                    if (row && row.id) {
                        batch.delete(doc(db, "visits", row.id));
                    }
                }
                await batch.commit();
                Swal.fire({icon: 'success', title: 'تم الحذف', showConfirmButton: false, timer: 1500});
            } catch (e) {
                console.error("خطأ أثناء الحذف الجماعي:", e);
                Swal.fire('خطأ', 'حدث خطأ أثناء إتمام عملية الحذف.', 'error');
            }
        }
    }
}

function updateStats() { 
    const rows = document.querySelectorAll('#tableBody .main-row'); 
    const dToday = new Date();
    const currentMonthYear = String(dToday.getMonth() + 1).padStart(2, '0') + '-' + dToday.getFullYear();
    const todayFormatted = getTodayFormatted(); 
    
    let total = rows.length, tDay = 0, tMonth = 0, valTotal = 0, valMonth = 0; 
    
    rows.forEach(row => { 
        const dateInput = row.querySelector('.visit-date-val'); 
        const visitValInput = row.querySelector('.opp-value-input'); 
        const statusSelect = row.querySelector('.status-select');
        const currentStatus = statusSelect ? statusSelect.value : '';

        const visitVal = visitValInput ? parseFloat(visitValInput.value) || 0 : 0; 
        const isValuable = (currentStatus === 'عرض سعر' || currentStatus === 'متابعة');
        
        if (isValuable) {
            valTotal += visitVal; 
        }
        
        if (dateInput) { 
            const dateVal = dateInput.value; 
            const parsedD = parseDate(dateVal);
            const rowMonthYear = String(parsedD.getMonth() + 1).padStart(2, '0') + '-' + parsedD.getFullYear();
            
            if (dateVal === todayFormatted || (parsedD.getDate() === dToday.getDate() && parsedD.getMonth() === dToday.getMonth() && parsedD.getFullYear() === dToday.getFullYear())) {
                tDay++;
            }
            if (rowMonthYear === currentMonthYear) { 
                tMonth++; 
                if (isValuable) {
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

function getLastNoteOnlyFromJSON(jsonStr) { try { const arr = JSON.parse(jsonStr); return arr.length > 0 ? arr[arr.length - 1].text : "أضف ملاحظة..."; } catch(e) { return "أضف ملاحظة..."; } }

function addToActivityLog(fieldName, oldVal, newVal, companyName) { 
    if (oldVal === newVal) return; 
    let logs = []; try { logs = JSON.parse(localStorage.getItem(LOGS_KEY) || "[]"); } catch(e) {}
    const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']; 
    const d = new Date(); 
    let dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0'), yyyy = d.getFullYear(); 
    const dayName = days[d.getDay()];
    const timeStr = getTimeFormatted();
    const cleanCompany = companyName || 'شركة غير مسماة'; 
    let actionText = fieldName === 'إجراء' ? `${oldVal} لزيارة شركة ( ${cleanCompany} )` : `تعديل ${fieldName} من [${oldVal || 'فارغ'}] إلى [${newVal || 'فارغ'}] لزيارة العميل ( ${cleanCompany} )`; 
    
    const fullLogHTML = `<div class="log-entry"><span class="log-badge-user"><i class="fas fa-user-circle"></i> المستخدم</span><span class="log-divider">|</span><span class="log-timestamp" dir="ltr">${timeStr} <i class="fas fa-clock"></i> ${dd}-${mm}-${yyyy} ${dayName}</span><span class="log-divider">|</span><span class="log-action">${actionText}</span></div>`; 
    logs.unshift(fullLogHTML);
    logs = logs.slice(0, 100);
    localStorage.setItem(LOGS_KEY, JSON.stringify(logs));
    renderActivityLog();
}

function renderActivityLog() { 
    const list = document.getElementById('activityList'); 
    if (!list) return; 
    let logs = []; try { logs = JSON.parse(localStorage.getItem(LOGS_KEY) || "[]"); } catch(e) {}
    list.innerHTML = logs.join(''); 
}

function debouncedFilterTable() { clearTimeout(searchTimeout); searchTimeout = setTimeout(() => {
    const q = document.getElementById('searchInput').value.toLowerCase().trim();
    document.querySelectorAll('.main-row').forEach(row => {
        const text = Array.from(row.cells).slice(1, 7).map(c => c.querySelector('input')?.value.toLowerCase() || '').join(' ');
        const subRow = document.getElementById('sub-' + row.id);
        if (text.includes(q)) { row.style.display = 'table-row'; } else { row.style.display = 'none'; if(subRow) subRow.style.display = 'none'; }
    });
}, 300); }

function openWhatsAppChat(el) { const inputEl = el.closest('.phone-cell-container').querySelector('input'); let rawPhone = inputEl.value.trim(); if (!rawPhone) { Swal.fire({icon: 'warning', title: 'تنبيه', text: 'يرجى إدخال رقم الجوال أولاً', confirmButtonText: 'حسناً', confirmButtonColor: '#3b82f6'}); return; } let cleanNumber = rawPhone.replace(/\D/g, ''); if (cleanNumber.startsWith('00966')) cleanNumber = cleanNumber.substring(2); else if (cleanNumber.startsWith('05')) cleanNumber = '966' + cleanNumber.substring(1); else if (cleanNumber.startsWith('5') && cleanNumber.length === 9) cleanNumber = '966' + cleanNumber; window.open("https://wa.me/" + cleanNumber, '_blank'); }

// ==========================================
// دوال التقويم المخصصة (Datepicker Functions)
// ==========================================
let targetRowForDatePicker = null;
let currentDateForPicker = new Date();

function openDatePicker(rowId) {
    targetRowForDatePicker = rowId;
    const row = document.getElementById(rowId);
    if (!row) return;
    
    const hiddenInput = row.querySelector('.visit-date-val');
    let d = parseDate(hiddenInput.value);
    if (isNaN(d.getTime())) d = new Date();
    currentDateForPicker = new Date(d.getTime());

    initDatePickerSelects();
    renderCalendarDays(currentDateForPicker);
    document.getElementById('customDatePicker').classList.add('active');
}

function closeDatePicker() {
    const overlay = document.getElementById('customDatePicker');
    if (overlay) overlay.classList.remove('active');
    targetRowForDatePicker = null;
}

function setTodayDate() {
    const today = new Date();
    selectDate(today.getDate(), today.getMonth(), today.getFullYear());
}

function initDatePickerSelects() {
    const monthSel = document.getElementById('dpMonth');
    const yearSel = document.getElementById('dpYear');
    
    if (monthSel.options.length === 0) {
        const months = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
        months.forEach((m, i) => {
            const opt = document.createElement('option');
            opt.value = i; opt.text = m; monthSel.add(opt);
        });
        
        const curYear = new Date().getFullYear();
        for (let y = curYear - 5; y <= curYear + 5; y++) {
            const opt = document.createElement('option');
            opt.value = y; opt.text = y; yearSel.add(opt);
        }
        
        monthSel.addEventListener('change', updateCalendarFromSelects);
        yearSel.addEventListener('change', updateCalendarFromSelects);
    }
}

function updateCalendarFromSelects() {
    const m = parseInt(document.getElementById('dpMonth').value);
    const y = parseInt(document.getElementById('dpYear').value);
    currentDateForPicker.setMonth(m);
    currentDateForPicker.setFullYear(y);
    renderCalendarDays(currentDateForPicker);
}

function renderCalendarDays(dateObj) {
    const month = dateObj.getMonth();
    const year = dateObj.getFullYear();
    
    document.getElementById('dpMonth').value = month;
    document.getElementById('dpYear').value = year;

    const dpDays = document.getElementById('dpDays');
    dpDays.innerHTML = '';

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    
    let targetSelectedDate = null;
    if (targetRowForDatePicker) {
        const row = document.getElementById(targetRowForDatePicker);
        if (row) {
            targetSelectedDate = parseDate(row.querySelector('.visit-date-val').value);
        }
    }

    for (let i = 0; i < firstDay; i++) {
        const emptyDiv = document.createElement('div');
        dpDays.appendChild(emptyDiv);
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const dayDiv = document.createElement('div');
        dayDiv.className = 'day-number';
        dayDiv.innerText = d;
        
        const currentIterDate = new Date(year, month, d);
        if (currentIterDate.getDay() === 0 || currentIterDate.getDay() === 6) {
            dayDiv.classList.add('weekend-day'); 
        }

        if (d === today.getDate() && month === today.getMonth() && year === today.getFullYear()) {
            dayDiv.classList.add('today-day');
        }

        if (targetSelectedDate && d === targetSelectedDate.getDate() && month === targetSelectedDate.getMonth() && year === targetSelectedDate.getFullYear()) {
            dayDiv.classList.add('selected-day');
        }

        dayDiv.onclick = () => selectDate(d, month, year);
        dpDays.appendChild(dayDiv);
    }
}

function selectDate(d, m, y) {
    if (!targetRowForDatePicker) return;
    const formattedDate = String(d).padStart(2, '0') + '-' + String(m + 1).padStart(2, '0') + '-' + y;
    const row = document.getElementById(targetRowForDatePicker);
    
    if (row) {
        const visibleInput = row.cells[7].querySelector('.excel-input');
        const hiddenInput = row.cells[7].querySelector('.visit-date-val');
        const oldVal = hiddenInput.value;
        
        visibleInput.value = formattedDate;
        hiddenInput.value = formattedDate;
        
        updateEditDateField(row);
        saveSingleRow(targetRowForDatePicker);
        
        const compName = row.cells[1].querySelector('input').value;
        addToActivityLog('تاريخ الزيارة', oldVal, formattedDate, compName);
        updateStats();
    }
    closeDatePicker();
}

Object.assign(window, {
    insertNewRow, toggleSubTable, addProductRow, calculateMainVisitValue,
    saveSingleRow, debouncedSaveSingleRow, updateEditDateField,
    addToActivityLog, openNote, closeNote, saveNote, handleStatusChange,
    toggleAllCheckboxes, toggleDropdown, handleBulkAction, toggleLogExpansion,
    debouncedFilterTable, openWhatsAppChat,
    openDatePicker, closeDatePicker, setTodayDate 
});

document.addEventListener('DOMContentLoaded', () => { listenToVisits(); });