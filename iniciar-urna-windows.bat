@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo   Urna Presencial Digital
echo ========================================
echo.

where pnpm >nul 2>nul
if errorlevel 1 (
  echo ERRO: pnpm nao foi encontrado.
  echo Instale Node.js 20+ e execute: corepack enable
  pause
  exit /b 1
)

if not exist "node_modules\cross-env\dist\bin\cross-env.js" (
  echo Dependencias nao encontradas. Instalando agora...
  call pnpm install
  if errorlevel 1 (
    echo.
    echo ERRO: nao foi possivel instalar as dependencias.
    pause
    exit /b 1
  )
)

echo Iniciando o servidor...
start "Urna Presencial Digital - Servidor" /D "%~dp0" cmd /k "set HOST=0.0.0.0&& set PORT=3000&& pnpm run dev"

set "LAN_IP="
for /f "delims=" %%I in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object {$_.IPAddress -like '192.168.137.*' -or $_.IPAddress -like '192.168.43.*' -or $_.IPAddress -like '172.20.*.*'} ^| Select-Object -First 1 -ExpandProperty IPAddress)"') do set "LAN_IP=%%I"
if not defined LAN_IP for /f "delims=" %%I in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object {$_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*'} ^| Select-Object -First 1 -ExpandProperty IPAddress)"') do set "LAN_IP=%%I"

echo Aguardando o servidor iniciar...
timeout /t 5 /nobreak >nul
start "" "http://localhost:3000/"

echo.
echo A urna foi aberta em http://localhost:3000/
if defined LAN_IP echo Acesso pela rede: http://%LAN_IP%:3000/
echo O painel administrativo esta em http://localhost:3000/admin
if defined LAN_IP echo Painel pela rede: http://%LAN_IP%:3000/admin
echo.
echo Enderecos IPv4 encontrados neste notebook:
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object {$_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*'} ^| Select-Object IPAddress,InterfaceAlias"
echo Login: Emilia  |  Senha: Emilia@123
echo.
echo Se o acesso pela rede falhar, libere a porta TCP 3000 no Firewall do Windows.
echo No outro notebook, teste: http://%LAN_IP%:3000/api/health
endlocal
