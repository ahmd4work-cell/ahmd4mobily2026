function changeMonth(step) {
    viewMonth += step;
    
    if (viewMonth < 0) {
        viewMonth = 11;
        viewYear--;
    } else if (viewMonth > 11) {
        viewMonth = 0;
        viewYear++;
    }
    renderCalendarDays();
}

function renderCalendarDays() {
    const monthSelect = document.getElementById('calMonthSelect');
    const yearSelect = document.getElementById('calYearSelect');
    const daysGrid = document.getElementById('calDaysGrid');
    if (!daysGrid || !monthSelect || !yearSelect) return;

    monthSelect.value = viewMonth;
    yearSelect.value = viewYear;

    daysGrid.innerHTML = '';

    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const today = new Date();

    for (let i = 0; i < firstDay; i++) {
        const emptyCell = document.createElement('span');
        daysGrid.appendChild(emptyCell);
    }

    for (let i = 1; i <= daysInMonth; i++) {
        const dayCell = document.createElement('span');
        dayCell.classList.add('day-number');
        dayCell.textContent = i;

        const cellDate = new Date(viewYear, viewMonth, i);
        const isWeekend = cellDate.getDay() === 5 || cellDate.getDay() === 6;
        if (isWeekend) {
            dayCell.classList.add('weekend-number');
        }

        if (viewYear === today.getFullYear() && viewMonth === today.getMonth() && i === today.getDate()) {
            dayCell.classList.add('today-day');
        }

        const dStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        
        if (tempSelectedDateStr === dStr) {
            dayCell.classList.add('selected-day');
        }

        dayCell.addEventListener('click', () => {
            tempSelectedDateStr = dStr;
            renderCalendarDays();
        });

        daysGrid.appendChild(dayCell);
    }
}

function openCustomDatePicker(e, displayInput, rowId) {
    e.stopPropagation();
    activeInputDisplayTarget = displayInput;
    const mainRow = document.getElementById(rowId);
    if (mainRow) {
        activeInputHiddenTarget = mainRow.querySelector('.exp-date-input');
    }
    activeRowTargetId = rowId;
    tempSelectedDateStr = activeInputHiddenTarget ? activeInputHiddenTarget.value : "";
    
    if (tempSelectedDateStr) {
        const parts = tempSelectedDateStr.split('-');
        if (parts.length === 3) {
            viewYear = parseInt(parts[0], 10);
            viewMonth = parseInt(parts[1], 10) - 1;
        }
    } else {
        const today = new Date();
        viewYear = today.getFullYear();
        viewMonth = today.getMonth();
    }
    
    const yearSelect = document.getElementById('calYearSelect');
    if (yearSelect) {
        yearSelect.innerHTML = '';
        const currentYear = new Date().getFullYear();
        for (let i = currentYear - 5; i <= currentYear + 5; i++) {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = i;
            yearSelect.appendChild(opt);
        }
        yearSelect.value = viewYear;
    }
    
    renderCalendarDays();
    document.getElementById('calendarOverlay').classList.add('active');
}
window.openCustomDatePicker = openCustomDatePicker;

function closeCalendar() {
    document.getElementById('calendarOverlay').classList.remove('active');
    activeInputDisplayTarget = null;
    activeInputHiddenTarget = null;
    activeRowTargetId = null;
    tempSelectedDateStr = "";
}
window.closeCalendar = closeCalendar;

function applySelectedDate(dateStr) {
    if (activeInputDisplayTarget && activeInputHiddenTarget) {
        activeInputHiddenTarget.value = dateStr;
        activeInputHiddenTarget.dataset.old = dateStr;
        activeInputDisplayTarget.value = formatDateToDisplay(dateStr);
        
        const mainRow = document.getElementById(activeRowTargetId);
        if (mainRow) {
            updateEditDateField(mainRow);
            debouncedSaveSingleRow(activeRowTargetId);
            updateAllDateColors();
        }
    }
    closeCalendar();
}
window.applySelectedDate = applySelectedDate;

document.addEventListener('DOMContentLoaded', () => {
    setupCalendarEvents();
    loadLogsData();
    listenToOpportunities();
});