// ==========================================
// تحديث دوال الملاحظات داخل visits.js
// استبدل دوال الملاحظات في أسفل ملف visits.js لديك بهذا الكود:
// ==========================================

function openNote(el) {
    currentActivePreview = el;
    let arr = []; try { arr = JSON.parse(el.getAttribute('data-full-notes') || "[]"); } catch(e) {}
    const historyLog = document.getElementById('historyLog');
    const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const todayStr = getTodayFormatted(); // لجلب تاريخ اليوم فقط

    if (historyLog) {
        historyLog.innerHTML = arr.map((msg, index) => {
            let msgDateObj = new Date(msg.date);
            let dayStr = isNaN(msgDateObj) ? '' : days[msgDateObj.getDay()] + ' ';
            let userName = msg.user && msg.user !== "المستخدم" ? msg.user : "المستخدم";

            // إضافة أيقونة الحذف فقط إن كانت الملاحظة تابعة لليوم
            let deleteBtnHTML = '';
            if (msg.date === todayStr) {
                deleteBtnHTML = `<button class="btn-delete-note" onclick="deleteNote(${index})" title="حذف الملاحظة"><i class="fas fa-trash-alt"></i></button>`;
            }

            return `
            <div class="note-entry">
                ${deleteBtnHTML}
                <div style="margin-bottom: 6px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-left: 28px;">
                    <span class="log-badge-user"><i class="fas fa-user-circle"></i> ${userName}</span>
                    <span class="log-divider">|</span>
                    <span class="log-timestamp"><i class="fas fa-clock"></i> ${dayStr}${msg.date} ${msg.time}</span>
                </div>
                <div class="log-action" style="color: #0f172a; font-size: 12px; font-weight: 700; white-space: pre-wrap; padding-right: 5px;">${msg.text}</div>
            </div>
            `;
        }).join('') || '<div style="color:#64748b; text-align:center; font-size:11px; padding:20px; font-weight:700;">لا توجد ملاحظات سابقة</div>';
    }
    
    document.getElementById('noteModal').style.display = "flex";
    const modalTextArea = document.getElementById('modalTextArea');
    if (modalTextArea) { modalTextArea.value = ""; modalTextArea.focus(); }
}

window.deleteNote = function(index) {
    if (!currentActivePreview) return;
    
    Swal.fire({
        title: 'تأكيد الحذف',
        text: 'هل أنت متأكد من حذف هذه الملاحظة؟',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'نعم، احذف',
        cancelButtonText: 'إلغاء'
    }).then((result) => {
        if (result.isConfirmed) {
            let arr = []; 
            try { arr = JSON.parse(currentActivePreview.getAttribute('data-full-notes') || "[]"); } catch(e) {}
            
            // تحقق حماية إضافي قبل الحذف: الصلاحية لليوم فقط
            if (arr[index] && arr[index].date === getTodayFormatted()) {
                arr.splice(index, 1);
                currentActivePreview.setAttribute('data-full-notes', JSON.stringify(arr));
                currentActivePreview.innerText = arr.length > 0 ? arr[arr.length - 1].text : "أضف ملاحظة...";
                
                const mainRow = currentActivePreview.closest('.main-row');
                if (mainRow) {
                    updateEditDateField(mainRow);
                    debouncedSaveSingleRow(mainRow.id);
                }
                openNote(currentActivePreview); // تحديث نافذة الملاحظات مباشرة
            } else {
                Swal.fire('غير مصرح', 'انتهت صلاحية الحذف (تم تجاوز الساعة 11:59 مساءً).', 'error');
            }
        }
    });
};

function saveNote() {
    const txt = document.getElementById('modalTextArea').value.trim();
    if (txt && currentActivePreview) {
        let arr = []; try { arr = JSON.parse(currentActivePreview.getAttribute('data-full-notes') || "[]"); } catch(e) {}
        let username = "المستخدم"; const mainRow = currentActivePreview.closest('.main-row');
        if (mainRow) { const ownerInput = mainRow.cells[13]?.querySelector('input'); if (ownerInput && ownerInput.value.trim()) username = ownerInput.value.trim(); }
        arr.push({ user: username, date: getTodayFormatted(), time: getTimeFormatted(), text: txt });
        currentActivePreview.setAttribute('data-full-notes', JSON.stringify(arr)); currentActivePreview.innerText = txt;
        if (mainRow) { updateEditDateField(mainRow); debouncedSaveSingleRow(mainRow.id); }
    }
    closeNote();
}

function closeNote() { document.getElementById('noteModal').style.display = "none"; }