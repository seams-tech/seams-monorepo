# Platform glossary

Use these terms in Platform plans, API designs, and technical explanations.
This glossary changes documentation only. Map concepts to existing entities before
adding tables or renaming code, wire fields, or persisted records.

| Term                             | Meaning                                                                              | Example                           |
| -------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------- |
| **Developer account**            | The person or business that buys Seams services                                      | Acme Software                     |
| **Developer user**               | An identity that can administer developer accounts through the Platform              | An Acme engineer                  |
| **Developer account membership** | A developer user's role and permissions within a developer account                   | Acme account administrator        |
| **Application**                  | A developer-built product and the outer scope for its users and organisations        | Acme CRM                          |
| **Organisation**                 | A team or business using an application                                              | Northstar Bakery                  |
| **User**                         | An identity within an application                                                    | A Northstar employee              |
| **Membership**                   | A user's role and permissions within an organisation                                 | Northstar administrator           |
| **Project**                      | A resource group within an organisation, with project-specific access where required | Northstar's inventory project     |
| **Project environment**          | A project's deployment stage and associated resource scope                           | Development, staging, production  |
| **Developer project**            | The existing Platform resource and cost group under a developer account              | Acme's Wallet integration project |
| **Service instance**             | A product provisioned for a developer project                                        | Its Wallet or Satyr instance      |

The proposed application-facing hierarchy is:

```text
Developer account
└── Application
    ├── Users
    └── Organisations
        ├── Memberships
        └── Projects
            └── Project environments
                └── Resources and wallets
```

A user can join several organisations within an application. A person can also
hold a developer account membership. These memberships confer separate
authority. Organisation membership alone does not grant wallet signing authority.
Project environments scope deployment resources and credentials. Specify identity
and session separation explicitly. An environment name alone does not establish it.

## Billing and audience

- **Developer billing:** Seams charges a developer account for Seams services.
- **Application billing:** A developer charges its end customers for its application.
- **Developer customer:** The buyer of Seams, when discussing the commercial relationship.
- **End customer:** The developer's customer. An organisation represents a B2B end customer;
  an individual user can be a B2C end customer.
- **Stripe Customer:** A payment-provider object. Name the billing relationship it belongs to.

Avoid bare “customer” when both commercial relationships are in scope. Use entity
names in APIs and contracts. Use **Application** for the outer application scope and
**ProjectEnvironment** for a project's deployment stage. Qualify existing
operational terms such as **Satyr native tenant** or **Wallet native organisation**.

## Existing implementation mapping

| Existing term or identifier                                  | Meaning in these Platform plans                                                   |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Platform organisation; Platform `organizationId` / `orgId`   | Developer account                                                                 |
| Platform organisation membership                             | Developer account membership                                                      |
| Platform `userId`                                            | Developer user identity; application users need their own scope                   |
| Platform project; Platform `projectId` / `platformProjectId` | Developer project                                                                 |
| Platform `billingAccountId`                                  | Developer billing account                                                         |
| Wallet `environmentId`                                       | An existing Wallet project environment; retain its product-owned semantics        |
| Satyr native environment                                     | An existing native lifecycle scope; no automatic mapping to a project environment |
| Satyr native organisation and work project                   | Existing product resources with native access rules                               |

Keep those implementation identifiers unchanged. A storage namespace is not proof
of application isolation. The public application/organisation hierarchy still needs
an implementation design. The current developer-project/service-instance model
does not establish it. Do not equate a developer project with an application
or an end-customer project without an explicit mapping.

For new designs, prefer `developerAccountId`, `applicationId`,
`organizationId`, `userId`, `membershipId`, `projectId`, and `projectEnvironmentId`.
Distinguish `DeveloperAccountMembership` from `OrganizationMembership`.
These names are design vocabulary, not newly implemented API fields or types.
