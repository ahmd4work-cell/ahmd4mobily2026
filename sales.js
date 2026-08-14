// ==========================================
// sales.js - إدارة المبيعات سحابياً
// ==========================================
import { db } from './firebase-config.js';
import { collection, onSnapshot, doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

let currentActivePreview = null;
let currentAttachmentName = null; 
let pendingAttachment = null;
const LOGS_KEY = 'asgate_general_sales_logs';

const CUSTOMERS_STORAGE_KEY = 'crm_customers'; 
let saveTimeout;

function getTodayFormatted() { return new Date().toISOString().split('T')[0]; }
function getTimeFormatted() { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ":" + String(d.getMinutes()).padStart(2, '0'); }

function getArabicDayName(dateString) {
    const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const d = dateString ? new Date(dateString) : new Date();
    return days[d.getDay()];
}

async function initPage() {
    initStatsVisibility();
    listenToSales();
}

function listenToSales() {
    const salesRef = collection(db, "sales");
    onSnapshot(salesRef, (snapshot) => {
        const tbody = document.getElementById('salesBody');
        if (!tbody) return;

        const salesData = [];
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            data.id = docSnap.id;
            salesData.push(data);
        });

        localStorage.setItem('asgate_sales_db', JSON.stringify(salesData));
        loadSalesFromStorage();
    });
}

function toggleStatsVisibility() {
    const container = document.getElementById('statsContainer');
    const btn = document.getElementById('eyeToggleBtn');
    if (!container || !btn) return;
    const isHidden = container.classList.toggle('blur-active');
    
    if (isHidden) {
        btn.innerHTML = '<i class="fas fa-eye-slash"></i>';
        localStorage.setItem('asgate_sales_stats_hidden', 'true');
    } else {
        btn.innerHTML = '<i class="fas fa-eye"></i>';
        localStorage.setItem('asgate_sales_stats_hidden', 'false');
    }
}

function initStatsVisibility() {
    const isHidden = localStorage.getItem('asgate_sales_stats_hidden') === 'true';
    const container = document.getElementById('statsContainer');
    const btn = document.getElementById('eyeToggleBtn');
    if (isHidden && container && btn) {
        container.classList.add('blur-active');
        btn.innerHTML = '<i class="fas fa-eye-slash"></i>';
    }
}

function debouncedSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        autoSave();
    }, 500);
}

function toggleGeneralLogHeight() {
    const section = document.getElementById('generalActivityLogSection');
    const btn = document.getElementById('toggleGeneralLogBtn');
    if (section.classList.contains('expanded')) {
        section.classList.remove('expanded');
        btn.innerHTML = '<i class="fas fa-expand-alt"></i>';
    } else {
        section.classList.add('expanded');
        btn.innerHTML = '<i class="fas fa-compress-alt"></i>';
    }
}

function generateCustomOrderId() {
    const now = new Date();
    const year = String(now.getFullYear()).slice(-2); 
    const month = String(now.getMonth() + 1).padStart(2, '0'); 
    const prefix = year + month; 
    const saved = JSON.parse(localStorage.getItem('asgate_sales_db') || '[]');
    let maxSequence = 0;
    saved.forEach(item => {
        const idStr = String(item.id);
        if (idStr.startsWith(prefix) && idStr.length === 8) {
            const seq = parseInt(idStr.slice(4), 10);
            if (seq > maxSequence) maxSequence = seq;
        }
    });
    return prefix + String(maxSequence + 1).padStart(4, '0');
}

