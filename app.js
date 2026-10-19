// ============================================================
// ⚠️ PASTE YOUR APPS SCRIPT WEB APP URL BETWEEN THE QUOTES
// ============================================================
const API_URL = 'https://script.google.com/macros/s/AKfycbxYkd1gw0yG7b7Q25Q6T9mW0BDs-lYa5CsEX0_jeboVPrAOtV5LZ3LZyhW_KOQWC09z/exec';

// ---------- STATE ----------
let students = [];
let attendance = {};
let viewDate = todayISO();
let currentClass = localStorage.getItem('currentClass') || null;
let currentProfileStudentId = null;
let reportData = null;
let activeReportType = 'weekly';
let selectedReportStudentId = '';

const ALL = '__ALL__';
const CYCLE = { undefined: 'Present', 'Present': 'Absent', 'Absent': 'Bunked', 'Bunked': undefined };

const NOTE_CATEGORIES = [
  'General', 'Academic', 'Behaviour', 'Achievement',
  'Meeting', 'Medical', 'Parent Contact'
];

// ---------- DATE HELPERS ----------
function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function shiftDate(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function formatDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  const prefix = iso === todayISO() ? 'Today · ' : '';
  return prefix + d.toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short'
  });
}

function formatTimestamp(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// ---------- CLASS FILTERING ----------
function getClasses() {
  const set = new Set();
  students.forEach(s => {
    const cls = String(s['Class'] || '').trim();
    set.add(cls || 'Unassigned');
  });
  return Array.from(set).sort((a, b) => {
    if (a === 'Unassigned') return 1;
    if (b === 'Unassigned') return -1;
    return a.localeCompare(b);
  });
}

function visibleStudents() {
  if (currentClass === ALL) return students;
  return students.filter(s => {
    const cls = String(s['Class'] || '').trim() || 'Unassigned';
    return cls === currentClass;
  });
}

function renderClassBar() {
  const bar = document.getElementById('class-bar');
  const classes = getClasses();
  bar.innerHTML = '';
  if (classes.length === 0) return;

  if (currentClass !== ALL && !classes.includes(currentClass)) {
    currentClass = classes[0];
    localStorage.setItem('currentClass', currentClass);
  }

  if (classes.length > 1) {
    const allTab = document.createElement('button');
    allTab.className = 'class-tab' + (currentClass === ALL ? ' active' : '');
    allTab.textContent = 'All';
    allTab.addEventListener('click', () => {
      currentClass = ALL;
      localStorage.setItem('currentClass', currentClass);
      render();
    });
    bar.appendChild(allTab);
  }

  classes.forEach(cls => {
    const tab = document.createElement('button');
    tab.className = 'class-tab' + (cls === currentClass ? ' active' : '');
    tab.textContent = cls;
    tab.addEventListener('click', () => {
      currentClass = cls;
      localStorage.setItem('currentClass', currentClass);
      render();
    });
    bar.appendChild(tab);
  });
}

// ---------- INIT ----------
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('prev-day').addEventListener('click', () => changeDay(-1));
  document.getElementById('next-day').addEventListener('click', () => changeDay(1));
  document.getElementById('sync-btn').addEventListener('click', syncAttendance);
  document.getElementById('mark-all-btn').addEventListener('click', markAllPresent);

  const dateInput = document.getElementById('date-input');
  dateInput.max = todayISO();
  dateInput.addEventListener('change', onDatePicked);

  document.getElementById('profile-back').addEventListener('click', closeProfile);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeProfile();
  });

  document.getElementById('register-view-tab').addEventListener('click', () => setWorkspaceView('register'));
  document.getElementById('reports-view-tab').addEventListener('click', () => setWorkspaceView('reports'));
  document.getElementById('generate-report-btn').addEventListener('click', generateReport);
  document.getElementById('export-report-btn').addEventListener('click', exportCurrentReport);
  document.getElementById('print-report-btn').addEventListener('click', () => window.print());
  document.querySelectorAll('.report-type-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      activeReportType = tab.dataset.reportType;
      renderReportTypeTabs();
      if (reportData) renderReportBody();
    });
  });
  document.getElementById('report-date').value = todayISO();
  renderReportClassOptions();

  loadStudentsFromLocal();
  loadAttendanceForViewDate();
  renderReportClassOptions();
  render();
  updateOnlineStatus();

  if (navigator.onLine) {
    await fetchStudents();
    await fetchAttendanceForViewDate();
    render();
  }

  window.addEventListener('online',  () => { updateOnlineStatus(); syncAttendance(); });
  window.addEventListener('offline', () => { updateOnlineStatus(); });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js');
  }
});

async function changeDay(delta) {
  viewDate = shiftDate(viewDate, delta);
  document.getElementById('next-day').disabled = (viewDate >= todayISO());
  loadAttendanceForViewDate();
  render();
  if (navigator.onLine) {
    await fetchAttendanceForViewDate();
    render();
  }
}

