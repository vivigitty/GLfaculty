# UAT deployment runbook (Ubuntu 24.04 VM)

Single-server deployment: Node.js app (systemd) behind nginx with HTTPS, YAML data on the VM's disk.
Replace `SERVER_IP` with the server's address (or its DNS name if IT assigns one).

## Layout
| What | Where |
|---|---|
| App code | `/opt/rts/app` (owned by service user `rts`) |
| Settings | `/opt/rts/app/.env.local` (mode 600, never committed) |
| Data (durable) | `/var/lib/rts/data` |
| Backups | `/var/backups/rts` (copy off the server regularly) |
| Service | `systemctl status rts`, logs `journalctl -u rts -f` |
| Web | nginx :443 → `127.0.0.1:3000`; :80 redirects to HTTPS |

## 0. Connect
VPN → `ssh ubuntuadmin@SERVER_IP` (PuTTY: Host = SERVER_IP, port 22). If `sudo` is refused, use `su -`
(root password) and run the commands without `sudo`.

## 1. System packages and Node.js 22
```bash
sudo apt-get update && sudo apt-get -y upgrade
sudo apt-get install -y git nginx openssl ufw curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # v22.x
```
If downloads time out, the server needs internet access (or the college HTTP proxy configured) — ask IT.

## 2. Service user and folders
```bash
sudo useradd --system --create-home --home-dir /opt/rts --shell /bin/bash rts
sudo mkdir -p /var/lib/rts/data /var/backups/rts
sudo chown -R rts:rts /var/lib/rts /var/backups/rts
sudo chmod 750 /var/lib/rts /var/lib/rts/data
```

## 3. Get the code
**Option A — read-only deploy key (recommended; makes updates a `git pull`):**
```bash
sudo -u rts ssh-keygen -t ed25519 -N "" -f /opt/rts/.ssh/id_ed25519 -C "rts-uat-server"
sudo -u rts cat /opt/rts/.ssh/id_ed25519.pub
```
GitHub → repository → Settings → Deploy keys → Add deploy key → paste, leave "Allow write access" **off**. Then:
```bash
sudo -u rts git clone git@github.com:vivigitty/GLfaculty.git /opt/rts/app
```
If port 22 to GitHub is blocked, use `ssh://git@ssh.github.com:443/vivigitty/GLfaculty.git`.

**Option B — no GitHub access from the server:** download the ZIP (GitHub → Code → Download ZIP) on your
laptop, upload it with WinSCP to `/tmp`, then:
```bash
sudo apt-get install -y unzip
sudo unzip /tmp/GLfaculty-main.zip -d /opt/rts && sudo mv /opt/rts/GLfaculty-main /opt/rts/app && sudo chown -R rts:rts /opt/rts/app
```

## 4. Settings (`.env.local`)
Generate the session secret and the Admin password hash:
```bash
openssl rand -hex 32
```
```bash
cd /opt/rts/app && sudo -u rts npm ci
```
```bash
cd /opt/rts/app && sudo -u rts npm run hash-password -- "a-long-admin-password"
```
Create the file:
```bash
sudo -u rts nano /opt/rts/app/.env.local
```
```
DATA_DIR=/var/lib/rts/data
ALLOW_EPHEMERAL_DATA_DIR=false
ADMIN_LOGIN_USERNAME=admin
ADMIN_LOGIN_PASSWORD_HASH=<paste the whole value printed by hash-password, including the \$ signs>
SESSION_SECRET=<paste the openssl output>
SESSION_TTL_MINUTES=120
APP_BASE_URL=https://SERVER_IP
EMAIL_PROVIDER=smtp
EMAIL_FROM="RTS Office <rts-office@your-college.edu>"
ADMIN_NOTIFY_EMAIL=rts-office@your-college.edu
SMTP_HOST=<college SMTP host, or smtp.gmail.com>
SMTP_PORT=587
SMTP_USER=<SMTP user>
SMTP_PASSWORD=<SMTP / app password>
EMAIL_WEBHOOK_SECRET=
```
```bash
sudo chmod 600 /opt/rts/app/.env.local
```
Email notes: access codes are **emailed** and shown to the Admin only if sending fails, so UAT needs working
SMTP. Until SMTP is ready you may set `EMAIL_PROVIDER=outbox`; messages (including codes) are then written
to `/var/lib/rts/data/outbox/*.eml` and must be read on the server — use only with test faculty records.

