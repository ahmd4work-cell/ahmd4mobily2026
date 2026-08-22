// ==========================================
// main.js - لوحة القيادة العامة وتكامل السحابة (محدث ومحسن)
// ==========================================
import { db } from './firebase-config.js';
import { collection, onSnapshot, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

let firestoreRawData = { visits: [], opportunities: [], sales: [] };
let achievedChart, gaugeChart, pendingChart, staffChart;
let q1Chart, q2Chart, q3Chart, q4Chart;
let monthlyCompletedChart, monthlyVisitsChart;

let isEditingTargets = false;
const defaultMonthlyTarget = 15000;
let monthlyTargetsArr = Array(12).fill(defaultMonthlyTarget);

const oppCountEl = document.getElementById('oppCount');
const visitCountEl = document.getElementById('visitCount');
const salesValueEl = document.getElementById('salesValue');
const pendingValueEl = document.getElementById('pendingValue');
const tbody = document.getElementById('monthsBody');

const monthsNames = ["يناير", "فبراير", "مارس", "ابريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

// دالة ذكية لتوليد تدرج ألوان للخريطة الحرارية
function generateHeatmapColors(values, baseColorRGB) {
    const max = Math.max(...values);
    if (max === 0) return Array(12).fill('#f1f5f9');
    return values.map(v => {
        if (v === 0) return '#f8fafc'; 
        const opacity = 0.3 + (0.7 * (v / max)); 
        return `rgba(${baseColorRGB}, ${opacity})`;
    });
}

// جلب وحفظ أهداف الأشهر محلياً وسحابياً مع إدارة حالة المزامنة
function getStoredTargets() {
    const saved = localStorage.getItem('monthlyTargets');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length === 12) return parsed;
        } catch (e) {
            console.error("خطأ في قراءة الأهداف من الذاكرة المحلية:", e);
        }
    }
    return monthlyTargetsArr;
}

async function saveStoredTargets(targetsArr) {
    monthlyTargetsArr = targetsArr;
    
    // 1. الحفظ المحلي الفوري
    try {
        localStorage.setItem('monthlyTargets', JSON.stringify(targetsArr));
    } catch (e) {
        console.error("خطأ في التخزين المحلي:", e);
    }

    updateSyncStatus('saving');

    // 2. الحفظ السحابي
    try {
        await setDoc(doc(db, "settings", "monthlyTargets"), { 
            values: targetsArr,
            updatedAt: new Date().toISOString()
        }, { merge: true });
        console.log("[Cloud] تم حفظ الأهداف سحابياً بنجاح");
        updateSyncStatus('saved');
    } catch (e) {
        console.error("خطأ في حفظ الأهداف على السحابة:", e);
        updateSyncStatus('error');
    }
}

function updateSyncStatus(status) {
    const statusEl = document.getElementById('syncStatus') || document.getElementById('cloudStatus');
    if (!statusEl) return;
    
    switch(status) {
        case 'saving': statusEl.textContent = 'جاري الحفظ...'; statusEl.className = 'sync-saving'; break;
        case 'saved': statusEl.textContent = 'تم الحفظ'; statusEl.className = 'sync-saved'; break;
        case 'loading': statusEl.textContent = 'جاري التحديث...'; statusEl.className = 'sync-loading'; break;
        case 'error': statusEl.textContent = 'خطأ في الاتصال'; statusEl.className = 'sync-error'; break;
        default: statusEl.textContent = ''; statusEl.className = '';
    }
}

function initBlurToggle() {
    const toggleBlurBtn = document.getElementById('toggleBlurBtn');
    const yearlyTable = document.querySelector('.yearly-table');
    if (toggleBlurBtn && yearlyTable) {
        if (localStorage.getItem('tableBlurred') === 'true') {
            yearlyTable.classList.add('is-blurred');
            toggleBlurBtn.classList.add('active');
        }
        toggleBlurBtn.addEventListener('click', () => {
            yearlyTable.classList.toggle('is-blurred');
            toggleBlurBtn.classList.toggle('active');
            const isBlurred = yearlyTable.classList.contains('is-blurred');
            localStorage.setItem('tableBlurred', isBlurred ? 'true' : 'false');
        });
    }
}

