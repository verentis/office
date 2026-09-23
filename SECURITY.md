# Security policy and public-readiness gates

This is an experimental, prerequisite-gated integration, **not production-ready**.
Do not use real documents, personal data or platform credentials in the harness.
The synthetic identity is intentionally public; loopback binding is mandatory.

Report vulnerabilities through the repository's private vulnerability reporting
facility if enabled; otherwise contact the repository owner privately before
disclosing details. Do not include tokens, cookies, document content, production
URLs, private keys or unredacted logs in an issue. No published response SLA or
supported production release is claimed.

Live admission is permanently denied in the current backend. There is no
production in-memory coordination or invented trusted-service impersonation.
The test host is built by a separate Dockerfile outside `deploy/`.

Before public release/adoption, owners must complete:

- full repository-history/secret and publication/visibility review;
- vulnerability and license scans of final images and transitive dependencies;
- SBOM/provenance, source/notice redistribution and trademark review;
- intended-use/licensing review of CODE versus supported Collabora products;
- app-audience/installation/branch-bound delegation and consent/revocation tests;
- authoritative identity and conditional-write platform tests (gates B–E);
- live origin, iframe sandbox, CSP, proof-key and host navigation threat review;
- operational drain/recovery, backup, scaling, regional policy and TLS review.

Tests do not replace those approvals. Logs disable framework request logging
and CODE user data logging; never enable HTTP body/query logging on WOPI routes.
Browser traces are disabled because launch forms carry bearer credentials.
