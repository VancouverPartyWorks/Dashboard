import sys

with open('/Users/hamza/VancouverPartyWorksAdmin/src/assets/js/events.js', 'r') as f:
    content = f.read()

# 1. Add setupForms array
content = content.replace(
"""    let allShifts = [];
    let supervisorReports = [];
    let firebaseEvents = []; // Unique events extracted from Firebase""",
"""    let allShifts = [];
    let supervisorReports = [];
    let setupForms = [];
    let firebaseEvents = []; // Unique events extracted from Firebase"""
)

# 2. Add forms listener
content = content.replace(
"""        onSnapshot(collection(db, "supervisorReports"), (snapshot) => {
            supervisorReports = [];
            snapshot.forEach(docSnap => {
                supervisorReports.push({ id: docSnap.id, ...docSnap.data() });
            });
            buildFirebaseEvents();
        }, (error) => {
            console.error("Error loading supervisorReports:", error);
        });
    }""",
"""        onSnapshot(collection(db, "supervisorReports"), (snapshot) => {
            supervisorReports = [];
            snapshot.forEach(docSnap => {
                supervisorReports.push({ id: docSnap.id, ...docSnap.data() });
            });
            buildFirebaseEvents();
        }, (error) => {
            console.error("Error loading supervisorReports:", error);
        });

        onSnapshot(collection(db, "forms"), (snapshot) => {
            setupForms = [];
            snapshot.forEach(docSnap => {
                setupForms.push({ id: docSnap.id, ...docSnap.data() });
            });
            buildFirebaseEvents();
        }, (error) => {
            console.error("Error loading setup forms:", error);
        });
    }"""
)

# 3. Match forms with shifts
content = content.replace(
"""                // 2. Setup Form submission
                if (shift.setupFormSubmitted || shift.setupForm || shift.formData || shift.checklist) {
                    ev.submissions.setupFormSubmitted = true;
                    if (!ev.submissions.setupForm) {
                        ev.submissions.setupForm = shift.setupForm || shift.formData || shift.checklist;
                    }
                    if (shift.assignedUserId) {
                        ev.submissions.setupFormLeadId = shift.assignedUserId;
                    }
                }""",
"""                // 2. Setup Form submission
                const shiftForm = setupForms.find(f => f.shiftId === shift.id);

                if (shiftForm || shift.setupFormSubmitted || shift.setupForm || shift.formData || shift.checklist) {
                    ev.submissions.setupFormSubmitted = true;
                    if (shiftForm) {
                        ev.submissions.setupForm = shiftForm;
                    } else if (!ev.submissions.setupForm) {
                        ev.submissions.setupForm = shift.setupForm || shift.formData || shift.checklist;
                    }
                    if (shift.assignedUserId) {
                        ev.submissions.setupFormLeadId = shift.assignedUserId;
                    }
                }"""
)

# 4. Enhance renderFormData
content = content.replace(
"""        // Object with key-values
        let rows = '';
        for (const [key, val] of Object.entries(formData)) {
            const formattedKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
            let valDisplay = val;
            if (typeof val === 'boolean') {
                valDisplay = val ? '<span class="badge bg-success">Yes</span>' : '<span class="badge bg-secondary">No</span>';
            } else if (typeof val === 'object' && val !== null) {
                valDisplay = JSON.stringify(val);
            } else {
                valDisplay = escapeHtml(String(val));
            }

            rows += `
                <tr>
                    <td class="fw-semibold text-muted small py-2" style="width: 35%;">${escapeHtml(formattedKey)}</td>
                    <td class="small py-2">${valDisplay}</td>
                </tr>
            `;
        }""",
"""        // Object with key-values
        let rows = '';
        
        // Skip unneeded metadata keys for display
        const skipKeys = ['createdAt', 'updatedAt', 'formType', 'shiftId', 'id', 'submittedBy'];
        
        for (const [key, val] of Object.entries(formData)) {
            if (skipKeys.includes(key) || val === null) continue;
            
            const formattedKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
            let valDisplay = val;
            if (typeof val === 'boolean') {
                valDisplay = val ? '<span class="badge bg-success">Yes</span>' : '<span class="badge bg-secondary">No</span>';
            } else if (Array.isArray(val)) {
                if (val.length === 0) {
                    valDisplay = '<span class="text-muted small">None</span>';
                } else if (key === 'inspectionItems' || key === 'inflatableGamesItems' || key === 'accessoriesItems') {
                    let itemsHtml = '<ul class="list-group list-group-flush mb-0">';
                    val.forEach((item, idx) => {
                        const area = item.inspectedArea || `Item #${idx+1}`;
                        const status = item.status || item.supervisorInitials || 'Done';
                        let badgeClass = 'bg-success';
                        if (status.toLowerCase() === 'no') badgeClass = 'bg-danger';
                        else if (status.toLowerCase() === 'n/a' || status.toLowerCase() === 'na') badgeClass = 'bg-secondary';
                        
                        let itemContent = `
                            <div class="d-flex w-100 justify-content-between align-items-center">
                                <span class="small fw-semibold me-2">${escapeHtml(area)}</span>
                                <span class="badge ${badgeClass}">${escapeHtml(status)}</span>
                            </div>
                        `;
                        if (item.commentsActionTaken) {
                            itemContent += `<div class="small text-muted mt-1 bg-light p-1 rounded border border-light-subtle"><strong>Notes:</strong> ${escapeHtml(item.commentsActionTaken)}</div>`;
                        }
                        itemsHtml += `<li class="list-group-item px-2 py-1">${itemContent}</li>`;
                    });
                    itemsHtml += '</ul>';
                    valDisplay = itemsHtml;
                } else {
                    let itemsHtml = '<ul class="mb-0 ps-3 small">';
                    val.forEach(item => {
                        if (typeof item === 'object' && item !== null) {
                            itemsHtml += `<li><pre class="mb-0">${escapeHtml(JSON.stringify(item))}</pre></li>`;
                        } else {
                            itemsHtml += `<li>${escapeHtml(String(item))}</li>`;
                        }
                    });
                    itemsHtml += '</ul>';
                    valDisplay = itemsHtml;
                }
            } else if (typeof val === 'object' && val !== null) {
                // Formatting timestamps gracefully if they have seconds property
                if (val.seconds) {
                    valDisplay = formatDateTimeDisplay(val);
                } else {
                    valDisplay = JSON.stringify(val);
                }
            } else {
                valDisplay = escapeHtml(String(val));
            }

            rows += `
                <tr>
                    <td class="fw-semibold text-muted small py-2 align-middle" style="width: 30%;">${escapeHtml(formattedKey)}</td>
                    <td class="small py-2">${valDisplay}</td>
                </tr>
            `;
        }"""
)

with open('/Users/hamza/VancouverPartyWorksAdmin/src/assets/js/events.js', 'w') as f:
    f.write(content)