function updateHeaderStats() {
    const saved = JSON.parse(localStorage.getItem('asgate_sales_db') || '[]');
    const currentMonthStr = getTodayFormatted().substring(0, 7);
    
    let totalComp = 0, totalPend = 0, monthCount = 0;
    let monthComp = 0, monthPend = 0;
    
    saved.forEach(item => {
        const sums = calculateOrderSums(item.id);
        totalComp += sums.completed; 
        totalPend += sums.pending;
        
        if (item.date && item.date.startsWith(currentMonthStr)) {
            monthCount++;
            monthComp += sums.completed;
            monthPend += sums.pending;
        }
    });
    
    if(document.getElementById('count-total')) document.getElementById('count-total').innerText = saved.length;
    if(document.getElementById('month-count')) document.getElementById('month-count').innerText = monthCount;
    if(document.getElementById('sum-completed')) document.getElementById('sum-completed').innerText = totalComp.toLocaleString('en-US', {minimumFractionDigits: 2});
    if(document.getElementById('sum-pending')) document.getElementById('sum-pending').innerText = totalPend.toLocaleString('en-US', {minimumFractionDigits: 2});
    if(document.getElementById('month-completed')) document.getElementById('month-completed').innerText = monthComp.toLocaleString('en-US', {minimumFractionDigits: 2});
    if(document.getElementById('month-pending')) document.getElementById('month-pending').innerText = monthPend.toLocaleString('en-US', {minimumFractionDigits: 2});
}

function calculateOrderSums(orderId) {
    const productsDb = JSON.parse(localStorage.getItem('asgate_products_db') || '{}');
    const products = productsDb[orderId] || [];
    let completed = 0, pending = 0;
    products.forEach(p => {
        const lineTotal = (parseFloat(p.qty) || 0) * (parseFloat(String(p.sub).replace(/[^\d.]/g, '')) || 0);
        if (p.status === "مكتمل") completed += lineTotal;
        if (p.status === "معلق") pending += lineTotal;
    });
    return { completed, pending };
}

