@echo off
title KHOI DONG UNG DUNG NGHITTS
cd /d "%~dp0nghitts"

echo ===========================================
echo        DANG KHOI DONG UNG DUNG NGHITTS
echo ===========================================

:: Kiem tra thu vien da duoc cai dat chua
if not exist "node_modules" (
    echo Dang tu dong cai dat cac thu vien can thiet, vui long cho...
    npm install
)

echo Dang mo trinh duyet...
:: Mo trinh duyet
start http://localhost:5173

echo Dang khoi chay may chu...
:: Khoi dong server
npm run dev

pause