async function onDatePicked(e) {
  const picked = e.target.value;
  if (!picked) return;
  viewDate = picked;
  document.getElementById('next-day').disabled = (viewDate >= todayISO());
  loadAttendanceForViewDate();
  render();
  if (navigator.onLine) {
    await fetchAttendanceForViewDate();
    render();
  }
}

// ---------- FETCH ----------
async function fetchStudents() {
  try {
    const res = await fetch(API_URL + '?action=getStudents');
    const data = await res.json();
    students = data.students || [];
    localStorage.setItem('students', JSON.stringify(students));
    renderReportClassOptions();
  } catch (err) { console.error('fetchStudents failed:', err); }
}

async function fetchAttendanceForViewDate() {
  try {
    const res = await fetch(API_URL + '?action=getAttendance&date=' + viewDate);
    const data = await res.json();
    const fresh = {};
    (data.records || []).forEach(r => { fresh[r['Student ID']] = r['Status']; });
    // Reapply locally queued edits after the server response so a slow fetch
    // cannot overwrite an offline mark or a just-cleared status.
    const pending = JSON.parse(localStorage.getItem('pendingSync') || '[]');
    pending.filter(r => r.date === viewDate).forEach(r => {
      if (r.status) fresh[r.studentId] = r.status;
      else delete fresh[r.studentId];
    });
    attendance = fresh;
    saveAttendanceForViewDate();
  } catch (err) { console.error('fetchAttendance failed:', err); }
}

// ---------- LOCAL STORAGE ----------
function loadStudentsFromLocal() {
  const s = localStorage.getItem('students');
  if (s) students = JSON.parse(s);
}

function loadAttendanceForViewDate() {
  const a = localStorage.getItem('attendance_' + viewDate);
  attendance = a ? JSON.parse(a) : {};
}

function saveAttendanceForViewDate() {
  localStorage.setItem('attendance_' + viewDate, JSON.stringify(attendance));
}

// ---------- RENDER MAIN ----------
function render() {
  renderClassBar();

  const grid = document.getElementById('student-grid');
  grid.innerHTML = '';

  document.getElementById('date-display').textContent = formatDate(viewDate);
  document.getElementById('date-input').value = viewDate;
  document.getElementById('next-day').disabled = (viewDate >= todayISO());

  visibleStudents().forEach(student => {
    const id = student['Student ID'];
    const name = student['Name'] || 'Unknown';
    const status = attendance[id];

    const card = document.createElement('div');
    let cls = 'card';
    if (status === 'Present') cls += ' present';
    else if (status === 'Absent') cls += ' absent';
    else if (status === 'Bunked') cls += ' bunked';
    card.className = cls;
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.setAttribute('aria-label', name + ', attendance ' + (status || 'not marked') + '. Activate to change status.');

    const initials = String(name).split(/\s+/)
      .map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const statusLabel = status === 'Present' ? '✓ Present' :
      status === 'Absent' ? '× Absent' :
      status === 'Bunked' ? '⚠ Bunked' : 'Tap to mark';

    card.innerHTML =
      '<button class="info-btn" type="button" aria-label="Open profile for ' + escapeHtml(name) + '">ⓘ</button>' +
      '<div class="initials" aria-hidden="true">' + escapeHtml(initials) + '</div>' +
      '<div class="name">' + escapeHtml(name) + '</div>' +
      '<div class="status-label">' + statusLabel + '</div>';

    card.addEventListener('click', () => toggleStatus(id));
    card.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === card) {
        e.preventDefault();
        toggleStatus(id);
      }
    });
    card.querySelector('.info-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openProfile(id);
    });
    grid.appendChild(card);
  });

  updateSummary();
}

function updateSummary() {
  const list = visibleStudents();
  let p = 0, a = 0, b = 0;
  list.forEach(s => {
    const st = attendance[s['Student ID']];
    if (st === 'Present') p++;
    else if (st === 'Absent') a++;
    else if (st === 'Bunked') b++;
  });
  const u = list.length - p - a - b;
  document.getElementById('summary').innerHTML =
    '<div class="summary-item present-summary"><span class="summary-icon" aria-hidden="true">✓</span><strong class="summary-num">' + p + '</strong><span class="summary-label">Present</span></div>' +
    '<div class="summary-item absent-summary"><span class="summary-icon" aria-hidden="true">×</span><strong class="summary-num">' + a + '</strong><span class="summary-label">Absent</span></div>' +
    '<div class="summary-item bunked-summary"><span class="summary-icon" aria-hidden="true">!</span><strong class="summary-num">' + b + '</strong><span class="summary-label">Bunked</span></div>' +
    '<div class="summary-item unmarked-summary"><span class="summary-icon" aria-hidden="true">…</span><strong class="summary-num">' + u + '</strong><span class="summary-label">Unmarked</span></div>';
}

