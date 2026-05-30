# IMAP Backup

A Node.js app that connects to one or more IMAP email accounts and backs up all emails to local storage. Supports incremental backups, multiple mailboxes per account, and outputs emails as `.eml` or `.json` files.

---

## Requirements

- [Node.js](https://nodejs.org/) 18 or later (for running from source)
- Network access to your IMAP server(s)

---

## Quick Start (from source)

```bash
# 1. Install dependencies
npm install

# 2. Run the app — creates a config.json on first run, then exits
npm start

# 3. Edit config.json with your account details (see Configuration below)

# 4. Run again to start the backup
npm start
```

---

## Quick Start (pre-built binary)

Download the binary for your platform from the [Releases](../../releases) page:

| File | Platform |
|---|---|
| `imap-backup-linux-x64` | Linux (x64) |
| `imap-backup-linux-arm64` | Linux (ARM64, e.g. Raspberry Pi) |
| `imap-backup-darwin-x64` | macOS (Intel) |
| `imap-backup-darwin-arm64` | macOS (Apple Silicon) |
| `imap-backup-windows-x64.exe` | Windows (x64) |

```bash
# Linux / macOS — make executable first
chmod +x imap-backup-linux-x64
./imap-backup-linux-x64

# Windows
imap-backup-windows-x64.exe
```

On first run, the binary creates a `config.json` file in the **current working directory** and exits. Edit it, then run again.

---

## Configuration

All settings live in `config.json`. The path can be overridden with the `CONFIG_PATH` environment variable.

### Minimal example

```json
{
  "accounts": [
    {
      "name": "My Account",
      "host": "imap.example.com",
      "port": 993,
      "secure": true,
      "auth": {
        "user": "me@example.com",
        "pass": "my-password"
      },
      "mailboxes": ["INBOX", "Sent"],
      "backupDir": "backups/my-account"
    }
  ],
  "backup": {
    "format": "eml"
  }
}
```

### Full config reference

```json
{
  "accounts": [
    {
      "name": "Work Account",
      "host": "imap.example.com",
      "port": 993,
      "secure": true,
      "auth": {
        "user": "user@example.com",
        "pass": "your-password-here"
      },
      "mailboxes": ["INBOX", "Sent", "Drafts"],
      "backupDir": "backups/work"
    }
  ],
  "backup": {
    "format": "eml",
    "incrementalOnly": true,
    "concurrentAccounts": 2,
    "logDir": "logs",
    "logLevel": "info"
  }
}
```

### Account fields
```
| Field         | Required  | Description 
|---------------|-----------|-------------
| `name`        | Yes       | Human-readable label used in logs and folder naming
| `host`        | Yes       | IMAP server hostname
| `port`        | Yes       | Usually `993` (TLS) or `143` (STARTTLS)
| `secure`      | Yes       | `true` for TLS (port 993), `false` for STARTTLS
| `auth.user`   | Yes       | Email address / login username
| `auth.pass`   | Yes       | Password or app password
| `mailboxes`   | No        | Array of mailbox paths to back up. Defaults to `["INBOX"]` if omitted
| `backupDir`   | No        | Output folder. Defaults to `backups/<account-name>`
```

### Backup settings
```
| Field                 | Default   | Description 
|-----------------------|-----------|-------------
| `format`              | `"eml"`   | Output format: `"eml"` or `"json"` (parsed metadata + body)
| `concurrentAccounts`  | `1`       | How many accounts to process in parallel
| `logDir`              | `"logs"`  | Directory for log files
| `logLevel`            | `"info"`  | Log verbosity: `"error"`, `"warn"`, `"info"`, or `"debug"`
```
---

## Multiple accounts

Add as many objects to the `accounts` array as you need:

```json
{
  "accounts": [
    {
      "name": "Work",
      "host": "imap.work.com",
      "port": 993,
      "secure": true,
      "auth": { "user": "me@work.com", "pass": "work-pass" },
      "mailboxes": ["INBOX", "Sent"],
      "backupDir": "backups/work"
    },
    {
      "name": "Gmail",
      "host": "imap.gmail.com",
      "port": 993,
      "secure": true,
      "auth": { "user": "me@gmail.com", "pass": "gmail-app-password" },
      "mailboxes": ["INBOX", "[Gmail]/Sent Mail", "[Gmail]/All Mail"],
      "backupDir": "backups/gmail"
    }
  ],
  "backup": {
    "format": "eml",
    "concurrentAccounts": 2
  }
}
```

---


## Output structure

Emails are saved as:

```
backups/
└── <account>/
    └── <mailbox>/
        └── 2024-03-15_uid-1234_Invoice March 2024.eml
```

File names are `YYYY-MM-DD_uid-<UID>_<subject>.<ext>`. Characters that are invalid in file names are replaced with `_`.

---

## Incremental backups & scheduling

The app tracks the highest email UID it has seen for each mailbox in `backup-state.json`. Re-running the app only downloads new messages.

To run automatically, use your OS scheduler:

**Linux/macOS — cron (every minute):**
```bash
crontab -e
# Add:
* * * * * /path/to/imap-backup-linux-x64 >> /var/log/imap-backup.log 2>&1
```

**Windows — Task Scheduler:**
1. Open Task Scheduler → Create Basic Task
2. Set the trigger
3. Action: Start a program → `C:\path\to\imap-backup-windows-x64.exe`
4. Set "Start in" to the folder containing your `config.json`

---

## Building from source

```bash
# Install dependencies (including devDependencies)
npm install

# Bundle with webpack → dist/bundle.js
npm run build

# The bundle can then be passed to js2bin to produce a native binary
npx js2bin --build --node=22.22.2 --platform=linux --app=dist/bundle.js --name=imap-backup
```