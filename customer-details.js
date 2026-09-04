// ==========================================
// customer-details.js - تفاصيل العميل سحابياً ومحلياً (حماية مزدوجة)
// ==========================================
import { db } from './firebase-config.js';
import { doc, getDoc, updateDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

let currentCustomer = null;
let customerCode = null;
const CUSTOMER_DETAIL_LOCAL_KEY = 'asgate_customer_detail_local_v1';
const LOGS_KEY = 'asgate_customer_details_logs_v1'; // مفتاح السجل لصفحة تفاصيل العميل

// ==========================================
// وظائف سجل النشاطات (Activity Log)
// ==========================================
function getTimeFormatted() { 
    const d = new Date(); 
    return String(d.getHours()).padStart(2, '0') + ":" + String(d.getMinutes()).padStart(2, '0'); 
}

function escapeHTML(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function addToActivityLog(fieldName, oldVal, newVal, targetName) { 
    if (oldVal === newVal) return; 
    let logs = []; 
    try { logs = JSON.parse(localStorage.getItem(LOGS_KEY) || "[]"); } catch(e) {}
    
    const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']; 
    const d = new Date(); 
    let dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0'), yyyy = d.getFullYear(); 
    const dayName = days[d.getDay()];
    const timeStr = getTimeFormatted();
    const cleanTarget = targetName || 'عنصر غير مسمى'; 
    
    let actionText = '';
    if (fieldName === 'الحالة') {
        actionText = `تم تغير الحالة من ${escapeHTML(oldVal) || 'فارغ'} الى ${escapeHTML(newVal) || 'فارغ'} لـ ( ${escapeHTML(cleanTarget)} )`;
    } else if (fieldName === 'إجراء') {
        actionText = `${escapeHTML(oldVal)} لـ ( ${escapeHTML(cleanTarget)} )`;
    } else {
        actionText = `تعديل ${escapeHTML(fieldName)} من [${escapeHTML(oldVal) || 'فارغ'}] إلى [${escapeHTML(newVal) || 'فارغ'}] لـ ( ${escapeHTML(cleanTarget)} )`;
    }

    const fullLogHTML = `<div class="log-entry"><span class="log-header-info"><span>المستخدم</span><span>${dayName}</span><span dir="ltr">${dd}-${mm}-${yyyy}</span><span dir="ltr">${timeStr}</span></span><span class="log-sep">|</span><span class="log-action">${actionText}</span></div>`; 
    
    logs.unshift(fullLogHTML);
    logs = logs.slice(0, 100); 
    localStorage.setItem(LOGS_KEY, JSON.stringify(logs));
    renderActivityLog();
}

function renderActivityLog() { 
    const list = document.getElementById('activityList'); 
    if (!list) return; 
    let logs = []; 
    try { logs = JSON.parse(localStorage.getItem(LOGS_KEY) || "[]"); } catch(e) {}
    list.innerHTML = logs.join(''); 
}

window.toggleLogExpansion = function() { 
    const logSection = document.getElementById('activityLogSection'); 
    const toggleBtn = document.getElementById('toggleExpandBtn'); 
    if (logSection.classList.contains('expanded')) { 
        logSection.classList.remove('expanded'); 
        toggleBtn.innerHTML = '<i class="fas fa-expand-alt"></i>'; 
    } else { 
        logSection.classList.add('expanded'); 
        toggleBtn.innerHTML = '<i class="fas fa-compress-alt"></i>'; 
    } 
}
// ==========================================

// حفظ بيانات العميل محلياً بشكل فوري
function saveCustomerLocally() {
    if (!customerCode || !currentCustomer) return;
    try {
        let cache = JSON.parse(localStorage.getItem(CUSTOMER_DETAIL_LOCAL_KEY) || '{}');
        cache[customerCode] = currentCustomer;
        localStorage.setItem(CUSTOMER_DETAIL_LOCAL_KEY, JSON.stringify(cache));
    } catch (e) {
        console.error("خطأ في الحفظ المحلي لتفاصيل العميل:", e);
    }
}

async function initPage() {
    renderActivityLog(); // تشغيل السجل عند البداية

    const urlParams = new URLSearchParams(window.location.search);
    customerCode = urlParams.get('code');
    
    if (!customerCode) {
        const cName = document.getElementById('c-name');
        if (cName) cName.textContent = "خطأ: لم يتم العثور على العميل";
        return;
    }

    // 1. الاسترجاع الفوري من الذاكرة المحلية كبديل آمن (Offline Fallback)
    try {
        const cache = JSON.parse(localStorage.getItem(CUSTOMER_DETAIL_LOCAL_KEY) || '{}');
        if (cache[customerCode]) {
            currentCustomer = cache[customerCode];
            populateCustomerUI();
        }
    } catch(e) {
        console.error("خطأ في قراءة الذاكرة المحلية:", e);
    }

    await loadCustomerData();
}

function populateCustomerUI() {
    if (!currentCustomer) return;
    
    // تهيئة مصفوفة المسؤولين للعملاء القدامى (استيراد البيانات الأساسية إلى الجدول)
    if (!currentCustomer.managers || currentCustomer.managers.length === 0) {
        if (currentCustomer.mgr || currentCustomer.mob || currentCustomer.email) {
            currentCustomer.managers = [{
                id: Date.now(),
                name: currentCustomer.mgr || "",
                phone: currentCustomer.mob || "",
                altPhone: "",
                email: currentCustomer.email || "",
                jobTitle: "المسؤول الرئيسي",
                date: currentCustomer.creationDate || currentCustomer.date || new Date().toISOString().split('T')[0],
                isPrimary: true
            }];
            saveToFirestore(); 
        } else {
            currentCustomer.managers = [];
        }
    }

    currentCustomer.orders = currentCustomer.orders || [];
    currentCustomer.visits = currentCustomer.visits || [];
    currentCustomer.opportunities = currentCustomer.opportunities || [];
    currentCustomer.sales = currentCustomer.sales || [];
    currentCustomer.attachments = currentCustomer.attachments || [];
    currentCustomer.primaryContact = currentCustomer.primaryContact || {};

    const cName = document.getElementById('c-name');
    if (cName) cName.textContent = currentCustomer.comp || currentCustomer.name || 'بدون اسم';
    
    const cCode = document.getElementById('c-code');
    if (cCode) cCode.textContent = customerCode || currentCustomer.code || '-';

    const cr1 = document.getElementById('c-cr1');
    if (cr1) cr1.textContent = currentCustomer.cr1 || currentCustomer.cr || '-';
    
    const cr2 = document.getElementById('c-cr2');
    if (cr2) cr2.textContent = currentCustomer.cr2 || '-';
    
    const city = document.getElementById('c-city');
    if (city) city.textContent = currentCustomer.city || '-';
    
    const neighborhood = document.getElementById('c-neighborhood');
    if (neighborhood) neighborhood.textContent = currentCustomer.neighborhood || currentCustomer.address || '-';
    
    const classEl = document.getElementById('c-class');
    if (classEl) classEl.textContent = currentCustomer.classification || '-';
    
    const statusEl = document.getElementById('c-status');
    if (statusEl) statusEl.textContent = currentCustomer.status || 'نشط';
    
    const owner = document.getElementById('c-owner');
    if (owner) owner.textContent = currentCustomer.owner || '-';
    
    const source = document.getElementById('c-source');
    if (source) source.textContent = currentCustomer.source || '-';

    renderManagersTable();
    if (typeof window.switchTab === 'function' && !document.querySelector('.tab-btn.active')) {
        window.switchTab('orders');
    }
}

async function loadCustomerData() {
    try {
        const docRef = doc(db, "customers", customerCode);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            currentCustomer = docSnap.data();
            currentCustomer.code = customerCode;
            saveCustomerLocally();
            populateCustomerUI();
        } else if (!currentCustomer) {
            const cName = document.getElementById('c-name');
            if (cName) cName.textContent = "لم يتم العثور على بيانات العميل";
        }
    } catch (error) {
        console.error("Error fetching document:", error);
        if (!currentCustomer) {
            const cName = document.getElementById('c-name');
            if (cName) cName.textContent = "خطأ في الاتصال بالخادم (يتم عرض النسخة المحلية المخزنة)";
        }
    }
}

function renderManagersTable() {
    const tbody = document.getElementById('managerTableBody');
    if(!tbody) return;
    tbody.innerHTML = '';

    currentCustomer.managers.forEach((mgr, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="text-center">
                <input type="radio" name="primaryManager" ${mgr.isPrimary ? 'checked' : ''} onchange="window.setPrimaryManager(${index})">
            </td>
            <td><input type="text" value="${mgr.name || ''}" onchange="window.updateManager(${index}, 'name', this.value)"></td>
            <td><input type="text" value="${mgr.phone || ''}" onchange="window.updateManager(${index}, 'phone', this.value)"></td>
            <td><input type="text" value="${mgr.altPhone || ''}" onchange="window.updateManager(${index}, 'altPhone', this.value)"></td>
            <td><input type="email" value="${mgr.email || ''}" onchange="window.updateManager(${index}, 'email', this.value)"></td>
            <td><input type="text" value="${mgr.jobTitle || ''}" onchange="window.updateManager(${index}, 'jobTitle', this.value)"></td>
            <td>${mgr.date || '-'}</td>
            <td class="text-center">
                <button class="btn-icon" onclick="window.deleteManagerRow(${index})" title="حذف"><i class="fas fa-trash-alt"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.setPrimaryManager = function(selectedIndex) {
    currentCustomer.managers.forEach((mgr, idx) => {
        mgr.isPrimary = (idx === selectedIndex);
    });
    
    const selectedMgr = currentCustomer.managers[selectedIndex];
    if(selectedMgr) {
        currentCustomer.primaryContact = { name: selectedMgr.name, phone: selectedMgr.phone, email: selectedMgr.email };
        currentCustomer.mgr = selectedMgr.name;
        currentCustomer.mob = selectedMgr.phone;
        currentCustomer.email = selectedMgr.email;
        
        // تتبع إضافة/تغيير المدير الرئيسي
        addToActivityLog('المسؤول الرئيسي', 'تغيير', selectedMgr.name, currentCustomer.comp || currentCustomer.name || 'العميل');
    }

    saveToFirestore();
}

window.addNewManagerRow = function() {
    const today = new Date().toISOString().split('T')[0];
    const newMgr = {
        id: Date.now(), name: "", phone: "", altPhone: "", email: "", jobTitle: "", date: today,
        isPrimary: currentCustomer.managers.length === 0
    };
    
    currentCustomer.managers.push(newMgr);
    if(newMgr.isPrimary) {
        window.setPrimaryManager(currentCustomer.managers.length - 1);
    } else {
        saveToFirestore();
    }
    
    addToActivityLog('إجراء', 'إضافة مسؤول تواصل جديد', '', currentCustomer.comp || currentCustomer.name || 'العميل');
    renderManagersTable();
}

window.updateManager = function(index, field, value) {
    if(!currentCustomer.managers[index]) return;
    
    const oldVal = currentCustomer.managers[index][field];
    currentCustomer.managers[index][field] = value;
    
    if (oldVal !== value) {
        addToActivityLog(`بيانات مسؤول (${currentCustomer.managers[index].name || 'بدون اسم'})`, oldVal, value, currentCustomer.comp || currentCustomer.name || 'العميل');
    }
    
    if (currentCustomer.managers[index].isPrimary && (field === 'name' || field === 'phone' || field === 'email')) {
        if (!currentCustomer.primaryContact) currentCustomer.primaryContact = {};
        currentCustomer.primaryContact[field] = value;
        
        if (field === 'name') currentCustomer.mgr = value;
        if (field === 'phone') currentCustomer.mob = value;
        if (field === 'email') currentCustomer.email = value;
    }
    
    saveToFirestore();
}

window.deleteManagerRow = function(index) {
    if (confirm("هل أنت متأكد من حذف هذا المسؤول؟")) {
        const mgrName = currentCustomer.managers[index].name || 'مسؤول غير مسمى';
        const isWasPrimary = currentCustomer.managers[index].isPrimary;
        currentCustomer.managers.splice(index, 1);
        
        addToActivityLog('إجراء', `حذف مسؤول (${mgrName})`, '', currentCustomer.comp || currentCustomer.name || 'العميل');

        if (isWasPrimary && currentCustomer.managers.length > 0) {
            currentCustomer.managers[0].isPrimary = true;
            window.setPrimaryManager(0);
        } else {
            if (currentCustomer.managers.length === 0) {
                currentCustomer.primaryContact = {};
                currentCustomer.mgr = "";
                currentCustomer.mob = "";
                currentCustomer.email = "";
            }
            saveToFirestore();
        }
        renderManagersTable();
    }
}

window.switchTab = function(tabName) {
    const buttons = document.querySelectorAll('.tab-btn');
    buttons.forEach(btn => btn.classList.remove('active'));

    const activeBtn = document.getElementById(`btn-${tabName}`);
    if (activeBtn) activeBtn.classList.add('active');

    const thead = document.getElementById('tableHeadRow');
    const tbody = document.getElementById('contentBody');
    const title = document.getElementById('tab-title');

    if(!tbody || !thead || !title) return;
    tbody.innerHTML = '';

    if (tabName === 'orders') {
        title.textContent = '🛒 سجل الطلبات';
        thead.innerHTML = `<th>رقم الطلب</th><th>تفاصيل الطلب</th><th>التاريخ</th><th>المبلغ</th><th>الحالة</th>`;
        (currentCustomer.orders || []).forEach(item => {
            tbody.innerHTML += `<tr><td><b>${item.id}</b></td><td>${item.title}</td><td>${item.date}</td><td>${item.amount}</td><td><span class="status-badge active">${item.status}</span></td></tr>`;
        });
    } else if (tabName === 'visits') {
        title.textContent = '🚗 سجل الزيارات';
        thead.innerHTML = `<th>تاريخ الزيارة</th><th>الزائر (الموظف)</th><th>الهدف من الزيارة</th><th>النتيجة / الملاحظات</th>`;
        (currentCustomer.visits || []).forEach(item => {
            tbody.innerHTML += `<tr><td>${item.date}</td><td>${item.visitor}</td><td>${item.purpose}</td><td>${item.result}</td></tr>`;
        });
    } else if (tabName === 'opportunities') {
        title.textContent = '🎯 الفرص البيعية';
        thead.innerHTML = `<th>اسم الفرصة</th><th>القيمة التقديرية</th><th>المرحلة</th><th>نسبة النجاح</th>`;
        (currentCustomer.opportunities || []).forEach(item => {
            tbody.innerHTML += `<tr><td>${item.title}</td><td>${item.value}</td><td>${item.stage}</td><td>${item.probability}</td></tr>`;
        });
    } else if (tabName === 'sales') {
        title.textContent = '💰 سجل المبيعات والفواتير';
        thead.innerHTML = `<th>رقم الفاتورة</th><th>التاريخ</th><th>الإجمالي</th><th>الحالة</th>`;
        (currentCustomer.sales || []).forEach(item => {
            tbody.innerHTML += `<tr><td><b>${item.invId}</b></td><td>${item.date}</td><td>${item.total}</td><td>${item.status}</td></tr>`;
        });
    } else if (tabName === 'attachments') {
        title.textContent = '📎 الملفات والمرفقات';
        thead.innerHTML = `<th>اسم الملف</th><th>تاريخ الإضافة</th><th>الحجم</th><th>تحميل</th>`;
        (currentCustomer.attachments || []).forEach(item => {
            tbody.innerHTML += `<tr><td>${item.name}</td><td>${item.date}</td><td>${item.size}</td><td><button class="btn btn-outline" style="padding: 2px 8px;"><i class="fas fa-download"></i></button></td></tr>`;
        });
    }
}

async function saveToFirestore() {
    saveCustomerLocally(); 
    try {
        await updateDoc(doc(db, "customers", customerCode), currentCustomer);
    } catch (error) {
        console.error("Error updating document:", error);
    }
}

// ==========================================
// === دوال تعديل بيانات العميل الأساسية ===
// ==========================================

window.openEditModal = function() {
    if (!currentCustomer) return;
    
    document.getElementById('editCode').value = currentCustomer.code || customerCode || '';
    document.getElementById('editComp').value = currentCustomer.comp || currentCustomer.name || '';
    document.getElementById('editCity').value = currentCustomer.city || '';
    document.getElementById('editAddress').value = currentCustomer.neighborhood || currentCustomer.address || '';
    document.getElementById('editCr1').value = currentCustomer.cr1 || currentCustomer.cr || '';
    document.getElementById('editCr2').value = currentCustomer.cr2 || '';
    document.getElementById('editOwner').value = currentCustomer.owner || '';
    document.getElementById('editSource').value = currentCustomer.source || '';
    
    const classSelect = document.getElementById('editClass');
    if (classSelect) classSelect.value = currentCustomer.classification || 'صغير';
    
    const statusSelect = document.getElementById('editStatus');
    if (statusSelect) statusSelect.value = currentCustomer.status || 'جديد';

    document.getElementById('editCustomerModal').style.display = 'flex';
}

window.closeEditModal = function() {
    document.getElementById('editCustomerModal').style.display = 'none';
}

window.saveCustomerEdits = async function(event) {
    if (!currentCustomer || !customerCode) return;

    const newComp = document.getElementById('editComp').value.trim();
    if (newComp === '') {
        alert('اسم الشركة مطلوب');
        return;
    }

    // تتبع التعديلات على سجل النشاط
    const customerNameLog = currentCustomer.comp || currentCustomer.name || 'عميل غير مسمى';
    
    const oldComp = currentCustomer.comp || currentCustomer.name || '';
    if (oldComp !== newComp) addToActivityLog('اسم المنشأة', oldComp, newComp, customerNameLog);
    
    const newCity = document.getElementById('editCity').value;
    const oldCity = currentCustomer.city || '';
    if (oldCity !== newCity) addToActivityLog('المدينة', oldCity, newCity, customerNameLog);

    const newAddress = document.getElementById('editAddress').value;
    const oldAddress = currentCustomer.neighborhood || currentCustomer.address || '';
    if (oldAddress !== newAddress) addToActivityLog('العنوان', oldAddress, newAddress, customerNameLog);

    const newCr1 = document.getElementById('editCr1').value;
    const oldCr1 = currentCustomer.cr1 || currentCustomer.cr || '';
    if (oldCr1 !== newCr1) addToActivityLog('السجل الرئيسي', oldCr1, newCr1, customerNameLog);

    const newClass = document.getElementById('editClass').value;
    const oldClass = currentCustomer.classification || 'صغير';
    if (oldClass !== newClass) addToActivityLog('تصنيف العميل', oldClass, newClass, customerNameLog);

    const newStatus = document.getElementById('editStatus').value;
    const oldStatus = currentCustomer.status || 'جديد';
    if (oldStatus !== newStatus) addToActivityLog('الحالة', oldStatus, newStatus, customerNameLog);

    // تطبيق القيم الجديدة
    currentCustomer.comp = newComp;
    currentCustomer.name = newComp; 
    currentCustomer.city = newCity;
    currentCustomer.neighborhood = newAddress;
    currentCustomer.address = newAddress;
    currentCustomer.cr1 = newCr1;
    currentCustomer.cr2 = document.getElementById('editCr2').value;
    currentCustomer.classification = newClass;
    currentCustomer.status = newStatus;
    currentCustomer.owner = document.getElementById('editOwner').value; 

    try {
        const btn = event.target;
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الحفظ...';
        btn.disabled = true;

        await saveToFirestore();
        populateCustomerUI();
        
        const logEntry = {
            user: currentCustomer.owner || 'النظام',
            date: new Date().toLocaleString('ar-EG'),
            action: `قام بتعديل البيانات الأساسية للعميل (${newComp})`,
            timestamp: Date.now()
        };
        await setDoc(doc(db, "activity_logs", Date.now().toString()), logEntry);

        closeEditModal();
        btn.innerHTML = originalText;
        btn.disabled = false;
        
        if (typeof Swal !== 'undefined') {
            Swal.fire('نجاح', 'تم تحديث بيانات العميل بنجاح وتمت المزامنة!', 'success');
        } else {
            alert('تم تحديث البيانات بنجاح!');
        }

    } catch (error) {
        console.error("خطأ في تحديث البيانات:", error);
        alert('حدث خطأ أثناء حفظ التعديلات.');
        event.target.disabled = false;
    }
}

window.goBackAndFocus = function() { window.location.href = 'customers.html'; }
window.openNoteModal = function() { const m = document.getElementById('noteModal'); if(m) m.style.display = 'flex'; }
window.closeNoteModal = function() { const m = document.getElementById('noteModal'); if(m) m.style.display = 'none'; }

window.handleFileSelect = function(input) {
    const fileName = input.files[0] ? input.files[0].name : "لم يتم اختيار ملف";
    const el = document.getElementById('fileName');
    if(el) el.textContent = fileName;
}

window.saveActivity = function() {
    const noteEl = document.getElementById('activityNote');
    const note = noteEl ? noteEl.value : '';
    if (note.trim() === '') return alert('يرجى كتابة الملاحظة أولاً');
    
    addToActivityLog('إجراء', 'إضافة ملاحظة/نشاط جديد', '', currentCustomer.comp || currentCustomer.name || 'العميل');
    
    alert('تم حفظ النشاط بنجاح');
    if(noteEl) noteEl.value = '';
    window.closeNoteModal();
}

document.addEventListener('DOMContentLoaded', initPage);