function initTargetEditToggle() {
    const editBtn = document.getElementById('editTargetBtn');
    if (!editBtn) return;
    editBtn.addEventListener('click', () => {
        isEditingTargets = !isEditingTargets;
        editBtn.classList.toggle('active', isEditingTargets);
        
        if (!isEditingTargets) {
            const inputs = document.querySelectorAll('.target-input');
            if (inputs.length === 12) {
                const newTargets = Array.from(inputs).map(inp => parseFloat(inp.value) || 0);
                saveStoredTargets(newTargets);
            }
        }
        updateDashboard();
    });
}

function listenToFirestoreData() {
    let visitsData = [], oppsData = [], salesDb = [], productsDb = {};
    updateSyncStatus('loading');

    // منع تحديث الأهداف سحابياً أثناء قيام المستخدم بالتعديل لمنع تجمد حقول الإدخال
    onSnapshot(doc(db, "settings", "monthlyTargets"), (docSnap) => {
        if (isEditingTargets) return; 
        if (docSnap.exists() && docSnap.data().values && docSnap.data().values.length === 12) {
            monthlyTargetsArr = docSnap.data().values;
            localStorage.setItem('monthlyTargets', JSON.stringify(monthlyTargetsArr));
            updateDashboard();
            updateSyncStatus('saved');
        }
    });

    const checkAndUpdate = () => {
        let linkedSales = [];
        salesDb.forEach(order => {
            const orderProducts = productsDb[order.id] || [];
            let completedSum = 0;
            let pendingSum = 0;
            
            orderProducts.forEach(p => {
                const lineTotal = (parseFloat(p.qty) || 0) * (parseFloat(String(p.sub || p.price || 0).replace(/[^\d.]/g, '')) || 0);
                if (p.status === "مكتمل" || order.status === "مكتمل") completedSum += lineTotal;
                if (p.status === "معلق" || order.status === "معلق") pendingSum += lineTotal;
            });

            linkedSales.push({
                id: order.id,
                date: order.date || order.createdAt || '',
                region: order.region || '',
                supervisor: order.supervisor || '',
                salesman: order.owner || order.salesman || '',
                completedSum: completedSum,
                pendingSum: pendingSum
            });
        });

        firestoreRawData = { visits: visitsData, opportunities: oppsData, sales: linkedSales };
        populateFilterOptions();
        updateDashboard();
    };

    onSnapshot(collection(db, "visits"), (snapshot) => { visitsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); checkAndUpdate(); });
    onSnapshot(collection(db, "opportunities"), (snapshot) => { oppsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); checkAndUpdate(); });
    onSnapshot(collection(db, "sales"), (snapshot) => { salesDb = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); checkAndUpdate(); });
    onSnapshot(collection(db, "products"), (snapshot) => {
        productsDb = {};
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data.orderId) {
                if (!productsDb[data.orderId]) productsDb[data.orderId] = [];
                productsDb[data.orderId].push(data);
            }
        });
        checkAndUpdate();
    });
}

function populateFilterOptions() {
    const data = firestoreRawData;
    const allData = [...data.sales, ...data.opportunities, ...data.visits];
    const regions = new Set(), supervisors = new Set(), salesmen = new Set(), years = new Set(["2026"]);

    allData.forEach(item => {
        if (item.region) regions.add(item.region);
        if (item.supervisor) supervisors.add(item.supervisor);
        if (item.salesman || item.owner) salesmen.add(item.salesman || item.owner);
        
        let itemDate = item.date || item.visitDate || item.visit_date || item.oppDate || item.saleDate;
        if (itemDate) {
            if(itemDate.includes('/')) years.add(itemDate.split('/')[2]);
            else if(itemDate.includes('-')) years.add(itemDate.split('-')[0]);
        }
    });

    fillSelect(document.getElementById('filterYear'), Array.from(years).filter(y => y && y.length === 4), "2026");
    fillSelect(document.getElementById('filterMonth'), monthsNames, "الكل", true);
    fillSelect(document.getElementById('filterRegion'), regions, "الكل");
    fillSelect(document.getElementById('filterSupervisor'), supervisors, "الكل");
    fillSelect(document.getElementById('filterSalesman'), salesmen, "الكل");
}

