# Storage and Sharing Services

A deliberately small local-network file exchange. It provides one technical web
interface for two directions of transfer:

- **Receive:** a phone or browser uploads images and videos into
  `shared/received`.
- **Share:** files placed in `shared/available` appear with their size, MIME
  type, modified time, SHA-256, and a direct download link.

The shared-folder contents are local runtime data. Git and Docker both exclude
them; the repository contains only code, empty directory placeholders, and
deployment instructions.

## Requirements

- Docker Desktop, Docker Engine with Compose, or another Compose-compatible
  runtime
- A browser on this computer or on the same trusted local network

## Start

From the repository directory:

```powershell
Copy-Item .env.example .env
docker compose up -d --build
```

Open `http://127.0.0.1:8084` on this computer. For another device on the same
network, substitute this computer's LAN IPv4 address, for example
`http://192.168.1.20:8084`.

On Windows, this prints likely LAN addresses:

```powershell
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } |
  Select-Object InterfaceAlias, IPAddress
```

The service does **not** start automatically after a reboot. Compose explicitly
sets `restart: "no"`.

## Use

### Offer files for download

Copy regular files directly into:

```text
shared/available
```

Press **Refresh files** in the browser. Subdirectories and hidden files are not
served. Downloads use `Content-Disposition: attachment`.

### Receive images and videos

Use **Select images or videos** in the browser. Accepted files are written to:

```text
shared/received
```

Supported media includes JPEG, PNG, WebP, GIF, HEIC, HEIF, AVIF, MP4, MOV,
WebM, MKV, M4V, MPEG, OGV, AVI, 3GP, and 3G2. The default per-file limit is
1024 MB.

## Stop and restart manually

```powershell
docker compose stop
docker compose start
```

To remove the container and network while preserving all shared files:

```powershell
docker compose down
```

## Configuration

Copy `.env.example` to `.env` and adjust these values:

| Variable | Default | Purpose |
| --- | ---: | --- |
| `PORT` | `8084` | Host-side HTTP port |
| `BIND_ADDRESS` | `0.0.0.0` | `0.0.0.0` for LAN access; `127.0.0.1` for local-only |
| `MAX_FILE_SIZE_MB` | `1024` | Maximum size of one inbound upload |

The container runs as the unprivileged Node user, uses a read-only application
filesystem, mounts `shared/available` read-only, and has no automatic restart
policy.

## HTTP endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /` | Web interface |
| `GET /healthz` | Container health response |
| `GET /api/downloads` | Technical metadata for offered files |
| `GET /download/:name` | Attachment download from `shared/available` |
| `POST /upload` | Multipart media upload into `shared/received` |

## Development without Docker

```powershell
npm ci
npm run check
npm start
```

The non-container defaults use the same `shared/received` and
`shared/available` directories.

## Security boundary

This service has no authentication. Run it only on a trusted LAN, do not expose
port 8084 to the public internet, and stop it when the transfer is finished.
SHA-256 values help verify file integrity; they do not provide access control.
