import * as bootstrap from 'bootstrap';
import { db } from './firebase-client.js';
import { collection, onSnapshot, addDoc, serverTimestamp, updateDoc, doc, deleteDoc, getDocs } from 'firebase/firestore';

document.addEventListener('DOMContentLoaded', () => {
    const shiftsTableBody = document.getElementById('shiftsTableBody');
    const addShiftForm = document.getElementById('addShiftForm');

    let allUsersList = [];
    let allShifts = [];
    let availableRoles = [];

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

    async function fetchIOEvents() {
        const apiKey = import.meta.env.VITE_IO_API_KEY;
        const apiUrl = `/io-api/leads/?apiKey=${apiKey}&_body=true`;
        console.log("Fetching IO Events from URL:", apiUrl);
        
        const container = document.getElementById('shiftEventContainer');
        container.innerHTML = '<div class="text-muted small">Loading events...</div>';
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

            // Some events might have an empty eventname, fallback to organization or ID
            const validLeads = leads.filter(l => {
                if (!l || typeof l !== 'object' || !l.id) return false;
                const displayName = l.eventname || l.eventorganization || `Lead #${l.id}`;
                return !assignedEvents.has(displayName);
            });
            
            if (validLeads.length === 0) {
                container.innerHTML = '<div class="text-muted small">No events found (or all events are already assigned).</div>';
                return;
            }

            container.innerHTML = '';
            validLeads.forEach(lead => {
                const id = `event_${lead.id || Math.random().toString(36).substr(2, 9)}`;
                const displayName = lead.eventname || lead.eventorganization || `Lead #${lead.id}`;
                
                const div = document.createElement('div');
                div.className = 'd-flex justify-content-between align-items-center mb-2';
                div.innerHTML = `
                  <label class="form-check-label" for="${id}">${displayName}</label>
                  <input class="form-check-input event-checkbox" type="checkbox" value="${displayName}" id="${id}">
                `;
                container.appendChild(div);
            });
        } catch (error) {
            console.error("Error fetching IO events:", error);
            container.innerHTML = `<div class="text-danger small">Failed to load events: ${error.message}</div>`;
        }
    }

    function loadShifts() {
        if (!db) {
            shiftsTableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">No shifts found.</td></tr>`;
            return;
        }

        onSnapshot(collection(db, "shifts"), (querySnapshot) => {
            shiftsTableBody.innerHTML = '';
            allShifts = [];
            
            if (querySnapshot.empty) {
                shiftsTableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">No shifts found.</td></tr>`;
                return;
            }

            querySnapshot.forEach((docSnap) => {
                const shift = docSnap.data();
                allShifts.push({ id: docSnap.id, ...shift });
                
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

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${venue}</td>
                    <td>${dateDisplay}</td>
                    <td>${loc}</td>
                    <td>${role}</td>
                    <td>${status}</td>
                    <td class="text-end">
                        <button class="btn btn-sm btn-outline-secondary edit-shift-btn"
                            data-id="${docSnap.id}"
                            data-venue="${venue}"
                            data-date="${dateValue}"
                            data-location="${loc}"
                            data-role="${role}"
                            data-status="${status}"
                            data-assigned="${assigned}">
                            <i class="ti ti-edit"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger delete-shift-btn ms-1"
                            data-id="${docSnap.id}">
                            <i class="ti ti-trash"></i>
                        </button>
                    </td>
                `;
                shiftsTableBody.appendChild(tr);
            });
        }, (error) => {
            console.error("Error loading shifts: ", error);
            shiftsTableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-danger">Error loading shifts.</td></tr>`;
        });
    }

    const addShiftModalEl = document.getElementById('addShiftModal');
    if (addShiftModalEl) {
        addShiftModalEl.addEventListener('show.bs.modal', async () => {
            fetchIOEvents(); // Fetch API events dynamically
            if (allUsersList.length === 0) {
                await fetchRolesAndUsers();
            }
            
            const leadSelect = document.getElementById('shiftLead');
            const staffContainer = document.getElementById('shiftStaffContainer');
            
            leadSelect.innerHTML = '<option value="" disabled selected>Select Lead...</option>';
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
            const events = Array.from(eventCheckboxes).map(cb => cb.value);
            const meetingLocation = document.getElementById('shiftMeetingLocation').value;
            const selector = document.getElementById('shiftSelector').value;
            const startTime = document.getElementById('shiftStartTime').value;
            const lead = document.getElementById('shiftLead').value;
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
                    notes: [],
                    outsideGeoFence: false,
                    role: selector,
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
            } catch (error) {
                console.error("Error adding shift: ", error);
                alert("Failed to add shift.");
            }
        });
    }

    let shiftToDeleteId = null;

    shiftsTableBody.addEventListener('click', async (e) => {
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

    loadShifts();
});