function fillSelect(selectElement, setOrArray, defaultVal, isMonth = false) {
    if (!selectElement) return;
    const currentValue = selectElement.value;
    selectElement.innerHTML = '';
    const defaultOpt = document.createElement('option');
    defaultOpt.text = defaultVal; 
    defaultOpt.value = defaultVal === "الكل" ? "all" : defaultVal;
    selectElement.appendChild(defaultOpt);

    setOrArray.forEach((val, index) => {
        if(isMonth && val === defaultVal) return;
        const opt = document.createElement('option');
        opt.text = val; 
        opt.value = isMonth ? (index + 1).toString().padStart(2, '0') : val; 
        if(val !== defaultVal) selectElement.appendChild(opt);
    });

    if (currentValue && selectElement.querySelector(`option[value="${currentValue}"]`)) {
        selectElement.value = currentValue;
    }
}

function getQuarterColors(m1, m2, m3) {
    if (m1 === 0 && m2 === 0 && m3 === 0) return ['#e2e8f0', '#e2e8f0', '#e2e8f0'];
    let vals = [{ idx: 0, v: m1 }, { idx: 1, v: m2 }, { idx: 2, v: m3 }];
    vals.sort((a, b) => b.v - a.v); 
    vals[0].color = '#10b981'; vals[1].color = '#f59e0b'; vals[2].color = '#ef4444'; 
    let result = [];
    result[vals[0].idx] = vals[0].color; result[vals[1].idx] = vals[1].color; result[vals[2].idx] = vals[2].color;
    return result;
}

function updateQuarterChart(chart, pctElementId, m1, m2, m3, targetQuarterly) {
    if(!chart) return;
    let colors = getQuarterColors(m1, m2, m3);
    let achieved = m1 + m2 + m3;
    let remaining = Math.max(0, targetQuarterly - achieved);
    chart.data.datasets[0].data = [m1, m2, m3, remaining];
    chart.data.datasets[0].backgroundColor = [...colors, '#f1f5f9'];
    chart.update();
    let pct = targetQuarterly > 0 ? Math.round((achieved / targetQuarterly) * 100) : 0;
    const pctEl = document.getElementById(pctElementId);
    if(pctEl) pctEl.innerText = pct + '%';
}

function parseMonthFromDate(dateStr) {
    if(!dateStr) return null;
    if (dateStr.includes('/')) return dateStr.split('/')[1].padStart(2, '0');
    if (dateStr.includes('-')) return dateStr.split('-')[1].padStart(2, '0');
    return null;
}

function parseYearFromDate(dateStr) {
    if(!dateStr) return null;
    if (dateStr.includes('/')) return dateStr.split('/')[2];
    if (dateStr.includes('-')) return dateStr.split('-')[0];
    return null;
}

