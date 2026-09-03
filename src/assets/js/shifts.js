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
                    const notifyUnconfirmedBtn = document.getElementById('notifyUnconfirmedBtn');
                    if (notifyUnconfirmedBtn && canManageShifts) {
                        notifyUnconfirmedBtn.classList.remove('d-none');
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
            const apiUrl = `/io-api/leads/?apiKey=${apiKey}&_body=true`;
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

        // Only validate if date, time, and at least one event are chosen
        if (!selectedDate || !selectedTime || checkedEvents.length === 0) {
            return true;
        }

        // Check if any checked event already has a shift on this date with the same start time
        let conflictingEvent = null;
        for (const shift of allShifts) {
            const shiftInfo = getShiftDateAndTime(shift);
            if (shiftInfo.dateStr === selectedDate && shiftInfo.timeStr === selectedTime) {
                const match = checkedEvents.find(eventName => shiftInfo.events.includes(eventName));
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

            const isAllowedType = dt.includes('fully staffed') || 
                                  dt.includes('partyworks') || 
                                  dt.includes('drop-off') || 
                                  dt.includes('drop off');
            if (!isAllowedType) return false;

            const rawStart = lead.eventstarttime || lead.fullstart || lead.cushstart || lead.createtime || '';
            const startDate = typeof rawStart === 'string' ? rawStart.split('T')[0] : '';
            
            const rawEnd = lead.eventendtime || lead.fullend || lead.cushend || rawStart;
            const endDate = typeof rawEnd === 'string' ? rawEnd.split('T')[0] : startDate;

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
                  <option value="Setup">Setup</option>
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
        searchInput.addEventListener('input', renderShiftsTable);
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

        if (filteredShifts.length === 0) {
            shiftsTableBody.innerHTML = `<tr><td colspan="${canManageShifts ? 6 : 5}" class="text-center py-4 text-muted">No shifts found.</td></tr>`;
            return;
        }

        filteredShifts.forEach((shift) => {
            const venue = shift.venueName || 'N/A';
            const loc = shift.meetingLocation || 'N/A';
            const role = shift.role || 'N/A';
            const status = shift.status || 'unconfirmed';
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

            const isUnconfirmed = (status || '').toLowerCase() === 'unconfirmed';
            const notifyBtn = (canManageShifts && isUnconfirmed) ? `
                <button class="btn btn-sm btn-outline-primary notify-shift-btn me-1"
                    data-id="${shift.id}"
                    data-venue="${venue}"
                    data-date="${dateDisplay}"
                    data-location="${loc}"
                    title="Send push notification to unconfirmed users">
                    <i class="ti ti-bell-ringing"></i>
                </button>` : '';

            const actionCell = canManageShifts ? `
                <td class="text-end text-nowrap">
                    ${notifyBtn}
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
                    </button>
                    <button class="btn btn-sm btn-outline-danger delete-shift-btn ms-1"
                        data-id="${shift.id}"
                        title="Delete Shift">
                        <i class="ti ti-trash"></i>
                    </button>
                </td>` : '';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${venue}</td>
                <td>${dateDisplay}</td>
                <td>${loc}</td>
                <td>${role}</td>
                <td>${formatStatusDisplay(status)}</td>
                ${actionCell}
            `;
            shiftsTableBody.appendChild(tr);
        });
    }

    function formatStatusDisplay(statusStr) {
        if (!statusStr) return 'Un Confirmed';
        const s = String(statusStr).trim().toLowerCase();
        if (s === 'confirmed') return 'Confirmed';
        if (s === 'unconfirmed') return 'Un Confirmed';
        return statusStr.charAt(0).toUpperCase() + statusStr.slice(1);
    }

    function loadShifts() {
        if (!db) {
            shiftsTableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">No shifts found.</td></tr>`;
            return;
        }

        onSnapshot(collection(db, "shifts"), (querySnapshot) => {
            allShifts = [];
            querySnapshot.forEach((docSnap) => {
                const shift = docSnap.data();
                allShifts.push({ id: docSnap.id, ...shift });
            });
            renderShiftsTable();
        }, (error) => {
            console.error("Error loading shifts: ", error);
            shiftsTableBody.innerHTML = `<tr><td colspan="${canManageShifts ? 6 : 5}" class="text-center py-4 text-danger">Error loading shifts.</td></tr>`;
        });
    }

    function updateLeadRequirement() {
        const locationInput = document.getElementById('shiftMeetingLocation');
        const leadSelect = document.getElementById('shiftLead');
        const leadLabel = document.querySelector('label[for="shiftLead"]');
        if (!locationInput || !leadSelect) return;

        const isWarehouse = locationInput.value.trim().toLowerCase() === 'warehouse';
        if (isWarehouse) {
            leadSelect.setAttribute('required', '');
            leadSelect.required = true;
            if (leadLabel) leadLabel.textContent = 'Select Lead';
            if (leadSelect.options && leadSelect.options.length > 0 && leadSelect.options[0].value === '') {
                leadSelect.options[0].text = 'Select Lead...';
            }
        } else {
            leadSelect.removeAttribute('required');
            leadSelect.required = false;
            leadSelect.setCustomValidity('');
            if (leadLabel) leadLabel.textContent = 'Select Lead (Optional)';
            if (leadSelect.options && leadSelect.options.length > 0 && leadSelect.options[0].value === '') {
                leadSelect.options[0].text = 'Select Lead (Optional)...';
            }
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

            const leadSelect = document.getElementById('shiftLead');
            const staffContainer = document.getElementById('shiftStaffContainer');
            
            leadSelect.innerHTML = '<option value="" selected>Select Lead...</option>';
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
                    const opt = document.createElement('option');
                    opt.value = user.id;
                    opt.textContent = displayName;
                    leadSelect.appendChild(opt);
                }
                const rId = parseInt(user.roleId, 10);
                // Only show users with roleId 5 in the staff list
                if (rId === 5 && !assignedLeads.has(user.id) && !assignedStaff.has(user.id)) {
                    const div = document.createElement('div');
                    div.className = 'd-flex justify-content-between align-items-center mb-2';
                    div.innerHTML = `
                      <label class="form-check-label" for="staff_${user.id}">${displayName}</label>
                      <input class="form-check-input staff-checkbox" type="checkbox" value="${user.id}" id="staff_${user.id}">
                    `;
                    staffContainer.appendChild(div);
                }
            });
            
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
            const leadSelect = document.getElementById('shiftLead');
            const lead = leadSelect.value;

            if (isWarehouse && !lead) {
                leadSelect.setCustomValidity('Please select a Lead when Meeting Location is Warehouse.');
                leadSelect.reportValidity();
                return;
            } else {
                leadSelect.setCustomValidity('');
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

            let dateTimeVal = null;
            if (date && startTime) {
                dateTimeVal = new Date(`${date}T${startTime}`);
            }

            try {
                const staffMembers = staff.map(id => ({ id: id, status: 'pending' }));

                await addDoc(collection(db, "shifts"), {
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
                    staffMembers: staffMembers,
                    status: 'confirmed',
                    venueName: events.join(', ') || 'No Event Selected',
                    
                    // Preserving exact string inputs from UI for fallback/reference
                    dateString: date,
                    startTimeString: startTime,
                    eventsList: events,
                });
                
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

            // 2. Event Name (disabled)
            const eventNameInput = document.getElementById('editShiftEventName');
            const eventName = shift.venueName || (Array.isArray(shift.eventsList) ? shift.eventsList.join(', ') : editBtn.dataset.venue || '');
            if (eventNameInput) eventNameInput.value = eventName;

            // 3. Type (Dropdown of all event types)
            const currentType = shift.role || editBtn.dataset.role || 'Delivery';
            const typeSelect = document.getElementById('editShiftType');
            if (typeSelect) {
                if (!Array.from(typeSelect.options).some(opt => opt.value === currentType)) {
                    typeSelect.add(new Option(currentType, currentType));
                }
                typeSelect.value = currentType;
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

            // 6. Lead (Load all leads)
            const leadSelect = document.getElementById('editShiftLead');
            if (leadSelect) {
                leadSelect.innerHTML = '<option value="">Select Lead...</option>';
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
                    const displayName = user.displayName || user.email || user.phoneNumber || user.id;
                    const opt = document.createElement('option');
                    opt.value = uid;
                    opt.textContent = displayName;
                    if (uid === currentLeadId) opt.selected = true;
                    leadSelect.appendChild(opt);
                });

                if (currentLeadId) {
                    leadSelect.value = currentLeadId;
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

                if (Array.isArray(shift.staffMembers)) shift.staffMembers.forEach(addCandidateId);
                if (Array.isArray(shift.staff)) shift.staff.forEach(addCandidateId);
                if (Array.isArray(shift.staffList)) shift.staffList.forEach(addCandidateId);
                if (Array.isArray(shift.assignedStaff)) shift.assignedStaff.forEach(addCandidateId);
                if (Array.isArray(shift.assignedUsers)) shift.assignedUsers.forEach(addCandidateId);
                if (shift.staffMembers && typeof shift.staffMembers === 'object' && !Array.isArray(shift.staffMembers)) {
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
                    const isStaff = rId === 5 || roleName.includes('staff') || currentStaffIds.has(uid);

                    if (isStaff && !staffUsersMap.has(uid)) {
                        staffUsersMap.set(uid, user);
                    }
                });

                // Ensure any ID from currentStaffIds not present in allUsersList is still represented
                currentStaffIds.forEach(staffId => {
                    if (!staffUsersMap.has(staffId)) {
                        staffUsersMap.set(staffId, { id: staffId, displayName: `Staff (${staffId})` });
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
                    const displayName = user.displayName || user.email || user.phoneNumber || user.id;
                    const isChecked = currentStaffIds.has(uid);

                    const div = document.createElement('div');
                    div.className = 'd-flex justify-content-between align-items-center mb-2';
                    div.innerHTML = `
                      <label class="form-check-label" for="edit_staff_${uid}">${displayName}</label>
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
        const leadSelect = document.getElementById('editShiftLead');
        const leadLabel = document.querySelector('label[for="editShiftLead"]');
        if (!locationInput || !leadSelect) return;

        const isWarehouse = locationInput.value.trim().toLowerCase() === 'warehouse';
        if (isWarehouse) {
            leadSelect.setAttribute('required', '');
            leadSelect.required = true;
            if (leadLabel) leadLabel.textContent = 'Select Lead';
            if (leadSelect.options && leadSelect.options.length > 0 && leadSelect.options[0].value === '') {
                leadSelect.options[0].text = 'Select Lead...';
            }
        } else {
            leadSelect.removeAttribute('required');
            leadSelect.required = false;
            leadSelect.setCustomValidity('');
            if (leadLabel) leadLabel.textContent = 'Select Lead (Optional)';
            if (leadSelect.options && leadSelect.options.length > 0 && leadSelect.options[0].value === '') {
                leadSelect.options[0].text = 'Select Lead (Optional)...';
            }
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
        const eventNameInput = document.getElementById('editShiftEventName');
        const errorEl = document.getElementById('editShiftStartTimeError');

        if (!timeInput) return true;

        const currentShiftId = idInput ? idInput.value : '';
        const selectedDate = dateInput ? dateInput.value : '';
        const selectedTime = normalizeTime(timeInput.value);
        const eventName = eventNameInput ? eventNameInput.value.trim() : '';

        // Reset error state
        timeInput.classList.remove('is-invalid');
        timeInput.setCustomValidity('');
        if (errorEl) {
            errorEl.classList.add('d-none');
            errorEl.innerHTML = '';
        }

        if (!selectedDate || !selectedTime || !eventName) return true;

        // Extract events for current shift
        const currentShift = allShifts.find(s => s.id === currentShiftId);
        let editEvents = [];
        if (currentShift && Array.isArray(currentShift.eventsList) && currentShift.eventsList.length > 0) {
            editEvents = [...currentShift.eventsList];
        } else {
            editEvents = eventName.split(',').map(s => s.trim()).filter(Boolean);
        }
        eventName.split(',').map(s => s.trim()).filter(Boolean).forEach(e => {
            if (!editEvents.includes(e)) editEvents.push(e);
        });

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
            const eventName = document.getElementById('editShiftEventName').value;
            const typeVal = document.getElementById('editShiftType').value;
            const meetingLocation = document.getElementById('editShiftMeetingLocation').value;
            const startTime = document.getElementById('editShiftStartTime').value;
            const leadSelect = document.getElementById('editShiftLead');
            const lead = leadSelect ? leadSelect.value : '';
            const status = document.getElementById('editShiftStatus').value;

            // Check Warehouse lead requirement
            const isWarehouse = meetingLocation.trim().toLowerCase() === 'warehouse';
            if (isWarehouse && !lead) {
                if (leadSelect) {
                    leadSelect.setCustomValidity('Please select a Lead when Meeting Location is Warehouse.');
                    leadSelect.reportValidity();
                }
                return;
            } else if (leadSelect) {
                leadSelect.setCustomValidity('');
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

            const existingStaffMembers = Array.isArray(currentShift.staffMembers) ? currentShift.staffMembers : [];
            const updatedStaffMembers = selectedStaffIds.map(staffId => {
                const existing = existingStaffMembers.find(m => {
                    const sid = typeof m === 'string' ? m : (m && (m.id || m.uid));
                    return sid === staffId;
                });
                if (existing && typeof existing === 'object') {
                    return existing;
                }
                return { id: staffId, status: 'pending' };
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
                    role: typeVal,
                    status,
                    assignedUserId: lead || null,
                    staffMembers: updatedStaffMembers,
                    staff: selectedStaffIds,
                    notes: editShiftNotes,
                    updatedAt: serverTimestamp()
                };

                if (currentShift.eventTypes && typeof currentShift.eventTypes === 'object') {
                    const updatedEventTypes = { ...currentShift.eventTypes };
                    if (eventName) {
                        eventName.split(',').map(s => s.trim()).filter(Boolean).forEach(ev => {
                            updatedEventTypes[ev] = typeVal;
                        });
                    }
                    updatePayload.eventTypes = updatedEventTypes;
                }

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

        const isAll = targetShiftId === 'ALL_UNCONFIRMED';
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

        if (isAll) {
            const unconfirmedShifts = allShifts.filter(s => (s.status || '').toLowerCase() === 'unconfirmed');
            unconfirmedShifts.forEach(shift => {
                if (shift.assignedUserId) targetUserIds.add(shift.assignedUserId);
                if (Array.isArray(shift.staffMembers)) {
                    shift.staffMembers.forEach(m => {
                        if (m && m.id) targetUserIds.add(m.id);
                    });
                }
                if (Array.isArray(shift.staff)) {
                    shift.staff.forEach(id => {
                        if (id) targetUserIds.add(id);
                    });
                }
            });

            if (targetTitle) targetTitle.textContent = `Targeting: All Unconfirmed Shifts (${unconfirmedShifts.length} shifts)`;
            if (targetSubtitle) targetSubtitle.textContent = 'Sending notification to all users assigned to unconfirmed shifts.';
            defaultBody = 'You have one or more unconfirmed shifts scheduled. Please open the Vancouver PartyWorks app to review and confirm your availability.';
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
                if (targetShift.assignedUserId) targetUserIds.add(targetShift.assignedUserId);
                if (Array.isArray(targetShift.staffMembers)) {
                    targetShift.staffMembers.forEach(m => {
                        if (m && m.id) targetUserIds.add(m.id);
                    });
                }
                if (Array.isArray(targetShift.staff)) {
                    targetShift.staff.forEach(id => {
                        if (id) targetUserIds.add(id);
                    });
                }
            }

            if (targetTitle) targetTitle.textContent = `Targeting: ${venue}`;
            if (targetSubtitle) targetSubtitle.textContent = `Date: ${dateDisplay} | Meeting Location: ${targetShift ? (targetShift.meetingLocation || 'N/A') : 'N/A'}`;
            defaultBody = `You have an unconfirmed shift at ${venue} on ${dateDisplay}. Please open the PartyWorks app to confirm your shift.`;
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

    const notifyUnconfirmedBtn = document.getElementById('notifyUnconfirmedBtn');
    if (notifyUnconfirmedBtn) {
        notifyUnconfirmedBtn.addEventListener('click', () => {
            openPushNotificationModal('ALL_UNCONFIRMED');
        });
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
                const isAll = shiftId === 'ALL_UNCONFIRMED';
                const targetShift = !isAll ? allShifts.find(s => s.id === shiftId) : null;
                const venueName = isAll ? 'All Unconfirmed Shifts' : (targetShift ? (targetShift.venueName || 'Shift') : 'Shift Reminder');

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
});
