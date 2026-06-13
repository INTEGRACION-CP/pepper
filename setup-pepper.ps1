# setup-pepper.ps1
# Ejecutar desde la carpeta raiz del proyecto pepper
# Uso: .\setup-pepper.ps1

Write-Host "=== Configurando estructura de PEPPER ===" -ForegroundColor Cyan

# Carpetas necesarias
$carpetas = @(
    "api",
    "lib",
    "lib\supabase",
    "lib\memory",
    "lib\agents"
)

foreach ($carpeta in $carpetas) {
    if (-not (Test-Path $carpeta)) {
        New-Item -ItemType Directory -Path $carpeta | Out-Null
        Write-Host "✅ Carpeta creada: $carpeta" -ForegroundColor Green
    } else {
        Write-Host "⏭  Ya existe: $carpeta" -ForegroundColor Yellow
    }
}

# Crear .env.local si no existe
if (-not (Test-Path ".env.local")) {
    $envContent = @"
# Supabase
SUPABASE_URL=https://bhwfgbdgrdzrrrzxwihg.supabase.co
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key_aqui

# Anthropic
ANTHROPIC_API_KEY=tu_api_key_aqui
"@
    $envContent | Out-File -FilePath ".env.local" -Encoding utf8
    Write-Host "✅ Archivo creado: .env.local" -ForegroundColor Green
} else {
    Write-Host "⏭  Ya existe: .env.local" -ForegroundColor Yellow
}

# Crear .env.example
$envExample = @"
# Supabase
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...
"@
$envExample | Out-File -FilePath ".env.example" -Encoding utf8
Write-Host "✅ Archivo creado: .env.example" -ForegroundColor Green

# Agregar .env.local al .gitignore
if (-not (Test-Path ".gitignore")) {
    ".env.local`n.env`nnode_modules/" | Out-File -FilePath ".gitignore" -Encoding utf8
    Write-Host "✅ Archivo creado: .gitignore" -ForegroundColor Green
} else {
    $gitignore = Get-Content ".gitignore"
    if ($gitignore -notcontains ".env.local") {
        Add-Content -Path ".gitignore" -Value "`n.env.local"
        Write-Host "✅ .env.local agregado a .gitignore" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "=== Estructura lista ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "IMPORTANTE: Antes del proximo commit abre .env.local" -ForegroundColor Yellow
Write-Host "y reemplaza 'tu_service_role_key_aqui' con tu clave real de Supabase." -ForegroundColor Yellow
Write-Host ""
Write-Host "La encontras en: Supabase -> Settings -> API -> service_role (secret)" -ForegroundColor Yellow