function loadSalesFromStorage() {
    const tbody = document.getElementById('salesBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const saved = JSON.parse(localStorage.getItem('asgate_sales_db') || '[]');
    saved.forEach(obj => renderTableRow(obj));
    updateHeaderStats();
    renderGeneralLog();
}

function renderTableRow(obj) {
    const tbody = document.getElementById('salesBody');
    const sums = calculateOrderSums(obj.id);
    const row = tbody.insertRow(-1);
    row.className = 'main-row';
    row.id = `row-${obj.id}`;
    
    if (obj.status === "فقدان") row.classList.add('lost-row');
    
    row.innerHTML = `
        <td><input type="checkbox" class="select-check" data-id="${obj.id}"></td>
        <td><a href="./order_details.html?id=${obj.id}" class="order-link" title="فتح التفاصيل">#${obj.id}</a></td>
        <td><input type="text" class="excel-input" value="${obj.type || ''}" data-old="${obj.type || ''}" onfocus="this.dataset.old=this.value" onkeyup="updateDateField(this); debouncedSave();" onblur="logEdit('اسم الطلب', this, '${obj.comp}', '${obj.id}')"></td>
        <td><input type="text" class="excel-input readonly-input" value="${obj.date}" readonly style="color:var(--text-muted); font-weight:700;"></td>
        <td><input type="text" class="excel-input" value="${obj.comp || ''}" data-old="${obj.comp || ''}" onfocus="this.dataset.old=this.value" onkeyup="updateDateField(this); debouncedSave();" onblur="logEdit('الشركة', this, '${obj.comp}', '${obj.id}')"></td>
        <td><input type="text" class="excel-input" value="${obj.cr || ''}" data-old="${obj.cr || ''}" onfocus="this.dataset.old=this.value" onkeyup="updateDateField(this); debouncedSave();" onblur="logEdit('السجل', this, '${obj.comp}', '${obj.id}')"></td>
        <td>
            <select class="excel-input status-select ${getStatusClass(obj.status)}" data-old="${obj.status || 'معلق'}" onchange="handleStatusChange(this, '${obj.id}', '${obj.comp}')">
                <option value="مكتمل" ${obj.status === 'مكتمل' ? 'selected' : ''}>مكتمل</option>
                <option value="معلق" ${obj.status === 'معلق' ? 'selected' : ''}>معلق</option>
                <option value="مرتجع" ${obj.status === 'مرتجع' ? 'selected' : ''}>مرتجع</option>
                <option value="تفعيلات" ${obj.status === 'تفعيلات' ? 'selected' : ''}>تفعيلات</option>
                <option value="الطلب" ${obj.status === 'الطلب' ? 'selected' : ''}>الطلب</option>
                <option value="موافقة" ${obj.status === 'موافقة' ? 'selected' : ''}>موافقة</option>
                <option value="فقدان" ${obj.status === 'فقدان' ? 'selected' : ''}>فقدان</option>
            </select>
        </td>
        <td><input type="text" class="excel-input readonly-input" value="${sums.completed.toFixed(2)}" readonly style="color:var(--success); font-weight:800;"></td>
        <td><input type="text" class="excel-input readonly-input" value="${sums.pending.toFixed(2)}" readonly style="color:var(--danger); font-weight:800;"></td>
        <td><div class="notes-preview" onclick="openNote(this)" data-full-notes='${(obj.notes || '[]').replace(/'/g, "&apos;")}' title="عرض الملاحظات">${getLastNoteOnly(obj.notes || "[]")}</div></td>
        <td><input type="text" class="excel-input readonly-input last-mod-field" value="${obj.lastModifiedDate || '---'}" readonly style="color:var(--text-muted); font-weight:700;"></td>
        <td><input type="text" class="excel-input" value="${obj.owner || 'المستخدم'}" data-old="${obj.owner || ''}" onfocus="this.dataset.old=this.value" onkeyup="updateDateField(this); debouncedSave();" onblur="logEdit('المالك', this, '${obj.comp}', '${obj.id}')"></td>
    `;
}

// دالة تحديد كلاس اللون بناءً على الحالة المحددة
function getStatusClass(status) {
    if(status === 'مكتمل') return 'status-complete';
    if(status === 'معلق') return 'status-pending';
    if(status === 'مرتجع') return 'status-returned';
    if(status === 'تفعيلات') return 'status-activations';
    if(status === 'الطلب') return 'status-order';
    if(status === 'موافقة') return 'status-approval';
    if(status === 'فقدان') return 'status-lost';
    return 'status-order'; // الحالة الافتراضية إذا كانت فارغة أو غير معروفة
}

function handleStatusChange(el, orderId, company) {
    const val = el.value; const oldVal = el.dataset.old;
    const row = el.closest('tr');
    el.className = `excel-input status-select ${getStatusClass(val)}`;
    
    if (val === "فقدان") row.classList.add('lost-row');
    else row.classList.remove('lost-row');
    
    addGeneralLog(`تعديل الحالة من [${oldVal}] إلى [${val}] للعميل ( ${company} )`);
    
    updateDateField(el);
    el.dataset.old = val;
    debouncedSave();
}

function updateDateField(inputElement) {
    const row = inputElement.closest('tr');
    const modField = row.querySelector('.last-mod-field');
    if (modField) modField.value = getTodayFormatted();
}

function logEdit(fieldName, el, comp, id) {
    const newVal = el.value; const oldVal = el.dataset.old;
    if(newVal !== oldVal) {
        addGeneralLog(`تعديل ${fieldName} من [${oldVal || 'فارغ'}] إلى [${newVal}] للعميل ( ${comp} )`);
        el.dataset.old = newVal;
    }
}

async function autoSave() {
    const rows = document.querySelectorAll('#salesBody .main-row');
    for (let r of rows) {
        const id = r.cells[1].innerText.replace('#', '').trim();
        const salesData = {
            id: id,
            type: r.cells[2].querySelector('input').value,
            date: r.cells[3].querySelector('input').value,
            comp: r.cells[4].querySelector('input').value,
            cr: r.cells[5].querySelector('input').value,
            status: r.cells[6].querySelector('select').value,
            notes: r.cells[9].querySelector('.notes-preview').getAttribute('data-full-notes'),
            lastModifiedDate: r.cells[10].querySelector('input').value === '---' ? '' : r.cells[10].querySelector('input').value,
            owner: r.cells[11].querySelector('input').value
        };
        
        try {
            await setDoc(doc(db, "sales", id), salesData, { merge: true });
        } catch (e) {
            console.error("خطأ بالحفظ السحابي للمبيعات:", e);
        }
    }
    
    updateHeaderStats();
}

function filterSalesTable() {
    const query = document.getElementById('globalSearch').value.toLowerCase().trim();
    const rows = document.querySelectorAll('#salesBody .main-row');
    rows.forEach(row => {
        const text = row.innerText.toLowerCase();
        row.style.display = text.includes(query) ? '' : 'none';
    });
}

function toggleDropdown(e, btn) {
    e.stopPropagation();
    const menu = btn.nextElementSibling;
    document.querySelectorAll('.dropdown-menu').forEach(m => { if(m !== menu) m.classList.remove('show'); });
    if (menu) menu.classList.toggle('show');
}

window.onclick = (e) => {
    if (!e.target.matches('.btn-bulk-trigger') && !e.target.matches('.fa-chevron-down')) {
        document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
    }
};

function toggleAllCheckboxes(source) {
    document.querySelectorAll('.select-check').forEach(chk => chk.checked = source.checked);
}

async function handleBulkAction(action) {
    const selected = document.querySelectorAll('.select-check:checked');
    if (selected.length === 0) { 
        if (typeof Swal !== 'undefined') Swal.fire({icon: 'info', text: 'يرجى تحديد صف واحد على الأقل', confirmButtonColor: '#3b82f6'}); 
        return; 
    }
    
    if (action === 'حذف') {
        const result = await Swal.fire({ title: 'تأكيد الحذف؟', text: "سيتم حذف الطلبات المحددة بشكل نهائي!", icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#94a3b8', confirmButtonText: 'نعم، احذف', cancelButtonText: 'إلغاء' });
        if (result.isConfirmed) {
            for (let chk of selected) {
                const row = chk.closest('tr');
                const orderId = row.cells[1].innerText.replace('#', '').trim();
                const comp = row.cells[4].querySelector('input').value;
                
                try {
                    await deleteDoc(doc(db, "sales", orderId));
                    addGeneralLog(`تم حذف الطلب #${orderId} للعميل ( ${comp} )`);
                    row.remove();
                } catch (e) {
                    console.error("خطأ أثناء الحذف السحابي:", e);
                }
            }
            updateHeaderStats();
            Swal.fire({icon: 'success', title: 'تم الحذف', showConfirmButton: false, timer: 1500});
        }
    } else {
        Swal.fire({icon: 'success', title: 'تم', text: 'تم تنفيذ الإجراء (' + action + ') على ' + selected.length + ' صف', showConfirmButton: false, timer: 1500});
    }
}

function addGeneralLog(description) {
    const logs = JSON.parse(localStorage.getItem(LOGS_KEY) || '[]');
    const logObj = {
        user: "المستخدم",
        day: getArabicDayName(getTodayFormatted()),
        date: getTodayFormatted(),
        time: getTimeFormatted(),
        action: description
    };
    
    logs.unshift(logObj);
    const updatedLogs = logs.slice(0, 100);
    localStorage.setItem(LOGS_KEY, JSON.stringify(updatedLogs));
    
    renderGeneralLog();
}

function renderGeneralLog() {
    const list = document.getElementById('activityLogs');
    if (!list) return;
    const logs = JSON.parse(localStorage.getItem(LOGS_KEY) || '[]');
    
    list.innerHTML = logs.map(log => {
        if (typeof log === 'string') {
            return `<div class="log-entry"><span class="log-action">${log}</span></div>`; 
        }
        return `
        <div class="log-entry">
            <span class="log-badge-user"><i class="fas fa-user"></i> ${log.user}</span>
            <span class="log-divider">|</span>
            <span class="log-timestamp"><i class="far fa-clock"></i> ${log.day} ${log.date} ${log.time}</span>
            <span class="log-divider">|</span>
            <span class="log-action">${log.action}</span>
        </div>`;
    }).join('') || '<div style="color:#94a3b8; text-align:center; padding:10px;">لا يوجد نشاط مسجل</div>';
}

function openNote(el) {
    currentActivePreview = el;
    pendingAttachment = null;
    const prevContainer = document.getElementById('filePreviewContainer');
    if (prevContainer) prevContainer.style.display = 'none';
    
    let arr = []; 
    try { arr = JSON.parse(el.getAttribute('data-full-notes') || "[]"); } catch(e) {}
    const historyLog = document.getElementById('historyLog');
    
    if (historyLog) {
        historyLog.innerHTML = arr.map(msg => {
            const attachHtml = msg.attachment ? `<br><a href="${msg.attachment.data}" download="${msg.attachment.name}" style="color:var(--accent-blue); font-size:10.5px; font-weight:800; text-decoration:none;"><i class="fas fa-download"></i> ${msg.attachment.name}</a>` : '';
            return `
            <div class="chat-msg-block">
                <div class="chat-msg-header">
                    <span><i class="fas fa-user-circle"></i> ${msg.user || 'المستخدم'}</span>
                    <span style="color:#94a3b8;"><i class="fas fa-clock"></i> ${msg.date} ${msg.time}</span>
                </div>
                <div class="chat-msg-text">${msg.text || ''}${attachHtml}</div>
            </div>`;
        }).join('') || '<div style="color:#64748b; text-align:center; font-size:10px; padding:20px; font-weight:700;">لا توجد ملاحظات سابقة</div>';
    }
    
    const modal = document.getElementById('noteModal');
    if (modal) modal.style.display = "flex";
    const modalTextArea = document.getElementById('modalTextArea');
    if (modalTextArea) { modalTextArea.value = ""; modalTextArea.focus(); }
}

function handleFileSelect(input) {
    const file = input.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            pendingAttachment = { name: file.name, data: e.target.result };
            const nameDisp = document.getElementById('fileNameDisplay');
            if(nameDisp) nameDisp.innerText = file.name;
            const prevContainer = document.getElementById('filePreviewContainer');
            if(prevContainer) prevContainer.style.display = 'block';
        };
        reader.readAsDataURL(file);
    }
}

function removeAttachment() {
    pendingAttachment = null;
    const fileAttach = document.getElementById('modalFileAttachment');
    if(fileAttach) fileAttach.value = '';
    const prevContainer = document.getElementById('filePreviewContainer');
    if(prevContainer) prevContainer.style.display = 'none';
}

function saveNote() {
    const txtArea = document.getElementById('modalTextArea');
    const txt = txtArea ? txtArea.value.trim() : '';
    if ((txt || pendingAttachment) && currentActivePreview) {
        let arr = []; 
        try { arr = JSON.parse(currentActivePreview.getAttribute('data-full-notes') || "[]"); } catch(e) {}
        
        const newNote = { 
            user: "المستخدم", 
            date: getTodayFormatted(), 
            time: getTimeFormatted(), 
            text: txt 
        };
        if(pendingAttachment) { newNote.attachment = pendingAttachment; }
        
        arr.push(newNote);
        currentActivePreview.setAttribute('data-full-notes', JSON.stringify(arr)); 
        currentActivePreview.innerText = txt ? txt : "مرفق";
        
        const row = currentActivePreview.closest('tr');
        updateDateField(currentActivePreview);
        
        const comp = row.cells[4].querySelector('input').value;
        addGeneralLog(`إضافة ملاحظة على الطلب للعميل ( ${comp} )`);

        autoSave();
    }
    removeAttachment();
    closeNote();
}

function closeNote() { 
    const modal = document.getElementById('noteModal');
    if (modal) modal.style.display = "none"; 
}

function getLastNoteOnly(jsonStr) { 
    try { 
        const arr = JSON.parse(jsonStr); 
        if(arr.length > 0) {
            const last = arr[arr.length - 1];
            return last.text ? last.text : "مرفق";
        }
        return "أضف ملاحظة..."; 
    } catch(e) { return "أضف ملاحظة..."; } 
}

function openOrderModal() { 
    const modal = document.getElementById('orderModal');
    if (modal) modal.style.display = 'flex'; 
}

function closeOrderModal() { 
    const modal = document.getElementById('orderModal');
    if (modal) modal.style.display = 'none'; 
    ['mSearchField', 'mType', 'mComp', 'mCr'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.value = '';
    });
}

