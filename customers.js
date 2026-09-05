// ==========================================
// customers.js - إدارة العملاء سحابياً ومحلياً
// ==========================================
import { db } from './firebase-config.js';
import { collection, getDocs, setDoc, doc, deleteDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const tableBody = document.getElementById('tableBody');
const logsBody = document.getElementById('activityList'); 
const totalCustomers = document.getElementById('stat-total'); 
const monthCustomers = document.getElementById('stat-month'); 
const todayCustomers = document.getElementById('stat-today'); 
const searchInput = document.getElementById('searchInput');

let searchTimeout;
let customersDataList = [];
let logsDataList = [];

// دوال مساعدة لتهيئة الوقت والتاريخ
function getTodayFormatted() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function getTimeFormatted() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function saveLocalBackup() {
    try {
        localStorage.setItem('crm_customers', JSON.stringify(customersDataList));
        localStorage.setItem('crm_activity_logs', JSON.stringify(logsDataList));
    } catch (e) {
        console.error("Local Storage Error: ", e);
    }
}

async function loadSavedData() {
    const localCust = localStorage.getItem('crm_customers');
    const localLogs = localStorage.getItem('crm_activity_logs');
    if (localCust) {
        try { customersDataList = JSON.parse(localCust); } catch(e){}
    }
    if (localLogs) {
        try { logsDataList = JSON.parse(localLogs); } catch(e){}
    }

    updateStats(customersDataList);
    renderCustomers(customersDataList);
    renderLogs(logsDataList);

    try {
        const querySnapshot = await getDocs(collection(db, "customers"));
        const freshCustomers = [];
        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            data.code = docSnap.id || data.code;
            freshCustomers.push(data);
        });
        
        freshCustomers.sort((a, b) => (b.code || '').localeCompare(a.code || ''));
        customersDataList = freshCustomers;

        const logsSnapshot = await getDocs(collection(db, "activity_logs"));
        const freshLogs = [];
        logsSnapshot.forEach((docSnap) => {
            freshLogs.push(docSnap.data());
        });
        
        freshLogs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        logsDataList = freshLogs;

        saveLocalBackup();
        updateStats(customersDataList);
        renderCustomers(customersDataList);
        renderLogs(logsDataList);

        if (searchInput) {
            searchInput.addEventListener('input', debouncedFilterTable);
        }
    } catch (error) {
        console.error("Error loading data from Cloud: ", error);
    }
}

function normalizeText(v) { return String(v || '').toLowerCase().trim(); }
function escapeHTML(str) { return String(str || '').replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag])); }

function badgeClass(status) {
    const s = normalizeText(status);
    if (s.includes('جديد') || s.includes('مفتوح')) return 'status-active';
    if (s.includes('نشط') || s.includes('مكتمل') || s.includes('تم')) return 'status-active';
    if (s.includes('متابعة')) return 'status-med';
    if (s.includes('مغلق') || s.includes('ملغي')) return 'status-inactive';
    return 'status-small';
}

function classBadgeColor(classification) {
    const c = normalizeText(classification);
    if (c.includes('حكومي')) return 'status-gov';
    if (c.includes('هام')) return 'status-important';
    if (c.includes('متوسط')) return 'status-med';
    if (c.includes('صغير')) return 'status-small';
    return 'status-small';
}

function safe(value, fallback = '-') { return escapeHTML(value && String(value).trim() ? String(value).trim() : fallback); }

function getDisplayManager(v) { return safe(v.delegatePriority && v.delegateName ? v.delegateName : v.mgr); }
function getDisplayMobile(v) { return safe(v.delegatePriority && v.delegateMob ? v.delegateMob : v.mob); }
function getDisplayEmail(v) { return safe(v.delegatePriority && v.delegateEmail ? v.delegateEmail : v.email); }

