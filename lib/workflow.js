// Shared constants for the v1.3 User -> Reviewer -> Approver workflow.
// Single source of truth for state names so BFF endpoints can't drift.

export const WORKFLOW_STATES = [
  "Not Started",
  "In Progress",
  "Pending Review",
  "Pending Approval",
  "Rejected",
  "Compliant",
  "Complied with Condition",
  "Not Compliant",
];

// Approver's terminal decision -> the simple `status` value that drives the
// existing Overview KPIs / radar / grade calculations (unchanged since v1.0).
export const DECISION_TO_STATUS = {
  compliant: "Compliant",
  complied_with_condition: "Partial",
  not_compliant: "Not Compliant",
};

export const DECISION_TO_WORKFLOW_STATE = {
  compliant: "Compliant",
  complied_with_condition: "Complied with Condition",
  not_compliant: "Not Compliant",
};

export const SUBMITTABLE_STATES = ["Not Started", "In Progress", "Rejected"];