function searchCustomerInModal(el) {
    const query = el.value.toLowerCase().trim();
    const resDiv = document.getElementById('mResults');
    const customers = JSON.parse(localStorage.getItem(CUSTOMERS_STORAGE_KEY) || '[]');
    
    if (query.length < 1) { if(resDiv) resDiv.style.display='none'; return; }
    
    const filtered = customers.filter(c => {
        const cName = (c.comp || "").toLowerCase();
        const crMain = (c.cr1 || c.cr || "");
        const crSub = (c.cr2 || "");
        return cName.includes(query) || crMain.includes(query) || crSub.includes(query);
    });
    
    if(resDiv) {
        resDiv.innerHTML = filtered.map(c => {
            const displayCr = c.cr1 || c.cr || c.cr2 || '';
            return `<div onclick="window.selectCustomer('${c.comp}', '${displayCr}')">${c.comp} - ${displayCr}</div>`;
        }).join('') || '<div style="color:#94a3b8; text-align:center; padding: 10px;">لا يوجد نتائج</div>';
        resDiv.style.display = 'block';
    }
}

function selectCustomer(comp, cr) {
    const mComp = document.getElementById('mComp');
    const mCr = document.getElementById('mCr');
    const resDiv = document.getElementById('mResults');
    const searchField = document.getElementById('mSearchField');
    if(mComp) mComp.value = comp;
    if(mCr) mCr.value = cr;
    if(resDiv) resDiv.style.display = 'none';
    if(searchField) searchField.value = comp;
}