// ---------- ATTENDANCE INTERACTION ----------
function toggleStatus(studentId) {
  const current = attendance[studentId];
  const next = CYCLE[current];
  if (next) attendance[studentId] = next;
  else delete attendance[studentId];

  saveAttendanceForViewDate();
  queueForSync(studentId);
  render();
}

function markAllPresent() {
  const list = visibleStudents();
  if (list.length === 0) return;

  const nonPresent = list.filter(s => {
    const st = attendance[s['Student ID']];
    return st && st !== 'Present';
  });

  if (nonPresent.length > 0) {
    const ok = confirm(
      nonPresent.length + ' student(s) already marked Absent/Bunked.\n' +
      'Reset everyone in this class to Present?'
    );
    if (!ok) return;
  }

  list.forEach(s => {
    const id = s['Student ID'];
    attendance[id] = 'Present';
    queueForSync(id);
  });
  saveAttendanceForViewDate();
  render();
}

function queueForSync(studentId) {
  const status = attendance[studentId];
  const student = students.find(s => s['Student ID'] === studentId);
  if (!student) return;

  const cls = String(student['Class'] || '').trim() || 'Unassigned';

  const pending = JSON.parse(localStorage.getItem('pendingSync') || '[]');
  const filtered = pending.filter(r => !(String(r.studentId) === String(studentId) && r.date === viewDate));

  // Always queue the latest state. An empty status tells Apps Script to
  // remove a previously saved record rather than leaving a stale mark behind.
  filtered.push({
    date: viewDate,
    studentId: studentId,
    studentName: student['Name'],
    class: cls,
    status: status || ''
  });
  localStorage.setItem('pendingSync', JSON.stringify(filtered));
}

// ---------- SYNC ----------
async function syncAttendance() {
  if (!navigator.onLine) return;
  const pending = JSON.parse(localStorage.getItem('pendingSync') || '[]');
  if (pending.length === 0) return;

  setSyncStatus('syncing');
  const btn = document.getElementById('sync-btn');
  btn.disabled = true;

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'markAttendance', records: pending })
    });
    const result = await res.json();
    if (result.success) {
      // Remove only the changes just acknowledged by the server. Keep any
      // newer marks the teacher made while this request was in flight.
      const posted = new Map(pending.map(r => [String(r.date) + '|' + String(r.studentId), String(r.status || '')]));
      const latest = JSON.parse(localStorage.getItem('pendingSync') || '[]');
      const remaining = latest.filter(r => {
        const key = String(r.date) + '|' + String(r.studentId);
        return !posted.has(key) || posted.get(key) !== String(r.status || '');
      });
      if (remaining.length) localStorage.setItem('pendingSync', JSON.stringify(remaining));
      else localStorage.removeItem('pendingSync');
      setSyncStatus('online');
      btn.innerHTML = '<span aria-hidden="true">✓</span> Synced';
      setTimeout(() => { btn.innerHTML = '<span aria-hidden="true">↻</span> Sync now'; }, 1800);
    } else {
      throw new Error(result.error || 'Sync failed');
    }
  } catch (err) {
    console.error('Sync failed:', err);
    setSyncStatus('offline');
  }
  btn.disabled = false;
}

// ============================================================
// PROFILE
// ============================================================
async function openProfile(studentId) {
  currentProfileStudentId = studentId;
  const overlay = document.getElementById('profile-overlay');
  overlay.classList.remove('hidden');

  document.getElementById('profile-title').textContent = 'Loading…';
  document.getElementById('profile-body').innerHTML =
    '<div class="loading">Loading profile…</div>';

  try {
    const res = await fetch(API_URL + '?action=getProfile&studentId=' +
      encodeURIComponent(studentId));
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderProfile(data);
  } catch (err) {
    console.error('Profile fetch failed:', err);
    document.getElementById('profile-body').innerHTML =
      '<div class="error">Could not load profile.<br>' + err.message + '</div>';
  }
}

function closeProfile() {
  document.getElementById('profile-overlay').classList.add('hidden');
  currentProfileStudentId = null;
}

