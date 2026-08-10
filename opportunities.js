// ==========================================
// opportunities.js - إدارة الفرص البيعية سحابياً
// ==========================================
import { db } from './firebase-config.js';
import { collection, onSnapshot, doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

let currentActivePreview = null;
let saveTimeout;
let searchTimeout;
const LOGS_KEY = 'asgate_opportunities_logs_v1';

// تهيئة الاستماع اللحظي لسحابة Firestore
function listenToOpportunities() {
    const oppsRef = collection(db, "opportunities");
    onSnapshot(oppsRef, (snapshot) => {
        const tbody = document.getElementById('tableBody');
        if (!tbody) return;

        let activeId = null;
        let activeClass = null;
        let selectionStart = 0;
        if (document.activeElement && document.activeElement.tagName === 'INPUT') {
            const tr = document.activeElement.closest('tr');
            if (tr) {
                activeId = tr.id;
                activeClass = document.activeElement.className;
                try { selectionStart = document.activeElement.selectionStart; } catch(e){}
            }
        }

        tbody.innerHTML = '';
        if (!snapshot.empty) {
            snapshot.forEach((docSnapshot) => {
                const data = docSnapshot.data();
                data.id = docSnapshot.id;
                renderRow(data, false);
            });
        }
        
        reorderRows();
        updateStats();
        renderActivityLog();

        if (activeId && activeClass) {
            const activeRow = document.getElementById(activeId);
            if (activeRow) {
                const inputToFocus = activeRow.querySelector(`[class="${activeClass}"]`);
                if (inputToFocus) {
                    inputToFocus.focus();
                    try { inputToFocus.setSelectionRange(selectionStart, selectionStart); } catch(e){}
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
        <td><input type="text" class="excel-input" value="${v.comp || ''}" data-old="${v.comp || ''}" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr')); debouncedSaveSingleRow('${rowId}');" onblur="addToActivityLog('الشركة', this.dataset.old, this.value, this.value); this.dataset.old=this.value;"></td>
        <td><input type="text" class="excel-input" value="${v.address || ''}" data-old="${v.address || ''}" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr')); debouncedSaveSingleRow('${rowId}');" onblur="addToActivityLog('العنوان', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value); this.dataset.old=this.value;"></td>
        <td><input type="text" class="excel-input" value="${v.mgr || ''}" data-old="${v.mgr || ''}" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr')); debouncedSaveSingleRow('${rowId}');" onblur="addToActivityLog('المسؤول', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value); this.dataset.old=this.value;"></td>
        <td>
            <div class="phone-cell-container">
                <a class="whatsapp-icon-btn" onclick="openWhatsAppChat(this)" title="مراسلة عبر واتساب"><i class="fa-brands fa-whatsapp"></i></a>
                <input type="text" class="excel-input" value="${v.mob || ''}" data-old="${v.mob || ''}" oninput="this.value = this.value.replace(/[^0-9]/g, ''); debouncedSaveSingleRow('${rowId}');" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr'));" onblur="addToActivityLog('رقم التواصل', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value); this.dataset.old=this.value;">
            </div>
        </td>
        <td><input type="text" class="excel-input" value="${v.email || ''}" data-old="${v.email || ''}" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr')); debouncedSaveSingleRow('${rowId}');" onblur="addToActivityLog('الإيميل', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value); this.dataset.old=this.value;"></td>
        <td><input type="text" class="excel-input" value="${v.record || ''}" data-old="${v.record || ''}" oninput="this.value = this.value.replace(/[^0-9]/g, ''); debouncedSaveSingleRow('${rowId}');" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr'));" onblur="addToActivityLog('السجل', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value); this.dataset.old=this.value;"></td>
        <td><input type="text" class="excel-input readonly-input" value="${oppDate}" style="color:var(--text-muted); font-weight:700;" readonly><input type="hidden" class="opp-date-val" value="${oppDate}"></td>
        <td><input type="text" class="excel-input cur-serv-val" value="${v.curServ || ''}" data-old="${v.curServ || ''}" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr')); debouncedSaveSingleRow('${rowId}');" onblur="addToActivityLog('الخدمة', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value); this.dataset.old=this.value;" onmouseenter="showStatusTooltip(this)" onmouseleave="hideStatusTooltip()"></td>
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
            <input type="text" class="excel-input exp-date-input readonly-input" value="${v.expDate || ''}" data-old="${v.expDate || ''}" readonly style="cursor:pointer;" onclick="openCustomDatePicker(event, this, '${rowId}')" placeholder="اختر التاريخ">
            <input type="hidden" class="edit-date-val" value="${v.editDate || ''}">
        </td>
        <td><input type="text" class="excel-input" value="${v.owner || ''}" data-old="${v.owner || ''}" onfocus="this.dataset.old=this.value" onkeyup="updateEditDateField(this.closest('tr')); debouncedSaveSingleRow('${rowId}');" onblur="addToActivityLog('المالك', this.dataset.old, this.value, this.closest('tr').cells[1].querySelector('input').value); this.dataset.old=this.value;"></td>
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
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => { saveSingleRow(rowId); }, 600);
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
                }
            }
            Swal.fire({icon: 'success', title: 'تم الحذف', showConfirmButton: false, timer: 1500});
        }
    }
}

function handleStatusChange(selectEl, rowId) {
    const newVal = selectEl.value; const oldVal = selectEl.dataset.old; const companyName = selectEl.closest('tr').cells[1].querySelector('input').value;
    applyStatusColor(selectEl); addToActivityLog('الحالة', oldVal, newVal, companyName); updateEditDateField(selectEl.closest('tr')); saveSingleRow(rowId); updateStats(); selectEl.dataset.old = newVal;
}

function applyStatusColor(selectEl) { 
    if (!selectEl) return; 
    const val = selectEl.value; 
    const mainRow = selectEl.closest('.main-row'); 
    
    selectEl.classList.remove('status-yellow', 'status-green', 'status-red'); 
    if (mainRow) mainRow.classList.remove('closed-row'); 
    
    if (val === 'مهتم') {
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
        const dateInput = row.querySelector('.exp-date-input');
        if(!dateInput) return;
        const status = row.querySelector('.status-select').value;

        dateInput.classList.remove('date-today', 'date-warning', 'date-past');
        if (status === 'رابح' || status === 'فقدان') return;

        const dVal = dateInput.value;
        if (!dVal) return;

        const expDateObj = new Date(dVal);
        const diffDays = Math.round((expDateObj - todayObj) / (1000 * 60 * 60 * 24));

        if (diffDays < 0) dateInput.classList.add('date-past');       
        else if (diffDays === 0) dateInput.classList.add('date-today');      
        else if (diffDays > 0 && diffDays <= 3) dateInput.classList.add('date-warning');    
    });
}

