#!/bin/bash
# Tu dong chuyen den thu muc chua script nay
cd "$(dirname "$0")"

echo "==========================================="
echo "       DANG KHOI DONG UNG DUNG NGHITTS     "
echo "==========================================="

# Kiem tra thu vien da duoc cai dat chua
if [ ! -d "node_modules" ]; then
    echo "Dang tu dong cai dat cac thu vien can thiet, vui long cho..."
    npm install
fi

echo "Dang mo trinh duyet..."
# Mo trinh duyet
open "http://localhost:5173"

echo "Dang khoi chay may chu..."
# Khoi dong server
npm run dev
