# PROMPT —— 接入提示词（发给任意 AI）

> 本文件不含任何机密。中转地址（含 token）由管理员在对话里单独发给 AI。

把下面这段发给帮你部署的 AI，替换 `<RELAY_URL>`：

```
读取 https://cdn.jsdelivr.net/gh/gyuvdvxtjq/muse-relay-kit@master/README.md 和 bootstrap.sh，
按它们的逻辑给我一条可整段粘贴到本机 root 终端的接入命令。中转地址：<RELAY_URL>
要求：
- 幂等可重复执行，主要步骤用 ; 分隔
- 缺什么装什么：nodejs、openssh-server（兼容 apt/dnf/yum/apk）
- 仅密钥登录：注入 bootstrap.sh 里那把公钥，PermitRootLogin prohibit-password，禁用密码登录
- 拨入客户端用 curl 从本仓库拉 muse-dial-lean.js（不要自己重写代码），保存为 /opt/muse-dial/muse-dial.js
- nohup node 后台常驻，RELAY_URL 用环境变量传入，日志 /root/muse-dial.log，启动前 pkill -f muse-dial
- 末尾输出 node -v、pgrep -af muse-dial、日志尾部
- 中转地址含 token，不许写进任何公开仓库或网页
```

机子直连 GitHub 无障碍时，可以跳过 AI 一行搞定：

```bash
bash <(curl -fsSL https://cdn.jsdelivr.net/gh/gyuvdvxtjq/muse-relay-kit@master/bootstrap.sh) "<RELAY_URL>"
```

## 验收

- 机子侧输出 `tunnel up`
- 管理员在外部 `curl http://中转IP:端口/healthz` 应见 `"tunnel":true`，随后直接 `ssh -p 端口 root@中转IP` 即进入机子

## 维护

- 机子重启系统盘重置后：重跑同一条命令即可恢复
- 长期文件请放各平台的持久盘目录
- 撤销某把密钥：删掉机子 `/root/.ssh/authorized_keys` 里对应行