function renderProfile(data) {
  const { student, contact, notes, recentAttendance } = data;
  document.getElementById('profile-title').textContent =
    student['Name'] + (student['Class'] ? ' · ' + student['Class'] : '');

  const body = document.getElementById('profile-body');
  body.innerHTML = '';

  // --- CONTACT SECTION ---
  const contactSection = document.createElement('div');
  contactSection.className = 'profile-section';
  contactSection.innerHTML = '<h3>Contact</h3>';

  const c = contact || {};
  const contactFields = [
    { key: 'Parent 1 Name',  label: 'Parent / Guardian 1', type: 'text' },
    { key: 'Parent 1 Phone', label: 'Phone',               type: 'tel' },
    { key: 'Parent 1 Email', label: 'Email',               type: 'email' },
    { key: 'Parent 2 Name',  label: 'Parent / Guardian 2', type: 'text' },
    { key: 'Parent 2 Phone', label: 'Phone',               type: 'tel' },
    { key: 'Parent 2 Email', label: 'Email',               type: 'email' }
  ];

  const inputs = {};
  contactFields.forEach(f => {
    const wrap = document.createElement('div');
    wrap.className = 'contact-field';
    const label = document.createElement('label');
    label.textContent = f.label;
    const input = document.createElement('input');
    input.type = f.type;
    input.value = c[f.key] || '';
    input.placeholder = f.label;
    wrap.appendChild(label);
    wrap.appendChild(input);
    contactSection.appendChild(wrap);
    inputs[f.key] = input;
  });

  const saveBtn = document.createElement('button');
  saveBtn.className = 'contact-save';
  saveBtn.textContent = 'Save Contact';
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    const payload = { 'Student ID': student['Student ID'] };
    contactFields.forEach(f => { payload[f.key] = inputs[f.key].value.trim(); });
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'saveContact', contact: payload })
      });
      const result = await res.json();
      if (result.success) {
        saveBtn.textContent = 'Saved ✓';
        setTimeout(() => {
          saveBtn.textContent = 'Save Contact';
          saveBtn.disabled = false;
        }, 1500);
      } else {
        throw new Error('Save failed');
      }
    } catch (err) {
      console.error(err);
      saveBtn.textContent = 'Save failed — tap to retry';
      saveBtn.disabled = false;
    }
  });
  contactSection.appendChild(saveBtn);
  body.appendChild(contactSection);

  // --- ATTENDANCE SECTION ---
  const attSection = document.createElement('div');
  attSection.className = 'profile-section';
  let p = 0, a = 0, b = 0;
  (recentAttendance || []).forEach(r => {
    if (r['Status'] === 'Present') p++;
    else if (r['Status'] === 'Absent') a++;
    else if (r['Status'] === 'Bunked') b++;
  });
  const total = p + a + b;
  const rate = total > 0 ? Math.round((p / total) * 100) : 0;
  attSection.innerHTML =
    '<h3>Attendance — last ' + total + ' records (' + rate + '% present)</h3>' +
    '<div class="att-summary">' +
      '<div class="att-stat present"><span class="num">' + p + '</span><span class="lbl">Present</span></div>' +
      '<div class="att-stat absent"><span class="num">' + a + '</span><span class="lbl">Absent</span></div>' +
      '<div class="att-stat bunked"><span class="num">' + b + '</span><span class="lbl">Bunked</span></div>' +
    '</div>';
  body.appendChild(attSection);

  // --- NOTES SECTION ---
  const notesSection = document.createElement('div');
  notesSection.className = 'profile-section';
  notesSection.innerHTML = '<h3>Notes</h3>';

  const form = document.createElement('div');
  form.className = 'note-form';

  const select = document.createElement('select');
  NOTE_CATEGORIES.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    select.appendChild(opt);
  });

  const textarea = document.createElement('textarea');
  textarea.placeholder = 'Write a note…';

  const addBtn = document.createElement('button');
  addBtn.textContent = 'Add Note';
  addBtn.disabled = true;

  textarea.addEventListener('input', () => {
    addBtn.disabled = textarea.value.trim().length === 0;
  });

  addBtn.addEventListener('click', async () => {
    const text = textarea.value.trim();
    if (!text) return;
    addBtn.disabled = true;
    addBtn.textContent = 'Saving…';
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'addNote',
          note: {
            studentId: student['Student ID'],
            category: select.value,
            text: text
          }
        })
      });
      const result = await res.json();
      if (result.success) {
        textarea.value = '';
        const savedNote = result.note || {
          'Timestamp': new Date().toISOString(),
          'Student ID': student['Student ID'],
          'Category': select.value,
          'Note': text
        };
        notesList.querySelector('.empty-hint')?.remove();
        notesList.insertBefore(createNoteElement(savedNote), notesList.firstChild);
        const statusLine = document.createElement('p');
        statusLine.className = 'note-save-confirmation';
        statusLine.textContent = 'Saved successfully';
        statusLine.setAttribute('role', 'status');
        form.appendChild(statusLine);
        setTimeout(() => statusLine.remove(), 2200);
        addBtn.textContent = 'Saved ✓';
        addBtn.disabled = true;
        setTimeout(() => {
          addBtn.textContent = 'Add Note';
          addBtn.disabled = textarea.value.trim().length === 0;
        }, 1200);
      } else {
        throw new Error(result.error || 'Failed to save note');
      }
    } catch (err) {
      console.error(err);
      addBtn.textContent = 'Failed — retry';
      addBtn.disabled = false;
    }
  });

  form.appendChild(select);
  form.appendChild(textarea);
  form.appendChild(addBtn);
  notesSection.appendChild(form);

  const notesList = document.createElement('div');
  if (!notes || notes.length === 0) {
    notesList.innerHTML = '<div class="empty-hint">No notes yet.</div>';
  } else {
    notes.forEach(n => notesList.appendChild(createNoteElement(n)));
  }
  notesSection.appendChild(notesList);
  body.appendChild(notesSection);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================
