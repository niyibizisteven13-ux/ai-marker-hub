# Deploying a Node.js + PostgreSQL site to an Ubuntu VPS

**Conventions used below**
- `yourdomain.com` is your Spaceship domain and `203.0.113.10` is your VPS public IP. Replace both everywhere.
- The app is assumed to live in a GitHub repo called `YOUR_GITHUB_USER/my-app`, to listen on `process.env.PORT`, and to start with `npm start`.
- Ubuntu LTS means 24.04 or 26.04. Every command here is identical on both.
- Run each **Verify** block before moving on. If a verification fails, fix it before continuing.

---

## STEP 0: Create a non-root user (do this first, because of Rule 2)

Your provider gives you `root` access. Don't run the app as root. If the app is compromised, the attacker gets the whole machine. Create an unprivileged user instead.

```bash
ssh root@203.0.113.10
adduser deploy                      # choose a strong password when prompted
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy   # copies your SSH key
```

**Verify:** open a **second terminal** and run `ssh deploy@203.0.113.10`, then `sudo whoami`. It should print `root`. Keep the first session open until this works.

Once it works, disable root login and password login:

```bash
sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sshd -t && sudo systemctl restart ssh
```

**Verify:** `ssh root@203.0.113.10` must now be refused, and `ssh deploy@203.0.113.10` must still work. Do everything below as `deploy`.

> Only run the password-login line if your SSH key login for `deploy` worked in the verification above. Otherwise you will lock yourself out.

---

## STEP 1: Initial server hardening

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ufw curl git ca-certificates gnupg
```

Configure the firewall. **Allow SSH before enabling UFW**, or you will cut off your own session.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'     # opens 80 and 443; this profile exists after Nginx is installed
```

The `Nginx Full` profile only exists once Nginx is installed, so install Nginx now:

```bash
sudo apt install -y nginx
sudo ufw allow 'Nginx Full'
sudo ufw enable                 # answer y
```

**Verify:**
```bash
sudo ufw status verbose         # expect: 22/OpenSSH, 80,443/Nginx Full ALLOW; default deny incoming
systemctl is-active nginx       # expect: active
curl -I http://localhost        # expect: HTTP/1.1 200 OK
```

Optional but recommended: `sudo apt install -y unattended-upgrades` for automatic security patches.

---

## STEP 2: Local PostgreSQL

```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql
```

**Verify:**
```bash
systemctl is-active postgresql              # expect: active
sudo -u postgres psql -c "SELECT version();"
```

### Generate a strong password first

```bash
openssl rand -hex 24
```

Copy the output. It's hex-only, so it won't break the connection string. Passwords containing `@ : / # %` must be URL-encoded inside a connection string, which is a common cause of "authentication failed" errors.

### Create the user and database

```bash
sudo -u postgres psql
```

Inside `psql` (replace the password with the value you generated):

```sql
CREATE USER appuser WITH PASSWORD 'PASTE_THE_GENERATED_HEX_HERE';
CREATE DATABASE appdb OWNER appuser;
REVOKE ALL ON DATABASE appdb FROM PUBLIC;
GRANT ALL PRIVILEGES ON DATABASE appdb TO appuser;
\c appdb
GRANT ALL ON SCHEMA public TO appuser;
\q
```

The `GRANT ALL ON SCHEMA public` line matters. PostgreSQL 15 and later no longer let ordinary users create tables in `public` by default, so without it your migrations fail with "permission denied for schema public".

### Connection string format (goes in `.env` in Step 3)

```
DATABASE_URL=postgresql://appuser:PASTE_THE_GENERATED_HEX_HERE@localhost:5432/appdb
```

**Verify the login actually works over TCP with a password** (this is the path your app uses):

```bash
PGPASSWORD='PASTE_THE_GENERATED_HEX_HERE' psql -h localhost -U appuser -d appdb -c "SELECT current_user, current_database();"
```

### ⚠️ Confirm Postgres is NOT exposed to the internet

```bash
sudo ss -tlnp | grep 5432
```

You want to see `127.0.0.1:5432` (and possibly `[::1]:5432`). If you see `0.0.0.0:5432` or `*:5432`, fix it:

```bash
sudo grep -n "^listen_addresses" /etc/postgresql/*/main/postgresql.conf
# should be unset (default localhost) or listen_addresses = 'localhost'
```

**Why this matters (Warning 1).** Port 5432 is scanned constantly by automated bots. They try default and weak credentials (`postgres/postgres`, `admin/admin123`) and attempt to exploit exposed databases. A reachable Postgres with a guessable password is typically found and breached within hours. Once inside, attackers can dump your data, run code on the host through `COPY ... PROGRAM`, or encrypt your data for ransom. Three rules follow:

1. Never open 5432 in UFW or your provider's cloud firewall, and never bind to `0.0.0.0` or allow `0.0.0.0/0` in `pg_hba.conf`.
2. Never use the `postgres` superuser as your app's database user, so a compromised app can't touch the rest of the server.
3. Never keep a default or weak password. If you ever need remote access, tunnel it: `ssh -L 5433:localhost:5432 deploy@203.0.113.10`, then connect to `localhost:5433` on your own machine.