function updateDashboard() {
    const data = firestoreRawData;
    const sYear = document.getElementById('filterYear')?.value || "2026";
    const sMonth = document.getElementById('filterMonth')?.value || "all";
    const sRegion = document.getElementById('filterRegion')?.value || "all";
    const sSuper = document.getElementById('filterSupervisor')?.value || "all";
    const sSales = document.getElementById('filterSalesman')?.value || "all";

    const filterCallback = (item) => {
        const iDate = item.date || item.visitDate || item.visit_date || item.oppDate || item.saleDate || "";
        let itemYear = parseYearFromDate(iDate) || "";
        let itemMonth = parseMonthFromDate(iDate) || "";

        if (sYear !== "all" && itemYear !== sYear) return false;
        if (sMonth !== "all" && itemMonth !== sMonth) return false;
        if (sRegion !== "all" && item.region !== sRegion) return false;
        if (sSuper !== "all" && item.supervisor !== sSuper) return false;
        const ownerName = item.salesman || item.owner;
        if (sSales !== "all" && ownerName !== sSales) return false;
        return true;
    };

    const filteredSales = data.sales.filter(filterCallback);
    const filteredOpps = data.opportunities.filter(filterCallback);
    const filteredVisits = data.visits.filter(filterCallback);

    let totalSales = 0, totalPending = 0;
    let monthlySalesArr = Array(12).fill(0);
    let monthlyVisitsArr = Array(12).fill(0);

    filteredSales.forEach(sale => {
        totalSales += sale.completedSum;
        totalPending += sale.pendingSum;
        let month = parseInt(parseMonthFromDate(sale.date));
        if (month >= 1 && month <= 12) {
            monthlySalesArr[month - 1] += sale.completedSum;
        }
    });

    filteredVisits.forEach(v => {
        let month = parseInt(parseMonthFromDate(v.date || v.visitDate || v.visit_date || v.oppDate));
        if (month >= 1 && month <= 12) {
            monthlyVisitsArr[month - 1] += 1;
        }
    });

    if(oppCountEl) oppCountEl.innerText = filteredOpps.length.toLocaleString('en-US'); 
    if(visitCountEl) visitCountEl.innerText = filteredVisits.length.toLocaleString('en-US'); 
    if(salesValueEl) salesValueEl.innerText = totalSales.toLocaleString('en-US');
    if(pendingValueEl) pendingValueEl.innerText = totalPending.toLocaleString('en-US');

    const yearlyTargetSum = updateYearlyTable(filteredSales, filteredOpps, filteredVisits);
    
    updateChartsLogic(totalSales, totalPending, filteredSales, yearlyTargetSum, monthlySalesArr, monthlyVisitsArr);
    
    const targets = getStoredTargets();
    const q1Target = (targets[0] + targets[1] + targets[2]) || 45000;
    const q2Target = (targets[3] + targets[4] + targets[5]) || 45000;
    const q3Target = (targets[6] + targets[7] + targets[8]) || 45000;
    const q4Target = (targets[9] + targets[10] + targets[11]) || 45000;

    const avgQuarterTarget = Math.round((q1Target + q2Target + q3Target + q4Target) / 4);
    const qTitle = document.getElementById('quarterTitleHeader');
    if (qTitle) qTitle.innerText = `تحليل مبيعات الأرباع السنوية (متوسط هدف الربع: ${Math.round(avgQuarterTarget/1000)}k)`;

    updateQuarterChart(q1Chart, 'q1Pct', monthlySalesArr[0], monthlySalesArr[1], monthlySalesArr[2], q1Target);
    updateQuarterChart(q2Chart, 'q2Pct', monthlySalesArr[3], monthlySalesArr[4], monthlySalesArr[5], q2Target);
    updateQuarterChart(q3Chart, 'q3Pct', monthlySalesArr[6], monthlySalesArr[7], monthlySalesArr[8], q3Target);
    updateQuarterChart(q4Chart, 'q4Pct', monthlySalesArr[9], monthlySalesArr[10], monthlySalesArr[11], q4Target);
}

