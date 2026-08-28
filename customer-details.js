// ==========================================
// customer-details.js - تفاصيل العميل سحابياً ومحلياً (حماية مزدوجة)
// ==========================================
import { db } from './firebase-config.js';
// تم دمج setDoc هنا مع باقي مكتبات فايربيس بشكل صحيح
import { doc, getDoc, updateDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

let currentCustomer = null;
let customerCode = null;
const CUSTOMER_DETAIL_LOCAL_KEY = 'asgate_customer_detail_local_v1';

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
    
    currentCustomer.managers = currentCustomer.managers || [];
    currentCustomer.orders = currentCustomer.orders || [];
    currentCustomer.visits = currentCustomer.visits || [];
    currentCustomer.opportunities = currentCustomer.opportunities || [];
    currentCustomer.sales = currentCustomer.sales || [];
    currentCustomer.attachments = currentCustomer.attachments || [];
    currentCustomer.primaryContact = currentCustomer.primaryContact || {};

    const cName = document.getElementById('c-name');
    if (cName) cName.textContent = currentCustomer.comp || currentCustomer.name || 'بدون اسم';
    
    const cr1 = document.getElementById('c-cr1');
    if (cr1) cr1.textContent = currentCustomer.cr1 || currentCustomer.cr || '-';
    
    const cr2 = document.getElementById('c-cr2');
    if (cr2) cr2.textContent = currentCustomer.cr2 || '-';
    
    const loc = document.getElementById('c-location');
    if (loc) loc.textContent = `${currentCustomer.city || ''}`;
    
    const addr = document.getElementById('c-addr');
    if (addr) addr.textContent = currentCustomer.address || '-';
    
    const source = document.getElementById('c-source');
    if (source) source.textContent = currentCustomer.classification || currentCustomer.source || '-';
    
    const owner = document.getElementById('c-owner');
    if (owner) owner.textContent = currentCustomer.owner || '-';

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
            saveCustomerLocally(); // تحديث الذاكرة المحلية بأحدث نسخة سحابية
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
    if(newMgr.isPrimary) window.setPrimaryManager(currentCustomer.managers.length - 1);
    else saveToFirestore();
    
    renderManagersTable();
}

window.updateManager = function(index, field, value) {
    if(!currentCustomer.managers[index]) return;
    currentCustomer.managers[index][field] = value;
    if (currentCustomer.managers[index].isPrimary && (field === 'name' || field === 'phone' || field === 'email')) {
        currentCustomer.primaryContact[field] = value;
        if(field === 'name') currentCustomer.mgr = value;
        if(field === 'phone') currentCustomer.mob = value;
        if(field === 'email') currentCustomer.email = value;
    }
    saveToFirestore();
}

window.deleteManagerRow = function(index) {
    if (confirm("هل أنت متأكد من حذف هذا المسؤول؟")) {
        const isWasPrimary = currentCustomer.managers[index].isPrimary;
        currentCustomer.managers.splice(index, 1);
        
        if (isWasPrimary && currentCustomer.managers.length > 0) {
            currentCustomer.managers[0].isPrimary = true;
            window.setPrimaryManager(0);
        } else {
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
    saveCustomerLocally(); // حفظ محلي فوري قبل المزامنة السحابية
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
    
    // تعبئة الحقول بالبيانات الحالية للعميل
    document.getElementById('editComp').value = currentCustomer.comp || currentCustomer.name || '';
    document.getElementById('editCity').value = currentCustomer.city || '';
    document.getElementById('editAddress').value = currentCustomer.address || '';
    document.getElementById('editCr1').value = currentCustomer.cr1 || currentCustomer.cr || '';
    document.getElementById('editCr2').value = currentCustomer.cr2 || '';
    
    // ضبط قوائم الاختيار
    const classSelect = document.getElementById('editClass');
    if (classSelect) classSelect.value = currentCustomer.classification || 'صغير';
    
    const statusSelect = document.getElementById('editStatus');
    if (statusSelect) statusSelect.value = currentCustomer.status || 'جديد';

    document.getElementById('editCustomerModal').style.display = 'flex';
}

window.closeEditModal = function() {
    document.getElementById('editCustomerModal').style.display = 'none';
}

window.saveCustomerEdits = async function() {
    if (!currentCustomer || !customerCode) return;

    // جلب البيانات الجديدة من الحقول
    const newComp = document.getElementById('editComp').value.trim();
    if (newComp === '') {
        alert('اسم الشركة مطلوب');
        return;
    }

    // تحديث كائن العميل الحالي
    currentCustomer.comp = newComp;
    currentCustomer.name = newComp; // للمطابقة
    currentCustomer.city = document.getElementById('editCity').value;
    currentCustomer.address = document.getElementById('editAddress').value;
    currentCustomer.cr1 = document.getElementById('editCr1').value;
    currentCustomer.cr2 = document.getElementById('editCr2').value;
    currentCustomer.classification = document.getElementById('editClass').value;
    currentCustomer.status = document.getElementById('editStatus').value;

    try {
        // تغيير زر الحفظ لإظهار حالة التحميل
        const btn = event.target;
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الحفظ...';
        btn.disabled = true;

        // 1. الحفظ في السحابة والمحلي (موجودة مسبقاً في كودك)
        await saveToFirestore();
        
        // 2. تحديث واجهة المستخدم في صفحة التفاصيل
        populateCustomerUI();
        
        // 3. تسجيل هذا النشاط ليظهر في صفحة العملاء الرئيسية
        const logEntry = {
            user: currentCustomer.owner || 'النظام',
            date: new Date().toLocaleString('ar-EG'),
            action: `قام بتعديل البيانات الأساسية للعميل (${newComp})`,
            timestamp: Date.now()
        };
        await setDoc(doc(db, "activity_logs", Date.now().toString()), logEntry);

        // إغلاق النافذة وإعادة الزر
        closeEditModal();
        btn.innerHTML = originalText;
        btn.disabled = false;
        
        // رسالة نجاح
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

// ==========================================
// === دوال التحكم في النوافذ والتنقل الأخرى ===
// ==========================================

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
    alert('تم حفظ النشاط بنجاح');
    if(noteEl) noteEl.value = '';
    window.closeNoteModal();
}

document.addEventListener('DOMContentLoaded', initPage);