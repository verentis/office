# Security policy and public-readiness gates

This integration requires verified signed packages, explicit WOPI processing
consent and current platform document authorization. It is **not certified
production-ready**. Use isolated resources and original fixtures for tests.

Report vulnerabilities through the repository's private vulnerability reporting
facility if enabled; otherwise contact the repository owner privately before
disclosing details. Do not include tokens, cookies, document content, production
URLs, private keys or unredacted logs in an issue. No published response SLA or
supported production release is claimed.

Collaboration alone admits sessions and verifies WOPI operations. Office has no
OAuth client secret, signing/storage authority or standalone WOPI backend.
The wrapper rejects public navigation without a platform-issued embed ticket.
Normal platform API authentication remains separate from WOPI credentials.

Before public release/adoption, owners must complete:

- full repository-history/secret and publication/visibility review;
- vulnerability and license scans of final images and transitive dependencies;
- SBOM/provenance, source/notice redistribution and trademark review;
- intended-use/licensing review of CODE versus supported Collabora products;
- installation/document/action-bound consent and live revocation tests;
- authoritative identity and conditional-write platform tests (gates B–E);
- live origin, iframe sandbox, CSP, proof-key and host navigation threat review;
- operational drain/recovery, backup, scaling, regional policy and TLS review.

Tests do not replace those approvals. Logs disable framework request logging
and CODE user data logging; never enable HTTP body/query logging on WOPI routes.
Browser traces are disabled because launch forms carry bearer credentials.