function updateYearlyTable(sales, opps, visits) {
    if (!tbody) return 180000;
    
    // إذا كان المستخدم يقوم بالتعديل حالياً، لا تقم بإعادة بناء الجدول لتجنب فقدان التركيز والتجمد
    if (isEditingTargets) {
        const targets = getStoredTargets();
        return targets.reduce((a, b) => a + b, 0);
    }

    tbody.innerHTML = '';

    const targets = getStoredTargets();
    let totalTarget = 0;
    let totalCompleted = 0;
    let totalPending = 0;
    let totalVisits = 0;
    let totalOpps = 0;

    monthsNames.forEach((monthName, index) => {
        const monthCode = (index + 1).toString().padStart(2, '0');
        const mSales = sales.filter(s => parseMonthFromDate(s.date) === monthCode);
        const mOpps = opps.filter(o => parseMonthFromDate(o.date || o.oppDate || o.visitDate || o.visit_date) === monthCode);
        const mVisits = visits.filter(v => parseMonthFromDate(v.date || v.visitDate || v.visit_date || v.oppDate) === monthCode);

        let mCompleted = 0, mPending = 0;
        mSales.forEach(s => { mCompleted += s.completedSum; mPending += s.pendingSum; });

        const currentTarget = targets[index] || 0;
        totalTarget += currentTarget;
        totalCompleted += mCompleted;
        totalPending += mPending;
        totalVisits += mVisits.length;
        totalOpps += mOpps.length;

        const targetDisplay = isEditingTargets
            ? `<input type="number" class="target-input" data-index="${index}" value="${currentTarget}">`
            : currentTarget.toLocaleString('en-US');

        const row = tbody.insertRow();
        row.innerHTML = `
            <td>${monthName}</td>
            <td>${targetDisplay}</td>
            <td style="color: var(--light-green); font-weight: 800;">${mCompleted > 0 ? mCompleted.toLocaleString('en-US') : '-'}</td>
            <td class="thick-border" style="color: #f59e0b; font-weight: 800;">${mPending > 0 ? mPending.toLocaleString('en-US') : '-'}</td>
            <td>${mVisits.length > 0 ? mVisits.length : '-'}</td>
            <td>${mOpps.length > 0 ? mOpps.length : '-'}</td>
        `;
    });

    if (isEditingTargets) {
        document.querySelectorAll('.target-input').forEach(inp => {
            inp.addEventListener('input', (e) => {
                const idx = parseInt(e.target.dataset.index);
                const val = parseFloat(e.target.value) || 0;
                targets[idx] = val;
                saveStoredTargets(targets);
                
                const newTotal = targets.reduce((a, b) => a + b, 0);
                const totTargetEl = document.getElementById('totTarget');
                if (totTargetEl) totTargetEl.innerText = newTotal.toLocaleString('en-US');
                const cardTargetEl = document.getElementById('yearlyTargetCardVal');
                if (cardTargetEl) cardTargetEl.innerText = newTotal.toLocaleString('en-US');
            });
        });
    }

    const totTargetEl = document.getElementById('totTarget');
    const totCompletedEl = document.getElementById('totCompleted');
    const totPendingEl = document.getElementById('totPending');
    const totVisitsEl = document.getElementById('totVisits');
    const totOppsEl = document.getElementById('totOpps');
    const cardTargetEl = document.getElementById('yearlyTargetCardVal');

    if (totTargetEl) totTargetEl.innerText = totalTarget.toLocaleString('en-US');
    if (cardTargetEl) cardTargetEl.innerText = totalTarget.toLocaleString('en-US');
    if (totCompletedEl) totCompletedEl.innerText = totalCompleted > 0 ? totalCompleted.toLocaleString('en-US') : '0';
    if (totPendingEl) totPendingEl.innerText = totalPending > 0 ? totalPending.toLocaleString('en-US') : '0';
    if (totVisitsEl) totVisitsEl.innerText = totalVisits > 0 ? totalVisits.toLocaleString('en-US') : '0';
    if (totOppsEl) totOppsEl.innerText = totalOpps > 0 ? totalOpps.toLocaleString('en-US') : '0';

    return totalTarget;
}

