# CPU benchmark runner for the Bend 2 quantization kernel.
# For each case: set the active palette, compile seq + par, sweep threads,
# verify exact labels, and write results/cpu.json.
$ErrorActionPreference = "Continue"
$root = "C:\Users\LukeScaggs\Documents\svg-X\experiments\bend2"
$active = "$root\fixtures\active"
$casesDir = "$root\fixtures\cases"
$bend = "/root/.bend/bin/bend"
$wslActive = "/mnt/c/Users/LukeScaggs/Documents/svg-X/experiments/bend2/fixtures/active"
$src = "/mnt/c/Users/LukeScaggs/Documents/svg-X/experiments/bend2/src"
$threads = @(1, 2, 4, 8, 16, 24)
$cases = @("synthetic-1000", "bicycle-1000", "stilllife-1254")

function QuantizeMs([string]$bin, [string[]]$extra) {
  $out = & wsl -d BendExp -- $bin @extra 2>&1 | Out-String
  $m = [regex]::Match($out, "quantize_ms=(\d+)")
  if (-not $m.Success) { throw "no quantize_ms in output: $out" }
  return [int]$m.Groups[1].Value
}

$results = @()
foreach ($case in $cases) {
  Copy-Item "$casesDir\$case\params.bend" "$active\params.bend" -Force
  Copy-Item "$casesDir\$case\rgba.bin" "$active\rgba.bin" -Force
  Copy-Item "$casesDir\$case\labels_double.bin" "$active\labels_double.bin" -Force
  & wsl -d BendExp -- cp "$wslActive/rgba.bin" /root/bendexp/rgba.bin | Out-Null
  & wsl -d BendExp -- $bend "$src/quantize_seq.bend" -o /root/bendexp/quantize_seq 2>&1 | Out-Null
  & wsl -d BendExp -- $bend "$src/quantize_par.bend" -o /root/bendexp/quantize_par 2>&1 | Out-Null

  $seqMs = QuantizeMs "/root/bendexp/quantize_seq" @()
  & wsl -d BendExp -- cp /root/bendexp/labels.bin /root/bendexp/labels_seq.bin | Out-Null
  $seqMismatch = (& wsl -d BendExp -- cmp -l /root/bendexp/labels_seq.bin "$wslActive/labels_double.bin" 2>&1 | Measure-Object).Count

  $par = @()
  foreach ($th in $threads) {
    $ms = QuantizeMs "/root/bendexp/quantize_par" @("--threads", "$th")
    $par += [pscustomobject]@{ threads = $th; ms = $ms }
  }
  & wsl -d BendExp -- cp /root/bendexp/labels.bin /root/bendexp/labels_par.bin | Out-Null
  $parMismatch = (& wsl -d BendExp -- cmp -l /root/bendexp/labels_par.bin "$wslActive/labels_double.bin" 2>&1 | Measure-Object).Count

  $results += [pscustomobject]@{
    case = $case
    seqMs = $seqMs
    seqMismatch = $seqMismatch
    parMismatch = $parMismatch
    par = $par
  }
  $sweepText = ($par | ForEach-Object { "$($_.threads):$($_.ms)" }) -join " "
  Write-Output "$case seq=$seqMs ms; par=$sweepText ; mismatch seq=$seqMismatch par=$parMismatch"
}

$startup = Measure-Command { & wsl -d BendExp -- /bin/true | Out-Null }
$payload = [pscustomobject]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  platform = "Windows->WSL2 BendExp"
  bend = (& wsl -d BendExp -- /root/.bend/bin/bend version 2>&1 | Out-String).Trim()
  chunkBytes = 8192
  forkDepth = 6
  wslTrivialStartupMs = [math]::Round($startup.TotalMilliseconds)
  results = $results
}
$payload | ConvertTo-Json -Depth 8 | Set-Content "$root\results\cpu.json"
Write-Output "wsl trivial startup: $($payload.wslTrivialStartupMs) ms"