**Verify the firewall blocks it:** from your **own computer**, run `nc -zv 203.0.113.10 5432`. It must fail or time out.

---

## STEP 3: Node.js, deploy key, clone, and `.env`

### Install Node.js from NodeSource

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
```

**Verify:** `node -v && npm -v`. Node should report v24.x.

### Create an SSH deploy key (read-only access to one repo)

```bash
ssh-keygen -t ed25519 -C "deploy-key-my-app" -f ~/.ssh/my-app_deploy -N ""
cat ~/.ssh/my-app_deploy.pub
```

Copy the single line of output. Then in GitHub:

1. Open your repo, then **Settings → Deploy keys → Add deploy key**.
2. Title: `vps-deploy`. Paste the key.
3. Leave **Allow write access** unchecked, so a stolen server key can't push code to your repo.
4. Click **Add key**.

Tell SSH to use this key for GitHub:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/my-app_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config ~/.ssh/my-app_deploy
ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts
```

**Verify:** `ssh -T git@github.com`. Expected: `Hi YOUR_GITHUB_USER/my-app! You've successfully authenticated, but GitHub does not provide shell access.`

### Clone into `/var/www/my-app`

```bash
sudo mkdir -p /var/www/my-app
sudo chown deploy:deploy /var/www/my-app
git clone git@github.com:YOUR_GITHUB_USER/my-app.git /var/www/my-app
cd /var/www/my-app
```

**Verify:** `ls -la /var/www/my-app` shows your project files, owned by `deploy`.

### Install dependencies

```bash
npm ci --omit=dev
```

If your app needs a build step (TypeScript, Next.js, etc.), do this instead:

```bash
npm ci
npm run build
npm prune --omit=dev
```

`npm ci` needs a `package-lock.json` in your repo. If it errors on that, commit one.

### Create the production `.env`

```bash
cat > /var/www/my-app/.env <<EOF
NODE_ENV=production
PORT=5000
DATABASE_URL=postgresql://appuser:PASTE_THE_GENERATED_HEX_HERE@localhost:5432/appdb
JWT_SECRET=$(openssl rand -hex 32)
SESSION_SECRET=$(openssl rand -hex 32)
EOF
chmod 600 /var/www/my-app/.env
```

Add any other secrets your app needs (API keys, etc.) to this file. Then confirm `.env` is in your repo's `.gitignore`.

**Verify:** `ls -l /var/www/my-app/.env` shows `-rw-------` owned by `deploy`, and `git -C /var/www/my-app status --short` does not list `.env`.

If your app has a migration command (for example `npm run migrate`, `npx prisma migrate deploy`, or `npx knex migrate:latest`), run it now, then do a quick foreground test:

```bash
cd /var/www/my-app && node -r dotenv/config server.js
```

(Adjust the entry file to match your project, or use `npm start` if your app loads `.env` itself.) In a second terminal, run `curl -I http://localhost:5000`. When it responds, stop the test with `Ctrl+C`.

---

## STEP 4: PM2 process management

```bash
sudo npm install -g pm2
pm2 -v
```

Create an ecosystem file so PM2 runs your app with the right settings every time:

```bash
cat > /var/www/my-app/ecosystem.config.js <<'EOF'
module.exports = {
  apps: [{
    name: "my-app",
    script: "npm",
    args: "start",
    cwd: "/var/www/my-app",
    env: { NODE_ENV: "production", PORT: 5000 },
    max_memory_restart: "300M",
    autorestart: true
  }]
};
EOF
```

If your app does not load `.env` by itself, add `node_args: "--env-file=.env"` and use `script: "server.js"` with no `args`. Node 20.6 and later support `--env-file` natively.

Start, save, and enable boot persistence:

```bash
cd /var/www/my-app
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u deploy --hp /home/deploy
```

The last command prints a line starting with `sudo env PATH=...`. **Copy that exact line and run it.** It registers the systemd service. Then:

```bash
pm2 save
```

**Verify:**
```bash
pm2 status                                  # my-app: online
pm2 logs my-app --lines 30 --nostream       # no errors, shows "listening on 5000" or similar
curl -I http://localhost:5000               # app answers directly
systemctl is-enabled pm2-deploy             # expect: enabled
```

