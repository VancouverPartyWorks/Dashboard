import * as bootstrap from 'bootstrap';
import { db, auth } from './firebase-client.js';
import { collection, onSnapshot, getDocs, query, where } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

document.addEventListener('DOMContentLoaded', () => {
    const eventsTableBody = document.getElementById('eventsTableBody');
    const searchInput = document.getElementById('searchEventInput');
    const filterSelect = document.getElementById('eventFilterSelect');
    const refreshBtn = document.getElementById('refreshEventsBtn');
    const countBadge = document.getElementById('eventsCountBadge');
    const paginationInfo = document.getElementById('paginationInfo');
    const paginationControls = document.getElementById('paginationControls');

    let allShifts = [];
    let firebaseEvents = []; // Unique events extracted from Firebase
    let cachedApiLeads = [];
    let usersMap = new Map();
    let availableRoles = [];
    let singleLeadCache = new Map();

    let canAccess = false;
    let isSuperAdmin = false;
    let isHr = false;
    let isSpectator = false;

    let currentPage = 1;
    const pageSize = 15;

    // -------------------------------------------------------------
    // Auth Guard & Role Verification
    // -------------------------------------------------------------
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = './signin.html';
            return;
        }

        if (db) {
            try {
                const q = query(collection(db, "dashboardUsers"), where("email", "==", user.email));
                const querySnapshot = await getDocs(q);
                if (querySnapshot.empty) {
                    window.location.href = './signin.html';
                    return;
                }

                const userData = querySnapshot.docs[0].data();
                const roleId = userData.roleId;
                const roleName = (userData.role || '').toLowerCase();

                isSuperAdmin = roleId === 1 || roleName === 'super admin';
                isHr = roleId === 2 || roleName === 'hr';
                isSpectator = roleId === 6 || roleName === 'spectator';
                canAccess = isSuperAdmin || isHr || isSpectator;

                if (!canAccess) {
                    window.location.href = './index.html';
                    return;
                }

                const pageSubtitle = document.getElementById('pageSubtitle');
                if (pageSubtitle) {
                    pageSubtitle.textContent = isSuperAdmin || isHr
                        ? 'Manage and Monitor Vancouver Partyworks Events & Lead Submissions'
                        : 'Vancouver Partyworks Events Directory';
                }

                await fetchUsersAndRoles();
                initShiftsListener();
                preloadApiLeads();
            } catch (error) {
                console.error("Error verifying user permissions:", error);
            }
        }
    });

    // -------------------------------------------------------------
    // Fetch Users & Roles
    // -------------------------------------------------------------
    async function fetchUsersAndRoles() {
        if (!db) return;
        try {
            const rolesSnap = await getDocs(collection(db, "userRoles"));
            availableRoles = rolesSnap.docs.map(doc => ({ id: doc.data().id, name: doc.data().name }));

            const usersSnap = await getDocs(collection(db, "users"));
            const dUsersSnap = await getDocs(collection(db, "dashboardUsers"));

            usersMap.clear();
            const addUser = (docSnap) => {
                const data = docSnap.data();
                const displayName = data.displayName || data.name || (data.firstName ? `${data.firstName} ${data.lastName || ''}`.trim() : '') || data.email || data.phoneNumber || docSnap.id;
                usersMap.set(docSnap.id, { id: docSnap.id, displayName, ...data });
            };

            usersSnap.forEach(addUser);
            dUsersSnap.forEach(addUser);
        } catch (err) {
            console.error("Error fetching users/roles:", err);
        }
    }

    // -------------------------------------------------------------
    // Preload API Leads Cache for Matching Event Details
    // -------------------------------------------------------------
    async function preloadApiLeads() {
        const apiKey = import.meta.env.VITE_IO_API_KEY;
        if (!apiKey) return;
        try {
            const res = await fetch(`/io-api/leads/?apiKey=${apiKey}&limit=250`);
            if (res.ok) {
                const data = await res.json();
                let leads = [];
                if (Array.isArray(data)) leads = data;
                else if (data.items && Array.isArray(data.items)) leads = data.items;
                else if (data.data && Array.isArray(data.data)) leads = data.data;
                else if (typeof data === 'object') leads = Object.values(data);
                cachedApiLeads = leads.filter(l => l && typeof l === 'object' && l.id);
                
                // If firebase events already derived, re-correlate and render
                if (firebaseEvents.length > 0) {
                    correlateEventsWithApi();
                    renderEventsTable();
                }
            }
        } catch (err) {
            console.warn("Could not preload API leads:", err);
        }
    }

    // -------------------------------------------------------------
    // Realtime Listener on Firebase Shifts Collection
    // -------------------------------------------------------------
    function initShiftsListener() {
        if (!db) return;
        onSnapshot(collection(db, "shifts"), (snapshot) => {
            allShifts = [];
            snapshot.forEach(docSnap => {
                allShifts.push({ id: docSnap.id, ...docSnap.data() });
            });
            buildFirebaseEvents();
        }, (error) => {
            console.error("Error loading shifts:", error);
            if (eventsTableBody) {
                eventsTableBody.innerHTML = `<tr><td colspan="3" class="text-center py-4 text-danger">Error loading shifts from Firebase.</td></tr>`;
            }
        });
    }

    // -------------------------------------------------------------
    // Extract & Group Events that are on Firebase Database
    // -------------------------------------------------------------
    function buildFirebaseEvents() {
        const eventsMap = new Map(); // Key: normalized event name or lead ID

        allShifts.forEach(shift => {
            // Get event names from shift
            let eventNames = [];
            if (Array.isArray(shift.eventsList) && shift.eventsList.length > 0) {
                eventNames = shift.eventsList.map(s => String(s).trim()).filter(Boolean);
            } else if (typeof shift.venueName === 'string' && shift.venueName.trim() && shift.venueName.trim().toLowerCase() !== 'no event selected') {
                eventNames = shift.venueName.split(',').map(s => s.trim()).filter(Boolean);
            } else if (shift.eventName) {
                eventNames = [String(shift.eventName).trim()];
            }

            if (eventNames.length === 0) {
                // If shift has a venueName even if default
                if (shift.venueName && shift.venueName.trim()) {
                    eventNames = [shift.venueName.trim()];
                } else {
                    eventNames = [`Shift #${shift.id.slice(0, 6)} Event`];
                }
            }

            eventNames.forEach(name => {
                const normKey = name.toLowerCase();
                if (!eventsMap.has(normKey)) {
                    eventsMap.set(normKey, {
                        key: normKey,
                        primaryName: name,
                        shifts: [],
                        leadIds: new Set(),
                        assignedLeadIds: new Set(),
                        apiLead: null,
                        // Aggregated Lead Submissions
                        submissions: {
                            clientSignatureSubmitted: false,
                            clientSignature: null,
                            clientSignatureDate: null,
                            clientSigneeName: null,
                            setupFormSubmitted: false,
                            setupForm: null,
                            setupFormLeadId: null,
                            setupPhotosSubmitted: false,
                            photos: [],
                            managerReportSubmitted: false,
                            managerReport: null,
                            managerReportUrl: null,
                            managerReportLeadId: null,
                            managerReportDate: null
                        }
                    });
                }

                const ev = eventsMap.get(normKey);
                ev.shifts.push(shift);

                if (shift.assignedUserId) ev.assignedLeadIds.add(shift.assignedUserId);
                if (shift.leadId) ev.leadIds.add(String(shift.leadId));
                if (shift.eventId) ev.leadIds.add(String(shift.eventId));

                // 1. Client Signature submission
                if (shift.clientSignatureSubmitted || shift.clientSignature || shift.signature || shift.clientSignatureUrl || shift.signatureUrl) {
                    ev.submissions.clientSignatureSubmitted = true;
                    if (!ev.submissions.clientSignature) {
                        ev.submissions.clientSignature = shift.clientSignature || shift.signature || shift.clientSignatureUrl || shift.signatureUrl;
                    }
                    if (shift.clientSignatureDate || shift.signedAt) {
                        ev.submissions.clientSignatureDate = shift.clientSignatureDate || shift.signedAt;
                    }
                    if (shift.clientName || shift.signeeName) {
                        ev.submissions.clientSigneeName = shift.clientName || shift.signeeName;
                    }
                }

                // 2. Setup Form submission
                if (shift.setupFormSubmitted || shift.setupForm || shift.formData || shift.checklist) {
                    ev.submissions.setupFormSubmitted = true;
                    if (!ev.submissions.setupForm) {
                        ev.submissions.setupForm = shift.setupForm || shift.formData || shift.checklist;
                    }
                    if (shift.assignedUserId) {
                        ev.submissions.setupFormLeadId = shift.assignedUserId;
                    }
                }

                // 3. Photos submission
                if (shift.setupPhotosSubmitted || (Array.isArray(shift.setupPhotos) && shift.setupPhotos.length > 0) || (Array.isArray(shift.photos) && shift.photos.length > 0)) {
                    ev.submissions.setupPhotosSubmitted = true;
                    const pList = shift.setupPhotos || shift.photos || shift.photosUrls || [];
                    if (Array.isArray(pList)) {
                        pList.forEach(p => {
                            if (p && !ev.submissions.photos.includes(p)) {
                                ev.submissions.photos.push(p);
                            }
                        });
                    }
                }

                // 4. Manager Report submission
                if (shift.managerReportSubmitted || shift.managerReport || shift.report || shift.managerReportUrl || shift.reportNotes) {
                    ev.submissions.managerReportSubmitted = true;
                    if (!ev.submissions.managerReport) {
                        ev.submissions.managerReport = shift.managerReport || shift.report || shift.reportNotes;
                    }
                    if (shift.managerReportUrl) {
                        ev.submissions.managerReportUrl = shift.managerReportUrl;
                    }
                    if (shift.assignedUserId) {
                        ev.submissions.managerReportLeadId = shift.assignedUserId;
                    }
                    if (shift.managerReportDate || shift.updatedAt) {
                        ev.submissions.managerReportDate = shift.managerReportDate || shift.updatedAt;
                    }
                }
            });
        });

        firebaseEvents = Array.from(eventsMap.values());

        // Sort events: most recent shift date first
        firebaseEvents.sort((a, b) => {
            const getLatestDate = (ev) => {
                let latest = 0;
                ev.shifts.forEach(s => {
                    const t = s.dateTime ? (s.dateTime.seconds ? s.dateTime.seconds * 1000 : new Date(s.dateTime).getTime()) : 0;
                    if (t > latest) latest = t;
                });
                return latest;
            };
            return getLatestDate(b) - getLatestDate(a);
        });

        correlateEventsWithApi();
        currentPage = 1;
        renderEventsTable();
    }

    // -------------------------------------------------------------
    // Match Firebase Events with Rental Software IO API Leads
    // -------------------------------------------------------------
    function correlateEventsWithApi() {
        if (cachedApiLeads.length === 0) return;

        firebaseEvents.forEach(ev => {
            if (ev.apiLead) return; // already matched

            const nameLower = ev.primaryName.toLowerCase().trim();

            // Match by lead ID if known
            for (const leadId of ev.leadIds) {
                const m = cachedApiLeads.find(l => String(l.id) === String(leadId));
                if (m) {
                    ev.apiLead = m;
                    return;
                }
            }

            // Match by name or organization
            const match = cachedApiLeads.find(lead => {
                const lName = (lead.eventname || '').toLowerCase().trim();
                const lOrg = (lead.eventorganization || '').toLowerCase().trim();
                const lVenue = (lead.venuename || '').toLowerCase().trim();
                const lId = String(lead.id).toLowerCase();

                if (nameLower === lName && lName.length > 0) return true;
                if (nameLower === lOrg && lOrg.length > 0) return true;
                if (nameLower === lVenue && lVenue.length > 0) return true;
                if (nameLower === `lead #${lId}` || nameLower === lId) return true;

                if (nameLower.length > 3 && (lName.includes(nameLower) || lOrg.includes(nameLower) || lVenue.includes(nameLower))) {
                    return true;
                }
                if (lName.length > 3 && nameLower.includes(lName)) return true;
                if (lOrg.length > 3 && nameLower.includes(lOrg)) return true;

                return false;
            });

            if (match) {
                ev.apiLead = match;
            }
        });
    }

    // -------------------------------------------------------------
    // Render Events Table
    // -------------------------------------------------------------
    function renderEventsTable() {
        if (!eventsTableBody) return;

        const queryStr = (searchInput ? searchInput.value : '').toLowerCase().trim();
        const filterVal = filterSelect ? filterSelect.value : 'all';

        let filtered = firebaseEvents.filter(ev => {
            const sub = ev.submissions;

            // Filters
            if (filterVal === 'with-submissions' && !sub.clientSignatureSubmitted && !sub.setupFormSubmitted && !sub.setupPhotosSubmitted && !sub.managerReportSubmitted) {
                return false;
            }
            if (filterVal === 'with-signature' && !sub.clientSignatureSubmitted) return false;
            if (filterVal === 'with-photos' && (!sub.setupPhotosSubmitted || sub.photos.length === 0)) return false;
            if (filterVal === 'with-report' && !sub.managerReportSubmitted) return false;

            // Search query
            if (queryStr) {
                const nameMatch = ev.primaryName.toLowerCase().includes(queryStr);
                const leadIdMatch = ev.apiLead && String(ev.apiLead.id).includes(queryStr);
                const orgMatch = ev.apiLead && (ev.apiLead.eventorganization || '').toLowerCase().includes(queryStr);
                const venueMatch = ev.apiLead && (ev.apiLead.venuename || '').toLowerCase().includes(queryStr);
                const shiftMatch = ev.shifts.some(s => (s.venueName && s.venueName.toLowerCase().includes(queryStr)) || (s.role && s.role.toLowerCase().includes(queryStr)));

                if (!nameMatch && !leadIdMatch && !orgMatch && !venueMatch && !shiftMatch) {
                    return false;
                }
            }

            return true;
        });

        if (countBadge) {
            countBadge.textContent = filtered.length;
        }

        if (filtered.length === 0) {
            eventsTableBody.innerHTML = `
                <tr>
                    <td colspan="3" class="text-center py-5 text-muted">
                        <i class="ti ti-calendar-off fs-2 d-block mb-2 text-secondary"></i>
                        No events on Firebase database matching your filter criteria.
                    </td>
                </tr>
            `;
            if (paginationInfo) paginationInfo.textContent = 'Showing 0 of 0 events';
            if (paginationControls) paginationControls.innerHTML = '';
            return;
        }

        // Pagination
        const totalItems = filtered.length;
        const totalPages = Math.ceil(totalItems / pageSize);
        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;

        const startIndex = (currentPage - 1) * pageSize;
        const endIndex = Math.min(startIndex + pageSize, totalItems);
        const pageItems = filtered.slice(startIndex, endIndex);

        if (paginationInfo) {
            paginationInfo.textContent = `Showing ${startIndex + 1} to ${endIndex} of ${totalItems} events`;
        }
        renderPagination(totalPages);

        eventsTableBody.innerHTML = '';

        pageItems.forEach(ev => {
            const api = ev.apiLead || {};
            const sub = ev.submissions;

            // Dates & Times
            let dateDisplay = '—';
            let timeDisplay = '';
            if (api.eventstarttime || api.fullstart) {
                dateDisplay = formatDateDisplay(api.eventstarttime || api.fullstart);
                timeDisplay = formatTimeDisplay(api.eventstarttime || api.fullstart);
            } else if (ev.shifts.length > 0 && ev.shifts[0].dateTime) {
                dateDisplay = formatDateDisplay(ev.shifts[0].dateTime);
                timeDisplay = formatShiftTime(ev.shifts[0]);
            }

            // Lead ID badge
            const leadIdBadge = api.id ? `<span class="badge bg-secondary-subtle text-secondary small ms-1">#${escapeHtml(api.id)}</span>` : '';

            // Subtitle information
            const org = api.eventorganization ? api.eventorganization.trim() : '';
            const venue = api.venuename ? api.venuename.trim() : '';
            const city = api.eventcity ? api.eventcity.trim() : '';
            const locationSubtext = [venue, city].filter(Boolean).join(' • ');

            // Lead Submission Status Badges
            const sigBadge = sub.clientSignatureSubmitted
                ? `<span class="badge bg-success-subtle text-success border small" title="Client Signature submitted"><i class="ti ti-writing me-0.5"></i>Signature</span>`
                : `<span class="badge bg-light text-muted border small" title="Client Signature pending"><i class="ti ti-writing me-0.5"></i>No Sig</span>`;

            const formBadge = sub.setupFormSubmitted
                ? `<span class="badge bg-info-subtle text-info border small" title="Setup Form submitted"><i class="ti ti-forms me-0.5"></i>Form</span>`
                : `<span class="badge bg-light text-muted border small" title="Setup Form pending"><i class="ti ti-forms me-0.5"></i>No Form</span>`;

            const photosCount = sub.photos.length;
            const photoBadge = (sub.setupPhotosSubmitted || photosCount > 0)
                ? `<span class="badge bg-primary-subtle text-primary border small" title="${photosCount} Photos uploaded"><i class="ti ti-photo me-0.5"></i>${photosCount} Photo${photosCount !== 1 ? 's' : ''}</span>`
                : `<span class="badge bg-light text-muted border small" title="Photos pending"><i class="ti ti-photo me-0.5"></i>0 Photos</span>`;

            const reportBadge = sub.managerReportSubmitted
                ? `<span class="badge border small" style="background: rgba(111,66,193,0.1); color: #6f42c1; border-color: rgba(111,66,193,0.2) !important;" title="Manager Report uploaded"><i class="ti ti-file-text me-0.5"></i>Report</span>`
                : `<span class="badge bg-light text-muted border small" title="Manager Report pending"><i class="ti ti-file-text me-0.5"></i>No Report</span>`;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <div class="d-flex flex-column">
                        <div class="d-flex align-items-center flex-wrap gap-1 mb-1">
                            <span class="fw-bold text-dark fs-6">${escapeHtml(ev.primaryName)}</span>
                            ${leadIdBadge}
                        </div>
                        <div class="text-muted small d-flex flex-wrap align-items-center gap-2 mb-2">
                            <span><i class="ti ti-calendar me-1 text-primary"></i>${escapeHtml(dateDisplay)}${timeDisplay ? ` at ${escapeHtml(timeDisplay)}` : ''}</span>
                            ${org && org !== ev.primaryName ? `<span>• <i class="ti ti-building me-1"></i>${escapeHtml(org)}</span>` : ''}
                            ${locationSubtext ? `<span>• <i class="ti ti-map-pin me-1"></i>${escapeHtml(locationSubtext)}</span>` : ''}
                        </div>
                        <div class="d-flex flex-wrap gap-1 align-items-center">
                            ${sigBadge}
                            ${formBadge}
                            ${photoBadge}
                            ${reportBadge}
                        </div>
                    </div>
                </td>
                <td>
                    <span class="badge bg-light text-dark border fw-bold px-2.5 py-1" style="font-size: 0.875rem;">${ev.shifts.length}</span>
                </td>
                <td class="text-end">
                    <button class="btn btn-sm btn-primary view-event-btn text-nowrap d-inline-flex align-items-center gap-1 shadow-sm" data-key="${escapeHtml(ev.key)}">
                        <i class="ti ti-eye fs-5"></i>
                        <span>View Event</span>
                    </button>
                </td>
            `;

            eventsTableBody.appendChild(tr);
        });

        // Attach event listeners for View Event buttons
        document.querySelectorAll('.view-event-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.key;
                openEventDetailsModal(key);
            });
        });
    }

    // -------------------------------------------------------------
    // Pagination Controls
    // -------------------------------------------------------------
    function renderPagination(totalPages) {
        if (!paginationControls) return;
        paginationControls.innerHTML = '';
        if (totalPages <= 1) return;

        const prevLi = document.createElement('li');
        prevLi.className = `page-item ${currentPage === 1 ? 'disabled' : ''}`;
        prevLi.innerHTML = `<button class="page-link">&laquo;</button>`;
        prevLi.addEventListener('click', (e) => {
            e.preventDefault();
            if (currentPage > 1) {
                currentPage--;
                renderEventsTable();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        });
        paginationControls.appendChild(prevLi);

        for (let p = 1; p <= totalPages; p++) {
            const li = document.createElement('li');
            li.className = `page-item ${p === currentPage ? 'active' : ''}`;
            li.innerHTML = `<button class="page-link">${p}</button>`;
            li.addEventListener('click', (e) => {
                e.preventDefault();
                if (currentPage !== p) {
                    currentPage = p;
                    renderEventsTable();
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
            });
            paginationControls.appendChild(li);
        }

        const nextLi = document.createElement('li');
        nextLi.className = `page-item ${currentPage === totalPages ? 'disabled' : ''}`;
        nextLi.innerHTML = `<button class="page-link">&raquo;</button>`;
        nextLi.addEventListener('click', (e) => {
            e.preventDefault();
            if (currentPage < totalPages) {
                currentPage++;
                renderEventsTable();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        });
        paginationControls.appendChild(nextLi);
    }

    // -------------------------------------------------------------
    // Open Big Event Details Modal
    // -------------------------------------------------------------
    async function openEventDetailsModal(eventKey) {
        const ev = firebaseEvents.find(e => e.key === eventKey);
        if (!ev) return;

        const modalEl = document.getElementById('viewEventModal');
        if (!modalEl) return;

        // Reset to first tab: Lead Submissions & Forms
        const submissionsTabBtn = document.getElementById('tab-submissions-btn');
        if (submissionsTabBtn) {
            const tabInstance = bootstrap.Tab.getOrCreateInstance(submissionsTabBtn);
            tabInstance.show();
        }

        const api = ev.apiLead || {};
        const sub = ev.submissions;

        // Header
        setText('modalEventName', ev.primaryName);
        setText('modalFooterEventName', ev.primaryName);
        setText('modalEventIdBadge', api.id ? `Lead #${api.id}` : 'Firebase Event');
        setText('modalStatusBadge', formatStatusName(api.status || api.statusid));
        setText('modalDeliveryTypeBadge', api.deliverytype || (ev.shifts[0] ? ev.shifts[0].role : 'Standard Delivery'));
        setText('modalDateBadge', formatDateDisplay(api.eventstarttime || api.fullstart || (ev.shifts[0] ? ev.shifts[0].dateTime : '')));

        // Quick Summary Banner
        setText('summaryEventDateTime', formatDateTimeDisplay(api.eventstarttime || api.fullstart || (ev.shifts[0] ? ev.shifts[0].dateTime : '')));
        setText('summaryEventDuration', api.eventduration ? `${parseFloat(api.eventduration).toFixed(1)} hrs duration` : 'Duration unspecified');
        setText('summaryVenueName', api.venuename || api.eventstreet || (ev.shifts[0] ? ev.shifts[0].meetingLocation : 'No venue specified'));
        setText('summaryVenueCity', [api.eventcity, api.eventstate].filter(Boolean).join(', ') || 'Location unspecified');
        setText('summaryTotalAmount', formatCurrency(api.total));

        const balanceDue = api.balancedue !== undefined ? api.balancedue : (parseFloat(api.total || 0) - parseFloat(api.amountpaid || 0));
        const balanceDueEl = document.getElementById('summaryBalanceDue');
        if (balanceDueEl) {
            balanceDueEl.textContent = `Balance Due: ${formatCurrency(balanceDue)}`;
            balanceDueEl.className = balanceDue > 0 ? 'small fw-bold text-danger' : 'small fw-bold text-success';
        }

        // Summary banner badges for lead submissions
        const summaryBadgesContainer = document.getElementById('summarySubmissionsBadges');
        if (summaryBadgesContainer) {
            summaryBadgesContainer.innerHTML = `
                <span class="badge ${sub.clientSignatureSubmitted ? 'bg-success' : 'bg-secondary-subtle text-muted border'}">
                    <i class="ti ti-writing me-0.5"></i> ${sub.clientSignatureSubmitted ? 'Signature ✓' : 'Signature Pending'}
                </span>
                <span class="badge ${sub.setupFormSubmitted ? 'bg-info' : 'bg-secondary-subtle text-muted border'}">
                    <i class="ti ti-forms me-0.5"></i> ${sub.setupFormSubmitted ? 'Form ✓' : 'Form Pending'}
                </span>
                <span class="badge ${sub.setupPhotosSubmitted || sub.photos.length > 0 ? 'bg-primary' : 'bg-secondary-subtle text-muted border'}">
                    <i class="ti ti-photo me-0.5"></i> ${sub.photos.length} Photo${sub.photos.length !== 1 ? 's' : ''}
                </span>
                <span class="badge ${sub.managerReportSubmitted ? 'bg-purple text-white' : 'bg-secondary-subtle text-muted border'}" style="${sub.managerReportSubmitted ? 'background-color: #6f42c1 !important;' : ''}">
                    <i class="ti ti-file-text me-0.5"></i> ${sub.managerReportSubmitted ? 'Report ✓' : 'Report Pending'}
                </span>
            `;
        }

        // =========================================================
        // TAB 1: LEAD SUBMISSIONS & FORMS
        // =========================================================

        // 1. Client Signature
        const sigBadgeEl = document.getElementById('sigStatusBadge');
        const sigSigneeEl = document.getElementById('sigSigneeNameText');
        const sigTimeEl = document.getElementById('sigTimestampText');
        const sigImgContainer = document.getElementById('sigImageContainer');

        if (sub.clientSignatureSubmitted && sub.clientSignature) {
            if (sigBadgeEl) {
                sigBadgeEl.textContent = 'Submitted';
                sigBadgeEl.className = 'badge bg-success-subtle text-success border';
            }
            if (sigSigneeEl) sigSigneeEl.textContent = sub.clientSigneeName || api.cust ? `${api.cust.firstname || ''} ${api.cust.lastname || ''}`.trim() : 'Authorized Signee';
            if (sigTimeEl) sigTimeEl.textContent = formatDateTimeDisplay(sub.clientSignatureDate) || 'Verified by Lead';

            if (sigImgContainer) {
                const isImgUrl = typeof sub.clientSignature === 'string' && (sub.clientSignature.startsWith('http') || sub.clientSignature.startsWith('data:image'));
                if (isImgUrl) {
                    sigImgContainer.innerHTML = `
                        <div class="text-center p-2">
                            <img src="${escapeHtml(sub.clientSignature)}" alt="Client Signature" class="img-fluid rounded border bg-white p-2 shadow-xs" style="max-height: 140px;">
                            <div class="small text-muted mt-1"><i class="ti ti-circle-check text-success me-1"></i>Client signature verified</div>
                        </div>
                    `;
                } else {
                    sigImgContainer.innerHTML = `
                        <div class="p-3 bg-success-subtle text-success rounded text-center border">
                            <i class="ti ti-writing fs-3 d-block mb-1"></i>
                            <strong>Signature Recorded</strong>: ${escapeHtml(String(sub.clientSignature))}
                        </div>
                    `;
                }
            }
        } else {
            if (sigBadgeEl) {
                sigBadgeEl.textContent = 'Pending';
                sigBadgeEl.className = 'badge bg-warning-subtle text-warning-emphasis border';
            }
            if (sigSigneeEl) sigSigneeEl.textContent = '—';
            if (sigTimeEl) sigTimeEl.textContent = '—';
            if (sigImgContainer) {
                sigImgContainer.innerHTML = `<span class="text-muted small"><i class="ti ti-alert-circle text-warning me-1"></i>Client signature has not been uploaded by the lead yet.</span>`;
            }
        }

        // 2. Manager Report
        const reportBadgeEl = document.getElementById('reportStatusBadge');
        const reportLeadEl = document.getElementById('reportLeadNameText');
        const reportTimeEl = document.getElementById('reportTimestampText');
        const reportContentBox = document.getElementById('reportContentBox');
        const reportAttachmentContainer = document.getElementById('reportAttachmentContainer');
        const reportAttachmentLink = document.getElementById('reportAttachmentLink');

        let leadDisplay = '—';
        if (sub.managerReportLeadId) {
            const u = usersMap.get(sub.managerReportLeadId);
            leadDisplay = u ? u.displayName : `Lead (${sub.managerReportLeadId})`;
        } else if (ev.assignedLeadIds.size > 0) {
            const firstId = Array.from(ev.assignedLeadIds)[0];
            const u = usersMap.get(firstId);
            leadDisplay = u ? u.displayName : `Lead (${firstId})`;
        }

        if (sub.managerReportSubmitted && (sub.managerReport || sub.managerReportUrl)) {
            if (reportBadgeEl) {
                reportBadgeEl.textContent = 'Submitted';
                reportBadgeEl.className = 'badge bg-success-subtle text-success border';
            }
            if (reportLeadEl) reportLeadEl.textContent = leadDisplay;
            if (reportTimeEl) reportTimeEl.textContent = formatDateTimeDisplay(sub.managerReportDate);

            if (reportContentBox) {
                if (typeof sub.managerReport === 'object') {
                    reportContentBox.textContent = JSON.stringify(sub.managerReport, null, 2);
                } else {
                    reportContentBox.textContent = sub.managerReport || 'Manager report submitted.';
                }
            }

            if (sub.managerReportUrl && reportAttachmentLink && reportAttachmentContainer) {
                reportAttachmentLink.href = sub.managerReportUrl;
                reportAttachmentContainer.classList.remove('d-none');
            } else if (reportAttachmentContainer) {
                reportAttachmentContainer.classList.add('d-none');
            }
        } else {
            if (reportBadgeEl) {
                reportBadgeEl.textContent = 'Pending';
                reportBadgeEl.className = 'badge bg-warning-subtle text-warning-emphasis border';
            }
            if (reportLeadEl) reportLeadEl.textContent = leadDisplay;
            if (reportTimeEl) reportTimeEl.textContent = '—';
            if (reportContentBox) {
                reportContentBox.textContent = 'Manager report has not been submitted by the lead yet.';
            }
            if (reportAttachmentContainer) reportAttachmentContainer.classList.add('d-none');
        }

        // 3. Setup Form Data
        const formBadgeEl = document.getElementById('formDataStatusBadge');
        const formLeadEl = document.getElementById('formDataLeadNameText');
        const formContainer = document.getElementById('formDataContainer');

        if (formLeadEl) formLeadEl.textContent = leadDisplay;

        if (sub.setupFormSubmitted && sub.setupForm) {
            if (formBadgeEl) {
                formBadgeEl.textContent = 'Submitted';
                formBadgeEl.className = 'badge bg-success-subtle text-success border';
            }
            renderFormData(formContainer, sub.setupForm);
        } else {
            if (formBadgeEl) {
                formBadgeEl.textContent = 'Pending';
                formBadgeEl.className = 'badge bg-warning-subtle text-warning-emphasis border';
            }
            if (formContainer) {
                formContainer.innerHTML = `<span class="text-muted small"><i class="ti ti-alert-circle text-warning me-1"></i>Setup form / inspection checklist has not been submitted by the lead yet.</span>`;
            }
        }

        // 4. Photos Gallery
        const photosBadgeEl = document.getElementById('photosStatusBadge');
        const photosContainer = document.getElementById('photosGalleryContainer');

        if (photosBadgeEl) {
            photosBadgeEl.textContent = `${sub.photos.length} Photo${sub.photos.length !== 1 ? 's' : ''}`;
            photosBadgeEl.className = sub.photos.length > 0 ? 'badge bg-primary' : 'badge bg-secondary-subtle text-secondary border';
        }

        renderPhotosGallery(photosContainer, sub.photos);

        // =========================================================
        // OTHER TABS (Schedule, Venue, Client, Rentals, Financials, Shifts, Notes)
        // =========================================================
        setText('modalRentalsCount', api.rentals ? Object.keys(api.rentals).length : (api.all_rental_data ? api.all_rental_data.length : 0));
        setText('modalShiftsCount', ev.shifts.length);

        // TAB 2: Schedule & Logistics
        setText('dtEventStart', formatDateTimeDisplay(api.eventstarttime));
        setText('dtEventEnd', formatDateTimeDisplay(api.eventendtime));
        setText('dtFullStart', formatDateTimeDisplay(api.fullstart));
        setText('dtFullEnd', formatDateTimeDisplay(api.fullend));
        setText('dtCushStart', formatDateTimeDisplay(api.cushstart));
        setText('dtCushEnd', formatDateTimeDisplay(api.cushend));
        setText('dtEventDuration', api.eventduration ? `${parseFloat(api.eventduration).toFixed(1)} hrs` : '—');
        setText('dtSetupDuration', api.setupduration ? `${parseFloat(api.setupduration).toFixed(2)} hrs` : '—');
        setText('dtTearDownDuration', api.tdownduration ? `${parseFloat(api.tdownduration).toFixed(2)} hrs` : '—');
        setText('dtTravelTime', api.ttimefrom ? `${parseFloat(api.ttimefrom).toFixed(1)} hrs` : '—');
        setText('dtDeliveryType', api.deliverytype || (ev.shifts[0] ? ev.shifts[0].role : '—'));
        setText('dtSurface', api.surface || 'Not specified');
        setText('dtStaffToSend', api.stafftosend || '0');
        setText('dtVolsReqd', api.volsreqd || '0');
        setText('dtVehiclesReqd', api.vehiclesreqd || '—');
        setText('dtCreateTime', formatDateTimeDisplay(api.createtime || (ev.shifts[0] ? ev.shifts[0].createdAt : '')));
        setText('dtModifiedTime', formatDateTimeDisplay(api.modifiedtime || (ev.shifts[0] ? ev.shifts[0].updatedAt : '')));
        setText('dtStatusText', formatStatusName(api.status || api.statusid));
        setText('dtDepositPaid', api.depositpaid === '1' || api.depositpaid === 1 ? 'Yes' : 'No');

        // TAB 3: Venue & Location
        setText('venueNameText', api.venuename || ev.primaryName || '—');
        setText('venueStreetText', api.eventstreet || '—');
        setText('venueCityStateText', [api.eventcity, api.eventstate].filter(Boolean).join(', ') || '—');
        setText('venueZipText', api.eventzip || '—');
        setText('venueCountryText', api.eventcountry || 'Canada');
        setText('venueSurfaceText', api.surface || 'Not specified');

        const fullAddress = [api.venuename, api.eventstreet, api.eventcity, api.eventstate, api.eventzip].filter(Boolean).join(', ');
        const mapsBtn = document.getElementById('venueGoogleMapsBtn');
        if (mapsBtn) {
            if (fullAddress) {
                mapsBtn.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`;
                mapsBtn.classList.remove('disabled');
            } else {
                mapsBtn.href = '#';
                mapsBtn.classList.add('disabled');
            }
        }
        setText('venueDirectionsBox', api.directionsfrom || 'No directions specified.');
        setText('venueNotesBox', api.venuenotes || 'No venue notes recorded.');

        // TAB 4: Customer & Contact
        const custName = api.cust ? `${api.cust.firstname || ''} ${api.cust.lastname || ''}`.trim() : '';
        setText('clientFullName', custName || api.eventorganization || '—');
        setText('clientOrgName', api.eventorganization || (api.cust ? api.cust.organization : '') || '—');

        const email = (api.cust ? api.cust.email : '') || api.email || '';
        const emailLink = document.getElementById('clientEmailLink');
        if (emailLink) {
            emailLink.textContent = email || 'No email provided';
            emailLink.href = email ? `mailto:${email}` : '#';
        }

        const cell = (api.cust ? api.cust.cellphone : '') || api.eventphonenumber || '';
        const cellLink = document.getElementById('clientCellPhoneLink');
        if (cellLink) {
            cellLink.textContent = cell || '—';
            cellLink.href = cell ? `tel:${cell}` : '#';
        }

        setText('clientOfficePhoneText', api.cust ? api.cust.officephone || '—' : '—');
        setText('clientHomePhoneText', api.cust ? api.cust.homephone || '—' : '—');
        setText('clientIdText', api.contactid || (api.cust ? api.cust.id : '—') || '—');
        setText('clientStreetText', api.cust ? api.cust.street || '—' : api.eventstreet || '—');
        setText('clientCityText', api.cust ? api.cust.city || '—' : api.eventcity || '—');
        setText('clientStateText', api.cust ? api.cust.state || '—' : api.eventstate || '—');
        setText('clientZipText', api.cust ? api.cust.zip || '—' : api.eventzip || '—');
        setText('clientCountryText', api.cust ? api.cust.country || 'Canada' : api.eventcountry || 'Canada');

        // TAB 5: Rentals
        renderModalRentalsTable(api.rentals || api.all_rental_data || []);

        // TAB 6: Financials
        setText('finSubtotal', formatCurrency(api.subtotal || (parseFloat(api.total || 0) - parseFloat(api.salestax || 0))));
        setText('finTaxRate', api.taxrate ? `${parseFloat(api.taxrate).toFixed(2)}%` : '5.00%');
        setText('finSalesTax', formatCurrency(api.salestax));
        setText('finTotalAmount', formatCurrency(api.total));
        setText('finDepositAmount', formatCurrency(api.depositamount));
        setText('finAmountPaid', formatCurrency(api.amountpaid || api.totalamountpaid));
        setText('finBalanceDue', formatCurrency(balanceDue));
        setText('finContractSent', formatDateTimeDisplay(api.contractsent));
        setText('finContractRecd', formatDateTimeDisplay(api.contractrecd));
        setText('finTaxExempt', api.taxexempt || 'No');
        setText('finTaxExemptId', api.taxexemptid || '—');
        setText('finQboStatus', api.qbostatus || '—');

        // TAB 7: Associated Shifts
        renderModalShiftsTable(ev.shifts);

        // TAB 8: Notes
        setText('notesGeneralBox', api.notes || 'No general notes recorded.');
        setText('notesIoBox', api.ionotes || 'No internal notes recorded.');
        setText('notesAdditional1Box', api.additionalnotes1 || 'None');
        setText('notesAdditional2Box', api.additionalnotes2 || 'None');

        // Show the Modal
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();

        // If API lead was not matched yet, search IO API by event name
        if (!ev.apiLead) {
            searchAndEnrichEvent(ev);
        } else if (api.id) {
            fetchFullLeadDetails(api.id);
        }
    }

    // -------------------------------------------------------------
    // Search API for unmatched event
    // -------------------------------------------------------------
    async function searchAndEnrichEvent(ev) {
        const apiKey = import.meta.env.VITE_IO_API_KEY;
        if (!apiKey) return;

        try {
            const cleanName = ev.primaryName.replace(/[^\w\s]/gi, '').trim();
            const res = await fetch(`/io-api/leads/?apiKey=${apiKey}&search=${encodeURIComponent(cleanName)}&_body=true`);
            if (res.ok) {
                const data = await res.json();
                let leads = [];
                if (Array.isArray(data)) leads = data;
                else if (data.items && Array.isArray(data.items)) leads = data.items;
                else if (data.data && Array.isArray(data.data)) leads = data.data;

                if (leads.length > 0) {
                    ev.apiLead = leads[0];
                    cachedApiLeads.push(leads[0]);
                    // Refresh modal fields with newly found API data
                    openEventDetailsModal(ev.key);
                }
            }
        } catch (e) {
            console.warn("Could not search API for event:", e);
        }
    }

    async function fetchFullLeadDetails(leadId) {
        const rentalsBodyStatus = document.getElementById('rentalsBodyStatus');
        if (rentalsBodyStatus) rentalsBodyStatus.textContent = 'Loading line items...';

        if (singleLeadCache.has(leadId)) {
            applyDetailedLeadData(singleLeadCache.get(leadId));
            if (rentalsBodyStatus) rentalsBodyStatus.textContent = '';
            return;
        }

        const apiKey = import.meta.env.VITE_IO_API_KEY;
        if (!apiKey) return;

        try {
            const res = await fetch(`/io-api/leads/${leadId}?apiKey=${apiKey}&_body=true`);
            if (res.ok) {
                const fullLead = await res.json();
                singleLeadCache.set(leadId, fullLead);
                applyDetailedLeadData(fullLead);
            }
        } catch (e) {
            console.warn("Could not fetch detailed lead:", e);
        } finally {
            if (rentalsBodyStatus) rentalsBodyStatus.textContent = '';
        }
    }

    function applyDetailedLeadData(fullLead) {
        if (!fullLead) return;

        if (fullLead.cust) {
            const c = fullLead.cust;
            const custFullName = `${c.firstname || ''} ${c.lastname || ''}`.trim();
            if (custFullName) setText('clientFullName', custFullName);
            if (c.organization) setText('clientOrgName', c.organization);
            if (c.email) {
                const link = document.getElementById('clientEmailLink');
                if (link) {
                    link.textContent = c.email;
                    link.href = `mailto:${c.email}`;
                }
            }
            if (c.cellphone) {
                const link = document.getElementById('clientCellPhoneLink');
                if (link) {
                    link.textContent = c.cellphone;
                    link.href = `tel:${c.cellphone}`;
                }
            }
            if (c.officephone) setText('clientOfficePhoneText', c.officephone);
            if (c.homephone) setText('clientHomePhoneText', c.homephone);
            if (c.street) setText('clientStreetText', c.street);
            if (c.city) setText('clientCityText', c.city);
            if (c.state) setText('clientStateText', c.state);
            if (c.zip) setText('clientZipText', c.zip);
        }

        renderModalRentalsTable(fullLead.rentals || fullLead.all_rental_data || []);
    }

    // -------------------------------------------------------------
    // Form Data Rendering
    // -------------------------------------------------------------
    function renderFormData(container, formData) {
        if (!container) return;

        if (!formData || (typeof formData === 'object' && Object.keys(formData).length === 0)) {
            container.innerHTML = `<span class="text-muted small">No setup form data submitted yet.</span>`;
            return;
        }

        if (typeof formData === 'string') {
            container.innerHTML = `<div class="p-2 bg-white rounded border small" style="white-space: pre-wrap;">${escapeHtml(formData)}</div>`;
            return;
        }

        if (Array.isArray(formData)) {
            let html = '<div class="list-group list-group-flush">';
            formData.forEach((item, idx) => {
                if (typeof item === 'object' && item !== null) {
                    const q = item.question || item.title || item.label || `Item #${idx + 1}`;
                    const a = item.answer !== undefined ? item.answer : (item.value !== undefined ? item.value : (item.status || 'Done'));
                    html += `
                        <div class="list-group-item px-2 py-2 d-flex justify-content-between align-items-center">
                            <span class="fw-semibold small">${escapeHtml(q)}</span>
                            <span class="badge bg-light text-dark border small">${escapeHtml(String(a))}</span>
                        </div>
                    `;
                } else {
                    html += `<div class="list-group-item px-2 py-1 small">• ${escapeHtml(String(item))}</div>`;
                }
            });
            html += '</div>';
            container.innerHTML = html;
            return;
        }

        // Object with key-values
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
        }

        container.innerHTML = `
            <div class="table-responsive bg-white rounded border">
                <table class="table table-sm table-striped mb-0">
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
    }

    // -------------------------------------------------------------
    // Photos Gallery Rendering & Lightbox
    // -------------------------------------------------------------
    function renderPhotosGallery(container, photos) {
        if (!container) return;

        if (!photos || photos.length === 0) {
            container.innerHTML = `
                <div class="col-12 text-center py-4 text-muted small">
                    <i class="ti ti-photo-off fs-3 d-block mb-1 text-secondary"></i>
                    No photos have been uploaded by the lead for this event yet.
                </div>
            `;
            return;
        }

        container.innerHTML = '';
        photos.forEach((photo, idx) => {
            const photoUrl = typeof photo === 'string' ? photo : (photo.url || photo.downloadUrl || photo.src || '');
            const caption = typeof photo === 'object' ? (photo.caption || photo.title || `Photo #${idx + 1}`) : `Photo #${idx + 1}`;

            const col = document.createElement('div');
            col.className = 'col-6 col-md-3 col-lg-2';
            col.innerHTML = `
                <div class="card h-100 border shadow-xs overflow-hidden photo-card" style="cursor: pointer;">
                    <div style="height: 120px; background-color: #f8f9fa; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                        <img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(caption)}" class="w-100 h-100 object-fit-cover transition" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'40\\' height=\\'40\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'%23999\\'><path d=\\'M15 8h.01M3 6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6z\\'/></svg>';">
                    </div>
                    <div class="card-footer bg-white p-1 text-center border-top">
                        <span class="small text-muted text-truncate d-block" style="font-size: 0.72rem;">${escapeHtml(caption)}</span>
                    </div>
                </div>
            `;

            col.querySelector('.photo-card').addEventListener('click', () => {
                openPhotoLightbox(photoUrl, caption);
            });

            container.appendChild(col);
        });
    }

    function openPhotoLightbox(url, caption) {
        const modalEl = document.getElementById('photoPreviewModal');
        const imgEl = document.getElementById('photoPreviewImage');
        const capEl = document.getElementById('photoPreviewCaption');
        if (!modalEl || !imgEl) return;

        imgEl.src = url;
        if (capEl) capEl.textContent = caption || '';

        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
    }

    // -------------------------------------------------------------
    // Rentals Table Rendering
    // -------------------------------------------------------------
    function renderModalRentalsTable(rentalsData) {
        const tbody = document.getElementById('modalRentalsTableBody');
        const countEl = document.getElementById('modalRentalsCount');
        if (!tbody) return;

        let items = [];
        if (Array.isArray(rentalsData)) {
            items = rentalsData;
        } else if (typeof rentalsData === 'object' && rentalsData !== null) {
            items = Object.values(rentalsData);
        }

        if (countEl) countEl.textContent = items.length;

        if (items.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center py-4 text-muted">
                        No equipment or rental items recorded for this event.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = '';
        items.forEach(item => {
            const name = item.ridename || item.name || item.itemname || `Item #${item.id || item.rentalid || ''}`;
            const qty = item.quantity || item.rentalqty || item.qty || '1';
            const price = item.price ? formatCurrency(item.price) : (item.origprice ? formatCurrency(item.origprice) : '—');
            const dim = item.dimensions ? `${item.dimensions}` : '—';
            const elec = item.electric ? `${item.electric} circuits` : 'Standard';
            const setupTime = item.setuptime ? `${item.setuptime} min` : '—';
            const teardownTime = item.tdowntime ? `${item.tdowntime} min` : '—';
            const packingList = item.pl ? escapeHtml(item.pl).replace(/\r?\n/g, '<br>') : '—';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="fw-semibold text-dark">
                    ${escapeHtml(name)}
                    ${item.id ? `<span class="badge bg-light text-muted border ms-1">#${escapeHtml(item.id)}</span>` : ''}
                </td>
                <td class="text-center fw-bold">${escapeHtml(qty)}</td>
                <td class="fw-semibold text-primary">${escapeHtml(price)}</td>
                <td class="small">
                    <div><span class="text-muted">Dim:</span> ${escapeHtml(dim)}</div>
                    <div><span class="text-muted">Pwr:</span> ${escapeHtml(elec)}</div>
                </td>
                <td class="small">
                    <div><span class="text-muted">Setup:</span> ${escapeHtml(setupTime)}</div>
                    <div><span class="text-muted">Tdown:</span> ${escapeHtml(teardownTime)}</div>
                </td>
                <td class="small text-muted" style="max-width: 250px;">
                    ${packingList}
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    // -------------------------------------------------------------
    // Associated Shifts Table Rendering
    // -------------------------------------------------------------
    function renderModalShiftsTable(shifts) {
        const tbody = document.getElementById('modalShiftsTableBody');
        if (!tbody) return;

        if (shifts.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center py-4 text-muted">
                        <i class="ti ti-calendar-off fs-3 text-secondary d-block mb-1"></i>
                        No shifts currently scheduled for this event in the system.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = '';
        shifts.forEach(shift => {
            const shiftDate = shift.dateString || formatDateDisplay(shift.dateTime);
            const shiftTime = shift.startTimeString ? formatTime12h(shift.startTimeString) : formatShiftTime(shift);
            const location = shift.meetingLocation || 'Warehouse';
            const role = shift.role || 'Delivery';
            const status = (shift.status || 'unconfirmed').toLowerCase();
            const statusBadge = status === 'confirmed'
                ? '<span class="badge bg-success">Confirmed</span>'
                : '<span class="badge bg-warning text-dark">Unconfirmed</span>';

            // Assigned Lead Name
            let leadName = 'Unassigned';
            if (shift.assignedUserId) {
                const u = usersMap.get(shift.assignedUserId);
                leadName = u ? u.displayName : `User (${shift.assignedUserId.slice(0, 6)}...)`;
            }

            // Assigned Staff Members
            let staffHtml = '<span class="text-muted small">None</span>';
            if (Array.isArray(shift.staffMembers) && shift.staffMembers.length > 0) {
                staffHtml = shift.staffMembers.map(s => {
                    const u = usersMap.get(s.id);
                    const sName = u ? u.displayName : `User (${s.id.slice(0, 6)}...)`;
                    const sStatusBadge = s.status === 'confirmed'
                        ? '<span class="badge bg-success-subtle text-success border ms-1" style="font-size: 0.68rem;">Confirmed</span>'
                        : '<span class="badge bg-secondary-subtle text-muted border ms-1" style="font-size: 0.68rem;">Pending</span>';
                    return `<div class="small text-nowrap">${escapeHtml(sName)} ${sStatusBadge}</div>`;
                }).join('');
            }

            // Notes
            let notesHtml = '—';
            if (Array.isArray(shift.notes) && shift.notes.length > 0) {
                notesHtml = shift.notes.map(n => `<div>• ${escapeHtml(n)}</div>`).join('');
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <div class="fw-bold text-dark">${escapeHtml(shiftDate)}</div>
                    <div class="small text-muted"><i class="ti ti-clock me-1"></i>${escapeHtml(shiftTime)}</div>
                </td>
                <td><span class="badge bg-light text-dark border">${escapeHtml(role)}</span></td>
                <td><span class="small"><i class="ti ti-building me-1 text-muted"></i>${escapeHtml(location)}</span></td>
                <td class="fw-semibold small">${escapeHtml(leadName)}</td>
                <td>${staffHtml}</td>
                <td>${statusBadge}</td>
                <td class="small text-muted" style="max-width: 200px;">${notesHtml}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    // -------------------------------------------------------------
    // Utility Helpers
    // -------------------------------------------------------------
    function setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text !== undefined && text !== null && text !== '' ? text : '—';
    }

    function formatCurrency(val) {
        if (val === undefined || val === null || val === '') return '$0.00';
        const num = parseFloat(val);
        if (isNaN(num)) return String(val);
        return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function formatDateDisplay(dateVal) {
        if (!dateVal) return '';
        try {
            let d = null;
            if (typeof dateVal.toDate === 'function') d = dateVal.toDate();
            else if (dateVal.seconds) d = new Date(dateVal.seconds * 1000);
            else d = new Date(dateVal);

            if (d && !isNaN(d.getTime())) {
                return d.toLocaleDateString('en-US', {
                    weekday: 'short',
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                });
            }
        } catch (e) {
            console.warn(e);
        }
        return String(dateVal);
    }

    function formatTimeDisplay(dateVal) {
        if (!dateVal) return '';
        try {
            let d = null;
            if (typeof dateVal.toDate === 'function') d = dateVal.toDate();
            else if (dateVal.seconds) d = new Date(dateVal.seconds * 1000);
            else d = new Date(dateVal);

            if (d && !isNaN(d.getTime())) {
                return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
            }
        } catch (e) {
            console.warn(e);
        }
        return '';
    }

    function formatDateTimeDisplay(dateVal) {
        if (!dateVal) return '—';
        try {
            let d = null;
            if (typeof dateVal.toDate === 'function') d = dateVal.toDate();
            else if (dateVal.seconds) d = new Date(dateVal.seconds * 1000);
            else d = new Date(dateVal);

            if (d && !isNaN(d.getTime())) {
                return d.toLocaleString('en-US', {
                    weekday: 'short',
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                });
            }
        } catch (e) {
            console.warn(e);
        }
        return String(dateVal);
    }

    function formatShiftTime(shift) {
        if (shift.startTimeString) {
            return formatTime12h(shift.startTimeString);
        }
        if (shift.dateTime) {
            let d = null;
            if (typeof shift.dateTime.toDate === 'function') d = shift.dateTime.toDate();
            else if (shift.dateTime.seconds) d = new Date(shift.dateTime.seconds * 1000);
            else d = new Date(shift.dateTime);
            if (d && !isNaN(d.getTime())) {
                return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
            }
        }
        return 'TBD';
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

    function formatStatusName(statusObj) {
        if (!statusObj) return 'Active';
        if (typeof statusObj === 'string') return statusObj;
        if (typeof statusObj === 'object' && statusObj.name) return statusObj.name;
        return 'Active';
    }

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // -------------------------------------------------------------
    // Search, Filter & Refresh Listeners
    // -------------------------------------------------------------
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            currentPage = 1;
            renderEventsTable();
        });
    }

    if (filterSelect) {
        filterSelect.addEventListener('change', () => {
            currentPage = 1;
            renderEventsTable();
        });
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            singleLeadCache.clear();
            preloadApiLeads();
            buildFirebaseEvents();
        });
    }
});
