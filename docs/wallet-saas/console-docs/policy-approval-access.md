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

The server sets approval safeguards. Policy publication requires one approval.
Key export requires two approvals from distinct actors. A key-export requester
cannot approve their own request. Each key-export approver must complete a fresh
WebAuthn step-up in the same Console session. Request bodies cannot set the
approval count or claim that step-up succeeded.

The same rules apply to key-export records. The server sets their two-approver
quorum and checks each approver's fresh, session-bound step-up.
