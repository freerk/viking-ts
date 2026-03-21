# Self-Hosting Guide

viking-ts is designed to run on your own hardware. It has minimal requirements: Node.js, disk space for SQLite and vectra indexes, and access to an embedding/LLM API (which can also be local via Ollama).

## Requirements

- Node.js >= 18
- ~100 MB disk for the application
- Additional disk for data (grows with number of memories/resources)
- An embedding provider (OpenAI API or local Ollama)
- An LLM provider (OpenAI API or local Ollama) for L0/L1 generation and memory extraction

## Quick setup

```bash
# Clone and build
git clone <repo-url> viking-ts
cd viking-ts
npm install
npm run build

# Configure
export EMBEDDING_API_KEY=sk-your-key
export LLM_API_KEY=sk-your-key

# Start
npm run start
```

The server listens on `127.0.0.1:1934` by default.

## Running as a systemd service

Create `/etc/systemd/system/viking-ts.service`:

```ini
[Unit]
Description=viking-ts context database
After=network.target

[Service]
Type=simple
User=viking
Group=viking
WorkingDirectory=/opt/viking-ts
ExecStart=/usr/bin/node packages/server/dist/main.js
Restart=on-failure
RestartSec=5

# Environment
Environment=PORT=1934
Environment=HOST=127.0.0.1
Environment=STORAGE_PATH=/var/lib/viking-ts/data
Environment=EMBEDDING_API_KEY=sk-your-key
Environment=LLM_API_KEY=sk-your-key

# Or use an env file
# EnvironmentFile=/etc/viking-ts/env

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/viking-ts

[Install]
WantedBy=multi-user.target
```

```bash
# Create user and data directory
sudo useradd -r -s /bin/false viking
sudo mkdir -p /var/lib/viking-ts/data
sudo chown viking:viking /var/lib/viking-ts/data

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable viking-ts
sudo systemctl start viking-ts

# Check status
sudo systemctl status viking-ts
sudo journalctl -u viking-ts -f
```

### Environment file

For secrets, use an environment file instead of inline `Environment=` directives:

```bash
# /etc/viking-ts/env
PORT=1934
HOST=127.0.0.1
STORAGE_PATH=/var/lib/viking-ts/data
EMBEDDING_API_KEY=sk-your-key
EMBEDDING_MODEL=text-embedding-3-small
LLM_API_KEY=sk-your-key
LLM_MODEL=gpt-4o-mini
```

```bash
sudo chmod 600 /etc/viking-ts/env
sudo chown viking:viking /etc/viking-ts/env
```

## Reverse proxy

### Caddy

```
viking.example.com {
    reverse_proxy localhost:1934
}
```

### nginx

```nginx
server {
    listen 443 ssl;
    server_name viking.example.com;

    ssl_certificate /etc/ssl/certs/viking.pem;
    ssl_certificate_key /etc/ssl/private/viking.key;

    location / {
        proxy_pass http://127.0.0.1:1934;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Tailscale access

If you run viking-ts on a home server or VPS, Tailscale provides zero-config private networking:

```bash
# Install Tailscale on the server
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# viking-ts is now accessible from any Tailscale device at:
# http://<tailscale-hostname>:1934
```

Bind to the Tailscale interface:

```bash
export HOST=0.0.0.0  # or your Tailscale IP
export PORT=1934
```

No reverse proxy, TLS certificates, or port forwarding needed. Tailscale handles encryption and access control.

### Tailscale Funnel (public access)

To expose viking-ts publicly via Tailscale Funnel:

```bash
tailscale funnel 1934
```

## Fully local setup with Ollama

Run everything on your own hardware with no external API calls:

```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Pull models
ollama pull nomic-embed-text   # embedding model (768d)
ollama pull llama3             # LLM for L0/L1 generation

# Configure viking-ts
export EMBEDDING_MODEL=nomic-embed-text
export EMBEDDING_API_BASE=http://localhost:11434/v1
export EMBEDDING_DIMENSION=768
export LLM_MODEL=llama3
export LLM_API_BASE=http://localhost:11434/v1

# No API keys needed
unset EMBEDDING_API_KEY
unset LLM_API_KEY

# Start
npm run start
```

## Data directory structure

```
~/.viking-ts/data/           # or STORAGE_PATH
├── db/
│   └── viking.db            # SQLite database (metadata, full text)
└── vectors/
    ├── memories/             # vectra index for memories
    ├── resources/            # vectra index for resources
    └── skills/               # vectra index for skills
```

## Backups

### SQLite database

The SQLite database uses WAL mode, so you can safely copy it while the server is running:

```bash
# Simple file copy (safe with WAL mode)
cp ~/.viking-ts/data/db/viking.db ~/backups/viking-$(date +%Y%m%d).db

# Or use sqlite3 .backup for a guaranteed-consistent copy
sqlite3 ~/.viking-ts/data/db/viking.db ".backup ~/backups/viking-$(date +%Y%m%d).db"
```

### vectra indexes

vectra stores data as JSON files. Copy the entire vectors directory:

```bash
cp -r ~/.viking-ts/data/vectors/ ~/backups/vectors-$(date +%Y%m%d)/
```

### Automated backup script

```bash
#!/bin/bash
BACKUP_DIR=~/backups/viking-ts/$(date +%Y%m%d)
mkdir -p "$BACKUP_DIR"

sqlite3 ~/.viking-ts/data/db/viking.db ".backup $BACKUP_DIR/viking.db"
cp -r ~/.viking-ts/data/vectors/ "$BACKUP_DIR/vectors/"

echo "Backup complete: $BACKUP_DIR"
```

Add to cron:

```bash
# Daily backup at 3 AM
0 3 * * * /opt/viking-ts/scripts/backup.sh
```

## Monitoring

### Health check

```bash
curl -s http://localhost:1934/health | jq .
```

Use this in monitoring tools (Uptime Kuma, Healthchecks.io) or systemd watchdog.

### Disk usage

```bash
# SQLite database size
du -sh ~/.viking-ts/data/db/

# vectra index sizes
du -sh ~/.viking-ts/data/vectors/*/
```

### Logs

When running via systemd:

```bash
sudo journalctl -u viking-ts -f          # follow logs
sudo journalctl -u viking-ts --since today  # today's logs
```

## Resource usage

viking-ts is lightweight:

- **Memory**: ~50-100 MB RSS for the Node.js process
- **CPU**: minimal at rest, spikes during embedding/LLM calls
- **Disk**: grows linearly with stored data. vectra JSON files are the largest component.
- **Network**: outbound calls to embedding/LLM API (unless using local Ollama)

A Raspberry Pi 4 or small VPS (1 CPU, 1 GB RAM) is sufficient for personal use.
