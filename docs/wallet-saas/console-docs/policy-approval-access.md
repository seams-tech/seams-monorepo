# Wallet Console policy and approval access

Owners and administrators can inspect policies, approvals, and environments across
their organization. A project member can inspect only resources that apply to an
assigned project.

Project editors can create and change transaction policies assigned to projects or
environments they can edit. A shared policy is editable by a member only when every
assignment is within that member's editable projects. Members cannot change an
organization assignment or a wallet assignment. A wallet assignment uses a wallet
ID without a project ID, so it cannot prove one project owns that assignment.

Gas sponsorship policy access follows the policy's project and environment scope.
Members can view an organization-wide policy. Only an owner or administrator can
change an organization-wide policy.

An approval request names one policy or key-export record. A project member can
read or decide the request only when its project and target resource are within
that member's access. The publish and export routes require an approved request
for the exact target resource.

The server records a digest of the policy's normalized rules when it creates a
publication approval. Publication checks that digest against the current rules.
The D1 update also checks the expected rules and version before it writes a
published version. Publishing different rules needs a new approval. Approvals
created before this digest existed cannot publish a policy.

The server sets approval safeguards. Policy publication requires one approval.
Key export requires two approvals from distinct actors. A key-export requester
cannot approve their own request. Each key-export approver must complete a fresh
WebAuthn step-up in the same Console session. Request bodies cannot set the
approval count or claim that step-up succeeded.

The same rules apply to key-export records. The server sets their two-approver
quorum and checks each approver's fresh, session-bound step-up.

The first Console step-up passkey requires proof from a Google or GitHub sign-in
completed within five minutes. Adding another passkey requires a separate proof
returned by an assertion with an existing passkey. Both proofs travel in the
request body and expire after five minutes. A copied Console session alone cannot
enroll a passkey. Registering a passkey does not authorize an operation. The user
must complete a separate passkey assertion afterward.
