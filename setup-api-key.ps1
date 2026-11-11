# Saves an image-generation API key for the sprite tool.
# The key is stored ONLY in %APPDATA%\agent-sprite-forge\config.json (not in the project folder).
# (Messages are in English to avoid console encoding issues in Windows PowerShell 5.1.)

Write-Host ""
Write-Host "=== Image API key setup ===" -ForegroundColor Cyan
Write-Host "  1) OpenAI  (https://platform.openai.com/api-keys  - needs paid API credits)"
Write-Host "  2) Google Gemini  (https://aistudio.google.com/apikey  - has a FREE tier)"
$choice = Read-Host "Choose provider [1/2]"

switch ($choice.Trim()) {
  '1' { $envName = 'OPENAI_API_KEY'; $hint = 'sk-...' }
  '2' { $envName = 'GEMINI_API_KEY'; $hint = 'AIza...' }
  default { Write-Host "Please run again and enter 1 or 2." -ForegroundColor Red; exit 1 }
}

$secure = Read-Host "Paste the API key ($hint) and press Enter (input is hidden)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$key = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
$key = $key.Trim()

if (-not $key) { Write-Host "Empty key. Run the script again." -ForegroundColor Red; exit 1 }

$dir = Join-Path $env:APPDATA 'agent-sprite-forge'
New-Item -ItemType Directory -Force $dir | Out-Null
$path = Join-Path $dir 'config.json'

# Keep any existing keys in the file
$config = @{}
if (Test-Path $path) {
  try {
    $json = Get-Content $path -Raw | ConvertFrom-Json
    foreach ($p in $json.PSObject.Properties) { $config[$p.Name] = $p.Value }
  } catch {}
}
$config[$envName] = $key
$config | ConvertTo-Json | Set-Content -Encoding utf8 $path

Write-Host ""
Write-Host "Saved: $path  ($envName)" -ForegroundColor Green
Write-Host "Now tell Claude: done!"
