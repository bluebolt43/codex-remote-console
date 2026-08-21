# Codex Remote Console

A mobile-friendly remote GUI for Codex App Server. It lets you manage and use
Codex sessions from a phone browser while Codex runs on your computer.

> [!NOTE]
> This is an experimental vibe-coding practice project built with Codex agents.
> It is a community project and is not an official OpenAI product.

## Features

- Multiple persistent Codex sessions
- Per-session workspace selection; multiple sessions may share a workspace
- Model and reasoning-effort controls
- Interactive approval choices and turn interruption
- Image upload, paste, generation, and inline workspace-image display
- English and Traditional Chinese UI
- Custom quick-prompt button

Voice input is planned but is not implemented yet.

## Beginner setup: a new Ubuntu or Debian computer

The computer runs Codex and this web server. Your Android phone only needs a
web browser. Connect both devices to the same trusted Wi-Fi network.

Open the **Terminal** application on the computer, then run each section below
in order.

### 1. Install basic tools

```bash
sudo apt update
sudo apt install -y curl git lsof
```

Enter the computer password if prompted. The password is not shown while you
type; this is normal.

### 2. Install Node.js 20 and npm

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.6/install.sh | bash
source ~/.bashrc
nvm install 20
node --version
npm --version
```

The final two commands should print version numbers. Node.js must be version 20
or newer.

### 3. Install and sign in to Codex CLI

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
source ~/.bashrc
codex --version
codex login
```

Follow the browser instructions to sign in. The official Codex CLI guide is
available at <https://developers.openai.com/codex/cli>.

### 4. Download Codex Remote Console

```bash
git clone https://github.com/bluebolt43/codex-remote-console.git
cd codex-remote-console
npm install
```

### 5. Start the server

```bash
./server.sh start
./server.sh status
```

The status should say that `codex-remote-console` is running on port `8080`.

### 6. Find the computer IP address

```bash
hostname -I
```

The command may show more than one address. A home-network address usually
starts with `192.168.` or `10.`. For example, if it shows `192.168.1.50`, open
this address in the Android phone browser:

```text
http://192.168.1.50:8080
```

Do not use `127.0.0.1` on the phone; that address means the phone itself.

## Beginner setup: macOS with Homebrew

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
./server.sh start
./server.sh status
```

Find the Mac Wi-Fi address with:

```bash
ipconfig getifaddr en0
```

For example, if it prints `192.168.1.50`, open
`http://192.168.1.50:8080` on the Android phone.

## First use in the phone browser

1. Tap **New Session** on the session-management page.
2. Select an existing workspace folder, or create a new folder.
3. Create and open the session.
4. Type a request in the box at the bottom, then tap **Send**.

Each session remembers its conversation. Multiple sessions can use the same
workspace folder. Workspace folders are stored inside this project's
`workspace/` directory and are not uploaded to GitHub.

## Server commands

Run these commands from the `codex-remote-console` directory:

```bash
./server.sh status
./server.sh restart
./server.sh stop
./server.sh logs
```

- `status`: check whether the server is running
- `restart`: stop the old server and start the latest version
- `stop`: stop the server
- `logs`: display server messages; press `Ctrl+C` to leave the log view

## Troubleshooting

If the phone cannot open the page:

1. Confirm the phone and computer are on the same Wi-Fi network.
2. Run `./server.sh status` and confirm the server is running.
3. On Linux, run `hostname -I`; on macOS, run `ipconfig getifaddr en0`.
4. Make sure a firewall is not blocking TCP port `8080`.

If startup reports `EADDRINUSE`, another program is already using port `8080`.
Run `./server.sh restart`. If the error remains, use `./server.sh logs` to view
the server message.

Runtime data, uploaded files, session workspaces, and local Codex/agent settings
are excluded from Git.

## Security

The server currently has no authentication screen. Use it only on a trusted
local network and do not expose port 8080 directly to the public internet.

## License

[MIT](LICENSE)
