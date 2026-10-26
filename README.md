# tabby-workspace

An all-in-one workspace plugin for [Tabby](https://github.com/Eugeny/tabby):
everything you need around your SSH sessions, right next to the terminal.
The interface is in Russian.

## Features

### Connections sidebar (left)
- All SSH profiles, grouped like in Tabby's settings, with search
- Right-click menu: connect, edit, duplicate, copy SSH command, pin, delete
- **Docker** group: containers of this machine and of every server open in a
  tab — start, stop, restart, pause, open a shell, follow logs, `docker stats`,
  open published ports in the browser, restart a whole compose project,
  remove containers. Works over the existing Tabby SSH connection, so
  password logins are fine

### Server panel (right)
Follows the active tab and runs everything over the tab's SSH connection,
without touching your shell:
- **Server** — OS, uptime, load, RAM / swap / disk usage, failed systemd
  services (restart in one click), top processes
- **Snippets** — saved commands with `{{variables}}`, global or per server;
  click to paste, double-click to run
- **Logs** — Docker containers, systemd services and log files with
  auto-refresh, line filter and "errors only"
- **Ports & tunnels** — listening ports on the server and one-click local
  port forwarding (`localhost:5432` → server)
- **History** — bash / zsh / fish history of the server, searchable
- **Notes** — a note per server

### Server monitoring
CPU, RAM, disk and network load of the current SSH session in a bottom bar
or floating panel, plus custom metrics from shell commands and a preset
library.

### Smart background
- Background images, slideshow, filters, UI font and transparency
- Per-server background, coloured frame and label (e.g. a red **PROD** frame)
- Day / night images, Bing picture of the day
- Drag-and-drop an image to set it, dim when the window loses focus,
  hotkeys for "next image" and "toggle background"

All toolbar buttons (profiles, connections sidebar, server panel,
monitoring) sit next to Settings. Both sidebars start closed and do nothing
until opened. Settings live in **Settings → Workspace**.

## Build

```bash
npm install --legacy-peer-deps
npm run build
```

## Install locally

```bash
npm run install-local
```

This moves the standalone `tabby-background`, `tabby-server-stats` and
`tabby-ssh-sidebar` plugins (which this one replaces) to
`~/.config/tabby/plugins-disabled/` and copies the build to
`~/.config/tabby/plugins/node_modules/tabby-workspace`. Restart Tabby
afterwards. Settings are stored under the same keys as those plugins, so
existing configuration keeps working.

## Credits

Background, server monitoring and the connections sidebar started from
MIT-licensed plugins by moemoechu, Akkariin Meiko and Theo Bousquet —
see [NOTICE.md](NOTICE.md).