**Reboot test** (do this once, it's worth it):
```bash
sudo reboot
# wait ~60s, then:
ssh deploy@203.0.113.10
pm2 status                                  # my-app should be online again
```

**Why not root (Warning 2).** Running the app as root means a single vulnerability in your app or any npm dependency, such as remote code execution or a malicious package, gives an attacker full control of the VPS. That includes the database, the SSH config, and the firewall. Running as `deploy` limits the damage to what that user can touch. Also never use `sudo npm install` or `sudo pm2 start` for the app itself. Root-owned files in your project folder cause permission errors later. Use `sudo` only for system-wide installs like `npm install -g pm2`.

---

## STEP 5: Spaceship DNS

1. Log in to Spaceship, open **Domain Manager**, click your domain, then go to the **DNS** (Advanced DNS) tab.
2. Make sure the domain uses Spaceship's default nameservers (the **Nameservers** section should say "Spaceship basic DNS").
3. **Delete** any existing parking or default `A`, `AAAA`, or `CNAME` records on `@` and `www`. Leftover records cause intermittent wrong-site results.
4. Add these two records:

| Type | Host | Value | TTL |
|---|---|---|---|
| **A** | `@` | `203.0.113.10` | 300 |
| **CNAME** | `www` | `yourdomain.com` | 300 |

If the form asks for the CNAME target with a trailing dot, use `yourdomain.com.`. If you use IPv6 on the VPS, also add an `AAAA` record for `@`. Otherwise do not add one.

**Verify** (from your own computer; propagation usually takes 1 to 30 minutes):
```bash
dig +short yourdomain.com A              # expect: 203.0.113.10
dig +short www.yourdomain.com CNAME      # expect: yourdomain.com.
```

Do not run Step 7 until `dig` returns your VPS IP, or Certbot's validation will fail.

---

## STEP 6: Nginx reverse proxy

```bash
sudo nano /etc/nginx/sites-available/my-app
```

Paste:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name yourdomain.com www.yourdomain.com;

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_read_timeout 60s;
    }
}
```

I used `127.0.0.1` instead of `localhost` on purpose. `localhost` can resolve to IPv6 `::1`, and if your app only listens on IPv4 you get 502 errors.

Enable it, remove the default site, test, and reload:

```bash
sudo ln -s /etc/nginx/sites-available/my-app /etc/nginx/sites-enabled/my-app
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

`nginx -t` must print `syntax is ok` and `test is successful`. Never reload without it.

**Verify:**
```bash
curl -I http://127.0.0.1:5000                 # app directly
curl -I -H "Host: yourdomain.com" http://127.0.0.1   # through Nginx
curl -I http://yourdomain.com                 # through DNS + Nginx (after DNS propagates)
```

If you get **502 Bad Gateway**, PM2 isn't running or the port doesn't match. Check with `pm2 status` and `sudo tail -n 30 /var/log/nginx/error.log`.

---

## STEP 7: HTTPS with Certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

Enter your email when prompted and accept the terms. When asked about redirecting HTTP to HTTPS, choose **redirect**. Certbot rewrites your Nginx file to add the 443 block, certificate paths, and the redirect.

**Verify:**
```bash
sudo nginx -t
curl -I https://yourdomain.com                # expect HTTP/2 200 (or your app's normal response)
curl -I http://yourdomain.com                 # expect 301 to https://
sudo certbot renew --dry-run                  # expect: "Congratulations, all simulated renewals succeeded"
systemctl list-timers | grep certbot          # auto-renewal timer is active
```

Certificates last 90 days and renew automatically through the systemd timer.

---

## Final end-to-end checklist

```bash
sudo ufw status                    # only OpenSSH + Nginx Full
sudo ss -tlnp | grep -E '5432|5000'  # both on 127.0.0.1 only
pm2 status                         # online
sudo systemctl is-active nginx postgresql
```

From your own computer, `nc -zv 203.0.113.10 5432` and `nc -zv 203.0.113.10 5000` should both fail, and `https://yourdomain.com` should load.

## Redeploying updates later

```bash
cd /var/www/my-app
git pull
npm ci --omit=dev        # add your build/migrate commands here if you have them
pm2 reload my-app
pm2 logs my-app --lines 20 --nostream
```

## Backups and troubleshooting

At $2 to $4/month you probably have no automatic backups, so create a daily one:

```bash
mkdir -p ~/backups
(crontab -l 2>/dev/null; echo '0 3 * * * pg_dump -U appuser -h localhost appdb | gzip > ~/backups/appdb-$(date +\%F).sql.gz') | crontab -
```

That cron job needs a `~/.pgpass` file so it doesn't prompt for the password:

```bash
echo 'localhost:5432:appdb:appuser:PASTE_THE_GENERATED_HEX_HERE' > ~/.pgpass
chmod 600 ~/.pgpass
```

Copy backups off the server regularly (`scp` or `rsync` to your own machine), since a backup on the same disk won't survive a lost VPS.

| Symptom | Likely cause | Check |
|---|---|---|
| 502 Bad Gateway | App down or wrong port | `pm2 status`, `pm2 logs my-app` |
| `password authentication failed` | Wrong or un-encoded password in `DATABASE_URL` | Re-run the `PGPASSWORD=... psql -h localhost` test |
| `permission denied for schema public` | Missing schema grant | Re-run `GRANT ALL ON SCHEMA public` inside `\c appdb` |
| Certbot challenge fails | DNS not propagated, or port 80 blocked | `dig +short yourdomain.com`, `sudo ufw status` |
| Can't `git pull` | Deploy key not added or wrong SSH config | `ssh -T git@github.com` |
| App missing after reboot | `pm2 startup` or `pm2 save` skipped | `systemctl status pm2-deploy` |

Small VPS plans often have 512 MB to 1 GB of RAM. If `npm ci` or a build gets killed, add swap: `sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`.
