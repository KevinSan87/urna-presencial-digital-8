@echo off
setlocal
net session >nul 2>&1
if errorlevel 1 (
  echo Este arquivo precisa ser executado como administrador.
  echo Clique com o botao direito e escolha: Executar como administrador.
  pause
  exit /b 1
)
netsh advfirewall firewall delete rule name="Urna Digital Porta 3000" >nul 2>&1
netsh advfirewall firewall add rule name="Urna Digital Porta 3000" dir=in action=allow protocol=TCP localport=3000 profile=any
if errorlevel 1 (
  echo Nao foi possivel criar a regra do Firewall.
  pause
  exit /b 1
)
echo Porta TCP 3000 liberada com sucesso.
echo Agora inicie a urna e use o endereco LAN mostrado pelo iniciar-urna-windows.bat.
pause
endlocal
