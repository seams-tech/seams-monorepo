# Platform glossary

Use these terms in Platform plans and technical explanations. This glossary changes
wording only. Do not rename code, wire fields, or stored records to match it.

| Term                             | Meaning                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Developer account**            | The person or business that buys Seams services.                                                    |
| **Developer user**               | A person who administers a developer account.                                                       |
| **Developer account membership** | A developer user's access and role within that account.                                             |
| **Developer project**            | A project that groups a developer account's resources and costs.                                    |
| **Product user**                 | A person who uses Wallet or Satyr. Each product owns that user's identity and permissions.          |
| **Native organisation**          | An organisation record owned by Wallet or Satyr. Its ID and rules remain product-defined.           |
| **Project environment**          | A project's development, staging, or production environment. It retains its owning product's scope. |
| **Service instance**             | A Wallet or Satyr product provisioned for a developer project.                                      |

For Seams commercial billing, the **developer account** is the payer. A **product user**
uses Wallet or Satyr under that product's identity and permissions. Do not use either
term as an alias for the other.

## Existing identifier mapping

| Existing term or field                              | Meaning in Platform plans                             |
| --------------------------------------------------- | ----------------------------------------------------- |
| Platform organisation, `organizationId`, or `orgId` | Developer account                                     |
| Platform organisation membership                    | Developer account membership                          |
| Platform `userId`                                   | Developer user identity                               |
| Platform project or `platformProjectId`             | Developer project                                     |
| `billingAccountId`                                  | Developer billing account                             |
| Wallet `environmentId`                              | Wallet project environment, with its existing meaning |
| Satyr organisation or work project                  | Satyr-owned records, with their existing meaning      |

Keep all existing IDs and records unchanged. A storage namespace does not change
ownership semantics. Do not map a native organisation, product user, or work project
to a developer account unless an explicit migration defines that mapping.