function renderCustomers(list) {
    if (!tableBody) return;
    tableBody.innerHTML = '';
    if (!list.length) {
        tableBody.innerHTML = `<tr><td colspan="13" style="text-align:center;padding:28px;color:#6b7280;">لا توجد بيانات لعرضها</td></tr>`;
        return;
    }
    list.forEach((v) => {
        const classification = safe(v.classification || v.source || 'غير محدد');
        
        let lastNotePreview = 'اضغط لإضافة ملاحظة';
        if (v.notesHistory && v.notesHistory.length > 0) {
            lastNotePreview = v.notesHistory[v.notesHistory.length - 1].text;
        } else if (v.notesText) {
            lastNotePreview = v.notesText;
        }

        const tr = document.createElement('tr');
        tr.className = 'main-row';
        tr.id = `row-${v.code}`;
        tr.innerHTML = `
            <td><input type="checkbox" class="select-check" data-code="${v.code}"></td>
            <td><a href="#" onclick="event.preventDefault(); window.location.href='customer-details.html?code=${v.code}'" class="code-link">${safe(v.code, '00001')}</a></td>
            <td><strong>${safe(v.comp)}</strong></td>
            <td>${safe(v.address || v.city)}</td>
            <td>${getDisplayManager(v)}</td>
            <td>
                <div class="phone-cell-container">
                ${getDisplayMobile(v)}
                <a href="https://wa.me/${getDisplayMobile(v).replace(/\D/g,'')}" target="_blank" class="whatsapp-icon-btn" title="مراسلة واتساب" onclick="event.stopPropagation()"><i class="fab fa-whatsapp"></i></a>
                </div>
            </td>
            <td>${getDisplayEmail(v)}</td>
            <td>${safe(v.cr1 || v.cr, '-')}</td>
            <td>${safe(v.creationDate || v.date)}</td>
            <td><span class="${classBadgeColor(classification)}" style="padding: 2px 8px; border-radius: 4px;">${classification}</span></td>
            <td><div class="notes-preview" onclick="window.openNote('${v.code}'); event.stopPropagation()">${safe(lastNotePreview)}</div></td>
            <td><span class="${badgeClass(v.status)}" style="padding: 2px 8px; border-radius: 4px;">${safe(v.status, 'جديد')}</span></td>
            <td><input type="hidden" value="${safe(v.owner)}"> ${safe(v.owner)}</td>
        `;
        tableBody.appendChild(tr);
    });
}

function renderLogs(list) {
    if (!logsBody) return;
    logsBody.innerHTML = '';
    if (!list.length) {
        logsBody.innerHTML = `<div style="text-align:center;padding:28px;color:#6b7280;">لا يوجد سجل نشاط بعد</div>`;
        return;
    }
    const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']; 
    
    list.slice(0, 100).forEach(log => {
        const d = new Date(log.timestamp || Date.now());
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear(); 
        const dayName = days[d.getDay()];
        const timeStr = String(d.getHours()).padStart(2, '0') + ":" + String(d.getMinutes()).padStart(2, '0');

        logsBody.innerHTML += `
            <div class="log-entry">
                <span class="log-header-info">
                    <span>${safe(log.user || 'المستخدم')}</span>
                    <span>${dayName}</span>
                    <span dir="ltr">${dd}-${mm}-${yyyy}</span>
                    <span dir="ltr">${timeStr}</span>
                </span>
                <span class="log-sep">|</span>
                <span class="log-action">${safe(log.action)}</span>
            </div>
        `;
    });
}

async function addToActivityLog(fieldName, oldVal, newVal, targetName, user = 'المستخدم') { 
    if (oldVal === newVal && fieldName !== 'إجراء') return; 
    
    const cleanTarget = targetName || 'عنصر غير مسمى'; 
    let actionText = '';
    if (fieldName === 'الحالة') {
        actionText = `تم تغير الحالة من ${escapeHTML(oldVal) || 'فارغ'} الى ${escapeHTML(newVal) || 'فارغ'} لـ ( ${escapeHTML(cleanTarget)} )`;
    } else if (fieldName === 'إجراء') {
        actionText = `${escapeHTML(oldVal)} لـ ( ${escapeHTML(cleanTarget)} )`;
    } else {
        actionText = `تعديل ${escapeHTML(fieldName)} من [${escapeHTML(oldVal) || 'فارغ'}] إلى [${escapeHTML(newVal) || 'فارغ'}] لـ ( ${escapeHTML(cleanTarget)} )`;
    }

    const logEntry = { user: user, action: actionText, timestamp: Date.now() };

    logsDataList.unshift(logEntry);
    saveLocalBackup();
    renderLogs(logsDataList);

    try {
        await setDoc(doc(db, "activity_logs", logEntry.timestamp.toString()), logEntry);
    } catch (error) {
        console.error("Error adding log to Cloud: ", error);
    }
}

