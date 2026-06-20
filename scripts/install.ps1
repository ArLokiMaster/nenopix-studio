# Nenopix Studio CLI — Windows Global Install Script
# Run: .\scripts\install.ps1

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  ⚡ Nenopix Studio CLI — Install Script" -ForegroundColor Cyan
Write-Host "  ───────────────────────────────────────" -ForegroundColor DarkGray
Write-Host ""

# Check Node.js
try {
    $nodeVersion = node --version
    Write-Host "  ✓ Node.js $nodeVersion found" -ForegroundColor Green
} catch {
    Write-Host "  ✗ Node.js not found. Install from: https://nodejs.org" -ForegroundColor Red
    exit 1
}

# Check npm
try {
    $npmVersion = npm --version
    Write-Host "  ✓ npm v$npmVersion found" -ForegroundColor Green
} catch {
    Write-Host "  ✗ npm not found" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "  Installing dependencies..." -ForegroundColor White
npm install

Write-Host ""
Write-Host "  Building TypeScript..." -ForegroundColor White
npm run build

Write-Host ""
Write-Host "  Linking globally..." -ForegroundColor White
npm link

Write-Host ""
Write-Host "  ✓ Nenopix Studio CLI installed successfully!" -ForegroundColor Green
Write-Host ""

# Check if setup has configured providers
Write-Host "  Verifying API key configuration..." -ForegroundColor White
$statusJson = node dist/cli/index.js status --json | Out-String
$status = $statusJson | ConvertFrom-Json

if ($status -and $status.configuredCount -gt 0) {
    Write-Host "  ✓ Found $($status.configuredCount) configured provider(s):" -ForegroundColor Green
    foreach ($p in $status.providers) {
        if ($p.status -eq "available") {
            Write-Host "    - $($p.name) (Ready)" -ForegroundColor Gray
        }
    }
    
    # Test connection of default provider
    $defaultProvider = $status.config.defaultProvider
    Write-Host "  Testing connection for default provider '$defaultProvider'..." -ForegroundColor White
    $testResult = node dist/cli/index.js providers test $defaultProvider | Out-String
    if ($testResult -like "*✓*") {
        Write-Host "  ✓ API key verified and working successfully!" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ Connection test failed. You might need to update your API key." -ForegroundColor Yellow
        Write-Host "  $testResult" -ForegroundColor DarkGray
    }
} else {
    Write-Host "  ⚠ No configured providers found." -ForegroundColor Yellow
    Write-Host "  To generate images, Nenopix Studio needs at least one API key." -ForegroundColor White
    Write-Host "  Supported env variables: NENOPIX_GEMINI_API_KEY, NENOPIX_OPENAI_API_KEY" -ForegroundColor DarkGray
    Write-Host ""

    # Check if non-interactive or redirected input
    $isRedirected = [System.Console]::IsInputRedirected
    $isNonInteractive = [bool]([System.Environment]::GetCommandLineArgs() -like "-NonInteractive")
    $runWizard = $false

    if (-not $isRedirected -and -not $isNonInteractive) {
        $choice = Read-Host "  Would you like to run the setup wizard now? [Y/n]"
        if ($choice -ne "n" -and $choice -ne "N") {
            $runWizard = $true
        }
    }

    if ($runWizard) {
        node dist/cli/index.js config --setup
    } else {
        Write-Host "  You can run the setup wizard later with: nenopix config --setup" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "  Starting Nenopix Studio Web UI..." -ForegroundColor Cyan
Write-Host "  This will start the server and open the browser." -ForegroundColor Gray
Write-Host "  Press Ctrl+C to stop the server." -ForegroundColor DarkGray
Write-Host ""
node dist/cli/index.js ui
