import sys

with open('/Users/hamza/VancouverPartyWorksAdmin/src/assets/js/events.js', 'r') as f:
    content = f.read()

# Replace the other block as well
old_block = """                } else {
                    reportContentBox.textContent = sub.managerReport || 'Manager report submitted.';
                }"""
new_block = """                } else {
                    reportContentBox.innerHTML = `<div class="p-3 bg-light rounded text-muted">${sub.managerReport || 'Manager report submitted.'}</div>`;
                }"""
content = content.replace(old_block, new_block)

new_func = """
function generateManagerReportHTML(report) {
    if (!report) return '<div class="text-muted">No report data found.</div>';
    
    return `
    <div class="report-container" style="font-size: 0.9rem;">
        <!-- Header -->
        <div class="row g-3 mb-4">
            <div class="col-12">
                <div class="d-flex justify-content-between align-items-center">
                    <h5 class="mb-0 text-primary fw-bold"><i class="ti ti-clipboard-check me-2"></i>Supervisor Report</h5>
                    <span class="badge bg-primary-subtle text-primary border">${report.shiftId || 'No Shift ID'}</span>
                </div>
            </div>
        </div>

        <!-- Operations Checklist -->
        <h6 class="fw-bold text-dark mb-3"><i class="ti ti-list-check me-2"></i>Operations Checklist</h6>
        <div class="row g-3 mb-4">
            <div class="col-md-4">
                <div class="card h-100 border bg-light-subtle shadow-sm">
                    <div class="card-body p-3">
                        <div class="fw-bold text-dark mb-2">1. Event Arrival</div>
                        <div class="mb-1"><span class="text-muted">Status:</span> 
                            <span class="badge ${report.eventArrivalStatus === 'on time' ? 'bg-success' : 'bg-danger'}">${report.eventArrivalStatus || 'N/A'}</span>
                        </div>
                        ${report.eventArrivalStatus === 'late' ? `
                        <div class="mb-1"><span class="text-muted">Time:</span> ${report.eventArrivalLateTime || '-'}</div>
                        <div class="small"><span class="text-muted">Reason:</span> ${report.eventArrivalLateReason || '-'}</div>
                        ` : ''}
                    </div>
                </div>
            </div>
            
            <div class="col-md-4">
                <div class="card h-100 border bg-light-subtle shadow-sm">
                    <div class="card-body p-3">
                        <div class="fw-bold text-dark mb-2">2. Setup Completion</div>
                        <div class="mb-1"><span class="text-muted">Status:</span> 
                            <span class="badge ${report.setupCompletionStatus === 'on time' ? 'bg-success' : 'bg-danger'}">${report.setupCompletionStatus || 'N/A'}</span>
                        </div>
                        ${report.setupCompletionStatus === 'late' ? `
                        <div class="mb-1"><span class="text-muted">Time:</span> ${report.setupCompletionLateTime || '-'}</div>
                        <div class="small"><span class="text-muted">Reason:</span> ${report.setupCompletionLateReason || '-'}</div>
                        ` : ''}
                    </div>
                </div>
            </div>
            
            <div class="col-md-4">
                <div class="card h-100 border bg-light-subtle shadow-sm">
                    <div class="card-body p-3">
                        <div class="fw-bold text-dark mb-2">3. Strike Down</div>
                        <div class="mb-1"><span class="text-muted">Status:</span> 
                            <span class="badge ${report.strikeDownStatus === 'on time' ? 'bg-success' : 'bg-danger'}">${report.strikeDownStatus || 'N/A'}</span>
                        </div>
                        ${report.strikeDownStatus === 'late' ? `
                        <div class="mb-1"><span class="text-muted">Time:</span> ${report.strikeDownLateTime || '-'}</div>
                        <div class="small"><span class="text-muted">Reason:</span> ${report.strikeDownLateReason || '-'}</div>
                        ` : ''}
                    </div>
                </div>
            </div>
        </div>

        <!-- Equipment Status -->
        <h6 class="fw-bold text-dark mb-3"><i class="ti ti-tool me-2"></i>Equipment Status</h6>
        <div class="card border mb-4 shadow-sm">
            <div class="card-body p-3">
                <div class="row g-3">
                    <div class="col-md-6 border-end">
                        <div class="fw-bold text-dark mb-2">4. Equipment BEFORE Event</div>
                        <div class="mb-2"><span class="text-muted">Condition:</span> 
                            <span class="badge ${report.equipmentBeforeEventStatus === 'Clean' ? 'bg-success' : 'bg-warning text-dark'}">${report.equipmentBeforeEventStatus || 'N/A'}</span>
                        </div>
                        ${report.equipmentBeforeEventStatus !== 'Clean' ? `
                        <div class="small"><span class="text-muted">Notes:</span> ${report.equipmentBeforeEventNotes || 'None'}</div>
                        ` : ''}
                    </div>
                    <div class="col-md-6">
                        <div class="fw-bold text-dark mb-2">5. Equipment AFTER Event</div>
                        <div class="mb-2"><span class="text-muted">Condition:</span> 
                            <span class="badge ${report.equipmentAfterEventStatus === 'Clean' ? 'bg-success' : 'bg-warning text-dark'}">${report.equipmentAfterEventStatus || 'N/A'}</span>
                        </div>
                        ${report.equipmentAfterEventStatus !== 'Clean' ? `
                        <div class="small"><span class="text-muted">Notes:</span> ${report.equipmentAfterEventNotes || 'None'}</div>
                        ` : ''}
                    </div>
                </div>
            </div>
        </div>

        <!-- Equipment Failure & Food -->
        <div class="row g-3 mb-4">
            <div class="col-md-6">
                <div class="card h-100 border shadow-sm ${report.equipmentStoppedWorking ? 'border-danger' : ''}">
                    <div class="card-header bg-light border-bottom py-2 fw-bold text-dark">
                        6. Equipment Failure
                    </div>
                    <div class="card-body p-3">
                        <div class="mb-2">
                            <span class="text-muted">Did equipment stop working?</span> 
                            <span class="badge ${report.equipmentStoppedWorking ? 'bg-danger' : 'bg-success'}">${report.equipmentStoppedWorking ? 'Yes' : 'No'}</span>
                        </div>
                        ${report.equipmentStoppedWorking ? `
                        <div class="small mb-1"><span class="fw-semibold">Equipment:</span> ${report.equipmentStoppedWorkingDetails || '-'}</div>
                        <div class="small mb-1"><span class="fw-semibold">Time:</span> ${report.equipmentStoppedWorkingTime || '-'}</div>
                        <div class="small mb-1"><span class="fw-semibold">Reason:</span> ${report.equipmentStoppedWorkingReason || '-'}</div>
                        <div class="small"><span class="fw-semibold">Actions:</span> ${report.equipmentStoppedWorkingActions || '-'}</div>
                        ` : ''}
                    </div>
                </div>
            </div>
            
            <div class="col-md-6">
                <div class="card h-100 border shadow-sm">
                    <div class="card-header bg-light border-bottom py-2 fw-bold text-dark">
                        7. Food Product & Staff
                    </div>
                    <div class="card-body p-3">
                        <div class="mb-3">
                            <div class="mb-1">
                                <span class="text-muted">Un-opened food returned?</span> 
                                <span class="badge ${report.unopenedFoodReturned ? 'bg-warning text-dark' : 'bg-secondary'}">${report.unopenedFoodReturned ? 'Yes' : 'No'}</span>
                            </div>
                            ${report.unopenedFoodReturned ? `
                            <div class="small text-muted fst-italic">${report.unopenedFoodReturnedDetails || 'No details provided'}</div>
                            ` : ''}
                        </div>
                        
                        <div class="pt-2 border-top">
                            <div class="mb-1">
                                <span class="text-muted">Issues with staff?</span> 
                                <span class="badge ${report.staffIssues ? 'bg-danger' : 'bg-success'}">${report.staffIssues ? 'Yes' : 'No'}</span>
                            </div>
                            ${report.staffIssues ? `
                            <div class="small text-danger fst-italic">${report.staffIssuesComments || 'No details provided'}</div>
                            ` : ''}
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Injuries -->
        <h6 class="fw-bold text-dark mb-3"><i class="ti ti-alert-triangle me-2"></i>Incident & Injuries</h6>
        <div class="card border mb-4 shadow-sm ${(report.hasCustomerInjury || report.hasStaffInjury) ? 'border-danger bg-danger-subtle' : ''}">
            <div class="card-body p-3">
                <div class="d-flex gap-4 mb-3">
                    <div>
                        <span class="text-muted">Customer Injury:</span> 
                        <span class="badge ${report.hasCustomerInjury ? 'bg-danger' : 'bg-success'}">${report.hasCustomerInjury ? 'Yes' : 'No'}</span>
                    </div>
                    <div>
                        <span class="text-muted">Staff Injury:</span> 
                        <span class="badge ${report.hasStaffInjury ? 'bg-danger' : 'bg-success'}">${report.hasStaffInjury ? 'Yes' : 'No'}</span>
                    </div>
                </div>
                
                ${(report.hasCustomerInjury || report.hasStaffInjury) ? `
                <div class="border-top border-danger pt-3 mt-2">
                    <h6 class="text-danger fw-bold mb-3"><i class="ti ti-medical-cross me-1"></i> Accident Report Form</h6>
                    
                    <div class="row g-3 mb-3">
                        <div class="col-md-6">
                            <div class="small"><span class="text-muted fw-semibold">Injured Party:</span> ${report.injuredPartyName || '-'}</div>
                        </div>
                        <div class="col-md-6">
                            <div class="small"><span class="text-muted fw-semibold">Time:</span> ${report.timeOfInjury || '-'}</div>
                        </div>
                        <div class="col-12">
                            <div class="small"><span class="text-muted fw-semibold">Nature of Injury:</span> ${report.natureOfInjury || '-'}</div>
                        </div>
                    </div>
                    
                    <div class="mb-3">
                        <div class="small text-muted fw-semibold mb-1">Accident Description:</div>
                        <div class="p-2 bg-white rounded border border-danger-subtle small">${report.accidentDescription || 'No description provided'}</div>
                    </div>
                    
                    <div class="mb-3">
                        <div class="small text-muted fw-semibold mb-1">Resolution (First Aid etc.):</div>
                        <div class="p-2 bg-white rounded border border-danger-subtle small">${report.accidentResolution || 'No resolution provided'}</div>
                    </div>
                    
                    <div class="row g-3">
                        <div class="col-md-6">
                            <div class="p-2 bg-white rounded border border-danger-subtle h-100">
                                <div class="small fw-bold text-dark mb-2 border-bottom pb-1">Lead Signature</div>
                                <div class="small mb-1"><span class="text-muted">Name:</span> ${report.accidentLeadName || '-'}</div>
                                <div class="small mb-1"><span class="text-muted">Phone:</span> ${report.accidentLeadPhone || '-'}</div>
                                <div class="small mb-1"><span class="text-muted">Signature:</span> <span class="fst-italic">${report.accidentLeadSignature || '-'}</span></div>
                                <div class="small"><span class="text-muted">Date:</span> ${report.accidentLeadDate || '-'}</div>
                            </div>
                        </div>
                        <div class="col-md-6">
                            <div class="p-2 bg-white rounded border border-danger-subtle h-100">
                                <div class="small fw-bold text-dark mb-2 border-bottom pb-1">Witness Signature</div>
                                <div class="small mb-1"><span class="text-muted">Name:</span> ${report.accidentWitnessName || '-'}</div>
                                <div class="small mb-1"><span class="text-muted">Phone:</span> ${report.accidentWitnessPhone || '-'}</div>
                                <div class="small mb-1"><span class="text-muted">Signature:</span> <span class="fst-italic">${report.accidentWitnessSignature || '-'}</span></div>
                                <div class="small"><span class="text-muted">Date:</span> ${report.accidentWitnessDate || '-'}</div>
                            </div>
                        </div>
                    </div>
                </div>
                ` : ''}
            </div>
        </div>
        
    </div>
    `;
}
"""
content = content + "\n\n" + new_func

with open('/Users/hamza/VancouverPartyWorksAdmin/src/assets/js/events.js', 'w') as f:
    f.write(content)

