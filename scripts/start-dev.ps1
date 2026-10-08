$ErrorActionPreference = 'Stop'
$axonRoot = Split-Path -Parent $PSScriptRoot
$axonOutput = Join-Path $axonRoot 'release'
$axonProfile = Join-Path $axonOutput 'development-profile'
New-Item -ItemType Directory -Path $axonProfile -Force | Out-Null

try {
    # Codex/Explorer may still carry PATH from before Claude was installed.
    $axonLocalBin = Join-Path $env:USERPROFILE '.local\bin'
    if ((Test-Path -LiteralPath $axonLocalBin) -and -not (($env:Path -split ';') -contains $axonLocalBin)) {
        $env:Path = $env:Path.TrimEnd(';') + ';' + $axonLocalBin
    }
    # Repeated shortcut clicks reuse the development window and its live sessions.
    $axonExisting = Get-CimInstance Win32_Process -Filter "name = 'electron.exe'" |
        Where-Object { $_.CommandLine -and $_.CommandLine.Contains("--user-data-dir=$axonProfile") -and -not $_.CommandLine.Contains('--type=') } |
        Select-Object -First 1
    if ($axonExisting) {
        $axonShell = New-Object -ComObject WScript.Shell
        $null = $axonShell.AppActivate([int]$axonExisting.ProcessId)
        exit 0
    }

    $axonNode = (Get-Command node.exe -ErrorAction Stop).Source
    $axonCli = Join-Path $axonRoot 'node_modules\electron-vite\bin\electron-vite.js'
    if (-not (Test-Path -LiteralPath $axonCli)) {
        throw 'Development dependencies are missing. Install the project dependencies first.'
    }
    # Start the helper without a console window; Electron opens the application UI.
    $axonArguments = '"{0}" dev -- "--user-data-dir={1}"' -f $axonCli, $axonProfile
    $axonProcess = Start-Process -FilePath $axonNode -ArgumentList $axonArguments `
        -WorkingDirectory $axonRoot -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $axonOutput 'dev-server.log') `
        -RedirectStandardError (Join-Path $axonOutput 'dev-server-error.log') -PassThru
    Set-Content -LiteralPath (Join-Path $axonOutput 'dev-server.pid') -Value $axonProcess.Id
} catch {
    $_ | Out-String | Set-Content -LiteralPath (Join-Path $axonOutput 'dev-launch-error.log')
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
        "Could not launch AxonSSH development mode.`n$($_.Exception.Message)",
        'AxonSSH', 'OK', 'Error') | Out-Null
    exit 1
}
