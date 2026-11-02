# Personal data incident procedure

This operational draft is for the owner and deployment operator. Verify named responders and the privacy contact before hosted launch.

1. Record discovery time in UTC, appoint an incident lead and preserve the smallest necessary evidence in a restricted incident record. Do not copy raw repository content or credentials into GitHub issues, chat or ordinary logs.
2. Contain the exposure: revoke affected sessions and credentials, stop affected workers or relay channels, rotate compromised secrets and restrict the affected integration. Preserve provider-side rights that were not granted by Geld.
3. Establish affected systems, data categories, users and customers, access window and likely consequences. Record what is known, uncertain and being investigated. Notify customers/controllers promptly when Geld acts as their processor.
4. Assess notification duties immediately. Under GDPR, notify the competent supervisory authority without undue delay and, where required, within 72 hours of becoming aware. Document reasons for delay and supply missing details in phases. Notify affected people without undue delay where the breach is likely to create a high risk, unless a lawful exception applies. Assess other applicable laws and contractual deadlines.
5. Use plain factual communications describing the incident, likely consequences, mitigation and a working contact. Owner approval of publication does not remove statutory notification duties.
6. Validate the fix, restore access from known-good state, verify revocation and audit continuity, and monitor recurrence. Document lessons, owners and deadlines. Retain only evidence needed for the incident and legal obligations under a specific retention decision.

Run a tabletop exercise before launch, including a leaked provider token, an unavailable customer content database during erasure, a compromised relay channel and a malicious webhook. Test the privacy mailbox, backups and recovery procedures. This document does not assert that an exercise or security certification has already occurred.
