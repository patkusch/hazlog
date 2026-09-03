# Functional Low-Level Design: Allergy Data Migration
**Document Reference:** FLLD-DM-04 (Functional Low-Level Design)
**Workstream:** Patient Data Migration & PAS Cutover
**Author:** David Vance (Lead Migration Architect)
**Approved Date:** 14 January 2026
**Version:** 3.0 (Final Approved)
**Target Platform:** Aurora EPR Release 4.2
**Source Platform:** Legacy CareTrak PAS v11.3
**Commercial Note:** CareTrak decommission deadline 30 June 2026; supplier extension fee £412,000 per quarter thereafter (contract CT-2019-SVC-114, schedule 4).

## 1. Executive Summary & Scope
This design governs the extraction, transformation and automated migration of historical patient allergy and adverse drug reaction (ADR) records from the legacy CareTrak PAS into the Aurora EPR core database schema.

## 2. Technical Architecture & Cutover Strategy
Historical allergy records represent a foundational safety element for longitudinal patient care. During the scheduled cutover weekend, legacy allergy entities will be extracted via the ETL staging layer, mapped to national terminology standards, and directly populated into the active patient record.

## 3. Detailed Functional Requirements

### DM-04-R01: Historical Allergy Record Migration
All historical allergy and adverse reaction records associated with active and archived patient master records in CareTrak PAS (approx. 1.4 million records spanning 2004-2025) shall be migrated into Aurora EPR during the cutover window.

### DM-04-R02: SNOMED CT Terminology Coding
Legacy allergen identifiers and free-text substance labels shall undergo best-effort algorithmic matching against the UK NHS SNOMED CT drug and substance subset (release v34.1). Unmapped items shall be assigned SNOMED code 716186003 (No known allergy) with the legacy text retained in secondary notes.

### DM-04-R03: Immediate Visibility in Active Clinical Panel
All migrated allergy records shall be rendered immediately visible and active in the Aurora Allergy & Intolerance clinical summary panel upon initial user login at go-live.

### DM-04-R04: Algorithmic Severity Derivation from Legacy Notes
Allergy severity classifications (Mild, Moderate, Severe, Life-Threatening) shall be algorithmically inferred from legacy free-text clinical notes and mapped into Aurora severity tiers using regex keyword extraction.

### DM-04-R05: Severity Default on Parse Failure
Where no severity keyword can be parsed from the legacy note, the record shall be migrated with severity defaulted to "Unknown" and shall remain active and visible in the clinical summary panel pending review at the patient's next encounter.

### DM-04-R06: Audit Logging and Clinician Attestation
The system shall preserve the original legacy recording timestamp, legacy clinician ID and migration batch identifier for every migrated allergy entity to support medicolegal compliance.

### DM-04-R07: Duplicate Resolution Mechanism
Where duplicate allergy entries exist for a single patient with matching substance concepts, the migration engine shall merge them into a single active record, preserving the highest recorded severity level.

### DM-04-R08: Paediatric Verification Flag
Allergy records pertaining to paediatric patients under 16 years of age shall carry a mandatory verification flag requiring secondary review at the subsequent hospital encounter.

### DM-04-R09: Transformation Failure Handling
Any record failing structural schema validation shall be diverted to the staging exception queue for manual resolution within 72 hours of cutover completion.

## 4. Sign-Off and Approvals
- David Vance, Lead Migration Architect (Approved: 14-Jan-2026)
- Sarah Jenkins, Migration Workstream Lead (Approved: 14-Jan-2026)
- Arthur Pendelton, Solution Assurance SME (Approved: 14-Jan-2026)