function initCharts() {
    const achievedEl = document.getElementById('achievedChart');
    if (achievedEl) achievedChart = new Chart(achievedEl, { type: 'doughnut', data: { datasets: [{ data: [0, 100], backgroundColor: ['#10b981', '#f1f5f9'], borderWidth: 0, borderRadius: 10 }] }, options: { cutout: '82%', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } });

    const pendingEl = document.getElementById('pendingChart');
    if (pendingEl) pendingChart = new Chart(pendingEl, { type: 'doughnut', data: { datasets: [{ data: [0, 100], backgroundColor: ['#f59e0b', '#f1f5f9'], borderWidth: 0, borderRadius: 10 }] }, options: { cutout: '82%', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } });

    const gaugeNeedlePlugin = {
        id: 'gaugeNeedle',
        afterDatasetDraw(chart, args, options) {
            const { ctx, chartArea: { width } } = chart;
            ctx.save();
            let percent = options.percent || 0; if(percent > 100) percent = 100;
            const angle = Math.PI + (Math.PI * (percent / 100));
            const meta = chart.getDatasetMeta(0);
            if (!meta.data.length) return;
            const cx = meta.data[0].x, cy = meta.data[0].y, needleLength = width / 2.3;
            ctx.translate(cx, cy); ctx.rotate(angle);
            
            ctx.beginPath(); ctx.moveTo(0, -3.5); ctx.lineTo(needleLength, 0); ctx.lineTo(0, 3.5); ctx.fillStyle = '#0a3a22'; ctx.fill();
            ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fillStyle = '#10b981'; ctx.fill();
            ctx.lineWidth = 1.5; ctx.strokeStyle = '#0a3a22'; ctx.stroke();
            
            ctx.restore();
        }
    };

    const gaugeEl = document.getElementById('gaugeChart');
    if (gaugeEl) gaugeChart = new Chart(gaugeEl.getContext('2d'), { type: 'doughnut', plugins: [gaugeNeedlePlugin], data: { datasets: [{ data: [100], backgroundColor: function(context) { const chart = context.chart; const {ctx, chartArea} = chart; if (!chartArea) return null; const gradient = ctx.createLinearGradient(chartArea.left, 0, chartArea.right, 0); gradient.addColorStop(0, '#ef4444'); gradient.addColorStop(0.5, '#fbbf24'); gradient.addColorStop(1, '#10b981'); return gradient; }, borderWidth: 0 }] }, options: { rotation: 270, circumference: 180, cutout: '80%', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false }, gaugeNeedle: { percent: 0 } } } });

    const quarterOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: function(ctx) { let labels = ['الشهر الأول', 'الشهر الثاني', 'الشهر الثالث', 'متبقي من الهدف']; return labels[ctx.dataIndex] + ': ' + (ctx.parsed||0).toLocaleString() + ' ريال'; } } }
        }
    };

    const qInitialData = { datasets: [{ data: [0, 0, 0, 100], backgroundColor: ['#e2e8f0', '#e2e8f0', '#e2e8f0', '#f1f5f9'], borderWidth: 2, borderColor: '#ffffff' }] };
    
    q1Chart = new Chart(document.getElementById('q1Chart'), { type: 'pie', data: JSON.parse(JSON.stringify(qInitialData)), options: quarterOptions });
    q2Chart = new Chart(document.getElementById('q2Chart'), { type: 'pie', data: JSON.parse(JSON.stringify(qInitialData)), options: quarterOptions });
    q3Chart = new Chart(document.getElementById('q3Chart'), { type: 'pie', data: JSON.parse(JSON.stringify(qInitialData)), options: quarterOptions });
    q4Chart = new Chart(document.getElementById('q4Chart'), { type: 'pie', data: JSON.parse(JSON.stringify(qInitialData)), options: quarterOptions });

    const distChartOptions = {
        cutout: '72%',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: function(ctx) { return monthsNames[ctx.dataIndex] + ': 0'; } } }
        }
    };

    const mcCtx = document.getElementById('monthlyCompletedChart');
    if (mcCtx) {
        monthlyCompletedChart = new Chart(mcCtx, {
            type: 'doughnut',
            data: { labels: monthsNames, datasets: [{ data: Array(12).fill(1), backgroundColor: Array(12).fill('#e2e8f0'), borderWidth: 2, borderColor: '#ffffff' }] },
            options: JSON.parse(JSON.stringify(distChartOptions))
        });
    }

    const mvCtx = document.getElementById('monthlyVisitsChart');
    if (mvCtx) {
        const visitOptions = JSON.parse(JSON.stringify(distChartOptions));
        visitOptions.plugins.tooltip.callbacks.label = function(ctx) { return monthsNames[ctx.dataIndex] + ': 0 زيارة'; };
        
        monthlyVisitsChart = new Chart(mvCtx, {
            type: 'doughnut',
            data: { labels: monthsNames, datasets: [{ data: Array(12).fill(1), backgroundColor: Array(12).fill('#e2e8f0'), borderWidth: 2, borderColor: '#ffffff' }] },
            options: visitOptions
        });
    }

    const staffEl = document.getElementById('staffChart');
    if (staffEl) staffChart = new Chart(staffEl.getContext('2d'), { type: 'bar', data: { labels: Array.from({length: 30}, (_, i) => `موظف ${i + 1}`), datasets: [ { label: 'مكتمل', data: Array.from({length: 30}, () => 0), backgroundColor: '#10b981', barPercentage: 0.85, categoryPercentage: 0.6 }, { label: 'معلق', data: Array.from({length: 30}, () => 0), backgroundColor: '#f59e0b', barPercentage: 0.85, categoryPercentage: 0.6 } ] }, options: { responsive: true, maintainAspectRatio: false, plugins: { tooltip: { callbacks: { label: function(context) { let label = context.dataset.label || ''; if (label) label += ': '; if (context.parsed.y !== undefined) { label += Number(context.parsed.y).toLocaleString('en-US') + ' ريال'; } return label; } } } }, scales: { x: { grid: { display: false }, ticks: { font: { family: 'Cairo', size: 10 }, maxRotation: 45, minRotation: 45 } } } } });
}

