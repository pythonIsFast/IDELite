$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path "$PSScriptRoot\..\..").Path
$Version = (Get-Content "$Root\VERSION" -Raw).Trim()
$Build = "$Root\build\windows"
$Dist = "$Root\dist\windows"

python -m PyInstaller --noconfirm --clean --windowed --name IDELite `
  --distpath $Dist --workpath $Build --specpath $Build `
  --collect-all webview `
  --add-data "$Root\idelite;idelite" `
  "$Root\run.py"

Copy-Item "$Root\VERSION" "$Dist\IDELite\version.txt"
$InnoSetup = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
if (!(Test-Path $InnoSetup)) { throw "Inno Setup 6 is not installed" }
& $InnoSetup "/DAppVersion=$Version" "/DBuildDir=$Dist" "/O$Root\dist" "$PSScriptRoot\idelite.iss"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
