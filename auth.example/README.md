# Authentication configuration

This directory contains public examples only. Do not place real private keys,
paired-device data, or login records here.

## Configure authentication

From the project directory, run:

```bash
mkdir -p auth
cp auth.example/config.env auth/config.env
nano auth/config.env
```

Replace every value enclosed in `< >`:

- `<YOUR_DOMAIN>`: your DDNS or domain name without `https://` or a port
- `<HTTPS_PORT>`: the forwarded HTTPS port, for example `8443`
- `<ABSOLUTE_PATH_TO_CERTIFICATE>`: the full certificate-chain file path
- `<ABSOLUTE_PATH_TO_PRIVATE_KEY>`: the matching private-key file path

Remove the `< >` characters after replacing each value. Then run:

```bash
./server.sh restart
./server.sh pair
```

The real `auth/` directory is excluded from Git.

## Security-control settings

- `ALLOW_PERSISTENT_APPROVALS`: keep this `false` to require a fresh approval
  every time the public console needs one. Set it to `true` only if you
  explicitly want “allow for this session.” Unauthenticated local mode always
  offers that option.
- `REQUESTS_PER_MINUTE`: maximum public HTTP requests accepted from one source
  IP address per minute.
- `MAX_CONNECTIONS`: maximum simultaneous TCP connections accepted by the
  public server.
- `MAX_SSE_CONNECTIONS`: maximum simultaneous SSE event streams across all
  clients.
- `MAX_SSE_CONNECTIONS_PER_IP`: maximum simultaneous SSE event streams from
  one source IP address.
- `UPLOADS_PER_15_MINUTES`: maximum image uploads from one source IP address to
  one session during a 15-minute window.
- `MAX_THREAD_UPLOAD_MB`: maximum stored upload data for one session.
- `MAX_TOTAL_UPLOAD_MB`: maximum stored upload data across all sessions.

The example values are conservative defaults for personal use. Keep them unless
the server log shows that normal use is reaching a limit. Rate-limit counters
are kept in memory and reset when the server restarts. Five failed login
verifications from one address block further attempts for 30 minutes. A
successful login from a new address is highlighted in the Security activity
list and written to the server log.
