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

    function renderEventOptions() {
        const container = document.getElementById('shiftEventContainer');
        if (!container) return;

        const shiftDateInput = document.getElementById('shiftDate');
        const selectedDate = shiftDateInput ? shiftDateInput.value : '';

        if (!selectedDate) {
            container.innerHTML = '<div class="text-muted small">Please select a date to view events.</div>';
            return;
        }

        if (cachedIOLeads === null) {
            container.innerHTML = '<div class="text-muted small">Loading events...</div>';
            return;
        }

        // Gather assigned events
        const assignedEvents = new Set();
        allShifts.forEach(shift => {
            if (shift.eventsList && Array.isArray(shift.eventsList)) {
                shift.eventsList.forEach(e => assignedEvents.add(e));
            } else if (shift.venueName) {
                // Fallback for older shifts
                shift.venueName.split(',').map(s => s.trim()).forEach(e => assignedEvents.add(e));
            }
        });

        // Filter leads matching the selected date, delivery type, and not already assigned
        const validLeads = cachedIOLeads.filter(lead => {
            const displayName = lead.eventname || lead.eventorganization || `Lead #${lead.id}`;
            if (assignedEvents.has(displayName)) return false;

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
            return;
        }

        container.innerHTML = '';
        validLeads.forEach(lead => {
            const id = `event_${lead.id || Math.random().toString(36).substr(2, 9)}`;
            const displayName = lead.eventname || lead.eventorganization || `Lead #${lead.id}`;
            
            const div = document.createElement('div');
            div.className = 'd-flex justify-content-between align-items-center p-2 mb-2 rounded border bg-white event-row';
            div.dataset.event = displayName;
            div.innerHTML = `
              <div class="form-check me-2 flex-grow-1 text-truncate" style="max-width: 62%;">
                <input class="form-check-input event-checkbox" type="checkbox" value="${displayName}" id="${id}">
                <label class="form-check-label fw-medium text-dark text-truncate ms-1" for="${id}" title="${displayName}">
                  ${displayName}
                </label>
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
                });
            }
            container.appendChild(div);
        });
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
                <td>${status}</td>
                ${actionCell}
            `;
            shiftsTableBody.appendChild(tr);
        });
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
            document.getElementById('editShiftId').value = editBtn.dataset.id;
            document.getElementById('editShiftVenueName').value = editBtn.dataset.venue;
            document.getElementById('editShiftDateTime').value = editBtn.dataset.date;
            document.getElementById('editShiftMeetingLocation').value = editBtn.dataset.location;
            document.getElementById('editShiftRole').value = editBtn.dataset.role;
            document.getElementById('editShiftAssignedUserId').value = editBtn.dataset.assigned;
            
            const statusSelect = document.getElementById('editShiftStatus');
            if (!Array.from(statusSelect.options).some(opt => opt.value === editBtn.dataset.status)) {
                 statusSelect.add(new Option(editBtn.dataset.status, editBtn.dataset.status));
            }
            statusSelect.value = editBtn.dataset.status;

            const modal = new bootstrap.Modal(document.getElementById('editShiftModal'));
            modal.show();
        }
    });

    const editShiftForm = document.getElementById('editShiftForm');
    if (editShiftForm) {
        editShiftForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('editShiftId').value;
            const venueName = document.getElementById('editShiftVenueName').value;
            const dateTimeVal = document.getElementById('editShiftDateTime').value;
            const meetingLocation = document.getElementById('editShiftMeetingLocation').value;
            const role = document.getElementById('editShiftRole').value;
            const status = document.getElementById('editShiftStatus').value;
            const assignedUserId = document.getElementById('editShiftAssignedUserId').value;

            try {
                await updateDoc(doc(db, "shifts", id), {
                    venueName,
                    dateTime: dateTimeVal ? new Date(dateTimeVal) : null,
                    meetingLocation,
                    role,
                    status,
                    assignedUserId,
                    updatedAt: serverTimestamp()
                });
                
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
