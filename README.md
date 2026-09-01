# Storage and Sharing Services

A deliberately small local-network file exchange. It provides one technical web
interface for two directions of transfer:

- **Receive:** a phone or browser uploads images and videos into
  `shared/received`.
- **Share:** files placed in `shared/available` appear with their size, MIME
  type, modified time, SHA-256, and a direct download link.

The shared-folder contents are local runtime data. Git excludes them; the
repository contains only code, empty directory placeholders, and environment
replication instructions.

## Environment replication

The managed environment starts from `debian:latest`. From a fresh Debian
environment with this repository mounted at `/workspace`, run:

```bash
bash /workspace/setup.sh
```

`setup.sh` installs only the Debian packages, locked npm dependencies, runtime
account, and runtime directories. It uses `apt-get --no-install-recommends` and
does not start or stop the service or manage containers.

On the Windows workstation, `tk storage` owns the separate container lifecycle:

```text
tk storage start
tk storage status
tk storage stop
tk storage rebuild
```

`start` preserves and reuses an existing stopped container. `rebuild` is the
explicit operation that replaces only this service's container with a fresh
`debian:latest` environment. Neither operation removes files in `shared`.

Open `http://127.0.0.1:8084` on this computer. For another device on the same
trusted network, substitute this computer's LAN IPv4 address, for example
`http://192.168.1.20:8084`.

On Windows, this prints likely LAN addresses:

```powershell
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } |
  Select-Object InterfaceAlias, IPAddress
```

The service does **not** start automatically after a reboot.

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

## Configuration

Optionally copy `.env.example` to `.env` and adjust these host-side launcher
values. Tukevejtso uses the documented defaults when `.env` is absent:

| Variable | Default | Purpose |
| --- | ---: | --- |
| `PORT` | `8084` | Host-side HTTP port |
| `BIND_ADDRESS` | `0.0.0.0` | Host publication: `0.0.0.0` for LAN access; `127.0.0.1` for local-only |
| `MAX_FILE_SIZE_MB` | `1024` | Maximum size of one inbound upload |

The managed Node process runs as an unprivileged account. Tukevejtso mounts the
project source and `shared/available` read-only, mounts `shared/received`
read/write, and configures no automatic restart policy.

## HTTP endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /` | Web interface |
| `GET /healthz` | Service health response |
| `GET /api/downloads` | Technical metadata for offered files |
| `GET /download/:name` | Attachment download from `shared/available` |
| `POST /upload` | Multipart media upload into `shared/received` |

## Direct development

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
