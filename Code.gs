// ============================================================
// My Teaching System — API v3
// Attendance, learner profiles, notes and weekly reports
// Replace the existing Apps Script code with this whole file.
// ============================================================

function doGet(e) {
  const params = (e && e.parameter) || {};
  const action = params.action;
  if (action === 'getStudents')   return jsonResponse(getStudents());
  if (action === 'getAttendance') return jsonResponse(getAttendance(params.date));
  if (action === 'getProfile')    return jsonResponse(getProfile(params.studentId));
  if (action === 'getWeeklyReport') return jsonResponse(getWeeklyReport(
    params.start, params.end, params.className || '__ALL__'
  ));
  if (action === 'ping')          return jsonResponse({ ok: true });
  return jsonResponse({ error: 'Unknown action: ' + action });
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.action === 'markAttendance') return jsonResponse(markAttendance(data.records || []));
    if (data.action === 'saveContact')    return jsonResponse(saveContact(data.contact));
    if (data.action === 'addNote')        return jsonResponse(addNote(data.note));
    return jsonResponse({ error: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ error: String(err && err.message || err) });
  }
}

// ---------- STUDENTS ----------
function getStudents() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Students');
  if (!sheet || sheet.getLastRow() < 2) return { students: [] };
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const students = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    if (String(data[i][3]).toUpperCase() !== 'TRUE') continue;
    const student = {};
    headers.forEach((h, idx) => student[h] = data[i][idx]);
    students.push(student);
  }
  return { students: students };
}

// ---------- ATTENDANCE ----------
function getAttendance(date) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Attendance');
  if (!sheet || sheet.getLastRow() < 2) return { records: [] };
  const timeZone = getAttendanceTimeZone();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const records = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    if (toDateString(data[i][0], timeZone) === String(date)) {
      const record = {};
      headers.forEach((h, idx) => record[h] = data[i][idx]);
      records.push(record);
    }
  }
  return { records: records };
}

/**
 * Upserts changed attendance records. A blank status means that the teacher
 * deliberately cleared the mark, so any saved row for that learner/date is
 * removed. Blank entries are not stored as an attendance status.
 */
function markAttendance(records) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Attendance');
  if (!sheet) return { error: 'Attendance sheet not found' };
  if (!records || !records.length) return { success: true, count: 0, removed: 0 };

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const timeZone = getAttendanceTimeZone();
    const finalByKey = new Map();
    records.forEach(record => {
      if (!record || record.date == null || record.studentId == null) return;
      const key = String(record.date) + '|' + String(record.studentId);
      let status = String(record.status || '').trim();
      if (status.toLowerCase() === 'unmarked') status = '';
      if (['Present', 'Absent', 'Bunked'].indexOf(status) < 0) status = '';
      finalByKey.set(key, Object.assign({}, record, { status: status }));
    });

    const clearKeys = new Set();
    finalByKey.forEach((record, key) => { if (!record.status) clearKeys.add(key); });
    let removed = 0;

    // Delete from bottom to top so sheet row indexes remain valid while deleting.
    if (clearKeys.size && sheet.getLastRow() >= 2) {
      const existing = sheet.getDataRange().getValues();
      for (let i = existing.length - 1; i >= 1; i--) {
        const key = toDateString(existing[i][0], timeZone) + '|' + String(existing[i][1]);
        if (clearKeys.has(key)) {
          sheet.deleteRow(i + 1);
          removed++;
        }
      }
    }

    // Rebuild the index after deletions, then upsert the non-blank statuses.
    const data = sheet.getDataRange().getValues();
    const rowByKey = new Map();
    for (let i = 1; i < data.length; i++) {
      if (!data[i][0] || data[i][1] == null || data[i][1] === '') continue;
      rowByKey.set(toDateString(data[i][0], timeZone) + '|' + String(data[i][1]), i + 1);
    }

    let changed = 0;
    finalByKey.forEach((record, key) => {
      if (!record.status) return;
      const row = [record.date, record.studentId, record.studentName || '', record.class || '', record.status, new Date()];
      const existingRow = rowByKey.get(key);
      if (existingRow) {
        sheet.getRange(existingRow, 3, 1, 4).setValues([[row[2], row[3], row[4], row[5]]]);
      } else {
        sheet.appendRow(row);
        rowByKey.set(key, sheet.getLastRow());
      }
      changed++;
    });
    return { success: true, count: changed, removed: removed };
  } finally {
    lock.releaseLock();
  }
}

/** Returns only the selected group's active learners and date-range attendance. */
function getWeeklyReport(startDate, endDate, className) {
  if (!isISODate(startDate) || !isISODate(endDate) || startDate > endDate) {
    return { error: 'Invalid report dates. Choose a valid week.' };
  }

  const allStudents = getStudents().students;
  const chosenClass = String(className || '__ALL__');
  const students = allStudents.filter(student => {
    if (chosenClass === '__ALL__' || chosenClass === 'All classes') return true;
    return normaliseClass(student['Class']) === chosenClass;
  });
  const studentIds = new Set(students.map(student => String(student['Student ID'])));

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Attendance');
  if (!sheet || sheet.getLastRow() < 2 || !studentIds.size) {
    return { startDate: startDate, endDate: endDate, students: students, records: [] };
  }

  const timeZone = getAttendanceTimeZone();
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());
  const dateIdx = findHeaderIndex(headers, ['Date', 'Attendance Date'], 0);
  const studentIdx = findHeaderIndex(headers, ['Student ID', 'StudentID', 'ID'], 1);
  const statusIdx = findHeaderIndex(headers, ['Status', 'Attendance Status'], 4);
  const records = [];
  for (let i = 1; i < data.length; i++) {
    const rawDate = data[i][dateIdx];
    if (!rawDate) continue;
    const date = toDateString(rawDate, timeZone);
    if (date < startDate || date > endDate) continue;
    const studentId = String(data[i][studentIdx] == null ? '' : data[i][studentIdx]);
    if (!studentIds.has(studentId)) continue;
    records.push({
      date: date,
      studentId: studentId,
      status: String(data[i][statusIdx] == null ? '' : data[i][statusIdx]).trim()
    });
  }
  return { startDate: startDate, endDate: endDate, students: students, records: records };
}