function updateChartsLogic(salesTotal, pendingTotal, filteredSales = [], yearlyTargetSum = 180000, monthlySalesArr = [], monthlyVisitsArr = []) {
    const grandTotal = salesTotal + pendingTotal || 1; 
    const salesPercent = Math.round((salesTotal / grandTotal) * 100) || 0;
    const pendingPercent = Math.round((pendingTotal / grandTotal) * 100) || 0;

    const achievedText = document.getElementById('achievedPct');
    if(achievedText) achievedText.innerText = `${salesPercent}%`;

    const pendingText = document.getElementById('pendingPct');
    if(pendingText) pendingText.innerText = `${pendingPercent}%`;

    const targetYearly = yearlyTargetSum || 180000;
    const gaugePercentRaw = targetYearly > 0 ? (salesTotal / targetYearly) * 100 : 0;
    const gaugeValueText = document.getElementById('gaugePct');
    if(gaugeValueText) gaugeValueText.innerText = `${Math.round(gaugePercentRaw)}%`;

    if (achievedChart) { achievedChart.data.datasets[0].data = [salesPercent, 100 - salesPercent]; achievedChart.update(); }
    if (pendingChart) { pendingChart.data.datasets[0].data = [pendingPercent, 100 - pendingPercent]; pendingChart.update(); }
    if (gaugeChart) { gaugeChart.options.plugins.gaugeNeedle.percent = Math.min(gaugePercentRaw, 100); gaugeChart.update(); }

    if (monthlyCompletedChart && monthlySalesArr.length > 0) {
        const totalSalesVolume = monthlySalesArr.reduce((a, b) => a + b, 0);
        monthlyCompletedChart.data.datasets[0].data = totalSalesVolume === 0 ? Array(12).fill(1) : monthlySalesArr;
        monthlyCompletedChart.data.datasets[0].backgroundColor = generateHeatmapColors(monthlySalesArr, '16, 185, 129');
        
        monthlyCompletedChart.options.plugins.tooltip.callbacks.label = function(ctx) {
            return monthsNames[ctx.dataIndex] + ': ' + (monthlySalesArr[ctx.dataIndex] || 0).toLocaleString('en-US') + ' ريال';
        };
        monthlyCompletedChart.update();
    }
    
    if (monthlyVisitsChart && monthlyVisitsArr.length > 0) {
        const totalVisitsVolume = monthlyVisitsArr.reduce((a, b) => a + b, 0);
        monthlyVisitsChart.data.datasets[0].data = totalVisitsVolume === 0 ? Array(12).fill(1) : monthlyVisitsArr;
        monthlyVisitsChart.data.datasets[0].backgroundColor = generateHeatmapColors(monthlyVisitsArr, '71, 85, 105');
        
        monthlyVisitsChart.options.plugins.tooltip.callbacks.label = function(ctx) {
            return monthsNames[ctx.dataIndex] + ': ' + (monthlyVisitsArr[ctx.dataIndex] || 0).toLocaleString('en-US') + ' زيارة';
        };
        monthlyVisitsChart.update();
    }

    if (staffChart) {
        const staffAggregation = {};
        filteredSales.forEach(sale => {
            const name = (sale.salesman || sale.owner || "").trim();
            if (!name) return;
            if (!staffAggregation[name]) staffAggregation[name] = { completed: 0, pending: 0 };
            staffAggregation[name].completed += sale.completedSum;
            staffAggregation[name].pending += sale.pendingSum;
        });

        const realStaffNames = Object.keys(staffAggregation);
        const finalLabels = Array.from({length: 30}, (_, i) => realStaffNames[i] || `موظف ${i + 1}`);
        const salesDataset = Array.from({length: 30}, (_, i) => realStaffNames[i] ? staffAggregation[realStaffNames[i]].completed : 0);
        const pendingDataset = Array.from({length: 30}, (_, i) => realStaffNames[i] ? staffAggregation[realStaffNames[i]].pending : 0);

        staffChart.data.labels = finalLabels;
        staffChart.data.datasets[0].data = salesDataset;
        staffChart.data.datasets[1].data = pendingDataset;
        staffChart.update();
    }
}

// التشغيل المبدئي
initBlurToggle();
initTargetEditToggle();
initCharts();
listenToFirestoreData();

document.querySelectorAll('.filters-grid select').forEach(select => select.addEventListener('change', updateDashboard));