// REPORTS & ANALYSIS
// ============================================================
function setWorkspaceView(view) {
  const reports = view === 'reports';
  document.getElementById('daily-view').hidden = reports;
  document.getElementById('reports-view').hidden = !reports;
  document.querySelector('.date-controls').hidden = reports;
  document.querySelector('.bottom-dock').hidden = reports;
  const registerTab = document.getElementById('register-view-tab');
  const reportsTab = document.getElementById('reports-view-tab');
  registerTab.classList.toggle('active', !reports);
  reportsTab.classList.toggle('active', reports);
  registerTab.setAttribute('aria-selected', String(!reports));
  reportsTab.setAttribute('aria-selected', String(reports));
  if (reports) renderReportClassOptions();
}

function renderReportClassOptions() {
  const select = document.getElementById('report-class');
  if (!select) return;
  const previous = select.value;
  const classes = getClasses();
  select.innerHTML = '';
  const allOpt = document.createElement('option');
  allOpt.value = ALL;
  allOpt.textContent = 'All classes';
  select.appendChild(allOpt);
  classes.forEach(cls => {
    const opt = document.createElement('option');
    opt.value = cls;
    opt.textContent = cls;
    select.appendChild(opt);
  });
  const validValues = [ALL, ...classes];
  if (validValues.includes(previous)) select.value = previous;
  else if (currentClass && validValues.includes(currentClass)) select.value = currentClass;
  else select.value = classes[0] || ALL;
}

function getWeekDates(anyDate) {
  const picked = new Date(String(anyDate) + 'T00:00:00');
  if (Number.isNaN(picked.getTime())) throw new Error('Please choose a valid date.');
  const day = picked.getDay();
  picked.setDate(picked.getDate() - ((day + 6) % 7));
  const dates = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(picked);
    d.setDate(picked.getDate() + i);
    dates.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
  }
  return dates;
}

function dateLabel(iso, long = false) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, long
    ? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }
    : { weekday: 'short', day: 'numeric', month: 'short' });
}

function setReportStatus(message, kind = '') {
  const el = document.getElementById('report-status');
  el.textContent = message;
  el.className = 'report-status' + (kind ? ' ' + kind : '');
}

async function generateReport() {
  const button = document.getElementById('generate-report-btn');
  const pickedDate = document.getElementById('report-date').value;
  const group = document.getElementById('report-class').value || ALL;
  const selectedDayIndexes = Array.from(document.querySelectorAll('[data-report-day]:checked'))
    .map(el => Number(el.dataset.reportDay));
  if (!pickedDate) return setReportStatus('Choose a date in the week first.', 'error');
  if (!selectedDayIndexes.length) return setReportStatus('Select at least one school day to include.', 'error');
  if (!navigator.onLine) return setReportStatus('You are offline. Reconnect to retrieve the latest attendance records, then generate the report again.', 'error');

  let weekDates;
  try { weekDates = getWeekDates(pickedDate); }
  catch (err) { return setReportStatus(err.message, 'error'); }

  button.disabled = true;
  button.innerHTML = '<span aria-hidden="true">◌</span> Building report…';
  setReportStatus('Retrieving records for ' + (group === ALL ? 'all classes' : group) + '…');
  try {
    const query = new URLSearchParams({
      action: 'getWeeklyReport',
      start: weekDates[0],
      end: weekDates[4],
      className: group
    });
    const res = await fetch(API_URL + '?' + query.toString());
    if (!res.ok) throw new Error('Server responded with ' + res.status + '.');
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const selectedDays = selectedDayIndexes.map(i => weekDates[i]);
    const studentsForReport = data.students || [];
    const selectedIds = new Set(studentsForReport.map(s => String(s['Student ID'])));
    const records = (data.records || []).filter(r => selectedIds.has(String(r.studentId)));
    if (!studentsForReport.length) {
      reportData = { students: [], records: [], selectedDays, weekDates, group, groupLabel: group === ALL ? 'All classes' : group };
    } else {
      reportData = { students: studentsForReport, records, selectedDays, weekDates, group, groupLabel: group === ALL ? 'All classes' : group };
    }
    selectedReportStudentId = studentsForReport.length ? String(studentsForReport[0]['Student ID']) : '';
    activeReportType = 'weekly';
    document.getElementById('report-output').hidden = false;
    const period = selectedDays.length === 1
      ? dateLabel(selectedDays[0], true)
      : dateLabel(selectedDays[0], true) + ' – ' + dateLabel(selectedDays[selectedDays.length - 1], true);
    document.getElementById('report-period-title').textContent = reportData.groupLabel + ' · Weekly register';
    document.getElementById('report-summary-line').textContent = period + ' · ' + selectedDays.length + ' school day' + (selectedDays.length === 1 ? '' : 's');
    document.getElementById('print-report-title').textContent = reportData.groupLabel + ' — Attendance Report';
    document.getElementById('print-report-subtitle').textContent = period + ' · Generated ' + new Date().toLocaleString();
    renderReportTypeTabs();
    renderReportBody();
    setReportStatus('Report ready. Unmarked entries are shown separately and are not counted as absences.', 'success');
  } catch (err) {
    console.error('Report generation failed:', err);
    setReportStatus('Could not generate report: ' + (err.message || 'Please try again.'), 'error');
  } finally {
    button.disabled = false;
    button.innerHTML = '<span aria-hidden="true">✦</span> Generate report';
  }
}

