# Console initialization diagnosis

The account bundle disabled schema initialization, but its billing constructor still created funds and usage schema.
An application readiness request could therefore create a trigger before its referenced platform table existed.
The shared constructor now honors the existing account initialization setting.
Omitting that setting preserves standalone billing initialization.

| Fact                                                                                        | Instrument                         | Record                                           | Checked                                                                                     |
| ------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| All 74 migrations pass individually and in transactions on fresh workerd D1                 | Miniflare D1                       | `/tmp/seams-r190-console-migration-control.json` | Both initial table counts are zero                                                          |
| Celld fails migration 0027 after application readiness, naming a trigger introduced in 0094 | Native migration CLI               | `celld-console-mf_l0m0x/migrate.log`             | Runtime, application bundle and migration hashes match the successful native-health control |
| One early application request creates one selected application object                       | Native CLI count after the request | `celld-console-b6on2osf/result.json`             | The control changes the readiness request, with the same runtime, bundle and SQL            |
| Native health readiness leaves selected application objects absent                          | Native CLI count                   | `celld-console-a5qytolg/result.json`             | All 74 migrations and onboarding then pass                                                  |
| The fixed bundle leaves selected objects absent after the application request               | Native CLI count                   | `celld-console-4y1l2q4w/result.json`             | The request returns 404, all 74 migrations pass, then onboarding passes                     |
| Standalone billing defaults remain valid                                                    | Existing billing and Console tests | `/tmp/seams-r190-console-billing-shared-fix.log` | Six checks pass                                                                             |

The CLI count selects `billing_funds_admission`, `platform_service_instances`, and `organizations`.
It proves the relevant contamination is absent. It does not establish absence of every possible schema write.
The earlier count of ten SQLite objects could include runtime objects and did not establish application contamination.

| Cause                                                   | Workerd migrations pass | Matching native-health run passes | Early request creates the trigger                     | Result                                            |
| ------------------------------------------------------- | ----------------------- | --------------------------------- | ----------------------------------------------------- | ------------------------------------------------- |
| Incorrect migration ordering                            | Contradicts             | Contradicts                       | Does not explain                                      | Removed                                           |
| Celld cannot execute the SQL                            | Does not decide         | Contradicts                       | Does not explain                                      | Removed                                           |
| Reused storage alone                                    | Does not decide         | Does not decide                   | Fresh paired control contradicts                      | Removed as the explanation for the paired control |
| Application initialization ignores the disabled setting | Fits                    | Fits                              | Fits the constructor path and exact trigger           | Confirmed                                         |
| The measurement changes the state                       | Fits                    | Fits                              | The application readiness request is that measurement | Confirmed                                         |

Classification: `production_regression` in shared initialization.
The fix passes the account bundle's setting to billing and conditions both initialization calls on it.
An independent review checked the source and raw controls and found no blocking issue.
It did not rerun the tests.

Separate setup failures preceded this diagnosis. The standalone Node driver needed the existing esbuild settings.
The emulator needed its supplied virtual environment. Migration files needed to reside inside the deployment directory.
Those failures changed test setup. The production SQL remains unchanged.
