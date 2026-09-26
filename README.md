# muse-relay-kit —— 云端机远程接管套件

> 无公网 IP 的 Linux 机子，通过自建中转实现被任意 AI / 人类远程操作。
> 平台无关：端砚 / 魔搭 / AutoDL / 学校机房 / 任何有终端和出站网络的 Linux。

## 架构

```
任意 SSH 客户端 / 浏览器 / AI Agent
      │
      ▼
中转(公网,自建): <中转IP>:<端口>        ← relay/ 目录，部署在任意有公网入口的容器
      │ WebSocket 隧道（内网机主动拨入，断线自动重连）
      ▼
云端机 sshd:22（真实鉴权在机子的 authorized_keys）
```

**三层分离**：连接层（本套件，平台无关）/ 身份层（authorized_keys 公钥制）/ 存储层（各平台自定持久盘路径）。

## 目录

| 文件 | 用途 | 放哪 |
|---|---|---|
| `bootstrap.sh` | 机子侧一键拨入（装 SSH+Node+启动隧道，幂等，apt/dnf/yum/apk 兼容，零 npm 依赖） | 目标机终端粘贴/执行 |
| `muse-dial-lean.js` | 拨入端程序（零依赖，node 标准库实现 WebSocket；bootstrap 自动拉取，此为源码） | 目标机 |
| `muse-dial.js` | 旧版拨入端（依赖 npm ws，仅作备份，新部署勿用） | 目标机 |
| `relay/` | 中转服务端（单端口分流 SSH/Web 终端） | 公网容器（如 Katabump） |
| `PROMPT.md` | 给任意 AI Agent 的接入提示词模板（不含机密） | 发给 AI |

## 拉取地址（三链自动降级，国内优先）

| 源 | URL 前缀 | 国内可达 |
|---|---|---|
| jsDelivr CDN | `https://cdn.jsdelivr.net/gh/gyuvdvxtjq/muse-relay-kit@master/` | ✅ 推荐 |
| gh-proxy 加速 | `https://gh-proxy.com/https://raw.githubusercontent.com/gyuvdvxtjq/muse-relay-kit/master/` | ✅ |
| GitHub raw | `https://raw.githubusercontent.com/gyuvdvxtjq/muse-relay-kit/master/` | ❌ 需科学上网 |

## 机子侧接入（一条命令）

在目标机终端执行（RELAY_URL 向管理员要，格式 `ws://中转IP:端口/tunnel?token=xxx`）：

```bash
bash <(curl -fsSL https://cdn.jsdelivr.net/gh/gyuvdvxtjq/muse-relay-kit@master/bootstrap.sh) "RELAY_URL放这里"
```

jsDelivr 不可用时自动降级版：

```bash
curl -fsSL https://cdn.jsdelivr.net/gh/gyuvdvxtjq/muse-relay-kit@master/bootstrap.sh -o bootstrap.sh 2>/dev/null || curl -fsSL https://gh-proxy.com/https://raw.githubusercontent.com/gyuvdvxtjq/muse-relay-kit/master/bootstrap.sh -o bootstrap.sh 2>/dev/null || curl -fsSL https://raw.githubusercontent.com/gyuvdvxtjq/muse-relay-kit/master/bootstrap.sh -o bootstrap.sh
bash bootstrap.sh "RELAY_URL放这里"
```

成功标志：输出 `tunnel up`。

## 给其他 AI 授权

每个 AI 用自己的密钥：让该 AI 输出它的 `~/.ssh/id_ed25519.pub` 内容，追加到目标机 `/root/.ssh/authorized_keys`（每行一把）。撤销 = 删对应行。

## 人类浏览器入口

```
http://<中转IP>:<端口>/?token=<PAGE_TOKEN>
```

## 中转部署（换平台/重建时用）

把 `relay/` 上传到任意支持 Node 的容器，设置环境变量：

- `PAGE_TOKEN` / `TUNNEL_TOKEN`：访问口令（必填）
- `PORT` 或 `SERVER_PORT`：监听端口（平台通常自动注入）
- `SSH_PRIVATE_KEY`：Web 终端用的私钥（PEM），或把 `id_ed25519_relay` 放同目录

启动：`npm install && npm start`。自检：`http://<IP>:<端口>/healthz` 返回 `{"ok":true,...}`。

## 安全规则

1. RELAY_URL / token 不进任何公开仓库、不发给不可信方
2. 每把密钥对应一个使用者，撤销 = 删 authorized_keys 对应行
3. 机子仅密钥登录（bootstrap 已强制 PermitRootLogin prohibit-password + 禁用密码），勿在机子上设密码
4. 中转容器若为免费档，注意续期周期（如 Katabump 4 天）
5. Web 终端为明文 HTTP，勿在公共网络输入敏感内容
