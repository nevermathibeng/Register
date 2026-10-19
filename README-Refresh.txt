CLASS REGISTER — WEEKLY REPORTS & ANALYSIS

PACKAGE CONTENTS
- index.html: app layout and Reports & Analysis workspace
- style.css: responsive visuals, report tables and print layout
- app.js: register, report calculations, CSV export, profile note update
- Code.gs: Google Apps Script API update (must be pasted into Apps Script)
- manifest.json, service-worker.js, icon-192.png, icon-512.png: PWA setup

WHAT CHANGED
1. Added a Reports & Analysis workspace with:
   - Weekly register: every learner by selected school day
   - Group summary: daily patterns, register completion and attendance rate
   - Learner analysis: one learner's status and totals for the selected dates
   - CSV export for the current report view
   - Print / Save as PDF layout
2. Reports let you choose a group, select any date in a week, and untick non-school days or holidays.
3. A blank status is reported as Not marked; it is not counted as absent.
4. Clearing a learner's status now queues a clear operation. The Apps Script removes the saved record instead of leaving an old status in the report.
5. Saving a note updates the visible notes list after the save response, instead of downloading the whole profile again.
6. Offline pending attendance edits are reapplied after a date fetch, so a slow server response does not overwrite a local change.

INSTALLATION / DEPLOYMENT
A. Back up your current app and Apps Script first.
B. Update the Google Apps Script API:
   1. Open the Apps Script project connected to this register.
   2. Replace its existing code with the complete contents of Code.gs from this package.
   3. Save the project.
   4. Open Deploy > Manage deployments, edit the existing web-app deployment, select a new version, and deploy it. Keep the same deployment if possible so the existing API URL remains valid.
   5. Confirm the deployment still allows the intended users to access the web app.
C. Publish all static app files together:
   index.html, style.css, app.js, manifest.json, service-worker.js,
   icon-192.png and icon-512.png.
D. Open the deployed app while online, reload it, and test:
   - mark Present, Absent, Bunked, then clear a status; press Sync Now
   - generate a report for a class and week with data
   - untick a school day and regenerate
   - export CSV and print / Save as PDF
   - add a note in a learner profile and confirm it appears without a full reload

IMPORTANT NOTES
- Code.gs is server-side Google Apps Script, not a file to upload to the static hosting site.
- The API endpoint in app.js was kept from the original project. If you create a new web-app deployment with a different URL, update API_URL in app.js.
- The Apps Script assumes the existing sheet names and column layout used by the provided API: Students, Attendance, Contacts and Notes. Attendance uses columns Date, Student ID, Learner Name, Class, Status and Timestamp in that order; the first five positions are used by the existing attendance workflow.
- The app cannot infer public holidays. Untick any holiday or non-school day for each report before generating it.
- Attendance dates are interpreted using the spreadsheet timezone. Make sure the spreadsheet itself is set to the school's timezone so report dates agree with the register.
- Print / PDF uses the browser's print dialog; choose “Save as PDF” there.
- Test with a small known week before relying on reports for formal records.
