# Desktop signing rehearsal

The **Desktop signing rehearsal** workflow runs on demand for a `main`
commit with successful CI. Choose Windows, macOS, or both. The jobs verify
and smoke-test the resulting distribution files on their runners and record
SHA-256 hashes. They use `--publish never` and have no artifact upload step.

## GitHub environments

In **Settings → Environments**, create `signing-windows` and `signing-macos`.
Restrict deployment branches to `main` and use required reviewers to approve
each rehearsal. Store signing values in those environments. Keep private
keys out of repository files, chat, and logs.

[GitHub environment setup](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)

## Windows

Create or reuse an Azure Artifact Signing account with completed publisher
identity validation and a **Public Trust** certificate profile. Create a
Microsoft Entra app registration and service principal for this repository.
Give the principal the **Artifact Signing Certificate Profile Signer** role
at the signing profile's scope.

Create a federated identity credential on the app registration with these
values:

| Field    | Value                                              |
| -------- | -------------------------------------------------- |
| Issuer   | `https://token.actions.githubusercontent.com`      |
| Subject  | `repo:lukifer23/svg-X:environment:signing-windows` |
| Audience | `api://AzureADTokenExchange`                       |

Set these **environment variables** in `signing-windows`:

| Variable                    | Value                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `AZURE_CLIENT_ID`           | Entra app registration's application (client) ID                                                                                     |
| `AZURE_TENANT_ID`           | Entra directory (tenant) ID                                                                                                          |
| `AZURE_SUBSCRIPTION_ID`     | Subscription ID that contains the signing account                                                                                    |
| `AZURE_SIGNING_ENDPOINT`    | HTTPS regional endpoint for the account                                                                                              |
| `AZURE_SIGNING_ACCOUNT`     | Artifact Signing account name                                                                                                        |
| `AZURE_SIGNING_PROFILE`     | Public Trust certificate profile name                                                                                                |
| `WINDOWS_SIGNING_PUBLISHER` | Expected certificate signer display name, exactly as PowerShell returns it via `SignerCertificate.GetNameInfo('SimpleName', $false)` |

GitHub OIDC supplies the authentication token. This path requires no Azure
client secret, Windows PFX, or personal access token. The account owner must
complete Azure publisher validation before a public-trust signature can be
issued.

The job resource-edits and signs the inner app EXE before packing it into the
portable EXE, then signs the wrapper. Both files must have valid Authenticode
signatures, the configured publisher, and an RFC 3161 timestamp. The test
launches the finished portable EXE and verifies a Color conversion.

[Azure Artifact Signing setup](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart) ·
[GitHub OIDC for Azure](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-azure) ·
[Microsoft signing action](https://github.com/Azure/artifact-signing-action)

## macOS

Use an Apple Developer Program team. Export a valid **Developer ID
Application** certificate and its matching private key together to a
password-protected `.p12`. Create an **App Store Connect team API key** with
Developer access or higher for notarization. Download its `AuthKey_<KEYID>.p8`
file and record the key ID and issuer ID.

Set the following in `signing-macos`:

| Type     | Name                           | Value                                                  |
| -------- | ------------------------------ | ------------------------------------------------------ |
| Secret   | `MACOS_CERTIFICATE_P12_BASE64` | Base64 of the complete `.p12` file                     |
| Secret   | `MACOS_CERTIFICATE_PASSWORD`   | Export password for that `.p12`                        |
| Secret   | `APPLE_API_KEY_P8_BASE64`      | Base64 of the complete App Store Connect `.p8` file    |
| Variable | `APPLE_API_KEY_ID`             | App Store Connect key ID                               |
| Variable | `APPLE_API_ISSUER`             | App Store Connect team issuer UUID                     |
| Variable | `APPLE_TEAM_ID`                | Apple Developer Team ID for the Developer ID signature |

For example, the macOS command `base64 -i path/to/file.p12 | pbcopy` copies
the encoded file into the clipboard for entry as a GitHub secret. Use the
same command with the `.p8` file for the API key secret.

The builder signs the app with Hardened Runtime and staples its notarization
ticket before creating the ZIP and signed DMG. The job also submits the DMG to
Apple, requires an accepted response, logs the submission ID, staples the
ticket, and verifies Gatekeeper assessment. It checks the Developer ID,
team, runtime, and ticket on both app copies taken from the actual DMG and ZIP
before running the conversion smoke.

[Apple distribution packaging](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution) ·
[Apple notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)

## Release evidence

A successful rehearsal qualifies the exact SHA-256 hashes in its logs. A
future distribution still needs clean-device checks for SmartScreen,
quarantined macOS downloads, and offline Gatekeeper behavior. The second-device
LAN check remains tracked separately.
