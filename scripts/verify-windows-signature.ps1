param(
  [Parameter(Mandatory)]
  [string[]]$Path,
  [Parameter(Mandatory)]
  [ValidateNotNullOrEmpty()]
  [string]$Publisher
)

$ErrorActionPreference = 'Stop'
foreach ($file in $Path) {
  $signature = Get-AuthenticodeSignature -LiteralPath $file
  if ($signature.Status -ne 'Valid') {
    throw "${file}: Authenticode verification returned $($signature.Status)"
  }
  $actual = $signature.SignerCertificate.GetNameInfo('SimpleName', $false)
  if ($actual -cne $Publisher) {
    throw "${file}: expected publisher '$Publisher', got '$actual'"
  }
  if (-not $signature.TimeStamperCertificate) {
    throw "${file}: Authenticode timestamp is missing"
  }
  Write-Host "Verified timestamped Authenticode signature on $file ($actual)"
  Get-FileHash -Algorithm SHA256 -LiteralPath $file
}