## 5. Build and seed
```bash
cd /opt/rts/app
sudo -u rts npm run build
sudo -u rts NODE_ENV=production npm run seed
```
The seed installs only the policy versions and the academic year; no demo faculty in production mode.

## 6. systemd service
```bash
sudo tee /etc/systemd/system/rts.service >/dev/null <<'EOF'
[Unit]
Description=RTS Faculty Portal
After=network.target

[Service]
Type=simple
User=rts
Group=rts
WorkingDirectory=/opt/rts/app
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm start -- -H 127.0.0.1 -p 3000
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now rts
curl -s http://127.0.0.1:3000/api/health
```

## 7. HTTPS with nginx
Prefer a certificate from college IT (with a DNS name such as `rts.<college>.edu`). For UAT a self-signed
certificate works; testers accept the browser warning once.
```bash
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout /etc/ssl/private/rts.key -out /etc/ssl/certs/rts.crt -subj "/CN=SERVER_IP" -addext "subjectAltName=IP:SERVER_IP"
```
```bash
sudo tee /etc/nginx/sites-available/rts >/dev/null <<'EOF'
server {
    listen 80 default_server;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl default_server;
    ssl_certificate     /etc/ssl/certs/rts.crt;
    ssl_certificate_key /etc/ssl/private/rts.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto https;
        # Overwrite (not append) so clients cannot spoof their IP for login rate limiting.
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 120s;
    }
}
EOF
sudo ln -sf /etc/nginx/sites-available/rts /etc/nginx/sites-enabled/rts
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

## 8. Firewall
Allow SSH **before** enabling the firewall so you are not locked out:
```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

## 9. Backups
```bash
sudo -u rts crontab -e
```
Add:
```
30 1 * * * cd /opt/rts/app && npm run backup -- /var/backups/rts >> /var/backups/rts/backup.log 2>&1
45 1 * * * find /var/backups/rts -maxdepth 1 -type d -name 'rts-backup-*' -mtime +30 -exec rm -rf {} +
```
Ask IT to include `/var/lib/rts` and `/var/backups/rts` in VM backups/snapshots. Test a restore once before
UAT ends (`npm run restore -- <backup folder>`, with the service stopped).

## 10. Smoke test (from a laptop on VPN)
1. `https://SERVER_IP` → accept the certificate warning → Admin tab → sign in.
2. Admin → Academic years: check the year, window dates and policy version.
3. Faculty master → add a tester with an address you can read → Issue code → confirm the email arrives.
4. In another browser (or private window), sign in as that faculty member, fill and submit a record → initial PDF email.
5. As Admin: Start review → Select all → Mark verified → Approve & lock → final PDF email.

## Updating to a new version
```bash
cd /opt/rts/app
sudo -u rts npm run backup -- /var/backups/rts
sudo -u rts git pull
sudo -u rts npm ci
sudo -u rts npm run build
sudo systemctl restart rts
```

## Troubleshooting
| Symptom | Check |
|---|---|
| Login succeeds but immediately asks to sign in again | You are on `http://`; use `https://` (secure cookies). |
| 502 Bad Gateway | `sudo systemctl status rts`, `journalctl -u rts -n 100` |
| Service exits with "SESSION_SECRET must be at least 32 characters" or "ADMIN_LOGIN_PASSWORD_HASH is required" | `.env.local` values missing or file not readable by `rts` |
| Admin password always rejected | The hash line must be pasted exactly as printed (with `\$`). |
| Emails fail | Admin → Email issues shows the SMTP error; check port 587 outbound is allowed from the server. |
