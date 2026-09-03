# Functional Low-Level Design: Clinical Allergy Capture at First Encounter
**Document Reference:** FLLD-CLIN-11 (Functional Low-Level Design)
**Workstream:** Clinical Design & Patient Safety
**Author:** Dr Fiona Gallagher (Consultant Anaesthetist; Clinical Safety Officer)
**Approved Date:** 19 February 2026
**Version:** 2.0 (Final Approved)
**Target Platform:** Aurora EPR Release 4.2
**Clinical Safety Authority:** Meridian Health CSG (Clinical Safety Group)

## 1. Executive Summary & Clinical Governance
This design specifies the mandatory clinical workflow for establishing patient allergy and intolerance profiles in Aurora EPR. Following Clinical Safety Case Review CSG-2026-08, direct automated ingestion of legacy PAS allergy data was evaluated and classified as an unacceptable clinical prescribing hazard.

## 2. Clinical Safety Baseline & Workflow Requirements

### CLIN-11-R01: Unpopulated Allergy Panel at Go-Live
The Aurora Allergy & Intolerance clinical summary panel shall be unpopulated and empty at go-live for all migrated patients, to ensure unverified legacy data does not compromise acute prescribing decisions.

### CLIN-11-R02: Prohibition of Unverified Legacy Data Ingestion
Legacy allergy data must never populate a clinical field, because the Clinical Safety Group ruled it unsafe for prescribing due to inconsistent coding and unverified severity in the legacy PAS.

### CLIN-11-R03: Point-of-Care Allergy Reconciliation
Allergy and intolerance profiles shall be captured directly from the patient by an authorised registered prescriber during the patient's first physical or virtual clinical appointment after go-live.

### CLIN-11-R04: Prescribing Hard-Stop
The electronic prescribing and medicines administration (ePMA) module shall enforce a hard-stop blocking all non-emergency drug orders until point-of-care allergy reconciliation has been completed by an authorised clinician. Emergency orders are exempt from the hard-stop.

### CLIN-11-R05: Direct Patient Elicitation of Severity
Allergy severity and adverse reaction manifestations shall be captured directly from the patient at first appointment, never inferred or derived from automated algorithms or unverified historical free-text notes.

### CLIN-11-R06: Clinical Decision Support Rule Alignment
Point-of-care captured allergies shall immediately trigger real-time drug-allergy interaction (DAI) alerts within the Aurora pharmacy engine upon confirmed clinician signing.

## 3. Governance and Safety Approvals
- Dr Fiona Gallagher, Consultant Anaesthetist and Clinical Safety Officer (Approved: 19-Feb-2026)
- Prof Alistair Finch, Medical Director and Chair, CSG (Approved: 19-Feb-2026)
- Dr Eleanor Vance, Clinical Lead Pharmacy & Therapeutics (Approved: 19-Feb-2026)
