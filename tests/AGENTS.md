# tests/ — agent instructions

Public Wallet lifecycle contracts and their normative specification live in the
separate `seams-wallet` repository. Tests retained here own private Console
composition, persistence, and deployed product flows.

Do not add unit tests. Prefer a medium-to-hard E2E scenario that verifies intended
product behavior and writes repeatable evidence. Keep existing focused private tests
only where the invariant cannot be observed through a product E2E flow, such as a
wire vector, type constraint, D1 migration, or transactional race.

Before changing code for a failing test, identify the invariant and compare it to
current domain types and the owning specification. Classify the failure as
`production_regression`, `valid_test_needs_update`, `obsolete_test_or_fixture`, or
`environment_or_infrastructure_failure`. Fix production regressions in production;
remove obsolete tests, fixtures, mocks, and guards. Do not restore retired source paths
to satisfy a test.

Complex domain-state records in retained tests come from shared branch-specific
factories. Do not use handwritten session, auth, signing, or persistence literals.