function openNote(el) {
    currentActivePreview = el;
    let arr = []; try { arr = JSON.parse(el.getAttribute('data-full-notes') || "[]"); } catch(e) {}
    const historyLog = document.getElementById('historyLog');
    const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

    if (historyLog) {
        historyLog.innerHTML = arr.map(msg => {
            let msgDateObj = new Date(msg.date);
            let dayStr = isNaN(msgDateObj) ? '' : days[msgDateObj.getDay()] + ' ';
            let userName = msg.user && msg.user !== "المستخدم" ? msg.user : "المستخدم";

            return `
            <div class="log-entry" style="display: block; line-height: 1.6;">
                <div style="margin-bottom: 4px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <span class="log-badge-user"><i class="fas fa-user-circle"></i> ${userName}</span>
                    <span class="log-divider">|</span>
                    <span class="log-timestamp"><i class="fas fa-clock"></i> ${dayStr}${msg.date} ${msg.time}</span>
                </div>
                <div class="log-action" style="padding-right: 5px; color: #0f172a; font-size: 11px; font-weight: 700; white-space: pre-wrap;">${msg.text}</div>
            </div>
            `;
        }).join('') || '<div style="color:#64748b; text-align:center; font-size:10px; padding:20px; font-weight:700;">لا توجد ملاحظات سابقة</div>';
    }
    
    const noteModal = document.getElementById('noteModal');
    if (noteModal) noteModal.style.display = "flex";
    const modalTextArea = document.getElementById('modalTextArea');
    if (modalTextArea) { modalTextArea.value = ""; modalTextArea.focus(); }
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
function toggleLogExpansion() { const logSection = document.getElementById('activityLogSection'); const toggleBtn = document.getElementById('toggleExpandBtn'); if (logSection.classList.contains('expanded')) { logSection.classList.remove('expanded'); toggleBtn.innerHTML = '<i class="fas fa-expand-alt"></i>'; } else { logSection.classList.add('expanded'); toggleBtn.innerHTML = '<i class="fas fa-compress-alt"></i>'; } }

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
    
    rowsData.sort((a, b) => a.date.localeCompare(b.date)); 
    
    const groups = {}; 
    rowsData.forEach(item => { 
        const month = item.date === '9999-12-31' ? 'بدون تاريخ متوقع' : item.date.substring(0, 7); 
        if (!groups[month]) groups[month] = []; 
        groups[month].push(item); 
    }); 
    
    tbody.innerHTML = ''; 
    const fragment = document.createDocumentFragment(); 
    
    const sortedMonths = Object.keys(groups).sort((a, b) => {
        if (a === currentMonth) return -1;
        if (b === currentMonth) return 1;
        if (a === 'بدون تاريخ متوقع') return 1;
        if (b === 'بدون تاريخ متوقع') return -1;
        return b.localeCompare(a);
    });

    sortedMonths.forEach(month => { 
        const sepRow = document.createElement('tr'); 
        sepRow.className = 'month-separator'; 
        const isCurrentMonth = (month === currentMonth); 
        const sepStyle = isCurrentMonth 
            ? 'background-color: #a855f7 !important; color:#fff !important; box-shadow: 0 2px 4px rgba(168,85,247,0.3);' 
            : 'background-color: #3b82f6 !important; color:#fff !important; box-shadow: 0 2px 4px rgba(59,130,246,0.3);'; 
        
        const monthText = month === 'بدون تاريخ متوقع' ? month : `الفرص المتوقعة لشهر ${month}`;

        sepRow.innerHTML = `<td colspan="14"><div class="sep-text" style="${sepStyle}"><i class="far fa-calendar-alt"></i> ${monthText}</div></td>`; 
        fragment.appendChild(sepRow); 
        groups[month].forEach(item => { fragment.appendChild(item.row); if (item.subRow) fragment.appendChild(item.subRow); }); 
    }); 
    tbody.appendChild(fragment); 
    updateAllDateColors();
}