function updateStats(list) {
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    const today = now.toISOString().slice(0, 10);

    if(totalCustomers) totalCustomers.textContent = list.length;
    if(monthCustomers) monthCustomers.textContent = list.filter(v => {
        const dStr = v.creationDate || v.date || '';
        if(dStr.includes('/')) {
            const parts = dStr.split('/');
            return parseInt(parts[1])-1 === thisMonth && parseInt(parts[2]) === thisYear;
        }
        const d = new Date(dStr);
        return !isNaN(d) && d.getMonth() === thisMonth && d.getFullYear() === thisYear;
    }).length;
    
    if(todayCustomers) todayCustomers.textContent = list.filter(v => {
        const d = String(v.creationDate || v.date || '');
        return d.includes(today) || d.includes(`${now.getDate()}`) || d.includes(`${now.getMonth() + 1}`);
    }).length;
}

function debouncedFilterTable() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        const q = normalizeText(searchInput.value);
        const filtered = customersDataList.filter(v => {
            const haystack = [
                v.code, v.comp, v.address, v.city, v.mgr, v.delegateName,
                v.mob, v.delegateMob, v.email, v.delegateEmail, v.cr1, v.cr, v.status,
                v.owner, v.classification, v.notesText, v.lastNote
            ].map(normalizeText).join(' ');
            return haystack.includes(q);
        });
        renderCustomers(filtered);
    }, 300);
}

