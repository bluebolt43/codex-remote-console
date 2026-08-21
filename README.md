# Codex Remote Console

A mobile-friendly remote GUI for Codex. Codex runs on your computer, while you
create sessions and send instructions from a phone browser.

> [!NOTE]
> This is an experimental vibe-coding practice project built with Codex agents.
> It is a community project and is not an official OpenAI product.

## Features

- Multiple persistent Codex sessions
- Multiple sessions can share the same workspace
- Model and reasoning-effort controls
- Approval buttons and turn interruption
- Image upload, paste, generation, and inline display
- English and Traditional Chinese interface
- Custom quick-prompt button

Voice input is planned but is not implemented yet.

## Beginner setup: Ubuntu or Debian

Your computer runs both Codex and Codex Remote Console. Your phone does not need
to install an app; it only needs a modern web browser.

Open the **Terminal** application on the computer, then complete each section in
order. Copy one code block at a time and press `Enter`.

### 1. Install the basic tools

```bash
sudo apt update
sudo apt install -y curl git lsof
```

Ubuntu may ask for your computer password. Nothing appears while you type the
password; this is normal. Press `Enter` when finished.

### 2. Install Node.js and npm

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.6/install.sh | bash
source ~/.bashrc
nvm install 20
node --version
npm --version
```

The final two commands should display version numbers. Node.js must be version
20 or newer.

### 3. Install and sign in to Codex CLI

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
source ~/.bashrc
codex --version
codex login
```

Follow the browser instructions to sign in to Codex. After signing in, return to
Terminal.

### 4. Download Codex Remote Console

```bash
git clone https://github.com/bluebolt43/codex-remote-console.git
cd codex-remote-console
npm install
```

The first installation may take a few minutes. When it finishes, choose one of
the connection modes below.

## Beginner setup: macOS

Install [Homebrew](https://brew.sh/) first if the `brew` command is unavailable.
Then open **Terminal** and run:

```bash
brew install node git
curl -fsSL https://chatgpt.com/codex/install.sh | sh
source ~/.zshrc
codex --version
codex login
git clone https://github.com/bluebolt43/codex-remote-console.git
cd codex-remote-console
npm install
```

Follow the browser instructions when `codex login` opens the sign-in page. When
installation finishes, choose one of the connection modes below.

## Choose how the phone connects

### Option 1: same Wi-Fi, without authentication

This is the default and easiest option. Use it when the computer and phone are
connected to the same trusted home Wi-Fi. You do not need a domain name, HTTPS
certificate, password, or Passkey.

Start the server:

```bash
./server.sh start
./server.sh status
```

The command displays an address similar to:

```text
http://192.168.1.20:8080
```

Open the displayed address in the phone browser. If several addresses appear,
try one beginning with `192.168.` or `10.`. Do not enter `127.0.0.1` on the
phone, because that address means the phone itself.

> [!WARNING]
> Do not forward port `8080` to the Internet. This mode has no authentication.

### Option 2: Internet access with Passkey protection

Choose this option only when you want to use the console away from home. This
setup requires some Router and HTTPS knowledge. Before continuing, prepare:

- A hostname or DDNS name that points to your public IP
- A valid HTTPS certificate for that hostname
- Router port forwarding to the configured HTTPS port

The domain must open without a browser certificate warning. A self-signed
certificate is unsuitable for Passkeys in a normal browser.

Create a private settings file from the included example:

```bash
mkdir -p auth
cp auth.example/config.env auth/config.env
nano auth/config.env
```

Follow the [Authentication configuration guide](auth.example/README.md) for the
complete settings reference. In the copied file, keep the included security
defaults and replace these values:

```bash
AUTH_ENABLED=true
PASSKEY_RP_ID=<YOUR_DOMAIN>
PASSKEY_ORIGIN=https://<YOUR_DOMAIN>:<HTTPS_PORT>
PUBLIC_HOST=0.0.0.0
PUBLIC_PORT=<HTTPS_PORT>
TLS_CERT_FILE=<ABSOLUTE_PATH_TO_CERTIFICATE>
TLS_KEY_FILE=<ABSOLUTE_PATH_TO_PRIVATE_KEY>
```

Replace every value enclosed in `< >`:

- `<YOUR_DOMAIN>`: your DDNS or domain name, without `https://` or a port
- `<HTTPS_PORT>`: the public HTTPS port, for example `8443`
- `<ABSOLUTE_PATH_TO_CERTIFICATE>`: the full certificate-chain file path
- `<ABSOLUTE_PATH_TO_PRIVATE_KEY>`: the matching private-key file path

Remove the `< >` characters after replacing each value. In `nano`, press
`Ctrl+O`, press `Enter` to save, and then press `Ctrl+X` to leave.

Start the server and display its address:

```bash
./server.sh start
./server.sh status
```

### Pair a browser

On the server computer, run:

```bash
./server.sh pair
```

The command displays a six-digit one-time password and a pairing URL:

1. Open the displayed pairing URL on the phone or computer you want to use.
2. Enter the six-digit password.
3. Select **Create Passkey** and follow the browser instructions.
4. After pairing, the browser opens the Session management page.

The password can be used once and expires after five minutes. Repeat these steps
for each browser or Chrome profile you want to authorize.

Passkeys belong to a browser profile rather than the entire physical device. If
you use a different browser or Chrome profile, run `./server.sh pair` again for
that browser.

Only forward the HTTPS port, such as `8443`. The local pairing command uses
that same HTTPS listener but the server rejects pairing-code creation unless
the connection comes from `127.0.0.1` or `::1`.

## First use in the phone browser

1. Open the address displayed by `./server.sh status`.
2. Tap **New Session** on the Session management page.
3. Select an existing workspace folder, or create a new folder.
4. Tap **Create Session**.
5. Enter a request in the box at the bottom and tap **Send**.

Each session keeps its own conversation. Sessions may run concurrently and may
use the same workspace folder.

The controls below the conversation allow you to:

- Change the Codex model and reasoning effort
- Check the remaining weekly usage
- Stop a running request
- Attach or paste an image
- Send the text configured for the custom prompt button

## Server commands

Run these commands inside the `codex-remote-console` directory:

```bash
./server.sh start
./server.sh status
./server.sh restart
./server.sh stop
./server.sh pair
./server.sh logs
```

- `start`: start the server
- `status`: show whether it is running and display the address
- `restart`: restart it after changing settings or updating files
- `stop`: stop the server
- `pair`: authorize another browser when authentication is enabled
- `logs`: show server messages; press `Ctrl+C` to exit

## Troubleshooting

### The phone cannot open the local address

- Run `./server.sh status` and use the displayed address.
- Confirm the phone and computer are on the same network.
- Confirm the computer firewall allows port `8080`.

### The public HTTPS address does not open

- Confirm the DDNS hostname points to the current public IP.
- Confirm the Router forwards the configured HTTPS port to this computer.
- Confirm the certificate is valid for the configured hostname.
- Run `./server.sh logs` and check for certificate or port errors.

### `EADDRINUSE` appears

Run:

```bash
./server.sh restart
```

If it still fails, use `./server.sh logs` to identify the program or port causing
the conflict.

### Pairing is unavailable

Confirm `AUTH_ENABLED=true` is present in `auth/config.env`, restart the server,
and then run `./server.sh pair` again.

## License

[MIT](LICENSE)