function getReportModel() {
  if (!reportData) return null;
  const studentsForReport = reportData.students;
  const dates = reportData.selectedDays;
  const statusMap = new Map();
  reportData.records.forEach(r => {
    if (!r.date || !r.studentId) return;
    statusMap.set(String(r.date) + '|' + String(r.studentId), normalizeReportStatus(r.status));
  });
  const rows = studentsForReport.map(student => {
    const id = String(student['Student ID']);
    const days = dates.map(date => statusMap.get(date + '|' + id) || '');
    const counts = countStatuses(days);
    const marked = counts.present + counts.absent + counts.bunked;
    return { student, id, days, ...counts, marked, unmarked: days.length - marked,
      attendanceRate: marked ? Math.round(counts.present / marked * 100) : null,
      completionRate: days.length ? Math.round(marked / days.length * 100) : 0 };
  });
  const daily = dates.map((date, i) => {
    const counts = countStatuses(rows.map(r => r.days[i]));
    const expected = rows.length;
    const marked = counts.present + counts.absent + counts.bunked;
    return { date, ...counts, expected, marked, unmarked: Math.max(0, expected - marked),
      completionRate: expected ? Math.round(marked / expected * 100) : 0,
      attendanceRate: marked ? Math.round(counts.present / marked * 100) : null };
  });
  const totalCounts = countStatuses(rows.flatMap(r => r.days));
  const expectedEntries = rows.length * dates.length;
  const markedEntries = totalCounts.present + totalCounts.absent + totalCounts.bunked;
  return { rows, daily, totalCounts, expectedEntries, markedEntries,
    unmarkedEntries: Math.max(0, expectedEntries - markedEntries),
    completionRate: expectedEntries ? Math.round(markedEntries / expectedEntries * 100) : 0,
    attendanceRate: markedEntries ? Math.round(totalCounts.present / markedEntries * 100) : null };
}

function normalizeReportStatus(status) {
  const clean = String(status == null ? '' : status).trim().toLowerCase();
  if (clean === 'present') return 'Present';
  if (clean === 'absent') return 'Absent';
  if (clean === 'bunked') return 'Bunked';
  return '';
}

function countStatuses(statuses) {
  const counts = { present: 0, absent: 0, bunked: 0 };
  statuses.forEach(status => {
    if (status === 'Present') counts.present++;
    else if (status === 'Absent') counts.absent++;
    else if (status === 'Bunked') counts.bunked++;
  });
  return counts;
}

