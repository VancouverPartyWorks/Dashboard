import * as bootstrap from 'bootstrap';
import { db, auth } from './firebase-client.js';
import { collection, onSnapshot, addDoc, updateDoc, doc, getDoc, getDocs, query, where, serverTimestamp, Timestamp } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import * as XLSX from 'xlsx';

document.addEventListener('DOMContentLoaded', () => {
  let allTimesheetLogs = [];
  let filteredLogs = [];
  let usersMap = new Map();
  let pendingFetchSet = new Set();
  let currentPage = 1;
  const RECORDS_PER_PAGE = 20;

  // DOM Elements
  const timesheetTableBody = document.getElementById('timesheetTableBody');
  const filterStartDate = document.getElementById('filterStartDate');
  const filterEndDate = document.getElementById('filterEndDate');
  const filterEmployee = document.getElementById('filterEmployee');
  const sortField = document.getElementById('sortField');
  const sortOrder = document.getElementById('sortOrder');
  const resetFiltersBtn = document.getElementById('resetFiltersBtn');
  const exportExcelBtn = document.getElementById('exportExcelBtn');
  const recordCountBadge = document.getElementById('recordCountBadge');
  const activeFiltersSummary = document.getElementById('activeFiltersSummary');
  
  const pageStartEl = document.getElementById('pageStart');
  const pageEndEl = document.getElementById('pageEnd');
  const totalRecordsCountEl = document.getElementById('totalRecordsCount');
  const paginationControls = document.getElementById('paginationControls');

  // Modal elements
  const editModalEl = document.getElementById('editTimeLogModal');
  const editTimeLogForm = document.getElementById('editTimeLogForm');
  const editLogId = document.getElementById('editLogId');
  const editLogSource = document.getElementById('editLogSource'); // 'shifts' or 'timesheets'
  const editEmpName = document.getElementById('editEmpName');
  const editEventName = document.getElementById('editEventName');
  const editClockIn = document.getElementById('editClockIn');
  const editClockOut = document.getElementById('editClockOut');
  const calculatedHoursEl = document.getElementById('calculatedHours');
  const editNote = document.getElementById('editNote');

  let editModalInstance = null;
  if (editModalEl) {
    editModalInstance = new bootstrap.Modal(editModalEl);
  }

  // Check Auth & Permissions
  onAuthStateChanged(auth, async (user) => {
    if (user && db) {
      try {
        const q = query(collection(db, "dashboardUsers"), where("email", "==", user.email));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          const userData = querySnapshot.docs[0].data();
          const roleId = userData.roleId;
          const isAccountant = (userData.role && (userData.role.toLowerCase() === 'accountant' || userData.role.toLowerCase() === 'accounts')) || roleId === 3;
          const isSuperAdmin = roleId === 1;

          if (!isAccountant && !isSuperAdmin) {
            window.location.href = './index.html';
            return;
          }
        }
      } catch (error) {
        console.error("Error checking permissions in timesheet.js:", error);
      }
    }
  });

  // Retrieve Employee Name from users collection
  function getUserName(id) {
    if (!id) return 'Staff User';
    const trimmedId = id.trim();
    if (usersMap.has(trimmedId)) {
      return usersMap.get(trimmedId);
    }
    
    // Direct document fetch from users collection if not in snapshot map yet
    if (!pendingFetchSet.has(trimmedId)) {
      pendingFetchSet.add(trimmedId);
      getDoc(doc(db, "users", trimmedId)).then((userDoc) => {
        if (userDoc.exists()) {
          const data = userDoc.data();
          const name = data.displayName || data.name || data.fullName || data.email;
          if (name) {
            usersMap.set(trimmedId, name);
            if (data.uid) usersMap.set(data.uid, name);
            rebuildLogsAndRender();
            return;
          }
        }
        // Secondary fallback to dashboardUsers if not in users collection
        return getDoc(doc(db, "dashboardUsers", trimmedId)).then((dDoc) => {
          if (dDoc.exists()) {
            const data = dDoc.data();
            const name = data.displayName || data.name || data.email;
            if (name) {
              usersMap.set(trimmedId, name);
              if (data.uid) usersMap.set(data.uid, name);
              rebuildLogsAndRender();
            }
          }
        });
      }).catch(err => {
        console.error("Error fetching user doc for ID:", trimmedId, err);
      });
    }

    return `Staff (${trimmedId.substring(0, 6)})`;
  }

  // Listen to users collection in real time
  function listenToUsers() {
    onSnapshot(collection(db, "users"), (usersSnap) => {
      usersSnap.forEach(d => {
        const data = d.data();
        const name = data.displayName || data.name || data.fullName || data.email || 'User';
        usersMap.set(d.id, name);
        if (data.uid) usersMap.set(data.uid, name);
      });
      rebuildLogsAndRender();
    }, (err) => {
      console.error("Error listening to users collection:", err);
    });

    onSnapshot(collection(db, "dashboardUsers"), (dUsersSnap) => {
      dUsersSnap.forEach(d => {
        const data = d.data();
        const name = data.displayName || data.name || data.email || 'Dashboard User';
        if (!usersMap.has(d.id)) usersMap.set(d.id, name);
        if (data.uid && !usersMap.has(data.uid)) usersMap.set(data.uid, name);
      });
      rebuildLogsAndRender();
    });
  }

  let rawShiftsSnap = null;

  function rebuildLogsAndRender() {
    if (!rawShiftsSnap) return;

    let shiftsLogs = [];
    rawShiftsSnap.forEach((docSnap) => {
      const shift = docSnap.data();
      const shiftId = docSnap.id;

      const shiftStatus = (shift.status || '').toLowerCase().trim();

      // Strictly load ONLY shift.status === "completed" and no other status
      if (shiftStatus !== 'completed') {
        return;
      }

      const addedUserIds = new Set();

      // Process staff members if present
      if (Array.isArray(shift.staffMembers) && shift.staffMembers.length > 0) {
        shift.staffMembers.forEach((staffObj, idx) => {
          if (!staffObj) return;
          const staffId = typeof staffObj === 'string' ? staffObj : (staffObj.id || staffObj.uid || `staff_${idx}`);
          if (staffId && typeof staffObj === 'object') {
            addedUserIds.add(staffId);
          }

          const fetchedName = getUserName(staffId);
          const staffName = (fetchedName && !fetchedName.startsWith('Staff (')) 
            ? fetchedName 
            : ((typeof staffObj === 'object' && staffObj.name) ? staffObj.name : fetchedName);
          const staffRole = (typeof staffObj === 'object' && staffObj.role) ? staffObj.role : (shift.role || 'Staff');
          const staffStatus = (typeof staffObj === 'object' && staffObj.status) ? staffObj.status : shiftStatus;

          const rawClockIn = (typeof staffObj === 'object' && staffObj.clockInTime !== undefined) ? staffObj.clockInTime : (shift.clockInTime || null);
          const rawClockOut = (typeof staffObj === 'object' && staffObj.clockOutTime !== undefined) ? staffObj.clockOutTime : (shift.clockOutTime || null);

          const clockInDate = parseFirestoreTimestamp(rawClockIn);
          const clockOutDate = parseFirestoreTimestamp(rawClockOut);

          const earlyClockIn = typeof staffObj === 'object' && staffObj.earlyClockIn !== undefined ? Boolean(staffObj.earlyClockIn) : Boolean(shift.earlyClockIn);
          const lateClockIn = typeof staffObj === 'object' && staffObj.lateClockIn !== undefined ? Boolean(staffObj.lateClockIn) : Boolean(shift.lateClockIn);
          const outsideGeoFence = typeof staffObj === 'object' && staffObj.outsideGeoFence !== undefined ? Boolean(staffObj.outsideGeoFence) : Boolean(shift.outsideGeoFence);

          // Derive date string YYYY-MM-DD from shift date
          let dateStr = shift.dateString || '';
          if (!dateStr) {
            const shiftDateObj = parseFirestoreTimestamp(shift.dateTime || rawClockIn);
            if (shiftDateObj) {
              dateStr = shiftDateObj.toISOString().split('T')[0];
            } else {
              dateStr = new Date().toISOString().split('T')[0];
            }
          }

          // Calculate total hours
          let totalHours = 0;
          if (typeof staffObj === 'object' && staffObj.totalHours !== undefined && staffObj.totalHours !== null) {
            totalHours = parseFloat(staffObj.totalHours);
          } else if (clockInDate && clockOutDate && clockOutDate > clockInDate) {
            totalHours = parseFloat(((clockOutDate - clockInDate) / (1000 * 60 * 60)).toFixed(2));
          } else if (shift.totalHours !== undefined && shift.totalHours !== null) {
            totalHours = parseFloat(shift.totalHours);
          }

          const isExplicitApproved = (staffStatus && staffStatus.toLowerCase() === 'approved') || (typeof staffObj === 'object' && staffObj.flag === 'Approved');

          let flag = 'Approved';
          if (isExplicitApproved) {
            flag = 'Approved';
          } else if (!clockOutDate || earlyClockIn || lateClockIn || outsideGeoFence) {
            flag = 'Incorrect Clock-Out';
          } else {
            flag = 'Pending';
          }

          shiftsLogs.push({
            id: `${shiftId}_staff_${idx}`,
            realDocId: shiftId,
            staffIndex: idx,
            sourceCollection: 'shifts',
            employeeId: staffId,
            employeeName: staffName,
            role: staffRole,
            date: dateStr,
            eventName: shift.venueName || (shift.eventsList && shift.eventsList.join(', ')) || 'Vancouver Event',
            clockIn: clockInDate ? clockInDate.toISOString() : null,
            clockOut: clockOutDate ? clockOutDate.toISOString() : null,
            totalHours: totalHours,
            earlyClockIn: earlyClockIn,
            lateClockIn: lateClockIn,
            outsideGeoFence: outsideGeoFence,
            flag: flag,
            status: isExplicitApproved ? 'approved' : (staffStatus || 'pending'),
            adjustmentNote: shift.notes ? (Array.isArray(shift.notes) ? shift.notes.join(', ') : shift.notes) : ''
          });
        });
      }

      // Fallback for assignedUserId if not already processed in staffMembers
      if (shift.assignedUserId && !addedUserIds.has(shift.assignedUserId)) {
        const empName = getUserName(shift.assignedUserId);
        const clockInDate = parseFirestoreTimestamp(shift.clockInTime);
        const clockOutDate = parseFirestoreTimestamp(shift.clockOutTime);

        let dateStr = shift.dateString || '';
        if (!dateStr) {
          const shiftDateObj = parseFirestoreTimestamp(shift.dateTime);
          if (shiftDateObj) {
            dateStr = shiftDateObj.toISOString().split('T')[0];
          } else {
            dateStr = new Date().toISOString().split('T')[0];
          }
        }

        let totalHours = 0;
        if (shift.totalHours !== undefined && shift.totalHours !== null) {
          totalHours = parseFloat(shift.totalHours);
        } else if (clockInDate && clockOutDate && clockOutDate > clockInDate) {
          totalHours = parseFloat(((clockOutDate - clockInDate) / (1000 * 60 * 60)).toFixed(2));
        }

        const isExplicitApproved = shiftStatus === 'approved' || shift.approved === true || shift.flag === 'Approved';
        let flag = 'Approved';
        if (isExplicitApproved) {
          flag = 'Approved';
        } else if (!clockOutDate || shift.earlyClockIn || shift.lateClockIn || shift.outsideGeoFence || shift.flag === 'Incorrect Clock-Out') {
          flag = 'Incorrect Clock-Out';
        } else {
          flag = 'Pending';
        }

        shiftsLogs.push({
          id: shiftId,
          realDocId: shiftId,
          staffIndex: -1,
          sourceCollection: 'shifts',
          employeeId: shift.assignedUserId,
          employeeName: empName,
          role: shift.role || 'Lead / Driver',
          date: dateStr,
          eventName: shift.venueName || (shift.eventsList && shift.eventsList.join(', ')) || 'Vancouver Event',
          clockIn: clockInDate ? clockInDate.toISOString() : null,
          clockOut: clockOutDate ? clockOutDate.toISOString() : null,
          totalHours: totalHours,
          earlyClockIn: Boolean(shift.earlyClockIn),
          lateClockIn: Boolean(shift.lateClockIn),
          outsideGeoFence: Boolean(shift.outsideGeoFence),
          flag: flag,
          status: isExplicitApproved ? 'approved' : 'pending',
          adjustmentNote: shift.notes ? (Array.isArray(shift.notes) ? shift.notes.join(', ') : shift.notes) : ''
        });
      }
    });

    allTimesheetLogs = shiftsLogs;
    populateEmployeeFilterOptions();
    applyFiltersAndSorting();
  }

  // Load Real Firebase Collections (`shifts` and `users`)
  function loadTimesheetData() {
    if (!db) {
      renderErrorState("Database connection unavailable.");
      return;
    }

    listenToUsers();

    // 1. Listen to real `shifts` collection
    onSnapshot(collection(db, "shifts"), (shiftsSnap) => {
      rawShiftsSnap = shiftsSnap;
      rebuildLogsAndRender();
    }, (err) => {
      console.error("Error listening to shifts collection:", err);
    });
  }

  // Populate Employee Filter Select
  function populateEmployeeFilterOptions() {
    const currentVal = filterEmployee.value;
    const empNames = Array.from(new Set(allTimesheetLogs.map(l => l.employeeName).filter(Boolean))).sort();
    
    filterEmployee.innerHTML = '<option value="">All Employees</option>';
    empNames.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === currentVal) opt.selected = true;
      filterEmployee.appendChild(opt);
    });
  }

  let currentSortField = 'name';
  let currentSortOrder = 'asc';

  // Filter & Sorting Engine
  function applyFiltersAndSorting() {
    const startDateVal = filterStartDate.value;
    const endDateVal = filterEndDate.value;
    const empVal = filterEmployee.value;
    const fieldVal = sortField ? sortField.value : currentSortField;
    const orderVal = sortOrder ? sortOrder.value : currentSortOrder;

    // Filter
    filteredLogs = allTimesheetLogs.filter(log => {
      if (empVal && log.employeeName !== empVal) {
        return false;
      }
      if (startDateVal && log.date < startDateVal) {
        return false;
      }
      if (endDateVal && log.date > endDateVal) {
        return false;
      }
      return true;
    });

    // Sorting Logic
    filteredLogs.sort((a, b) => {
      let cmp = 0;
      if (fieldVal === 'name') {
        cmp = (a.employeeName || '').localeCompare(b.employeeName || '');
      } else if (fieldVal === 'date') {
        cmp = (a.date || '').localeCompare(b.date || '');
      }

      return orderVal === 'desc' ? -cmp : cmp;
    });

    // Summary text
    let summaryParts = [];
    if (empVal) summaryParts.push(`Employee: ${empVal}`);
    if (startDateVal || endDateVal) {
      summaryParts.push(`Date: ${startDateVal || 'Start'} to ${endDateVal || 'End'}`);
    }
    activeFiltersSummary.textContent = summaryParts.length > 0 
      ? `Filtered by (${summaryParts.join(' | ')})` 
      : 'Showing all records';

    recordCountBadge.textContent = `${filteredLogs.length} record${filteredLogs.length === 1 ? '' : 's'}`;

    currentPage = 1;
    renderTablePage();
  }

  // Render Table Page (20 records / page)
  function renderTablePage() {
    timesheetTableBody.innerHTML = '';
    const totalRecords = filteredLogs.length;

    if (totalRecords === 0) {
      timesheetTableBody.innerHTML = `
        <tr>
          <td colspan="8" class="text-center py-5 text-muted">
            <i class="ti ti-clock-off fs-2 d-block mb-2 text-secondary"></i>
            No timesheet records match the selected filters.
          </td>
        </tr>`;
      pageStartEl.textContent = '0';
      pageEndEl.textContent = '0';
      totalRecordsCountEl.textContent = '0';
      paginationControls.innerHTML = '';
      return;
    }

    const startIdx = (currentPage - 1) * RECORDS_PER_PAGE;
    const endIdx = Math.min(startIdx + RECORDS_PER_PAGE, totalRecords);
    const pageRecords = filteredLogs.slice(startIdx, endIdx);

    pageRecords.forEach(log => {
      const tr = document.createElement('tr');

      const formattedClockIn = formatTime(log.clockIn);
      const formattedClockOut = formatTime(log.clockOut);
      const totalHoursDisplay = log.totalHours ? `${parseFloat(log.totalHours).toFixed(2)} hrs` : '0.00 hrs';

      // Detailed Badge styling for flags & staff attributes
      let flagBadge = '';
      if (log.flag === 'Approved' || log.status === 'approved') {
        flagBadge = `<span class="badge bg-success-subtle text-success border border-success-subtle px-2 py-1"><i class="ti ti-check me-1"></i>Approved</span>`;
      } else {
        let flagBadges = [];
        if (!log.clockOut) {
          flagBadges.push(`<span class="badge bg-danger-subtle text-danger border border-danger-subtle px-2 py-1"><i class="ti ti-alert-triangle me-1"></i>Missing Clock-Out</span>`);
        }
        if (log.earlyClockIn) {
          flagBadges.push(`<span class="badge bg-info-subtle text-info border border-info-subtle px-2 py-1"><i class="ti ti-clock-forward me-1"></i>Early Clock-In</span>`);
        }
        if (log.lateClockIn) {
          flagBadges.push(`<span class="badge bg-warning-subtle text-warning border border-warning-subtle px-2 py-1"><i class="ti ti-clock-off me-1"></i>Late Clock-In</span>`);
        }
        if (log.outsideGeoFence) {
          flagBadges.push(`<span class="badge bg-danger-subtle text-danger border border-danger-subtle px-2 py-1"><i class="ti ti-map-pin-off me-1"></i>Outside Geofence</span>`);
        }
        
        if (flagBadges.length > 0) {
          flagBadge = `<div class="d-flex flex-wrap gap-1">${flagBadges.join('')}</div>`;
        } else {
          flagBadge = `<span class="badge bg-secondary-subtle text-secondary border px-2 py-1">${escapeHtml(log.status || 'Pending')}</span>`;
        }
      }

      const isApproved = log.flag === 'Approved' || log.status === 'approved';
      const isMissingClockOut = !log.clockOut;

      tr.innerHTML = `
        <td class="fw-semibold text-dark">
          <div>
            <div class="fw-semibold text-dark">${escapeHtml(log.employeeName || 'Unknown')}</div>
            ${log.role ? `<span class="badge bg-light text-muted border small" style="font-size: 0.7rem; font-weight: 500;">${escapeHtml(log.role)}</span>` : ''}
          </div>
        </td>
        <td>${log.date || 'N/A'}</td>
        <td class="text-secondary">${escapeHtml(log.eventName || 'N/A')}</td>
        <td><span class="badge bg-light text-dark border font-monospace">${formattedClockIn}</span></td>
        <td><span class="badge ${log.clockOut ? 'bg-light text-dark border' : 'bg-danger-subtle text-danger border border-danger-subtle'} font-monospace">${formattedClockOut}</span></td>
        <td class="fw-semibold text-dark">${totalHoursDisplay}</td>
        <td>${flagBadge}</td>
        <td class="text-end pe-4">
          ${isApproved ? `
            <button class="btn btn-outline-primary btn-sm details-btn" data-id="${log.id}">
              <i class="ti ti-eye me-1"></i> Details
            </button>
          ` : `
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-secondary edit-btn" data-id="${log.id}" title="Edit Time">
                <i class="ti ti-pencil me-1"></i> Edit Time
              </button>
              <button class="btn btn-success approve-btn" data-id="${log.id}" title="${isMissingClockOut ? 'Clock-out required to approve' : 'Approve Payroll'}" ${isMissingClockOut ? 'disabled' : ''}>
                <i class="ti ti-check me-1"></i> Approve
              </button>
            </div>
          `}
        </td>
      `;

      timesheetTableBody.appendChild(tr);
    });

    // Event listeners for Edit, Details and Approve buttons
    timesheetTableBody.querySelectorAll('.edit-btn, .details-btn').forEach(btn => {
      btn.addEventListener('click', () => openEditModal(btn.dataset.id));
    });

    timesheetTableBody.querySelectorAll('.approve-btn').forEach(btn => {
      btn.addEventListener('click', () => approveLog(btn.dataset.id));
    });

    // Update pagination stats
    pageStartEl.textContent = (startIdx + 1).toString();
    pageEndEl.textContent = endIdx.toString();
    totalRecordsCountEl.textContent = totalRecords.toString();

    renderPaginationControls(Math.ceil(totalRecords / RECORDS_PER_PAGE));
  }

  // Render Pagination Controls
  function renderPaginationControls(totalPages) {
    paginationControls.innerHTML = '';
    if (totalPages <= 1) return;

    // Previous Button
    const prevLi = document.createElement('li');
    prevLi.className = `page-item ${currentPage === 1 ? 'disabled' : ''}`;
    prevLi.innerHTML = `<a class="page-link" href="#" aria-label="Previous"><i class="ti ti-chevron-left"></i></a>`;
    prevLi.addEventListener('click', (e) => {
      e.preventDefault();
      if (currentPage > 1) {
        currentPage--;
        renderTablePage();
      }
    });
    paginationControls.appendChild(prevLi);

    // Page Numbers
    for (let i = 1; i <= totalPages; i++) {
      const li = document.createElement('li');
      li.className = `page-item ${i === currentPage ? 'active' : ''}`;
      li.innerHTML = `<a class="page-link" href="#">${i}</a>`;
      li.addEventListener('click', (e) => {
        e.preventDefault();
        currentPage = i;
        renderTablePage();
      });
      paginationControls.appendChild(li);
    }

    // Next Button
    const nextLi = document.createElement('li');
    nextLi.className = `page-item ${currentPage === totalPages ? 'disabled' : ''}`;
    nextLi.innerHTML = `<a class="page-link" href="#" aria-label="Next"><i class="ti ti-chevron-right"></i></a>`;
    nextLi.addEventListener('click', (e) => {
      e.preventDefault();
      if (currentPage < totalPages) {
        currentPage++;
        renderTablePage();
      }
    });
    paginationControls.appendChild(nextLi);
  }

  // Open Edit Modal / Details Modal
  function openEditModal(logId) {
    const log = allTimesheetLogs.find(l => l.id === logId);
    if (!log) return;

    const isApproved = log.flag === 'Approved' || log.status === 'approved';
    const modalTitleEl = document.getElementById('editTimeLogModalLabel');
    const saveBtnEl = document.getElementById('saveEditLogBtn');

    if (modalTitleEl) {
      modalTitleEl.textContent = isApproved ? 'Time Log Details' : 'Edit Time Log';
    }

    editLogId.value = log.id;
    if (editLogSource) editLogSource.value = log.sourceCollection || 'shifts';
    editEmpName.value = log.employeeName || '';
    const editEmpRole = document.getElementById('editEmpRole');
    if (editEmpRole) editEmpRole.value = log.role || '';
    editEventName.value = log.eventName || '';
    editClockIn.value = log.clockIn ? toISOStringForInput(log.clockIn) : '';
    editClockOut.value = log.clockOut ? toISOStringForInput(log.clockOut) : '';
    editNote.value = log.adjustmentNote || '';

    // If approved, disable editing fields & hide save button
    editEventName.disabled = isApproved;
    editClockIn.disabled = isApproved;
    editClockOut.disabled = isApproved;
    editNote.disabled = isApproved;
    if (saveBtnEl) saveBtnEl.style.display = isApproved ? 'none' : 'inline-block';

    updateCalculatedHoursModal();
    if (editModalInstance) editModalInstance.show();
  }

  // Recalculate hours live inside modal
  function updateCalculatedHoursModal() {
    const inVal = editClockIn.value;
    const outVal = editClockOut.value;
    if (!inVal || !outVal) {
      calculatedHoursEl.textContent = '0.00 hrs';
      return;
    }

    const inDate = new Date(inVal);
    const outDate = new Date(outVal);
    if (isNaN(inDate.getTime()) || isNaN(outDate.getTime()) || outDate <= inDate) {
      calculatedHoursEl.textContent = '0.00 hrs';
      return;
    }

    const diffMs = outDate - inDate;
    const hours = diffMs / (1000 * 60 * 60);
    calculatedHoursEl.textContent = `${hours.toFixed(2)} hrs`;
  }

  editClockIn.addEventListener('change', updateCalculatedHoursModal);
  editClockOut.addEventListener('change', updateCalculatedHoursModal);
  editClockIn.addEventListener('input', updateCalculatedHoursModal);
  editClockOut.addEventListener('input', updateCalculatedHoursModal);

  // Save Time Edit Form directly to Firebase Firestore
  editTimeLogForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = editLogId.value;
    const log = allTimesheetLogs.find(l => l.id === id);
    if (!log) return;

    const inVal = editClockIn.value;
    const outVal = editClockOut.value;
    const eventNameVal = editEventName.value.trim();
    const noteVal = editNote.value.trim();

    if (!inVal || !outVal) {
      alert("Please enter valid Clock In and Clock Out times.");
      return;
    }

    const inDate = new Date(inVal);
    const outDate = new Date(outVal);
    if (outDate <= inDate) {
      alert("Clock Out time must be after Clock In time.");
      return;
    }

    const diffMs = outDate - inDate;
    const totalHrs = parseFloat((diffMs / (1000 * 60 * 60)).toFixed(2));
    const dateStr = inVal.split('T')[0];

    const targetDocId = log.realDocId || log.id;
    const targetCollection = log.sourceCollection || 'shifts';

    try {
      const docRef = doc(db, targetCollection, targetDocId);
      
      if (targetCollection === 'shifts') {
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const shiftData = docSnap.data();
          const updateData = {
            venueName: eventNameVal,
            dateString: dateStr,
            updatedAt: serverTimestamp()
          };

          let staffMembers = shiftData.staffMembers;
          if (Array.isArray(staffMembers) && log.staffIndex >= 0 && staffMembers[log.staffIndex]) {
            const targetStaff = staffMembers[log.staffIndex];
            if (typeof targetStaff === 'object') {
              targetStaff.clockInTime = Timestamp.fromDate(inDate);
              targetStaff.clockOutTime = Timestamp.fromDate(outDate);
              targetStaff.totalHours = totalHrs;
              targetStaff.status = 'approved';
              targetStaff.flag = 'Approved';
              targetStaff.earlyClockIn = false;
              targetStaff.lateClockIn = false;
              targetStaff.outsideGeoFence = false;
            }
            updateData.staffMembers = staffMembers;
          } else if (Array.isArray(staffMembers)) {
            const foundStaff = staffMembers.find(s => s && typeof s === 'object' && (s.id === log.employeeId || s.uid === log.employeeId));
            if (foundStaff) {
              foundStaff.clockInTime = Timestamp.fromDate(inDate);
              foundStaff.clockOutTime = Timestamp.fromDate(outDate);
              foundStaff.totalHours = totalHrs;
              foundStaff.status = 'approved';
              foundStaff.flag = 'Approved';
              foundStaff.earlyClockIn = false;
              foundStaff.lateClockIn = false;
              foundStaff.outsideGeoFence = false;
              updateData.staffMembers = staffMembers;
            }
          }

          if (shiftData.assignedUserId === log.employeeId || !Array.isArray(staffMembers)) {
            updateData.clockInTime = Timestamp.fromDate(inDate);
            updateData.clockOutTime = Timestamp.fromDate(outDate);
            updateData.totalHours = totalHrs;
            updateData.flag = "Approved";
            updateData.outsideGeoFence = false;
            updateData.earlyClockIn = false;
            updateData.lateClockIn = false;
          }

          await updateDoc(docRef, updateData);
        }
      }

      if (editModalInstance) editModalInstance.hide();
    } catch (err) {
      console.error("Error updating Firestore document:", err);
      alert("Failed to save timesheet updates to database.");
    }
  });

  // Approve Log Action in Firebase Firestore
  async function approveLog(logId) {
    const log = allTimesheetLogs.find(l => l.id === logId);
    if (!log) return;

    const targetDocId = log.realDocId || log.id;
    const targetCollection = log.sourceCollection || 'shifts';

    try {
      const docRef = doc(db, targetCollection, targetDocId);
      if (targetCollection === 'shifts') {
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const shiftData = docSnap.data();
          const updateData = {
            updatedAt: serverTimestamp()
          };

          let staffMembers = shiftData.staffMembers;
          if (Array.isArray(staffMembers) && log.staffIndex >= 0 && staffMembers[log.staffIndex]) {
            const targetStaff = staffMembers[log.staffIndex];
            if (typeof targetStaff === 'object') {
              targetStaff.status = 'approved';
              targetStaff.flag = 'Approved';
              targetStaff.earlyClockIn = false;
              targetStaff.lateClockIn = false;
              targetStaff.outsideGeoFence = false;
            }
            updateData.staffMembers = staffMembers;
          } else if (Array.isArray(staffMembers)) {
            const foundStaff = staffMembers.find(s => s && typeof s === 'object' && (s.id === log.employeeId || s.uid === log.employeeId));
            if (foundStaff) {
              foundStaff.status = 'approved';
              foundStaff.flag = 'Approved';
              foundStaff.earlyClockIn = false;
              foundStaff.lateClockIn = false;
              foundStaff.outsideGeoFence = false;
              updateData.staffMembers = staffMembers;
            }
          }

          if (shiftData.assignedUserId === log.employeeId || !Array.isArray(staffMembers)) {
            updateData.flag = "Approved";
            updateData.outsideGeoFence = false;
            updateData.earlyClockIn = false;
            updateData.lateClockIn = false;
          }

          await updateDoc(docRef, updateData);
        }
      }
    } catch (err) {
      console.error("Error approving log in Firestore:", err);
      alert("Failed to approve log.");
    }
  }

  // Export Approved Payroll to Excel (.xlsx)
  exportExcelBtn.addEventListener('click', () => {
    const approvedLogs = allTimesheetLogs.filter(l => l.flag === 'Approved' || l.status === 'approved');

    if (approvedLogs.length === 0) {
      alert("No approved payroll records found to export.");
      return;
    }

    // Format data for Excel worksheet
    const excelRows = approvedLogs.map(log => ({
      "Employee Name": log.employeeName || 'Unknown',
      "Role": log.role || 'Staff',
      "Date": log.date || '',
      "Event Name": log.eventName || '',
      "Clock In": formatTime(log.clockIn),
      "Clock Out": formatTime(log.clockOut),
      "Total Hours": parseFloat(log.totalHours || 0).toFixed(2),
      "Flag / Status": log.flag || 'Approved',
      "Adjustment Note": log.adjustmentNote || ''
    }));

    const worksheet = XLSX.utils.json_to_sheet(excelRows);
    
    // Auto-fit column widths
    const colWidths = [
      { wch: 22 }, // Employee Name
      { wch: 18 }, // Role
      { wch: 14 }, // Date
      { wch: 30 }, // Event Name
      { wch: 14 }, // Clock In
      { wch: 14 }, // Clock Out
      { wch: 14 }, // Total Hours
      { wch: 16 }, // Flag / Status
      { wch: 35 }  // Adjustment Note
    ];
    worksheet['!cols'] = colWidths;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Approved Payroll");

    const todayStr = new Date().toISOString().split('T')[0];
    XLSX.writeFile(workbook, `Approved_Payroll_${todayStr}.xlsx`);
  });

  // Filter & Sort Event Listeners
  filterStartDate.addEventListener('change', applyFiltersAndSorting);
  filterEndDate.addEventListener('change', applyFiltersAndSorting);
  filterEmployee.addEventListener('change', applyFiltersAndSorting);
  if (sortField) sortField.addEventListener('change', applyFiltersAndSorting);
  if (sortOrder) sortOrder.addEventListener('change', applyFiltersAndSorting);

  // Table header click sorting
  document.querySelectorAll('.sortable-header').forEach(th => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      if (currentSortField === field) {
        currentSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
      } else {
        currentSortField = field;
        currentSortOrder = 'asc';
      }
      if (sortField) sortField.value = currentSortField;
      if (sortOrder) sortOrder.value = currentSortOrder;
      applyFiltersAndSorting();
    });
  });

  // Reset Filters
  resetFiltersBtn.addEventListener('click', () => {
    filterStartDate.value = '';
    filterEndDate.value = '';
    filterEmployee.value = '';
    currentSortField = 'name';
    currentSortOrder = 'asc';
    if (sortField) sortField.value = 'name';
    if (sortOrder) sortOrder.value = 'asc';
    applyFiltersAndSorting();
  });

  // Utility Helper Functions
  function parseFirestoreTimestamp(ts) {
    if (!ts) return null;
    if (typeof ts.toDate === 'function') return ts.toDate();
    if (ts.seconds !== undefined) return new Date(ts.seconds * 1000);
    if (typeof ts === 'string' || typeof ts === 'number') {
      const d = new Date(ts);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  }

  function formatTime(isoOrTimeStr) {
    if (!isoOrTimeStr) return '--:--';
    try {
      const d = new Date(isoOrTimeStr);
      if (isNaN(d.getTime())) return isoOrTimeStr;
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return isoOrTimeStr;
    }
  }

  function toISOStringForInput(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return '';
      const pad = (num) => String(num).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
      return '';
    }
  }

  function renderErrorState(msg) {
    timesheetTableBody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center py-4 text-danger">
          <i class="ti ti-alert-circle me-1 fs-5"></i> ${msg}
        </td>
      </tr>`;
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Initialize
  loadTimesheetData();
});