function updateStats() { 
    const rows = document.querySelectorAll('#tableBody .main-row'); 
    const today = getTodayFormatted(), currentMonth = today.substring(0, 7); 
    let total = rows.length, tDay = 0, tMonth = 0, valTotal = 0, valMonth = 0; 
    rows.forEach(row => { 
        const dateInput = row.querySelector('.opp-date-val'); 
        const visitValInput = row.querySelector('.opp-value-input'); 
        const visitVal = visitValInput ? parseFloat(visitValInput.value) || 0 : 0; 
        valTotal += visitVal; 
        if (dateInput) { 
            const date = dateInput.value; 
            if (date === today) tDay++; 
            if (date.startsWith(currentMonth)) { tMonth++; valMonth += visitVal; } 
        } 
    }); 
    if (document.getElementById('stat-total')) document.getElementById('stat-total').innerText = total; 
    if (document.getElementById('stat-today')) document.getElementById('stat-today').innerText = tDay; 
    if (document.getElementById('stat-month')) document.getElementById('stat-month').innerText = tMonth; 
    if (document.getElementById('stat-value-total')) document.getElementById('stat-value-total').innerText = valTotal.toLocaleString() + ' ر.س'; 
    if (document.getElementById('stat-value-month')) document.getElementById('stat-value-month').innerText = valMonth.toLocaleString() + ' ر.س'; 
}