function openAddCustomerModal() {
    const modal = document.getElementById('addCustomerModal');
    if (modal) modal.style.display = 'flex';
    let nextNum = 1;
    if (customersDataList.length > 0) {
        const codes = customersDataList.map(c => {
            const match = (c.code || '').match(/\d+/);
            return match ? parseInt(match[0], 10) : 0;
        });
        nextNum = Math.max(...codes) + 1;
    }
    const code = 'CUST-' + String(nextNum).padStart(5, '0');
    const addCodeInput = document.getElementById('addCode');
    if (addCodeInput) addCodeInput.value = code;
    
    const d = new Date();
    const todayStr = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    const addDateInput = document.getElementById('addDate');
    if (addDateInput) addDateInput.value = todayStr;
    
    ['addComp', 'addCity', 'addAddress', 'addMainCR', 'addSubCR', 'addManager', 'addMob', 'addEmail', 'addCreator'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
}

function closeAddCustomerModal() {
    const modal = document.getElementById('addCustomerModal');
    if (modal) modal.style.display = 'none';
}

async function saveNewCustomer() {
    const compEl = document.getElementById('addComp');
    const comp = compEl ? compEl.value : '';
    if(!comp.trim()) {
        if (typeof Swal !== 'undefined') Swal.fire('تنبيه', 'يرجى إدخال اسم الشركة', 'warning');
        return;
    }

    const codeVal = document.getElementById('addCode').value;
    const dateVal = document.getElementById('addDate').value;
    const mgrVal = document.getElementById('addManager').value;
    const mobVal = document.getElementById('addMob').value;
    const emailVal = document.getElementById('addEmail').value;
    const creator = document.getElementById('addCreator').value || 'المستخدم';

    const newCust = {
        code: codeVal,
        date: dateVal,
        creationDate: dateVal,
        comp: comp,
        city: document.getElementById('addCity').value,
        address: document.getElementById('addAddress').value,
        cr1: document.getElementById('addMainCR').value,
        cr2: document.getElementById('addSubCR').value,
        mgr: mgrVal,
        mob: mobVal,
        email: emailVal,
        owner: creator,
        status: 'جديد',
        classification: 'صغير',
        notesText: '',
        managers: mgrVal || mobVal || emailVal ? [{
            id: Date.now(),
            name: mgrVal,
            phone: mobVal,
            altPhone: "",
            email: emailVal,
            jobTitle: "المدير / المسؤول",
            date: dateVal,
            isPrimary: true
        }] : [], 
        orders: [], visits: [], opportunities: [], sales: [], attachments: [], notesHistory: []
    };

    try {
        customersDataList.unshift(newCust);
        saveLocalBackup();

        await setDoc(doc(db, "customers", newCust.code), newCust);
        await addToActivityLog('إجراء', 'إنشاء عميل جديد', '', newCust.comp, creator);

        closeAddCustomerModal();
        updateStats(customersDataList);
        renderCustomers(customersDataList);

        if (typeof Swal !== 'undefined') Swal.fire('نجاح', 'تم إضافة العميل بنجاح', 'success');
    } catch (error) {
        console.error("Error adding document: ", error);
        if (typeof Swal !== 'undefined') Swal.fire('خطأ', 'حدث خطأ أثناء حفظ البيانات بالسحابة', 'error');
    }
}

// ---------------------------------------------------------
// نظام الملاحظات
// ---------------------------------------------------------

let currentNoteCode = null;

function openNote(code) {
    currentNoteCode = code;
    const modal = document.getElementById('noteModal');
    if (modal) modal.style.display = 'flex';
    
    const customer = customersDataList.find(c => c.code === code);
    const txtArea = document.getElementById('modalTextArea');
    if (txtArea) { txtArea.value = ''; txtArea.focus(); }
    
    const historyLog = document.getElementById('historyLog');
    const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

    if (historyLog) {
        if (customer && customer.notesHistory && customer.notesHistory.length) {
            historyLog.innerHTML = customer.notesHistory.map((msg, index) => {
                let msgDateObj = new Date(msg.date);
                let dayStr = isNaN(msgDateObj) ? '' : days[msgDateObj.getDay()] + ' ';
                let userName = msg.user && msg.user !== "المستخدم" ? msg.user : "المستخدم";

                let showDelete = true;
                if (msg.date && msg.time) {
                    let noteDateTime = new Date(`${msg.date}T${msg.time}:00`);
                    if (!isNaN(noteDateTime)) {
                        let diffInHours = (new Date() - noteDateTime) / (1000 * 60 * 60);
                        if (diffInHours > 24) {
                            showDelete = false; // إخفاء زر الحذف بعد مرور 24 ساعة
                        }
                    }
                }
                
                let deleteBtnHtml = showDelete ? `<i class="fas fa-trash-alt delete-note-btn" onclick="window.deleteNote(${index})" title="حذف الملاحظة"></i>` : '';

                return `
                <div class="note-item">
                    <div class="note-header">
                        <div class="note-meta">
                            <span class="note-user"><i class="fas fa-user-circle"></i> ${escapeHTML(userName)}</span>
                            <span dir="ltr"><i class="far fa-calendar-alt"></i> ${escapeHTML(dayStr)} ${escapeHTML(msg.date)}</span>
                            <span dir="ltr"><i class="far fa-clock"></i> ${escapeHTML(msg.time || '')}</span>
                        </div>
                        ${deleteBtnHtml}
                    </div>
                    <div class="note-body">${escapeHTML(msg.text)}</div>
                </div>
                `;
            }).join('');
            
            historyLog.scrollTop = historyLog.scrollHeight;
        } else {
            historyLog.innerHTML = '<div style="color:#64748b; text-align:center; font-size:11px; padding:20px; font-weight:700;">لا توجد ملاحظات سابقة</div>';
        }
    }
}

function closeNote() {
    const modal = document.getElementById('noteModal');
    if (modal) modal.style.display = 'none';
    currentNoteCode = null;
}

async function saveNote() {
    if (!currentNoteCode) return;
    const txtArea = document.getElementById('modalTextArea');
    const text = txtArea ? txtArea.value.trim() : '';
    if (!text) { closeNote(); return; }

    const customerIndex = customersDataList.findIndex(c => c.code === currentNoteCode);
    if (customerIndex === -1) return;
    
    const customer = customersDataList[customerIndex];
    let username = customer.owner || "المستخدم";
    
    if (!customer.notesHistory) customer.notesHistory = [];
    
    customer.notesHistory.push({ 
        user: username,
        date: getTodayFormatted(),
        time: getTimeFormatted(),
        text: text 
    });
    
    customer.notesText = text;
    
    try {
        saveLocalBackup();
        await updateDoc(doc(db, "customers", currentNoteCode), {
            notesHistory: customer.notesHistory,
            notesText: customer.notesText
        });
        
        await addToActivityLog('إجراء', 'إضافة ملاحظة جديدة', '', customer.comp, username);

        closeNote();
        renderCustomers(customersDataList);
        if (typeof Swal !== 'undefined') {
            Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'تم حفظ الملاحظة بنجاح', showConfirmButton: false, timer: 1500 });
        }
    } catch (error) {
        console.error("Error updating note: ", error);
        if (typeof Swal !== 'undefined') Swal.fire('خطأ', 'حدث خطأ أثناء حفظ الملاحظة بالسحابة', 'error');
    }
}

