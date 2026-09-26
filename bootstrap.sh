#!/bin/bash
# 机子侧一键拨入: bash bootstrap.sh "ws://中转IP:端口/tunnel?token=xxx"
# 幂等：重复执行安全 | 平台无关：apt/dnf/yum/apk | 零 npm 依赖
# 安全：仅密钥登录（不设任何密码），真实鉴权在机子 /root/.ssh/authorized_keys
set -u
RELAY_URL="${1:-}"
[ -n "${RELAY_URL}" ] || { echo "用法: bash bootstrap.sh <RELAY_URL>"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo '[1/4] SSH 服务 + Node（缺才装）...'
command -v node >/dev/null || {
  if command -v apt-get >/dev/null; then
    apt-get install -y --no-install-recommends nodejs npm 2>/dev/null || { apt-get update -qq; apt-get install -y --no-install-recommends nodejs npm; }
  elif command -v dnf >/dev/null; then dnf install -y nodejs
  elif command -v yum >/dev/null; then yum install -y nodejs
  elif command -v apk >/dev/null; then apk add --no-cache nodejs npm
  else echo '未找到包管理器，请手动安装 nodejs'; exit 1; fi
}
command -v sshd >/dev/null || {
  if command -v apt-get >/dev/null; then
    apt-get install -y --no-install-recommends openssh-server 2>/dev/null || { apt-get update -qq; apt-get install -y --no-install-recommends openssh-server; }
  elif command -v dnf >/dev/null; then dnf install -y openssh-server
  elif command -v yum >/dev/null; then yum install -y openssh-server
  elif command -v apk >/dev/null; then apk add --no-cache openssh
  fi
}

echo '[2/4] 主 AI 公钥 + sshd（仅密钥登录）...'
mkdir -p /run/sshd /root/.ssh
chmod 700 /root/.ssh
grep -q LAPTOP-JLFU2NHD /root/.ssh/authorized_keys 2>/dev/null || echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPQRyZDEtUsarV+rC5do054CloPFfBW2vDf/EAt6iZjQ 86191@LAPTOP-JLFU2NHD' >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
grep -q '^PermitRootLogin' /etc/ssh/sshd_config || echo 'PermitRootLogin prohibit-password' >> /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
grep -q '^PasswordAuthentication' /etc/ssh/sshd_config || echo 'PasswordAuthentication no' >> /etc/ssh/sshd_config
ssh-keygen -A >/dev/null 2>&1
( systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null || { pkill -x sshd 2>/dev/null; sleep 1; /usr/sbin/sshd; } ) 2>/dev/null
pgrep -x sshd >/dev/null || /usr/sbin/sshd

echo '[3/4] 拨入端（零依赖客户端，无 npm）...'
mkdir -p /opt/muse-dial
cd /opt/muse-dial
curl -fsSL "https://cdn.jsdelivr.net/gh/gyuvdvxtjq/muse-relay-kit@master/muse-dial-lean.js" -o muse-dial.js 2>/dev/null \
  || curl -fsSL "https://gh-proxy.com/https://raw.githubusercontent.com/gyuvdvxtjq/muse-relay-kit/master/muse-dial-lean.js" -o muse-dial.js 2>/dev/null \
  || curl -fsSL "https://raw.githubusercontent.com/gyuvdvxtjq/muse-relay-kit/master/muse-dial-lean.js" -o muse-dial.js \
  || { [ -s muse-dial.js ] && echo 'WARN: 拉取失败,沿用本地已有 muse-dial.js' || { echo '拉取失败且无本地副本'; exit 1; }; }

echo '[4/4] 启动拨入...'
pkill -f muse-dial 2>/dev/null
sleep 1
RELAY_URL="$RELAY_URL" nohup node muse-dial.js > /root/muse-dial.log 2>&1 &
sleep 4
grep -q 'tunnel up' /root/muse-dial.log && echo '====== tunnel up, 接入成功 ======' || { echo 'INIT_FAIL'; cat /root/muse-dial.log; }