function addToActivityLog(fieldName, oldVal, newVal, companyName) { 
    if (oldVal === newVal) return; 
    let logs = []; try { logs = JSON.parse(localStorage.getItem(LOGS_KEY) || "[]"); } catch(e) {}
    
    const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']; 
    const d = new Date(); 
    let dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0'), yyyy = d.getFullYear(); 
    const dayName = days[d.getDay()];
    const timeStr = getTimeFormatted();
    const cleanCompany = companyName || 'شركة غير مسماة'; 
    let actionText = fieldName === 'إجراء' ? `${oldVal} لفرصة شركة ( ${cleanCompany} )` : `تعديل ${fieldName} من [${oldVal || 'فارغ'}] إلى [${newVal || 'فارغ'}] لفرصة العميل ( ${cleanCompany} )`; 
    
    const fullLogHTML = `
        <div class="log-entry">
            <span class="log-badge-user"><i class="fas fa-user-circle"></i> المستخدم</span>
            <span class="log-divider">|</span>
            <span class="log-timestamp"><i class="fas fa-clock"></i> ${dayName} ${yyyy}-${mm}-${dd} ${timeStr}</span>
            <span class="log-divider">|</span>
            <span class="log-action">${actionText}</span>
        </div>
    `; 
    
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

function getTodayFormatted() { return new Date().toISOString().split('T')[0]; } 
function getTimeFormatted() { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ":" + String(d.getMinutes()).padStart(2, '0'); } 
function getLastNoteOnlyFromJSON(jsonStr) { try { const arr = JSON.parse(jsonStr); return arr.length > 0 ? arr[arr.length - 1].text : "أضف ملاحظة..."; } catch(e) { return "أضف ملاحظة..."; } }

function openWhatsAppChat(el) { const inputEl = el.closest('.phone-cell-container').querySelector('input'); let rawPhone = inputEl.value.trim(); if (!rawPhone) { Swal.fire({icon: 'warning', title: 'تنبيه', text: 'يرجى إدخال رقم الجوال أولاً', confirmButtonText: 'حسناً', confirmButtonColor: '#3b82f6'}); return; } let cleanNumber = rawPhone.replace(/\D/g, ''); if (cleanNumber.startsWith('00966')) cleanNumber = cleanNumber.substring(2); else if (cleanNumber.startsWith('05')) cleanNumber = '966' + cleanNumber.substring(1); else if (cleanNumber.startsWith('5') && cleanNumber.length === 9) cleanNumber = '966' + cleanNumber; window.open("https://wa.me/" + cleanNumber, '_blank'); }

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
   Date Picker Functions (محدثة لنظام القوائم المنسدلة والسنوات من الحالية حتى 7 سنوات قادمة)
   ========================================== */
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
let activeInputTarget = null;
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
    
    // السنة الحالية + 7 سنوات قادمة (المجموع 8 سنوات)
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

        // تمييز يومي الجمعة والسبت
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

function openCustomDatePicker(e, inputEl, rowId) {
    if(e) e.stopPropagation(); 
    activeInputTarget = inputEl; 
    activeRowTargetId = rowId;
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

    renderCustomCalendarDays();
    document.getElementById('calendarOverlay')?.classList.add('active');
}

function closeCustomDatePicker() {
    document.getElementById('calendarOverlay')?.classList.remove('active');
    activeInputTarget = null;
    activeRowTargetId = null;
}

function applySelectedDate(dateStr) {
    if (!activeInputTarget) return;
    const oldVal = activeInputTarget.dataset.old || ''; 
    activeInputTarget.value = dateStr;
    const mainRow = document.getElementById(activeRowTargetId);
    if (mainRow) {
        const companyName = mainRow.cells[1].querySelector('input').value;
        addToActivityLog('التاريخ المتوقع', oldVal, dateStr, companyName);
        activeInputTarget.dataset.old = dateStr; 
        updateEditDateField(mainRow); 
        saveSingleRow(activeRowTargetId); 
        updateAllDateColors(); 
        reorderRows(); 
    }
    closeCustomDatePicker();
}

Object.assign(window, {
    toggleSubTable, addProductRow, calculateMainVisitValue, openNote, closeNote, saveNote, handleStatusChange,
    toggleAllCheckboxes, toggleDropdown, handleBulkAction, toggleLogExpansion, debouncedFilterTable, openWhatsAppChat,
    openCustomDatePicker, showStatusTooltip, hideStatusTooltip
});

document.addEventListener('DOMContentLoaded', () => {
    initDatePicker();
    listenToOpportunities();
});