async function addOrderRow() {
    const type = document.getElementById('mType').value.trim();
    const comp = document.getElementById('mComp').value.trim();
    const cr = document.getElementById('mCr').value.trim();
    
    if(!type || !comp) {
        Swal.fire({icon: 'warning', text: 'يرجى اختيار العميل وإدخال اسم الطلب', confirmButtonColor: '#3b82f6'});
        return;
    }
    
    const newId = generateCustomOrderId();
    const newOrder = {
        id: newId,
        type: type,
        date: getTodayFormatted(),
        comp: comp,
        cr: cr,
        status: 'معلق',
        notes: '[]',
        lastModifiedDate: getTodayFormatted(),
        owner: 'المستخدم'
    };
    
    try {
        await setDoc(doc(db, "sales", newId), newOrder);
        addGeneralLog(`تم إنشاء طلب جديد #${newId} للعميل ( ${comp} )`);
        closeOrderModal();
        Swal.fire({icon: 'success', title: 'تم الإنشاء', text: `تم إنشاء الطلب #${newId} بنجاح`, timer: 2000, showConfirmButton: false});
    } catch (e) {
        console.error("خطأ إنشاء الطلب:", e);
    }
}

Object.assign(window, {
    initPage,
    toggleStatsVisibility,
    debouncedSave,
    toggleGeneralLogHeight,
    filterSalesTable,
    toggleDropdown,
    toggleAllCheckboxes,
    handleBulkAction,
    openNote,
    handleFileSelect,
    removeAttachment,
    saveNote,
    closeNote,
    openOrderModal,
    closeOrderModal,
    searchCustomerInModal,
    selectCustomer,
    addOrderRow,
    handleStatusChange,
    logEdit,
    updateDateField
});

document.addEventListener('DOMContentLoaded', () => {
    initPage();
});