// ---------- PROFILE ----------
function getProfile(studentId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Student row
  const sSheet = ss.getSheetByName('Students');
  if (!sSheet || sSheet.getLastRow() < 2) return { error: 'Student not found: ' + studentId };
  const sData = sSheet.getDataRange().getValues();
  const sHeaders = sData[0];
  let student = null;
  for (let i = 1; i < sData.length; i++) {
    if (String(sData[i][0]) === String(studentId)) {
      student = {};
      sHeaders.forEach((h, idx) => student[h] = sData[i][idx]);
      break;
    }
  }
  if (!student) return { error: 'Student not found: ' + studentId };

  // Contact row (may not exist yet)
  const cSheet = ss.getSheetByName('Contacts');
  let contact = {};
  if (cSheet && cSheet.getLastRow() >= 2) {
    const cData = cSheet.getDataRange().getValues();
    const cHeaders = cData[0];
    for (let i = 1; i < cData.length; i++) {
      if (String(cData[i][0]) === String(studentId)) {
        cHeaders.forEach((h, idx) => contact[h] = cData[i][idx]);
        break;
      }
    }
  }

  // Notes for this student
  const nSheet = ss.getSheetByName('Notes');
  const notes = [];
  if (nSheet && nSheet.getLastRow() >= 2) {
    const nData = nSheet.getDataRange().getValues();
    const nHeaders = nData[0];
    for (let i = 1; i < nData.length; i++) {
      if (String(nData[i][1]) === String(studentId)) {
        const note = {};
        nHeaders.forEach((h, idx) => note[h] = nData[i][idx]);
        notes.push(note);
      }
    }
    notes.sort((a, b) => new Date(b['Timestamp']) - new Date(a['Timestamp']));
  }

  // Recent attendance for this student (up to 60 entries, newest first)
  const aSheet = ss.getSheetByName('Attendance');
  const recentAttendance = [];
  if (aSheet && aSheet.getLastRow() >= 2) {
    const aData = aSheet.getDataRange().getValues();
    const aHeaders = aData[0];
    for (let i = aData.length - 1; i >= 1 && recentAttendance.length < 60; i--) {
      if (String(aData[i][1]) === String(studentId)) {
        const item = {};
        aHeaders.forEach((h, idx) => item[h] = aData[i][idx]);
        recentAttendance.push(item);
      }
    }
  }

  return { student: student, contact: contact, notes: notes, recentAttendance: recentAttendance };
}

function saveContact(contact) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Contacts');
  if (!sheet) return { error: 'Contacts sheet not found' };
  const data = sheet.getDataRange().getValues();
  const headers = data[0] || [];
  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(contact['Student ID'])) {
      rowIndex = i + 1;
      break;
    }
  }
  const row = headers.map(h => contact[h] !== undefined ? contact[h] : '');
  if (rowIndex > 0) sheet.getRange(rowIndex, 1, 1, headers.length).setValues([row]);
  else sheet.appendRow(row);
  return { success: true };
}

function addNote(note) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Notes');
  if (!sheet) return { error: 'Notes sheet not found' };
  if (!note || !note.studentId || !String(note.text || '').trim()) {
    return { error: 'A learner and a non-empty note are required.' };
  }
  const timestamp = new Date();
  const category = String(note.category || 'General');
  const text = String(note.text).trim();
  sheet.appendRow([timestamp, note.studentId, category, text]);
  // Return the saved note so the UI can append it without reloading the profile.
  return {
    success: true,
    note: {
      'Timestamp': timestamp.toISOString(),
      'Student ID': note.studentId,
      'Category': category,
      'Note': text
    }
  };
}

// ---------- UTILITIES ----------
function findHeaderIndex(headers, candidates, fallback) {
  const normal = headers.map(h => String(h).trim().toLowerCase());
  for (let i = 0; i < candidates.length; i++) {
    const idx = normal.indexOf(String(candidates[i]).toLowerCase());
    if (idx >= 0) return idx;
  }
  return fallback;
}

function normaliseClass(value) {
  return String(value || '').trim() || 'Unassigned';
}

function isISODate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !isNaN(new Date(String(value) + 'T00:00:00').getTime());
}

function getAttendanceTimeZone() {
  // Attendance is a school record, so interpret Date cells using the spreadsheet
  // timezone rather than assuming the Apps Script project's timezone is identical.
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss && ss.getSpreadsheetTimeZone
    ? ss.getSpreadsheetTimeZone()
    : Session.getScriptTimeZone();
}

function toDateString(value, timeZone) {
  const zone = timeZone || Session.getScriptTimeZone();
  if (value instanceof Date) {
    return Utilities.formatDate(value, zone, 'yyyy-MM-dd');
  }
  const text = String(value == null ? '' : value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, zone, 'yyyy-MM-dd');
  }
  return text;
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
