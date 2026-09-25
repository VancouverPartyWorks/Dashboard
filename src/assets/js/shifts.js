import * as bootstrap from 'bootstrap';
import { db, auth } from './firebase-client.js';
import { collection, onSnapshot, addDoc, serverTimestamp, updateDoc, doc, deleteDoc, getDocs, query, where } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

document.addEventListener('DOMContentLoaded', () => {
    const shiftsTableBody = document.getElementById('shiftsTableBody');
    const addShiftForm = document.getElementById('addShiftForm');

    let allUsersList = [];
    let allShifts = [];
    let availableRoles = [];
    let canManageShifts = false;

    let currentPage = 1;
    const pageSize = 10;
    const paginationInfo = document.getElementById('paginationInfo');
    const paginationControls = document.getElementById('paginationControls');

    onAuthStateChanged(auth, async (user) => {
        if (user && db) {
            try {
                const q = query(collection(db, "dashboardUsers"), where("email", "==", user.email));
                const querySnapshot = await getDocs(q);
                if (!querySnapshot.empty) {
                    const userData = querySnapshot.docs[0].data();
                    const roleId = userData.roleId;

                    const rolesSnap = await getDocs(collection(db, "userRoles"));
                    const roles = rolesSnap.docs.map(doc => ({ id: doc.data().id, name: doc.data().name }));
                    const currentRole = roles.find(r => r.id === roleId);
                    const roleName = currentRole ? currentRole.name.toLowerCase() : '';

                    // Super Admin and HR can manage shifts, Accounts cannot.
                    const isSuperAdminLocal = roleName === 'super admin';
                    const isHr = roleName === 'hr';
                    canManageShifts = isSuperAdminLocal || isHr;

                    const pageSubtitle = document.getElementById('pageSubtitle');
                    const tableTitle = document.getElementById('tableTitle');
                    const createShiftBtn = document.getElementById('createShiftBtn');

                    if (pageSubtitle) {
                        pageSubtitle.textContent = canManageShifts ? 'Manage Vancouver Partyworks Shifts' : 'Vancouver Partyworks Shifts Directory';
                    }
                    if (tableTitle) {
                        tableTitle.textContent = canManageShifts ? 'Shifts Management' : 'Shifts Directory';
                    }
                    if (createShiftBtn && canManageShifts) {
                        createShiftBtn.classList.remove('d-none');
                    }

                    // Re-render table if shifts are already loaded
                    if (allShifts.length > 0) {
                        renderShiftsTable();
                    }
                }
            } catch (error) {
                console.error("Error checking user permissions:", error);
            }
        }
    });

    async function fetchRolesAndUsers() {
        if (!db) return;
        try {
            const rolesSnap = await getDocs(collection(db, "userRoles"));
            availableRoles = rolesSnap.docs.map(doc => ({ id: doc.data().id, name: doc.data().name }));

            const usersSnap = await getDocs(collection(db, "users"));
            const dUsersSnap = await getDocs(collection(db, "dashboardUsers"));

            allUsersList = [];
            usersSnap.forEach(d => allUsersList.push({ id: d.id, ...d.data() }));
            dUsersSnap.forEach(d => allUsersList.push({ id: d.id, ...d.data() }));

            allUsersList.forEach(user => {
                const currentRoleObj = availableRoles.find(r => r.id === user.roleId || r.name === user.role);
                user.displayRole = currentRoleObj ? currentRoleObj.name : (user.role || 'User');
            });
        } catch (e) {
            console.error("Error fetching users/roles", e);
        }
    }

    let cachedIOLeads = null;

    async function fetchIOEvents() {
        const container = document.getElementById('shiftEventContainer');
        if (cachedIOLeads === null) {
            const apiKey = import.meta.env.VITE_IO_API_KEY;
            const apiUrl = `/io-api/leads/?apiKey=${apiKey}&limit=250&_body=true`;
            console.log("Fetching IO Events from URL:", apiUrl);

            if (container) {
                container.innerHTML = '<div class="text-muted small">Loading events...</div>';
            }
            try {
                const res = await fetch(apiUrl);
                if (!res.ok) {
                    if (res.status === 403) {
                        throw new Error("API Key permissions restricted. Admin must enable Leads.");
                    }
                    throw new Error(`API error: ${res.status}`);
                }
                const data = await res.json();
                console.log("API Response Data:", data);

                let leads = [];
                if (Array.isArray(data)) leads = data;
                else if (data.items && Array.isArray(data.items)) leads = data.items;
                else if (data.data && Array.isArray(data.data)) leads = data.data;
                else if (typeof data === 'object') leads = Object.values(data);

                cachedIOLeads = leads.filter(l => l && typeof l === 'object' && l.id);
            } catch (error) {
                console.error("Error fetching IO events:", error);
                if (container) {
                    container.innerHTML = `<div class="text-danger small">Failed to load events: ${error.message}</div>`;
                }
                return;
            }
        }
        renderEventOptions();
    }

    function normalizeTime(t) {
        if (!t) return '';
        const parts = String(t).trim().split(':');
        if (parts.length >= 2) {
            return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
        }
        return String(t).trim();
    }

    function formatTime12h(timeStr) {
        if (!timeStr) return '';
        const parts = String(timeStr).split(':');
        let h = parseInt(parts[0], 10);
        const m = parts[1] ? parts[1].padStart(2, '0') : '00';
        if (isNaN(h)) return timeStr;
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12;
        h = h ? h : 12;
        return `${h}:${m} ${ampm}`;
    }

    function getShiftDateAndTime(shift) {
        let dateStr = shift.dateString || '';
        let timeStr = shift.startTimeString ? normalizeTime(shift.startTimeString) : '';

        if ((!dateStr || !timeStr) && shift.dateTime) {
            let d = null;
            if (typeof shift.dateTime.toDate === 'function') {
                d = shift.dateTime.toDate();
            } else if (shift.dateTime.seconds) {
                d = new Date(shift.dateTime.seconds * 1000);
            } else if (typeof shift.dateTime === 'string' || typeof shift.dateTime === 'number') {
                d = new Date(shift.dateTime);
            }

            if (d && !isNaN(d.getTime())) {
                if (!dateStr) {
                    const yyyy = d.getFullYear();
                    const mm = String(d.getMonth() + 1).padStart(2, '0');
                    const dd = String(d.getDate()).padStart(2, '0');
                    dateStr = `${yyyy}-${mm}-${dd}`;
                }
                if (!timeStr) {
                    const hh = String(d.getHours()).padStart(2, '0');
                    const min = String(d.getMinutes()).padStart(2, '0');
                    timeStr = `${hh}:${min}`;
                }
            }
        }

        let events = [];
        if (Array.isArray(shift.eventsList)) {
            events = shift.eventsList;
        } else if (typeof shift.venueName === 'string') {
            events = shift.venueName.split(',').map(s => s.trim()).filter(Boolean);
        }

        return { dateStr, timeStr, events };
    }

    function validateShiftStartTime() {
        const timeInput = document.getElementById('shiftStartTime');
        const errorEl = document.getElementById('shiftStartTimeError');
        const dateInput = document.getElementById('shiftDate');
        if (!timeInput) return true;

        const selectedDate = dateInput ? dateInput.value : '';
        const selectedTime = normalizeTime(timeInput.value);
        const checkedEvents = Array.from(document.querySelectorAll('.event-checkbox:checked')).map(cb => cb.value);

        // Reset error state first
        timeInput.classList.remove('is-invalid');
        timeInput.setCustomValidity('');
        if (errorEl) {
            errorEl.classList.add('d-none');
            errorEl.innerHTML = '';
        }

        return true;
    }

    function renderEventOptions() {
        const container = document.getElementById('shiftEventContainer');
        if (!container) return;

        const shiftDateInput = document.getElementById('shiftDate');
        const selectedDate = shiftDateInput ? shiftDateInput.value : '';

        if (!selectedDate) {
            container.innerHTML = '<div class="text-muted small">Please select a date to view events.</div>';
            validateShiftStartTime();
            return;
        }

        if (cachedIOLeads === null) {
            container.innerHTML = '<div class="text-muted small">Loading events...</div>';
            return;
        }

        // Filter leads matching the selected date and delivery type (events remain visible even if already assigned)
        const validLeads = cachedIOLeads.filter(lead => {
            // Delivery type filter: ignore Customer Pickup from Warehouse, only show Fully Staffed and PartyWorks Drop Off & Pickup
            const dt = (lead.deliverytype || '').toLowerCase().trim();
            if (dt.includes('customer pick') || dt.includes('customer pickup')) return false;

            const rawStart = lead.eventstarttime || lead.fullstart || lead.cushstart || lead.createtime || '';
            const startDate = typeof rawStart === 'string' ? rawStart.split('T')[0].split(' ')[0] : '';

            const rawEnd = lead.eventendtime || lead.fullend || lead.cushend || rawStart;
            const endDate = typeof rawEnd === 'string' ? rawEnd.split('T')[0].split(' ')[0] : startDate;

            if (startDate) {
                const start = startDate;
                const end = endDate >= startDate ? endDate : startDate;
                return selectedDate >= start && selectedDate <= end;
            }
            return true;
        });

        if (validLeads.length === 0) {
            container.innerHTML = '<div class="text-muted small py-2 text-center">No events found for the selected date.</div>';
            validateShiftStartTime();
            return;
        }

        container.innerHTML = '';
        validLeads.forEach(lead => {
            const id = `event_${lead.id || Math.random().toString(36).substr(2, 9)}`;
            const displayName = lead.eventname || lead.eventorganization || `Lead #${lead.id}`;

            // Check existing shifts on selectedDate for this event
            const existingShifts = allShifts.filter(shift => {
                const info = getShiftDateAndTime(shift);
                return info.dateStr === selectedDate && info.events.includes(displayName);
            });
            const existingCount = existingShifts.length;
            const existingBadge = existingCount > 0
                ? `<span class="badge bg-secondary-subtle text-secondary small ms-1" title="${existingCount} shift${existingCount > 1 ? 's' : ''} already created on this date">${existingCount} shift${existingCount > 1 ? 's' : ''}</span>`
                : '';

            const existingTimes = existingCount > 0
                ? `<div class="text-muted small" style="font-size: 0.72rem;">Scheduled: ${existingShifts.map(s => formatTime12h(getShiftDateAndTime(s).timeStr)).filter(Boolean).join(', ')}</div>`
                : '';

            const div = document.createElement('div');
            div.className = 'd-flex justify-content-between align-items-center p-2 mb-2 rounded border bg-white event-row';
            div.dataset.event = displayName;
            div.innerHTML = `
              <div class="form-check me-2 flex-grow-1 text-truncate" style="max-width: 62%;">
                <input class="form-check-input event-checkbox" type="checkbox" value="${displayName}" id="${id}">
                <label class="form-check-label fw-medium text-dark text-truncate ms-1" for="${id}" title="${displayName}">
                  ${displayName}${existingBadge}
                </label>
                ${existingTimes}
              </div>
              <div style="width: 165px; flex-shrink: 0;">
                <select class="form-select form-select-sm event-type-select" disabled>
                  <option value="Delivery" selected>Delivery</option>
                  <option value="Pickup">Pickup</option>
                  <option value="Delivery & Pickup">Delivery & Pickup</option>
                  <option value="Full Staff Event">Full Staff Event</option>
                  <option value="Runtime">Runtime</option>
                  <option value="Set up & Runtime">Set up & Runtime</option>
                  <option value="Runtime & Pickup">Runtime & Pickup</option>
                </select>
              </div>
            `;

            const cbInput = div.querySelector('.event-checkbox');
            const typeSelect = div.querySelector('.event-type-select');

            if (cbInput && typeSelect) {
                cbInput.addEventListener('change', () => {
                    typeSelect.disabled = !cbInput.checked;
                    if (cbInput.checked) {
                        div.classList.add('border-primary', 'bg-light-subtle');
                    } else {
                        div.classList.remove('border-primary', 'bg-light-subtle');
                    }
                    document.querySelectorAll('.event-checkbox').forEach(cb => cb.setCustomValidity(''));
                    const shiftDateInput = document.getElementById('shiftDate');
                    if (shiftDateInput) shiftDateInput.setCustomValidity('');
                    validateShiftStartTime();
                });
            }
            container.appendChild(div);
        });
        validateShiftStartTime();
    }

    const shiftDateInput = document.getElementById('shiftDate');
    if (shiftDateInput) {
        shiftDateInput.addEventListener('input', () => {
            shiftDateInput.setCustomValidity('');
            renderEventOptions();
        });
        shiftDateInput.addEventListener('change', () => {
            shiftDateInput.setCustomValidity('');
            renderEventOptions();
        });
    }

    const shiftStartTimeInput = document.getElementById('shiftStartTime');
    if (shiftStartTimeInput) {
        shiftStartTimeInput.addEventListener('input', validateShiftStartTime);
        shiftStartTimeInput.addEventListener('change', validateShiftStartTime);
    }

    const searchInput = document.getElementById('searchShiftInput');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            currentPage = 1;
            renderShiftsTable();
        });
    }

    // Date Filters
    let currentFilterDate = null;
    let currentFilterStatus = '';
    const filterTodayBtn = document.getElementById('filterTodayBtn');
    const filterTomorrowBtn = document.getElementById('filterTomorrowBtn');
    const filterSelectDateBtn = document.getElementById('filterSelectDateBtn');
    const filterDateContainer = document.getElementById('filterDateContainer');
    const filterDateInput = document.getElementById('filterDateInput');
    const filterDateApplyBtn = document.getElementById('filterDateApplyBtn');
    const filterClearBtn = document.getElementById('filterClearBtn');
    const filterStatusSelect = document.getElementById('filterStatusSelect');

    function updateClearFilterBtn() {
        if (currentFilterDate || currentFilterStatus) {
            if (filterClearBtn) filterClearBtn.classList.remove('d-none');
        } else {
            if (filterClearBtn) filterClearBtn.classList.add('d-none');
        }
    }

    function setActiveFilterBtn(btn) {
        [filterTodayBtn, filterTomorrowBtn, filterSelectDateBtn].forEach(b => {
            if (b) b.classList.remove('active');
        });
        if (btn) btn.classList.add('active');
        updateClearFilterBtn();
    }

    if (filterStatusSelect) {
        filterStatusSelect.addEventListener('change', (e) => {
            currentFilterStatus = e.target.value;
            updateClearFilterBtn();
            currentPage = 1;
            renderShiftsTable();
        });
    }

    if (filterTodayBtn) {
        filterTodayBtn.addEventListener('click', () => {
            const today = new Date();
            const yyyy = today.getFullYear();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const dd = String(today.getDate()).padStart(2, '0');
            currentFilterDate = `${yyyy}-${mm}-${dd}`;
            setActiveFilterBtn(filterTodayBtn);
            if (filterDateContainer) filterDateContainer.classList.add('d-none');
            renderShiftsTable();
        });
    }

    if (filterTomorrowBtn) {
        filterTomorrowBtn.addEventListener('click', () => {
            const tmrw = new Date();
            tmrw.setDate(tmrw.getDate() + 1);
            const yyyy = tmrw.getFullYear();
            const mm = String(tmrw.getMonth() + 1).padStart(2, '0');
            const dd = String(tmrw.getDate()).padStart(2, '0');
            currentFilterDate = `${yyyy}-${mm}-${dd}`;
            setActiveFilterBtn(filterTomorrowBtn);
            if (filterDateContainer) filterDateContainer.classList.add('d-none');
            renderShiftsTable();
        });
    }

    if (filterSelectDateBtn) {
        filterSelectDateBtn.addEventListener('click', () => {
            setActiveFilterBtn(filterSelectDateBtn);
            if (filterDateContainer) {
                filterDateContainer.classList.remove('d-none');
            }
        });
    }

    if (filterDateApplyBtn) {
        filterDateApplyBtn.addEventListener('click', () => {
            if (filterDateInput && filterDateInput.value) {
                currentFilterDate = filterDateInput.value;
                if (filterClearBtn) filterClearBtn.classList.remove('d-none');
                renderShiftsTable();
            }
        });
    }

    if (filterClearBtn) {
        filterClearBtn.addEventListener('click', () => {
            currentFilterDate = null;
            currentFilterStatus = '';
            if (filterStatusSelect) filterStatusSelect.value = '';
            setActiveFilterBtn(null);
            if (filterDateInput) filterDateInput.value = '';
            if (filterDateContainer) filterDateContainer.classList.add('d-none');
            renderShiftsTable();
        });
    }

    function updateShiftStatusAlert(shifts) {
        const container = document.getElementById('shiftStatusAlertContainer');
        const alertDiv = document.getElementById('shiftStatusAlert');
        const icon = document.getElementById('shiftStatusAlertIcon');
        const messageSpan = document.getElementById('shiftStatusAlertMessage');

        if (!container || !alertDiv || !icon || !messageSpan) return;

        let totalStaff = 0;
        let rejectedCount = 0;
        let notRespondedCount = 0;

        const scheduledShifts = shifts ? shifts.filter(s => {
            const st = (s.status || '').toLowerCase();
            return st === 'scheduled' || st === 'unconfirmed';
        }) : [];

        if (scheduledShifts.length > 0) {
            scheduledShifts.forEach(shift => {
                const membersList = shift.members || shift.staffMembers || [];
                if (membersList && Array.isArray(membersList)) {
                    membersList.forEach(member => {
                        totalStaff++;
                        const s = (member.status || '').toLowerCase();
                        if (s === 'rejected' || s === 'reject' || s === 'declined') {
                            rejectedCount++;
                        } else if (s !== 'confirmed') {
                            notRespondedCount++;
                        }
                    });
                }
            });
        }

        if (scheduledShifts.length === 0) {
            container.classList.add('d-none');
            return;
        }

        container.classList.remove('d-none');
        alertDiv.className = 'alert mb-0 d-flex align-items-center gap-2 border';

        if (totalStaff === 0) {
            alertDiv.classList.add('alert-secondary', 'bg-secondary-subtle', 'text-secondary', 'border-secondary-subtle');
            icon.className = 'ti ti-info-circle fs-4';
            messageSpan.innerHTML = '<strong>Tomorrow\'s shifts</strong> have no staff assigned yet.';
        } else if (rejectedCount === 0 && notRespondedCount === 0) {
            alertDiv.classList.add('alert-success', 'bg-success-subtle', 'text-success', 'border-success-subtle');
            icon.className = 'ti ti-check fs-4';
            messageSpan.innerHTML = '<strong>Everyone\'s in!</strong> All set for tomorrow.';
        } else {
            alertDiv.classList.add('alert-warning', 'bg-warning-subtle', 'text-warning-emphasis', 'border-warning-subtle');
            icon.className = 'ti ti-alert-triangle fs-4';
            let parts = [];
            if (rejectedCount > 0) parts.push(`<strong>${rejectedCount} staff rejected</strong>`);
            if (notRespondedCount > 0) parts.push(`<strong>${notRespondedCount} staff not responded</strong>`);
            messageSpan.innerHTML = `Attention: ${parts.join(' and ')} for tomorrow's shift(s). Please kindly assign new ones.`;
        }
    }

    function renderShiftsTable() {
        shiftsTableBody.innerHTML = '';

        const actionHeader = document.getElementById('actionColumnHeader');
        if (actionHeader) {
            actionHeader.style.display = canManageShifts ? '' : 'none';
        }

        const searchTerm = (searchInput ? searchInput.value : '').toLowerCase();
        let filteredShifts = allShifts;

        if (searchTerm) {
            filteredShifts = allShifts.filter(shift =>
                (shift.venueName && shift.venueName.toLowerCase().includes(searchTerm))
            );
        }

        if (typeof currentFilterDate !== 'undefined' && currentFilterDate) {
            filteredShifts = filteredShifts.filter(shift => {
                const info = getShiftDateAndTime(shift);
                return info.dateStr === currentFilterDate;
            });
        }

        if (typeof currentFilterStatus !== 'undefined' && currentFilterStatus) {
            filteredShifts = filteredShifts.filter(shift => {
                const s = (shift.status || 'scheduled').toLowerCase();
                return s === currentFilterStatus;
            });
        }

        const tmrw = new Date();
        tmrw.setDate(tmrw.getDate() + 1);
        const yyyy = tmrw.getFullYear();
        const mm = String(tmrw.getMonth() + 1).padStart(2, '0');
        const dd = String(tmrw.getDate()).padStart(2, '0');
        const tomorrowDateStr = `${yyyy}-${mm}-${dd}`;

        const tomorrowShifts = allShifts.filter(shift => {
            const info = getShiftDateAndTime(shift);
            return info.dateStr === tomorrowDateStr;
        });

        updateShiftStatusAlert(tomorrowShifts);

        const totalItems = filteredShifts.length;
        const totalPages = Math.ceil(totalItems / pageSize) || 1;

        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;

        if (totalItems === 0) {
            shiftsTableBody.innerHTML = `<tr><td colspan="${canManageShifts ? 7 : 6}" class="text-center py-4 text-muted">No shifts found.</td></tr>`;
            if (paginationInfo) paginationInfo.textContent = 'Showing 0 of 0 shifts';
            if (paginationControls) paginationControls.innerHTML = '';
            return;
        }

        const startIndex = (currentPage - 1) * pageSize;
        const endIndex = Math.min(startIndex + pageSize, totalItems);
        const pageShifts = filteredShifts.slice(startIndex, endIndex);

        if (paginationInfo) {
            paginationInfo.textContent = `Showing ${startIndex + 1} to ${endIndex} of ${totalItems} shifts`;
        }

        pageShifts.forEach((shift) => {
            const venue = shift.venueName || 'N/A';
            const loc = shift.meetingLocation || 'N/A';
            const role = shift.role || 'N/A';
            const status = shift.status || 'scheduled';
            const assigned = shift.assignedUserId || '';

            let dateDisplay = 'N/A';
            let dateValue = '';
            if (shift.dateTime) {
                if (typeof shift.dateTime.toDate === 'function') {
                    const d = shift.dateTime.toDate();
                    dateDisplay = d.toLocaleString();
                    dateValue = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                } else if (shift.dateTime.seconds) {
                    const d = new Date(shift.dateTime.seconds * 1000);
                    dateDisplay = d.toLocaleString();
                    dateValue = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                } else if (typeof shift.dateTime === 'string') {
                    dateDisplay = shift.dateTime;
                    const d = new Date(shift.dateTime);
                    if (!isNaN(d)) {
                        dateValue = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                    } else {
                        dateValue = shift.dateTime;
                    }
                } else {
                    dateDisplay = String(shift.dateTime);
                }
            }

            const isUnconfirmed = (status || '').toLowerCase() === 'scheduled';
            const notifyBtn = (canManageShifts && isUnconfirmed) ? `
                <button class="btn btn-sm btn-outline-primary notify-shift-btn me-1"
                    data-id="${shift.id}"
                    data-venue="${venue}"
                    data-date="${dateDisplay}"
                    data-location="${loc}"
                    title="Send push notification to unconfirmed users">
                    <i class="ti ti-bell-ringing"></i>
                </button>` : '';

            const editBtn = (canManageShifts && isUnconfirmed) ? `
                    <button class="btn btn-sm btn-outline-secondary edit-shift-btn"
                        data-id="${shift.id}"
                        data-venue="${venue}"
                        data-date="${dateValue}"
                        data-location="${loc}"
                        data-role="${role}"
                        data-status="${status}"
                        data-assigned="${assigned}"
                        title="Edit Shift">
                        <i class="ti ti-edit"></i>
                    </button>` : '';

            const actionCell = canManageShifts ? `
                <td class="text-end text-nowrap">
                    ${notifyBtn}
                    ${editBtn}
                    <button class="btn btn-sm btn-outline-danger delete-shift-btn ms-1"
                        data-id="${shift.id}"
                        title="Delete Shift">
                        <i class="ti ti-trash"></i>
                    </button>
                </td>` : '';

            let confirmedCount = 0;
            let rejectedCount = 0;
            let pendingCount = 0;
            let totalMembers = 0;

            const membersList = shift.members || shift.staffMembers || [];
            if (membersList && Array.isArray(membersList)) {
                totalMembers = membersList.length;
                membersList.forEach(member => {
                    const s = (member.status || '').toLowerCase();
                    if (s === 'confirmed') confirmedCount++;
                    else if (s === 'rejected' || s === 'reject' || s === 'declined') rejectedCount++;
                    else pendingCount++;
                });
            }

            const membersStatusChips = `
                <div class="d-flex gap-1 flex-wrap">
                    <span class="badge bg-success-subtle text-success border border-success-subtle" title="${confirmedCount} Confirmed out of ${totalMembers}">${confirmedCount}/${totalMembers} <i class="ti ti-check"></i></span>
                    <span class="badge bg-warning-subtle text-warning border border-warning-subtle" title="${pendingCount} Not Responded">${pendingCount} <i class="ti ti-clock"></i></span>
                    <span class="badge bg-danger-subtle text-danger border border-danger-subtle" title="${rejectedCount} Rejected">${rejectedCount} <i class="ti ti-x"></i></span>
                </div>
            `;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${venue}</td>
                <td>${dateDisplay}</td>
                <td>${loc}</td>
                <td>${role}</td>
                <td>${membersStatusChips}</td>
                <td>${formatStatusDisplay(status)}</td>
                ${actionCell}
            `;
            shiftsTableBody.appendChild(tr);
        });
        
        renderPaginationControls(totalPages);
    }

    function renderPaginationControls(totalPages) {
        if (typeof paginationControls === 'undefined' || !paginationControls) return;
        paginationControls.innerHTML = '';

        // Previous Button
        const prevLi = document.createElement('li');
        prevLi.className = `page-item ${currentPage === 1 ? 'disabled' : ''}`;
        prevLi.innerHTML = `<a class="page-link" href="#" aria-label="Previous"><span aria-hidden="true">&laquo;</span></a>`;
        prevLi.addEventListener('click', (e) => {
            e.preventDefault();
            if (currentPage > 1) {
                currentPage--;
                renderShiftsTable();
            }
        });
        paginationControls.appendChild(prevLi);

        // Page Numbers
        for (let p = 1; p <= totalPages; p++) {
            const li = document.createElement('li');
            li.className = `page-item ${p === currentPage ? 'active' : ''}`;
            li.innerHTML = `<a class="page-link" href="#">${p}</a>`;
            li.addEventListener('click', (e) => {
                e.preventDefault();
                if (currentPage !== p) {
                    currentPage = p;
                    renderShiftsTable();
                }
            });
            paginationControls.appendChild(li);
        }

        // Next Button
        const nextLi = document.createElement('li');
        nextLi.className = `page-item ${currentPage === totalPages ? 'disabled' : ''}`;
        nextLi.innerHTML = `<a class="page-link" href="#" aria-label="Next"><span aria-hidden="true">&raquo;</span></a>`;
        nextLi.addEventListener('click', (e) => {
            e.preventDefault();
            if (currentPage < totalPages) {
                currentPage++;
                renderShiftsTable();
            }
        });
        paginationControls.appendChild(nextLi);
    }

    function formatStatusDisplay(statusStr) {
        if (!statusStr) return 'Scheduled';
        const s = String(statusStr).trim().toLowerCase();
        if (s === 'scheduled' || s === 'unconfirmed') return 'Scheduled';
        if (s === 'active') return 'Active';
        if (s === 'completed') return 'Completed';
        return statusStr.charAt(0).toUpperCase() + statusStr.slice(1);
    }

    function loadShifts() {
        if (!db) {
            shiftsTableBody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">No shifts found.</td></tr>`;
            return;
        }

        onSnapshot(collection(db, "shifts"), (querySnapshot) => {
            allShifts = [];
            querySnapshot.forEach((docSnap) => {
                const shift = docSnap.data();

                // Auto-migrate legacy status in database
                if (shift.status === 'unconfirmed') {
                    updateDoc(doc(db, "shifts", docSnap.id), { status: 'scheduled' }).catch(console.error);
                }

                allShifts.push({ id: docSnap.id, ...shift });
            });
            renderShiftsTable();
        }, (error) => {
            console.error("Error loading shifts: ", error);
            shiftsTableBody.innerHTML = `<tr><td colspan="${canManageShifts ? 7 : 6}" class="text-center py-4 text-danger">Error loading shifts.</td></tr>`;
        });
    }

    function updateLeadRequirement() {
        const locationInput = document.getElementById('shiftMeetingLocation');
        const leadSearch = document.getElementById('shiftLeadSearch');
        const leadLabel = leadSearch ? leadSearch.previousElementSibling : null;
        if (!locationInput) return;

        const isWarehouse = locationInput.value.trim().toLowerCase() === 'warehouse';
        if (isWarehouse) {
            if (leadLabel) leadLabel.textContent = 'Select Lead';
        } else {
            if (leadLabel) leadLabel.textContent = 'Select Lead (Optional)';
        }
    }

    const shiftMeetingLocInput = document.getElementById('shiftMeetingLocation');
    if (shiftMeetingLocInput) {
        shiftMeetingLocInput.addEventListener('input', updateLeadRequirement);
        shiftMeetingLocInput.addEventListener('change', updateLeadRequirement);
    }

    let createShiftNotes = [];

    function renderCreateShiftNotes() {
        const notesList = document.getElementById('shiftNotesList');
        if (!notesList) return;
        notesList.innerHTML = '';
        if (createShiftNotes.length === 0) {
            notesList.innerHTML = '<li class="list-group-item text-muted small py-2 text-center">No notes added</li>';
            return;
        }
        createShiftNotes.forEach((note, index) => {
            const li = document.createElement('li');
            li.className = 'list-group-item d-flex justify-content-between align-items-center py-1 px-3';

            const span = document.createElement('span');
            span.className = 'small me-2 text-break';
            span.textContent = `• ${note}`;

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'btn-close btn-close-xs ms-auto';
            removeBtn.style.fontSize = '0.65rem';
            removeBtn.setAttribute('aria-label', 'Remove note');
            removeBtn.addEventListener('click', () => {
                createShiftNotes.splice(index, 1);
                renderCreateShiftNotes();
            });

            li.appendChild(span);
            li.appendChild(removeBtn);
            notesList.appendChild(li);
        });
    }

    function addNoteItem(text) {
        const trimmed = (text || '').trim();
        if (!trimmed) return;
        createShiftNotes.push(trimmed);
        renderCreateShiftNotes();
    }

    const addNoteBtn = document.getElementById('addShiftNoteBtn');
    const noteInput = document.getElementById('shiftNoteInput');
    if (addNoteBtn && noteInput) {
        addNoteBtn.addEventListener('click', () => {
            addNoteItem(noteInput.value);
            noteInput.value = '';
            noteInput.focus();
        });

        noteInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addNoteItem(noteInput.value);
                noteInput.value = '';
            }
        });
    }


    const addShiftModalEl = document.getElementById('addShiftModal');
    if (addShiftModalEl) {
        addShiftModalEl.addEventListener('show.bs.modal', async () => {
            fetchIOEvents(); // Fetch API events dynamically
            if (allUsersList.length === 0) {
                await fetchRolesAndUsers();
            }

            createShiftNotes = [];
            renderCreateShiftNotes();

            const shiftStartTimeInput = document.getElementById('shiftStartTime');
            if (shiftStartTimeInput) {
                shiftStartTimeInput.classList.remove('is-invalid');
                shiftStartTimeInput.setCustomValidity('');
            }
            const timeErrorEl = document.getElementById('shiftStartTimeError');
            if (timeErrorEl) {
                timeErrorEl.classList.add('d-none');
                timeErrorEl.innerHTML = '';
            }

            const leadContainer = document.getElementById('shiftLeadContainer');
            const staffContainer = document.getElementById('shiftStaffContainer');

            leadContainer.innerHTML = '';
            updateLeadRequirement();
            staffContainer.innerHTML = '';

            const assignedLeads = new Set();
            const assignedStaff = new Set();

            allShifts.forEach(shift => {
                if (shift.lead) assignedLeads.add(shift.lead);
                if (shift.staff && Array.isArray(shift.staff)) {
                    shift.staff.forEach(s => assignedStaff.add(s));
                }
            });

            allUsersList.forEach(user => {
                const roleName = (user.displayRole || '').toLowerCase();
                const isLead = roleName.includes('lead');
                const displayName = user.displayName || user.email || user.phoneNumber || user.id;

                if (isLead && !assignedLeads.has(user.id)) {
                    const div = document.createElement('div');
                    div.className = 'd-flex justify-content-between align-items-center mb-2 item-row';
                    div.innerHTML = `
                      <label class="form-check-label item-name" for="lead_${user.id}">${displayName}</label>
                      <input class="form-check-input lead-radio" type="radio" name="shiftLeadRadio" value="${user.id}" id="lead_${user.id}">
                    `;
                    leadContainer.appendChild(div);
                }
                const rId = parseInt(user.roleId, 10);
                // Only show users with roleId 5 in the staff list
                if (rId === 5 && !assignedLeads.has(user.id) && !assignedStaff.has(user.id)) {
                    const div = document.createElement('div');
                    div.className = 'd-flex justify-content-between align-items-center mb-2 item-row';
                    div.innerHTML = `
                      <label class="form-check-label item-name" for="staff_${user.id}">${displayName}</label>
                      <input class="form-check-input staff-checkbox" type="checkbox" value="${user.id}" id="staff_${user.id}">
                    `;
                    staffContainer.appendChild(div);
                }
            });

            if (leadContainer.innerHTML === '') {
                leadContainer.innerHTML = '<div class="text-muted small">No leads available</div>';
            }
            if (staffContainer.innerHTML === '') {
                staffContainer.innerHTML = '<div class="text-muted small">No staff available</div>';
            }
        });
    }

    if (addShiftForm) {
        addShiftForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const date = document.getElementById('shiftDate').value;
            const eventCheckboxes = document.querySelectorAll('.event-checkbox:checked');
            if (eventCheckboxes.length === 0) {
                const firstCb = document.querySelector('.event-checkbox');
                if (firstCb) {
                    firstCb.setCustomValidity('Please select an item in the list.');
                    firstCb.reportValidity();
                } else {
                    const shiftDateInput = document.getElementById('shiftDate');
                    if (shiftDateInput) {
                        shiftDateInput.setCustomValidity('Please select a date with available events.');
                        shiftDateInput.reportValidity();
                    }
                }
                return;
            }

            const events = [];
            const eventTypesMap = {};
            const typeValues = [];
            eventCheckboxes.forEach(cb => {
                const eventName = cb.value;
                events.push(eventName);
                const row = cb.closest('.event-row');
                const selectEl = row ? row.querySelector('.event-type-select') : null;
                const typeVal = selectEl ? selectEl.value : 'Delivery';
                eventTypesMap[eventName] = typeVal;
                typeValues.push(typeVal);
            });
            const uniqueTypes = Array.from(new Set(typeValues));
            const role = uniqueTypes.join(', ') || 'Delivery';

            const meetingLocation = document.getElementById('shiftMeetingLocation').value;
            const isWarehouse = meetingLocation.trim().toLowerCase() === 'warehouse';
            const leadRadio = document.querySelector('.lead-radio:checked');
            const lead = leadRadio ? leadRadio.value : '';

            if (isWarehouse && !lead) {
                alert('Please select a Lead when Meeting Location is Warehouse.');
                return;
            }

            if (!validateShiftStartTime()) {
                const timeInput = document.getElementById('shiftStartTime');
                if (timeInput) {
                    timeInput.reportValidity();
                    timeInput.focus();
                }
                return;
            }

            const startTime = document.getElementById('shiftStartTime').value;
            const staffCheckboxes = document.querySelectorAll('.staff-checkbox:checked');
            const staff = Array.from(staffCheckboxes).map(cb => cb.value);
            if (lead && !staff.includes(lead)) {
                staff.push(lead);
            }

            let dateTimeVal = null;
            if (date && startTime) {
                dateTimeVal = new Date(`${date}T${startTime}`);
            }

            try {
                const members = staff.map(id => ({
                    id: id,
                    status: 'pending',
                    role: id === lead ? 'Lead' : 'Event Staff'
                }));

                const shiftDocRef = await addDoc(collection(db, "shifts"), {
                    assignedUserId: lead,
                    clientSignatureSubmitted: false,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                    dateTime: dateTimeVal,
                    earlyClockIn: false,
                    lateClockIn: false,
                    location: ["25.9604181", "52.0721444"], // Default coords
                    managerReportSubmitted: false,
                    meetingLocation: meetingLocation,
                    notes: createShiftNotes,
                    outsideGeoFence: false,
                    role: role,
                    eventTypes: eventTypesMap,
                    setupFormSubmitted: false,
                    setupPhotosSubmitted: false,
                    members: members,
                    status: 'scheduled',
                    venueName: events.join(', ') || 'No Event Selected',

                    // Preserving exact string inputs from UI for fallback/reference
                    dateString: date,
                    startTimeString: startTime,
                    eventsList: events,
                });

                // Send push notification to lead and staff
                const recipientIds = new Set();
                if (lead) recipientIds.add(lead);
                staff.forEach(id => recipientIds.add(id));

                if (recipientIds.size > 0) {
                    const venueName = events.join(', ') || 'New Shift';
                    const formattedTime = formatTime12h(startTime);
                    const title = "New Shift Assigned";
                    const body = `New shift assigned: ${venueName} on ${date} at ${formattedTime}`;

                    try {
                        await addDoc(collection(db, "pushNotifications"), {
                            type: "new_shift",
                            shiftId: shiftDocRef.id,
                            venueName: venueName,
                            recipientUserIds: Array.from(recipientIds),
                            recipientCount: recipientIds.size,
                            title: title,
                            body: body,
                            status: "pending",
                            sentByEmail: auth.currentUser ? auth.currentUser.email : "admin",
                            sentByName: auth.currentUser ? (auth.currentUser.displayName || auth.currentUser.email) : "Admin",
                            createdAt: serverTimestamp()
                        });

                        for (const userId of recipientIds) {
                            try {
                                await addDoc(collection(db, "users", userId, "notifications"), {
                                    title: title,
                                    body: body,
                                    type: "new_shift",
                                    shiftId: shiftDocRef.id,
                                    venueName: venueName,
                                    read: false,
                                    createdAt: serverTimestamp()
                                });
                            } catch (subErr) {
                                console.warn("Could not write in-app notification for user:", userId, subErr);
                            }
                        }
                    } catch (pushErr) {
                        console.error("Error sending push notification for new shift:", pushErr);
                    }
                }

                const modal = bootstrap.Modal.getInstance(document.getElementById('addShiftModal'));
                if (modal) modal.hide();

                addShiftForm.reset();
                validateShiftStartTime();
                document.getElementById('shiftMeetingLocation').value = 'Warehouse';
                createShiftNotes = [];
                renderCreateShiftNotes();
                updateLeadRequirement();
                renderEventOptions();
            } catch (error) {
                console.error("Error adding shift: ", error);
                alert("Failed to add shift.");
            }
        });
    }

    let shiftToDeleteId = null;

    shiftsTableBody.addEventListener('click', async (e) => {
        const notifyBtn = e.target.closest('.notify-shift-btn');
        if (notifyBtn) {
            const shiftId = notifyBtn.dataset.id;
            openPushNotificationModal(shiftId);
            return;
        }

        const deleteBtn = e.target.closest('.delete-shift-btn');
        if (deleteBtn) {
            shiftToDeleteId = deleteBtn.dataset.id;
            const modal = new bootstrap.Modal(document.getElementById('deleteShiftModal'));
            modal.show();
            return;
        }

        const editBtn = e.target.closest('.edit-shift-btn');
        if (editBtn) {
            const shiftId = editBtn.dataset.id;
            const shift = allShifts.find(s => s.id === shiftId) || {};

            document.getElementById('editShiftId').value = shiftId;

            // 1. Date & Start Time
            const shiftInfo = getShiftDateAndTime(shift);
            const dateInput = document.getElementById('editShiftDate');
            if (dateInput) dateInput.value = shiftInfo.dateStr || '';

            const timeInput = document.getElementById('editShiftStartTime');
            if (timeInput) timeInput.value = shiftInfo.timeStr || '';

            // 2. Event Name & Type (dynamically rendered)
            const editEventContainer = document.getElementById('editShiftEventContainer');
            if (editEventContainer) {
                editEventContainer.innerHTML = '';
                const eventsArray = (Array.isArray(shift.eventsList) && shift.eventsList.length > 0)
                    ? shift.eventsList
                    : [shift.venueName || editBtn.dataset.venue || 'Unknown Event'];

                const eventTypesMap = shift.eventTypes || {};
                const fallbackRole = shift.role || editBtn.dataset.role || 'Delivery';

                eventsArray.forEach((evtName, index) => {
                    const rowDiv = document.createElement('div');
                    rowDiv.className = 'd-flex justify-content-between align-items-center p-2 rounded border bg-white edit-event-row';
                    if (index > 0) rowDiv.classList.add('mt-2'); // spacing

                    const currentType = eventTypesMap[evtName] || fallbackRole;

                    rowDiv.innerHTML = `
                      <div class="d-flex align-items-center me-2 flex-grow-1 text-truncate" style="max-width: 62%;">
                        <input class="form-check-input mt-0 me-2" type="checkbox" checked disabled>
                        <input type="text" class="form-control form-control-plaintext fw-medium text-dark text-truncate p-0 m-0 w-100 edit-event-name-input" value="${evtName}" disabled readonly style="background: transparent; height: auto;">
                      </div>
                      <div style="width: 165px; flex-shrink: 0;">
                        <select class="form-select form-select-sm bg-light edit-event-type-select" required>
                          <option value="Delivery" ${currentType === 'Delivery' ? 'selected' : ''}>Delivery</option>
                          <option value="Pickup" ${currentType === 'Pickup' ? 'selected' : ''}>Pickup</option>
                          <option value="Delivery & Pickup" ${currentType === 'Delivery & Pickup' ? 'selected' : ''}>Delivery & Pickup</option>
                          <option value="Full Staff Event" ${currentType === 'Full Staff Event' ? 'selected' : ''}>Full Staff Event</option>
                          <option value="Runtime" ${currentType === 'Runtime' ? 'selected' : ''}>Runtime</option>
                          <option value="Set up and Runtime" ${currentType === 'Set up & Runtime' || currentType === 'Set up and Runtime' ? 'selected' : ''}>Set up & Runtime</option>
                          <option value="Runtime & Pickup" ${currentType === 'Runtime & Pickup' ? 'selected' : ''}>Runtime & Pickup</option>
                        </select>
                      </div>
                    `;
                    editEventContainer.appendChild(rowDiv);
                });
            }

            // 4. Meeting Location
            const locationInput = document.getElementById('editShiftMeetingLocation');
            if (locationInput) locationInput.value = shift.meetingLocation || editBtn.dataset.location || 'Warehouse';

            // 5. Status (Confirmed & Un Confirmed)
            const rawStatus = (shift.status || editBtn.dataset.status || 'unconfirmed').toLowerCase();
            const statusSelect = document.getElementById('editShiftStatus');
            if (statusSelect) {
                if (rawStatus === 'confirmed' || rawStatus === 'unconfirmed') {
                    statusSelect.value = rawStatus;
                } else {
                    let matchOpt = Array.from(statusSelect.options).find(opt => opt.value.toLowerCase() === rawStatus);
                    if (!matchOpt) {
                        const formatted = rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1);
                        statusSelect.add(new Option(formatted, shift.status || rawStatus));
                    }
                    statusSelect.value = shift.status || rawStatus;
                }
            }

            // Ensure roles and users are loaded
            if (allUsersList.length === 0) {
                await fetchRolesAndUsers();
            }

            const getMemberStatus = (uid) => {
                const arr = shift.members || shift.staffMembers || [];
                if (Array.isArray(arr)) {
                    const member = arr.find(m => {
                        if (!m) return false;
                        const id = m.id || m.uid || m.userId || m.employeeId || m.staffId;
                        return String(id).trim() === uid;
                    });
                    if (member && member.status) {
                        return member.status;
                    }
                }
                return null;
            };

            const getMemberStatusBadgeHtml = (mStatus) => {
                if (!mStatus) return '';
                const s = mStatus.toLowerCase();
                let formattedStatus = mStatus.charAt(0).toUpperCase() + mStatus.slice(1);
                if (s === 'unconfirmed') formattedStatus = 'Un Confirmed';

                let badgeClass = 'bg-secondary-subtle text-secondary border-secondary-subtle';
                if (s === 'confirmed') {
                    badgeClass = 'bg-success-subtle text-success border-success-subtle';
                } else if (s === 'rejected' || s === 'reject' || s === 'declined') {
                    badgeClass = 'bg-danger-subtle text-danger border-danger-subtle';
                } else if (s === 'pending' || s === 'unconfirmed') {
                    badgeClass = 'bg-warning-subtle text-warning border-warning-subtle';
                }

                return `<span class="badge border ${badgeClass} ms-2 fw-normal">${formattedStatus}</span>`;
            };

            // 6. Lead (Load all leads)
            const leadContainer = document.getElementById('editShiftLeadContainer');
            if (leadContainer) {
                leadContainer.innerHTML = '';
                const currentLeadId = String(shift.assignedUserId || shift.lead || editBtn.dataset.assigned || '').trim();

                const leadUsers = [];
                const seenLeadIds = new Set();

                allUsersList.forEach(user => {
                    const roleName = (user.displayRole || user.role || '').toLowerCase();
                    const isLead = roleName.includes('lead');
                    const uid = String(user.id).trim();

                    if ((isLead || uid === currentLeadId) && !seenLeadIds.has(uid)) {
                        seenLeadIds.add(uid);
                        leadUsers.push(user);
                    }
                });

                // Sort leads alphabetically
                leadUsers.sort((a, b) => {
                    const nameA = (a.displayName || a.email || a.phoneNumber || a.id).toLowerCase();
                    const nameB = (b.displayName || b.email || b.phoneNumber || b.id).toLowerCase();
                    return nameA.localeCompare(nameB);
                });

                leadUsers.forEach(user => {
                    const uid = String(user.id).trim();
                    let displayName = user.displayName || user.email || user.phoneNumber || user.id;

                    if (uid === currentLeadId) {
                        const mStatus = getMemberStatus(uid);
                        if (mStatus) {
                            displayName += getMemberStatusBadgeHtml(mStatus);
                        }
                    }

                    const div = document.createElement('div');
                    div.className = 'd-flex justify-content-between align-items-center mb-2 item-row';
                    div.innerHTML = `
                      <label class="form-check-label item-name" for="edit_lead_${uid}">${displayName}</label>
                      <input class="form-check-input edit-lead-radio" type="radio" name="editShiftLeadRadio" value="${uid}" id="edit_lead_${uid}" ${uid === currentLeadId ? 'checked' : ''}>
                    `;
                    leadContainer.appendChild(div);
                });

                if (leadContainer.innerHTML === '') {
                    leadContainer.innerHTML = '<div class="text-muted small">No leads available</div>';
                }
                updateEditLeadRequirement();
            }

            // 7. Staff (Show all staff, with selected staff ticked)
            const staffContainer = document.getElementById('editShiftStaffContainer');
            if (staffContainer) {
                staffContainer.innerHTML = '';

                const currentStaffIds = new Set();
                const addCandidateId = (val) => {
                    if (val === null || val === undefined) return;
                    if (typeof val === 'string' || typeof val === 'number') {
                        currentStaffIds.add(String(val).trim());
                    } else if (typeof val === 'object') {
                        const extracted = val.id || val.uid || val.userId || val.employeeId || val.staffId;
                        if (extracted) currentStaffIds.add(String(extracted).trim());
                    }
                };

                if (Array.isArray(shift.members)) shift.members.forEach(addCandidateId);
                if (Array.isArray(shift.staffMembers)) shift.staffMembers.forEach(addCandidateId);
                if (Array.isArray(shift.staff)) shift.staff.forEach(addCandidateId);
                if (Array.isArray(shift.staffList)) shift.staffList.forEach(addCandidateId);
                if (Array.isArray(shift.assignedStaff)) shift.assignedStaff.forEach(addCandidateId);
                if (Array.isArray(shift.assignedUsers)) shift.assignedUsers.forEach(addCandidateId);
                if (shift.members && typeof shift.members === 'object' && !Array.isArray(shift.members)) {
                    Object.keys(shift.members).forEach(k => {
                        if (shift.members[k]) currentStaffIds.add(String(k).trim());
                    });
                } else if (shift.staffMembers && typeof shift.staffMembers === 'object' && !Array.isArray(shift.staffMembers)) {
                    Object.keys(shift.staffMembers).forEach(k => {
                        if (shift.staffMembers[k]) currentStaffIds.add(String(k).trim());
                    });
                }

                // Gather all staff candidates
                const staffUsersMap = new Map();
                allUsersList.forEach(user => {
                    const uid = String(user.id).trim();
                    const rId = parseInt(user.roleId, 10);
                    const roleName = (user.displayRole || user.role || '').toLowerCase();
                    const isLead = roleName.includes('lead');
                    const isStaff = (rId === 5 || roleName.includes('staff') || currentStaffIds.has(uid)) && !isLead;

                    if (isStaff && !staffUsersMap.has(uid)) {
                        staffUsersMap.set(uid, user);
                    }
                });

                // Ensure any ID from currentStaffIds not present in allUsersList is still represented
                currentStaffIds.forEach(staffId => {
                    if (!staffUsersMap.has(staffId)) {
                        const userInAll = allUsersList.find(u => String(u.id).trim() === staffId);
                        const isLead = userInAll && (userInAll.displayRole || userInAll.role || '').toLowerCase().includes('lead');
                        if (!isLead) {
                            staffUsersMap.set(staffId, { id: staffId, displayName: `Staff (${staffId})` });
                        }
                    }
                });

                const staffList = Array.from(staffUsersMap.values());

                // Sort so checked/selected staff appear at the top, then alphabetically
                staffList.sort((a, b) => {
                    const uidA = String(a.id).trim();
                    const uidB = String(b.id).trim();
                    const aChecked = currentStaffIds.has(uidA) ? 1 : 0;
                    const bChecked = currentStaffIds.has(uidB) ? 1 : 0;
                    if (aChecked !== bChecked) return bChecked - aChecked; // selected first
                    const nameA = (a.displayName || a.email || a.phoneNumber || a.id).toLowerCase();
                    const nameB = (b.displayName || b.email || b.phoneNumber || b.id).toLowerCase();
                    return nameA.localeCompare(nameB);
                });

                staffList.forEach(user => {
                    const uid = String(user.id).trim();
                    let displayName = user.displayName || user.email || user.phoneNumber || user.id;
                    const isChecked = currentStaffIds.has(uid);

                    if (isChecked) {
                        const mStatus = getMemberStatus(uid);
                        if (mStatus) {
                            displayName += getMemberStatusBadgeHtml(mStatus);
                        }
                    }

                    const div = document.createElement('div');
                    div.className = 'd-flex justify-content-between align-items-center mb-2 item-row';
                    div.innerHTML = `
                      <label class="form-check-label item-name" for="edit_staff_${uid}">${displayName}</label>
                      <input class="form-check-input edit-staff-checkbox" type="checkbox" value="${uid}" id="edit_staff_${uid}" ${isChecked ? 'checked' : ''}>
                    `;
                    const cb = div.querySelector('.edit-staff-checkbox');
                    if (cb && isChecked) {
                        cb.checked = true;
                    }
                    staffContainer.appendChild(div);
                });

                if (staffContainer.innerHTML === '') {
                    staffContainer.innerHTML = '<div class="text-muted small">No staff available</div>';
                }
            }

            // 8. Notes
            editShiftNotes = [];
            if (Array.isArray(shift.notes)) {
                editShiftNotes = [...shift.notes];
            } else if (typeof shift.notes === 'string' && shift.notes.trim()) {
                editShiftNotes = [shift.notes.trim()];
            }
            renderEditShiftNotes();

            validateEditShiftTime();
            const modal = new bootstrap.Modal(document.getElementById('editShiftModal'));
            modal.show();
        }
    });

    let editShiftNotes = [];

    function renderEditShiftNotes() {
        const notesList = document.getElementById('editShiftNotesList');
        if (!notesList) return;
        notesList.innerHTML = '';
        if (editShiftNotes.length === 0) {
            notesList.innerHTML = '<li class="list-group-item text-muted small py-2 text-center">No notes added</li>';
            return;
        }
        editShiftNotes.forEach((note, index) => {
            const li = document.createElement('li');
            li.className = 'list-group-item d-flex justify-content-between align-items-center py-1 px-3';

            const span = document.createElement('span');
            span.className = 'small me-2 text-break';
            span.textContent = `• ${note}`;

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'btn-close btn-close-xs ms-auto';
            removeBtn.style.fontSize = '0.65rem';
            removeBtn.setAttribute('aria-label', 'Remove note');
            removeBtn.addEventListener('click', () => {
                editShiftNotes.splice(index, 1);
                renderEditShiftNotes();
            });

            li.appendChild(span);
            li.appendChild(removeBtn);
            notesList.appendChild(li);
        });
    }

    function addEditShiftNoteItem(text) {
        const trimmed = (text || '').trim();
        if (!trimmed) return;
        editShiftNotes.push(trimmed);
        renderEditShiftNotes();
    }

    const addEditShiftNoteBtn = document.getElementById('addEditShiftNoteBtn');
    const editShiftNoteInput = document.getElementById('editShiftNoteInput');
    if (addEditShiftNoteBtn && editShiftNoteInput) {
        addEditShiftNoteBtn.addEventListener('click', () => {
            addEditShiftNoteItem(editShiftNoteInput.value);
            editShiftNoteInput.value = '';
            editShiftNoteInput.focus();
        });

        editShiftNoteInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addEditShiftNoteItem(editShiftNoteInput.value);
                editShiftNoteInput.value = '';
            }
        });
    }

    function updateEditLeadRequirement() {
        const locationInput = document.getElementById('editShiftMeetingLocation');
        const leadSearch = document.getElementById('editShiftLeadSearch');
        const leadLabel = leadSearch ? leadSearch.previousElementSibling : null;
        if (!locationInput) return;

        const isWarehouse = locationInput.value.trim().toLowerCase() === 'warehouse';
        if (isWarehouse) {
            if (leadLabel) leadLabel.textContent = 'Select Lead';
        } else {
            if (leadLabel) leadLabel.textContent = 'Select Lead (Optional)';
        }
    }

    const editShiftMeetingLocInput = document.getElementById('editShiftMeetingLocation');
    if (editShiftMeetingLocInput) {
        editShiftMeetingLocInput.addEventListener('input', updateEditLeadRequirement);
        editShiftMeetingLocInput.addEventListener('change', updateEditLeadRequirement);
    }

    function validateEditShiftTime() {
        const idInput = document.getElementById('editShiftId');
        const dateInput = document.getElementById('editShiftDate');
        const timeInput = document.getElementById('editShiftStartTime');
        const errorEl = document.getElementById('editShiftStartTimeError');

        if (!timeInput) return true;

        const currentShiftId = idInput ? idInput.value : '';
        const selectedDate = dateInput ? dateInput.value : '';
        const selectedTime = normalizeTime(timeInput.value);

        const eventNameInputs = document.querySelectorAll('.edit-event-name-input');
        const editEvents = Array.from(eventNameInputs).map(input => input.value.trim()).filter(Boolean);

        // Reset error state
        timeInput.classList.remove('is-invalid');
        timeInput.setCustomValidity('');
        if (errorEl) {
            errorEl.classList.add('d-none');
            errorEl.innerHTML = '';
        }

        if (!selectedDate || !selectedTime || editEvents.length === 0) return true;

        // Check against other shifts
        let conflictingEvent = null;
        for (const shift of allShifts) {
            if (shift.id === currentShiftId) continue;
            const shiftInfo = getShiftDateAndTime(shift);
            if (shiftInfo.dateStr === selectedDate && shiftInfo.timeStr === selectedTime) {
                const match = editEvents.find(e => shiftInfo.events.includes(e));
                if (match) {
                    conflictingEvent = match;
                    break;
                }
            }
        }

        if (conflictingEvent) {
            const formattedTime = formatTime12h(selectedTime);
            timeInput.classList.add('is-invalid');
            const message = `A shift for "${conflictingEvent}" is already scheduled at ${formattedTime} on this date. Please choose a different start time.`;
            timeInput.setCustomValidity(message);
            if (errorEl) {
                errorEl.innerHTML = `<i class="ti ti-alert-circle me-1"></i>A shift for <strong>${conflictingEvent}</strong> is already scheduled at <strong>${formattedTime}</strong> on this date. Please choose a different start time.`;
                errorEl.classList.remove('d-none');
            }
            return false;
        }

        return true;
    }

    const editShiftDateInput = document.getElementById('editShiftDate');
    if (editShiftDateInput) {
        editShiftDateInput.addEventListener('input', validateEditShiftTime);
        editShiftDateInput.addEventListener('change', validateEditShiftTime);
    }

    const editShiftStartTimeInput = document.getElementById('editShiftStartTime');
    if (editShiftStartTimeInput) {
        editShiftStartTimeInput.addEventListener('input', validateEditShiftTime);
        editShiftStartTimeInput.addEventListener('change', validateEditShiftTime);
    }

    const editShiftForm = document.getElementById('editShiftForm');
    if (editShiftForm) {
        editShiftForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('editShiftId').value;
            const currentShift = allShifts.find(s => s.id === id) || {};

            const date = document.getElementById('editShiftDate').value;

            const eventNameInputs = document.querySelectorAll('.edit-event-name-input');
            const eventTypeSelects = document.querySelectorAll('.edit-event-type-select');

            const events = [];
            const eventTypesMap = {};
            const typeValues = [];

            eventNameInputs.forEach((input, index) => {
                const eName = input.value.trim();
                if (eName) {
                    events.push(eName);
                    const tVal = eventTypeSelects[index] ? eventTypeSelects[index].value : 'Delivery';
                    eventTypesMap[eName] = tVal;
                    typeValues.push(tVal);
                }
            });
            const uniqueTypes = Array.from(new Set(typeValues));
            const role = uniqueTypes.join(', ') || 'Delivery';
            const eventName = events.join(', ') || 'Unknown Event';

            const meetingLocation = document.getElementById('editShiftMeetingLocation').value;
            const startTime = document.getElementById('editShiftStartTime').value;
            const leadRadio = document.querySelector('.edit-lead-radio:checked');
            const lead = leadRadio ? leadRadio.value : '';
            const status = document.getElementById('editShiftStatus').value;

            // Check Warehouse lead requirement
            const isWarehouse = meetingLocation.trim().toLowerCase() === 'warehouse';
            if (isWarehouse && !lead) {
                alert('Please select a Lead when Meeting Location is Warehouse.');
                return;
            }

            // Validate time conflict
            if (!validateEditShiftTime()) {
                const timeInput = document.getElementById('editShiftStartTime');
                if (timeInput) {
                    timeInput.reportValidity();
                    timeInput.focus();
                }
                return;
            }

            const staffCheckboxes = document.querySelectorAll('.edit-staff-checkbox:checked');
            const selectedStaffIds = Array.from(staffCheckboxes).map(cb => cb.value);
            if (lead && !selectedStaffIds.includes(lead)) {
                selectedStaffIds.push(lead);
            }

            const existingMembers = Array.isArray(currentShift.members) ? currentShift.members : (Array.isArray(currentShift.staffMembers) ? currentShift.staffMembers : []);
            const updatedMembers = selectedStaffIds.map(staffId => {
                const existing = existingMembers.find(m => {
                    const sid = typeof m === 'string' ? m : (m && (m.id || m.uid));
                    return sid === staffId;
                });

                const newRole = (staffId === lead) ? 'Lead' : 'Event Staff';

                if (existing && typeof existing === 'object') {
                    return { ...existing, role: existing.role && existing.role !== 'Event Staff' && staffId !== lead ? existing.role : newRole };
                }
                return { id: staffId, status: 'pending', role: newRole };
            });

            let dateTimeVal = null;
            if (date && startTime) {
                dateTimeVal = new Date(`${date}T${startTime}`);
            }

            try {
                const updatePayload = {
                    venueName: eventName,
                    dateTime: dateTimeVal,
                    dateString: date || null,
                    startTimeString: startTime || null,
                    meetingLocation,
                    role: role,
                    eventTypes: eventTypesMap,
                    eventsList: events,
                    status,
                    assignedUserId: lead || null,
                    members: updatedMembers,
                    staff: selectedStaffIds,
                    notes: editShiftNotes,
                    updatedAt: serverTimestamp()
                };

                await updateDoc(doc(db, "shifts", id), updatePayload);

                const modalEl = document.getElementById('editShiftModal');
                const modal = bootstrap.Modal.getInstance(modalEl);
                if (modal) modal.hide();
            } catch (error) {
                console.error("Error updating shift: ", error);
                alert("Failed to update shift.");
            }
        });
    }

    const confirmDeleteBtn = document.getElementById('confirmDeleteShiftBtn');
    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', async () => {
            if (!shiftToDeleteId) return;
            try {
                await deleteDoc(doc(db, "shifts", shiftToDeleteId));

                const modalEl = document.getElementById('deleteShiftModal');
                const modal = bootstrap.Modal.getInstance(modalEl);
                if (modal) modal.hide();

                shiftToDeleteId = null;
            } catch (error) {
                console.error("Error deleting shift:", error);
                alert("Failed to delete shift.");
            }
        });
    }

    // ==========================================
    // PUSH NOTIFICATION FOR UNCONFIRMED SHIFTS
    // ==========================================
    let currentPushRecipients = [];

    async function openPushNotificationModal(targetShiftId) {
        if (allUsersList.length === 0) {
            await fetchRolesAndUsers();
        }

        const isAll = targetShiftId === 'ALL_SCHEDULED';
        const targetTitle = document.getElementById('pushTargetTitle');
        const targetSubtitle = document.getElementById('pushTargetSubtitle');
        const shiftIdInput = document.getElementById('pushNotificationShiftId');
        const titleInput = document.getElementById('pushNotificationTitle');
        const bodyInput = document.getElementById('pushNotificationBody');
        const recipientsContainer = document.getElementById('pushRecipientsContainer');
        const recipientsCount = document.getElementById('pushRecipientsCount');
        const submitBtn = document.getElementById('sendPushNotificationSubmitBtn');

        if (shiftIdInput) shiftIdInput.value = targetShiftId;

        const targetUserIds = new Set();
        let defaultTitle = 'Shift Confirmation Reminder';
        let defaultBody = '';

        const isMemberUnconfirmed = (shift, uid) => {
            const arr = shift.members || shift.staffMembers || [];
            if (Array.isArray(arr)) {
                const member = arr.find(m => {
                    if (!m) return false;
                    const id = m.id || m.uid || m.userId || m.employeeId || m.staffId;
                    return String(id).trim() === String(uid).trim();
                });
                if (member && (member.status || '').toLowerCase() === 'confirmed') {
                    return false;
                }
            }
            return true;
        };

        if (isAll) {
            const unconfirmedShifts = allShifts.filter(s => (s.status || '').toLowerCase() === 'scheduled');
            unconfirmedShifts.forEach(shift => {
                if (shift.assignedUserId && isMemberUnconfirmed(shift, shift.assignedUserId)) targetUserIds.add(shift.assignedUserId);
                if (Array.isArray(shift.members)) {
                    shift.members.forEach(m => {
                        if (m && m.id && isMemberUnconfirmed(shift, m.id)) targetUserIds.add(m.id);
                    });
                } else if (Array.isArray(shift.staffMembers)) {
                    shift.staffMembers.forEach(m => {
                        if (m && m.id && isMemberUnconfirmed(shift, m.id)) targetUserIds.add(m.id);
                    });
                }
                if (Array.isArray(shift.staff)) {
                    shift.staff.forEach(id => {
                        if (id && isMemberUnconfirmed(shift, id)) targetUserIds.add(id);
                    });
                }
            });

            if (targetTitle) targetTitle.textContent = `Targeting: All Scheduled Shifts (${unconfirmedShifts.length} shifts)`;
            if (targetSubtitle) targetSubtitle.textContent = 'Sending notification to all users assigned to scheduled shifts.';
            defaultBody = 'You have one or more scheduled shifts. Please open the Vancouver PartyWorks app to review and confirm your availability.';
        } else {
            const targetShift = allShifts.find(s => s.id === targetShiftId);
            const venue = targetShift ? (targetShift.venueName || 'Upcoming Event') : 'Shift';
            let dateDisplay = 'Upcoming';
            if (targetShift && targetShift.dateTime) {
                if (typeof targetShift.dateTime.toDate === 'function') {
                    dateDisplay = targetShift.dateTime.toDate().toLocaleString();
                } else if (targetShift.dateTime.seconds) {
                    dateDisplay = new Date(targetShift.dateTime.seconds * 1000).toLocaleString();
                } else if (typeof targetShift.dateTime === 'string') {
                    dateDisplay = targetShift.dateTime;
                }
            }

            if (targetShift) {
                if (targetShift.assignedUserId && isMemberUnconfirmed(targetShift, targetShift.assignedUserId)) targetUserIds.add(targetShift.assignedUserId);
                if (Array.isArray(targetShift.members)) {
                    targetShift.members.forEach(m => {
                        if (m && m.id && isMemberUnconfirmed(targetShift, m.id)) targetUserIds.add(m.id);
                    });
                } else if (Array.isArray(targetShift.staffMembers)) {
                    targetShift.staffMembers.forEach(m => {
                        if (m && m.id && isMemberUnconfirmed(targetShift, m.id)) targetUserIds.add(m.id);
                    });
                }
                if (Array.isArray(targetShift.staff)) {
                    targetShift.staff.forEach(id => {
                        if (id && isMemberUnconfirmed(targetShift, id)) targetUserIds.add(id);
                    });
                }
            }

            if (targetTitle) targetTitle.textContent = `Targeting: ${venue}`;
            if (targetSubtitle) targetSubtitle.textContent = `Date: ${dateDisplay} | Meeting Location: ${targetShift ? (targetShift.meetingLocation || 'N/A') : 'N/A'}`;
            defaultBody = `You have a scheduled shift at ${venue} on ${dateDisplay}. Please open the PartyWorks app to confirm your shift.`;
        }

        if (titleInput) titleInput.value = defaultTitle;
        if (bodyInput) bodyInput.value = defaultBody;

        // Resolve recipients
        currentPushRecipients = [];
        targetUserIds.forEach(uid => {
            const foundUser = allUsersList.find(u => u.id === uid);
            if (foundUser) {
                currentPushRecipients.push(foundUser);
            } else {
                currentPushRecipients.push({
                    id: uid,
                    displayName: `Staff User (${uid.substring(0, 6)}...)`,
                    displayRole: 'Staff Member',
                    email: '',
                    phoneNumber: ''
                });
            }
        });

        if (recipientsCount) recipientsCount.textContent = currentPushRecipients.length;

        if (recipientsContainer) {
            recipientsContainer.innerHTML = '';
            if (currentPushRecipients.length === 0) {
                recipientsContainer.innerHTML = `
                    <div class="alert alert-warning small mb-0 py-2">
                        <i class="ti ti-alert-triangle me-1"></i> No staff members are currently assigned to this shift. Please edit the shift to assign staff first.
                    </div>`;
                if (submitBtn) submitBtn.disabled = true;
            } else {
                if (submitBtn) submitBtn.disabled = false;
                currentPushRecipients.forEach(user => {
                    const row = document.createElement('div');
                    row.className = 'd-flex justify-content-between align-items-center p-2 mb-1 rounded border bg-white';

                    const name = user.displayName || user.email || user.phoneNumber || user.id;
                    const role = user.displayRole || user.role || 'Staff';
                    const contact = user.email || user.phoneNumber || 'No contact info';

                    row.innerHTML = `
                        <div class="d-flex align-items-center gap-2 text-truncate">
                            <div class="avatar avatar-xs rounded-circle bg-primary-subtle text-primary fw-bold text-center d-flex align-items-center justify-content-center" style="width: 32px; height: 32px; font-size: 0.8rem; flex-shrink: 0;">
                                ${(name[0] || 'U').toUpperCase()}
                            </div>
                            <div class="text-truncate">
                                <div class="fw-semibold text-dark small text-truncate">${name}</div>
                                <div class="text-muted small" style="font-size: 0.75rem;">${role} &bull; ${contact}</div>
                            </div>
                        </div>
                    `;
                    recipientsContainer.appendChild(row);
                });
            }
        }

        const modalEl = document.getElementById('sendPushNotificationModal');
        if (modalEl) {
            const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
            modal.show();
        }
    }


    function showNotificationToast(msg, isSuccess = true) {
        const toastEl = document.getElementById('pushNotificationToast');
        const toastText = document.getElementById('pushNotificationToastText');
        if (toastEl) {
            toastEl.className = `toast align-items-center text-bg-${isSuccess ? 'success' : 'danger'} border-0`;
            if (toastText) toastText.textContent = msg;
            const toast = bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 4500 });
            toast.show();
        }
    }

    const sendPushForm = document.getElementById('sendPushNotificationForm');
    if (sendPushForm) {
        sendPushForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = document.getElementById('sendPushNotificationSubmitBtn');
            const btnText = document.getElementById('sendPushNotificationBtnText');
            const shiftId = document.getElementById('pushNotificationShiftId').value;
            const title = document.getElementById('pushNotificationTitle').value.trim();
            const body = document.getElementById('pushNotificationBody').value.trim();

            if (!currentPushRecipients || currentPushRecipients.length === 0) {
                alert('No assigned staff found to send push notification.');
                return;
            }

            if (submitBtn) submitBtn.disabled = true;
            if (btnText) btnText.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span> Sending...';

            try {
                const recipientIds = currentPushRecipients.map(u => u.id);
                const isAll = shiftId === 'ALL_SCHEDULED';
                const targetShift = !isAll ? allShifts.find(s => s.id === shiftId) : null;
                const venueName = isAll ? 'All Scheduled Shifts' : (targetShift ? (targetShift.venueName || 'Shift') : 'Shift Reminder');

                // 1. Create document in pushNotifications collection (triggers Cloud Function for FCM delivery)
                await addDoc(collection(db, "pushNotifications"), {
                    type: "shift_reminder",
                    shiftId: shiftId,
                    venueName: venueName,
                    recipientUserIds: recipientIds,
                    recipientCount: recipientIds.length,
                    title: title,
                    body: body,
                    status: "pending",
                    sentByEmail: auth.currentUser ? auth.currentUser.email : "admin",
                    sentByName: auth.currentUser ? (auth.currentUser.displayName || auth.currentUser.email) : "Admin",
                    createdAt: serverTimestamp()
                });

                // 2. Also log in-app notification for each recipient user
                for (const userId of recipientIds) {
                    try {
                        await addDoc(collection(db, "users", userId, "notifications"), {
                            title: title,
                            body: body,
                            type: "shift_confirmation",
                            shiftId: shiftId,
                            venueName: venueName,
                            read: false,
                            createdAt: serverTimestamp()
                        });
                    } catch (subErr) {
                        console.warn("Could not write in-app notification for user:", userId, subErr);
                    }
                }

                const modalEl = document.getElementById('sendPushNotificationModal');
                if (modalEl) {
                    const modal = bootstrap.Modal.getInstance(modalEl);
                    if (modal) modal.hide();
                }

                showNotificationToast(`Push notification sent successfully to ${recipientIds.length} user(s)!`);
            } catch (error) {
                console.error("Error sending push notification:", error);
                showNotificationToast(`Failed to send push notification: ${error.message}`, false);
            } finally {
                if (submitBtn) submitBtn.disabled = false;
                if (btnText) btnText.textContent = 'Send Push Notification';
            }
        });
    }

    loadShifts();

    // Search functionality for Leads and Staff
    function attachSearchListener(searchInputId, containerId) {
        const searchInput = document.getElementById(searchInputId);
        if (searchInput) {
            searchInput.addEventListener('input', function () {
                const query = this.value.toLowerCase();
                const container = document.getElementById(containerId);
                if (container) {
                    const rows = container.querySelectorAll('.item-row');
                    let anyVisible = false;
                    rows.forEach(row => {
                        const nameLabel = row.querySelector('.item-name');
                        if (nameLabel) {
                            const nameText = nameLabel.textContent.toLowerCase();
                            if (nameText.includes(query)) {
                                row.classList.remove('d-none');
                                anyVisible = true;
                            } else {
                                row.classList.add('d-none');
                            }
                        }
                    });

                    let noResultsMsg = container.querySelector('.no-results-msg');
                    if (!anyVisible && rows.length > 0) {
                        if (!noResultsMsg) {
                            noResultsMsg = document.createElement('div');
                            noResultsMsg.className = 'text-muted small text-center py-2 no-results-msg';
                            noResultsMsg.textContent = 'No results found';
                            container.appendChild(noResultsMsg);
                        }
                    } else if (noResultsMsg) {
                        noResultsMsg.remove();
                    }
                }
            });
        }
    }

    attachSearchListener('shiftLeadSearch', 'shiftLeadContainer');
    attachSearchListener('shiftStaffSearch', 'shiftStaffContainer');
    attachSearchListener('editShiftLeadSearch', 'editShiftLeadContainer');
    attachSearchListener('editShiftStaffSearch', 'editShiftStaffContainer');
});