function renderReportTypeTabs() {
  document.querySelectorAll('.report-type-tab').forEach(tab => {
    const active = tab.dataset.reportType === activeReportType;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  const titles = { weekly: 'Weekly register', group: 'Group summary', learner: 'Learner analysis' };
  if (reportData) document.getElementById('report-period-title').textContent = reportData.groupLabel + ' · ' + titles[activeReportType];
}

function statusPill(status) {
  const cls = status === 'Present' ? 'present' : status === 'Absent' ? 'absent' : status === 'Bunked' ? 'bunked' : 'unmarked';
  const label = status || '—';
  return '<span class="status-pill ' + cls + '" aria-label="' + escapeHtml(status || 'Not marked') + '">' + escapeHtml(label) + '</span>';
}

function renderReportBody() {
  const target = document.getElementById('report-body');
  if (!reportData || !target) return;
  const model = getReportModel();
  if (!model || !model.rows.length) {
    target.innerHTML = '<div class="report-empty">No active learners were found for this group. Check the class selection and the Active column in the Students sheet.</div>';
    return;
  }
  if (activeReportType === 'weekly') target.innerHTML = renderWeeklyTable(model);
  else if (activeReportType === 'group') target.innerHTML = renderGroupSummary(model);
  else target.innerHTML = renderLearnerAnalysis(model);
  if (activeReportType === 'learner') {
    const select = document.getElementById('report-learner-select');
    if (select) select.addEventListener('change', () => {
      selectedReportStudentId = select.value;
      renderReportBody();
    });
  }
}

function renderWeeklyTable(model) {
  const dates = reportData.selectedDays;
  let html = '<div class="report-table-wrap"><table class="report-table"><thead><tr><th>Learner</th>';
  dates.forEach(date => { html += '<th>' + escapeHtml(dateLabel(date)) + '</th>'; });
  html += '<th>Present</th><th>Absent</th><th>Bunked</th><th>Marked</th><th>Attendance</th></tr></thead><tbody>';
  model.rows.forEach(row => {
    html += '<tr><td class="learner-cell">' + escapeHtml(row.student['Name'] || 'Unknown') + '</td>';
    row.days.forEach(status => { html += '<td>' + statusPill(status) + '</td>'; });
    html += '<td>' + row.present + '</td><td>' + row.absent + '</td><td>' + row.bunked + '</td><td>' + row.marked + '/' + row.days.length + '</td><td>' + (row.attendanceRate === null ? '—' : row.attendanceRate + '%') + '</td></tr>';
  });
  html += '</tbody><tfoot><tr><td>Group totals</td>';
  model.daily.forEach(day => {
    html += '<td><div class="day-total"><span class="status-pill present">P ' + day.present + '</span><span class="status-pill absent">A ' + day.absent + '</span><span class="status-pill bunked">B ' + day.bunked + '</span><small>— ' + day.unmarked + '</small></div></td>';
  });
  html += '<td>' + model.totalCounts.present + '</td><td>' + model.totalCounts.absent + '</td><td>' + model.totalCounts.bunked + '</td><td>' + model.markedEntries + '/' + model.expectedEntries + '</td><td>' + (model.attendanceRate === null ? '—' : model.attendanceRate + '%') + '</td></tr></tfoot></table></div>';
  html += '<p class="section-subtitle" style="margin-top:10px">Marked = Present, Absent or Bunked. Attendance rate = Present ÷ all marked entries. Unmarked entries are excluded from the attendance-rate calculation.</p>';
  return html;
}

function renderGroupSummary(model) {
  const stat = (label, value, detail) => '<div class="report-stat"><span class="stat-label">' + escapeHtml(label) + '</span><strong>' + escapeHtml(String(value)) + '</strong><small>' + escapeHtml(detail) + '</small></div>';
  let html = '<div class="report-stat-grid">';
  html += stat('Learners', model.rows.length, 'Active learners in selected group');
  html += stat('Register completion', model.completionRate + '%', model.markedEntries + ' of ' + model.expectedEntries + ' expected entries marked');
  html += stat('Attendance rate', model.attendanceRate === null ? '—' : model.attendanceRate + '%', 'Among entries with a recorded status');
  html += stat('Not marked', model.unmarkedEntries, 'Blank records, not counted as absences');
  html += '</div><h4 style="margin:0 0 11px">Day-by-day patterns</h4><div class="daily-breakdown">';
  model.daily.forEach(day => {
    const total = day.expected || 0;
    const width = n => total ? Math.max(0, n / total * 100) : 0;
    html += '<div class="daily-breakdown-row"><div class="daily-breakdown-head"><span>' + escapeHtml(dateLabel(day.date, true)) + '</span><span>' + day.completionRate + '% register completion</span></div>';
    html += '<div class="stacked-bar" role="img" aria-label="' + day.present + ' present, ' + day.absent + ' absent, ' + day.bunked + ' bunked, ' + day.unmarked + ' unmarked">';
    html += '<span class="bar-present" style="width:' + width(day.present) + '%"></span><span class="bar-absent" style="width:' + width(day.absent) + '%"></span><span class="bar-bunked" style="width:' + width(day.bunked) + '%"></span><span class="bar-unmarked" style="width:' + width(day.unmarked) + '%"></span></div>';
    html += '<div class="bar-legend"><span><i class="bar-present"></i>Present ' + day.present + '</span><span><i class="bar-absent"></i>Absent ' + day.absent + '</span><span><i class="bar-bunked"></i>Bunked ' + day.bunked + '</span><span><i class="bar-unmarked"></i>Not marked ' + day.unmarked + '</span></div></div>';
  });
  html += '</div><p class="section-subtitle" style="margin-top:12px">Use register completion to judge data completeness before comparing attendance rates. Days with unmarked entries have incomplete information.</p>';
  return html;
}

function renderLearnerAnalysis(model) {
  if (!selectedReportStudentId || !model.rows.some(row => row.id === selectedReportStudentId)) {
    selectedReportStudentId = model.rows[0] ? model.rows[0].id : '';
  }
  const options = model.rows.map(row => '<option value="' + escapeHtml(row.id) + '"' + (row.id === selectedReportStudentId ? ' selected' : '') + '>' + escapeHtml(row.student['Name'] || 'Unknown') + '</option>').join('');
  const row = model.rows.find(item => item.id === selectedReportStudentId);
  if (!row) return '<div class="report-empty">Choose a learner to view their attendance.</div>';
  let html = '<div class="learner-report-select"><label for="report-learner-select" class="report-field-label">Choose a learner</label><select id="report-learner-select" class="learner-select">' + options + '</select></div>';
  html += '<div class="learner-report-heading"><h4>' + escapeHtml(row.student['Name'] || 'Unknown') + '</h4><p>' + escapeHtml(String(row.student['Class'] || 'Unassigned')) + ' · ' + row.days.length + ' selected school days</p></div>';
  html += '<div class="report-stat-grid">';
  html += '<div class="report-stat"><span class="stat-label">Present</span><strong>' + row.present + '</strong><small>Days recorded present</small></div>';
  html += '<div class="report-stat"><span class="stat-label">Absent</span><strong>' + row.absent + '</strong><small>Recorded absences</small></div>';
  html += '<div class="report-stat"><span class="stat-label">Bunked</span><strong>' + row.bunked + '</strong><small>Recorded as bunked</small></div>';
  html += '<div class="report-stat"><span class="stat-label">Register completion</span><strong>' + row.completionRate + '%</strong><small>' + row.marked + ' of ' + row.days.length + ' entries marked</small></div>';
  html += '</div><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Date</th><th>Recorded status</th></tr></thead><tbody>';
  reportData.selectedDays.forEach((date, i) => { html += '<tr><td>' + escapeHtml(dateLabel(date, true)) + '</td><td>' + statusPill(row.days[i]) + '</td></tr>'; });
  html += '</tbody></table></div><p class="section-subtitle" style="margin-top:10px">This view describes the recorded entries for the selected dates only. A blank entry means the register has not been marked for that learner and day.</p>';
  return html;
}

function csvEscape(value) {
  const text = String(value == null ? '' : value);
  return '"' + text.replace(/"/g, '""') + '"';
}

function exportCurrentReport() {
  if (!reportData) return;
  const model = getReportModel();
  if (!model) return;
  let rows = [];
  if (activeReportType === 'weekly') {
    rows.push(['Learner', 'Class', ...reportData.selectedDays.map(date => dateLabel(date)), 'Present', 'Absent', 'Bunked', 'Marked entries', 'Expected entries', 'Attendance rate (%)', 'Register completion (%)']);
    model.rows.forEach(r => rows.push([
      r.student['Name'] || 'Unknown', r.student['Class'] || 'Unassigned',
      ...r.days.map(status => status || 'Not marked'), r.present, r.absent, r.bunked,
      r.marked, r.days.length, r.attendanceRate === null ? '' : r.attendanceRate, r.completionRate
    ]));
  } else if (activeReportType === 'group') {
    rows.push(['Date', 'Learners', 'Present', 'Absent', 'Bunked', 'Not marked', 'Register completion (%)', 'Attendance rate among marked (%)']);
    model.daily.forEach(d => rows.push([d.date, d.expected, d.present, d.absent, d.bunked, d.unmarked, d.completionRate, d.attendanceRate === null ? '' : d.attendanceRate]));
  } else {
    const learner = model.rows.find(r => r.id === selectedReportStudentId) || model.rows[0];
    rows.push(['Learner', learner.student['Name'] || 'Unknown'], ['Class', learner.student['Class'] || 'Unassigned'], ['Date', 'Status']);
    reportData.selectedDays.forEach((date, i) => rows.push([date, learner.days[i] || 'Not marked']));
    rows.push([], ['Present', learner.present], ['Absent', learner.absent], ['Bunked', learner.bunked], ['Register completion (%)', learner.completionRate], ['Attendance rate among marked (%)', learner.attendanceRate === null ? '' : learner.attendanceRate]);
  }
  const csv = '\ufeff' + rows.map(row => row.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeGroup = reportData.groupLabel.replace(/[^a-z0-9_-]+/gi, '-');
  a.download = 'attendance-' + safeGroup + '-' + reportData.selectedDays[0] + '-' + activeReportType + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function createNoteElement(note) {
  const item = document.createElement('div');
  item.className = 'note-item';
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.innerHTML = '<span class="category">' + escapeHtml(note['Category'] || 'General') + '</span>' +
    escapeHtml(formatTimestamp(note['Timestamp']));
  const text = document.createElement('div');
  text.className = 'text';
  text.textContent = String(note['Note'] || '');
  item.appendChild(meta);
  item.appendChild(text);
  return item;
}

// ---------- UI HELPERS ----------
function updateOnlineStatus() {
  setSyncStatus(navigator.onLine ? 'online' : 'offline');
}

function setSyncStatus(status) {
  const el = document.getElementById('sync-status');
  const label = document.getElementById('sync-label');
  const labels = { online: 'Connected', offline: 'Offline-ready', syncing: 'Syncing…' };
  el.className = status;
  el.setAttribute('aria-label', labels[status] || 'Sync status');
  if (label) label.textContent = labels[status] || 'Sync status';
}