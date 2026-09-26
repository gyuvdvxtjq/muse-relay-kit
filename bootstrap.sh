#!/bin/bash
# 机子侧一键拨入: bash bootstrap.sh "ws://中转IP:端口/tunnel?token=xxx"
# 幂等：重复执行安全。成功标志: tunnel up
set -u
RELAY_URL="$1"
if [ -z "${RELAY_URL:-}" ]; then echo "用法: bash bootstrap.sh <RELAY_URL>"; exit 1; fi

echo '[1/3] SSH 服务 + Node...'
(apt-get update -qq && apt-get install -y -qq openssh-server nodejs npm curl > /dev/null 2>&1) || (sudo apt-get update -qq && sudo apt-get install -y -qq openssh-server nodejs npm > /dev/null 2>&1)
mkdir -p /run/sshd /root/.ssh /opt/muse-dial
chmod 700 /root/.ssh
grep -q LAPTOP-JLFU2NHD /root/.ssh/authorized_keys 2>/dev/null || echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPQRyZDEtUsarV+rC5do054CloPFfBW2vDf/EAt6iZjQ 86191@LAPTOP-JLFU2NHD' >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
echo 'root:WorkBuddy2026' | chpasswd
sed -i 's/#\?PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config
/usr/sbin/sshd 2>/dev/null

echo '[2/3] 拨入端...'
cd /opt/muse-dial
curl -fsSL https://cdn.jsdelivr.net/gh/gyuvdvxtjq/muse-relay-kit@master/muse-dial.js -o muse-dial.js || echo 'WARN: 拉取失败,沿用本地已有 muse-dial.js'
npm config set registry https://registry.npmmirror.com > /dev/null 2>&1
[ -d node_modules ] || npm i ws --silent > /dev/null 2>&1

echo '[3/3] 启动拨入...'
pkill -f muse-dial 2>/dev/null
sleep 1
RELAY_URL="$RELAY_URL" nohup node muse-dial.js > /root/muse-dial.log 2>&1 &
sleep 4
grep -q 'tunnel up' /root/muse-dial.log && echo '====== tunnel up, 接入成功 ======' || { echo 'INIT_FAIL'; cat /root/muse-dial.log; }