async function deleteNote(index) {
    if (!currentNoteCode) return;
    const result = await Swal.fire({
        title: 'تأكيد الحذف؟',
        text: "هل أنت متأكد من حذف هذه الملاحظة؟",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#94a3b8',
        confirmButtonText: 'نعم، احذف',
        cancelButtonText: 'إلغاء'
    });

    if (result.isConfirmed) {
        const customer = customersDataList.find(c => c.code === currentNoteCode);
        if (!customer || !customer.notesHistory) return;
        
        customer.notesHistory.splice(index, 1);
        customer.notesText = customer.notesHistory.length > 0 ? customer.notesHistory[customer.notesHistory.length - 1].text : '';

        try {
            saveLocalBackup();
            await updateDoc(doc(db, "customers", currentNoteCode), {
                notesHistory: customer.notesHistory,
                notesText: customer.notesText
            });
            
            await addToActivityLog('إجراء', 'حذف ملاحظة', '', customer.comp);

            openNote(currentNoteCode);
            renderCustomers(customersDataList);
        } catch(error) {
            console.error("Error deleting note: ", error);
            Swal.fire('خطأ', 'حدث خطأ أثناء الحذف', 'error');
        }
    }
}

// ---------------------------------------------------------

function toggleDropdown(event, el) {
    event.stopPropagation();
    const menu = el.nextElementSibling;
    document.querySelectorAll('.dropdown-menu').forEach(m => { if(m !== menu) m.classList.remove('show'); });
    if (menu) menu.classList.toggle('show');
}

function toggleAllCheckboxes(source) {
    const checkboxes = document.querySelectorAll('.select-check');
    checkboxes.forEach(cb => cb.checked = source.checked);
}

async function handleBulkAction(action) {
    const selectedCheckboxes = Array.from(document.querySelectorAll('.select-check:checked'));
    if (!selectedCheckboxes.length) {
        if (typeof Swal !== 'undefined') Swal.fire('تنبيه', 'يرجى تحديد عميل واحد على الأقل', 'info');
        return;
    }
    
    if (action === 'حذف') {
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                title: 'هل أنت متأكد؟', text: "لن تتمكن من التراجع عن هذا الإجراء!", icon: 'warning',
                showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#cbd5e1',
                confirmButtonText: 'نعم، احذف', cancelButtonText: 'إلغاء'
            }).then(async (result) => {
                if (result.isConfirmed) {
                    try {
                        for (let cb of selectedCheckboxes) {
                            const code = cb.getAttribute('data-code');
                            const targetCust = customersDataList.find(c => c.code === code);
                            if(targetCust) await addToActivityLog('إجراء', 'حذف العميل', '', targetCust.comp);
                            await deleteDoc(doc(db, "customers", code));
                            customersDataList = customersDataList.filter(c => c.code !== code);
                        }
                        saveLocalBackup();
                        renderCustomers(customersDataList);
                        updateStats(customersDataList);
                        Swal.fire('تم الحذف!', 'تم حذف العملاء المحددين بنجاح.', 'success');
                    } catch (error) {
                        console.error("Error deleting documents: ", error);
                        Swal.fire('خطأ', 'فشل في حذف بعض أو كل العملاء', 'error');
                    }
                }
            });
        }
    } else {
        if (typeof Swal !== 'undefined') Swal.fire('معلومة', `إجراء ${action} غير متاح في هذه النسخة حالياً.`, 'info');
    }
}

function toggleLogExpansion() {
    const section = document.getElementById('activityLogSection');
    const icon = document.querySelector('#toggleExpandBtn i');
    if(!section || !icon) return;
    if(section.classList.contains('expanded')) {
        section.classList.remove('expanded');
        icon.classList.remove('fa-compress-alt');
        icon.classList.add('fa-expand-alt');
    } else {
        section.classList.add('expanded');
        icon.classList.remove('fa-expand-alt');
        icon.classList.add('fa-compress-alt');
    }
}

Object.assign(window, {
    debouncedFilterTable,
    openAddCustomerModal,
    closeAddCustomerModal,
    saveNewCustomer,
    openNote,
    closeNote,
    saveNote,
    deleteNote,
    toggleDropdown,
    toggleAllCheckboxes,
    handleBulkAction,
    toggleLogExpansion,
    addToActivityLog
});

document.addEventListener('click', () => { 
    document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show')); 
});

document.addEventListener('DOMContentLoaded', loadSavedData);