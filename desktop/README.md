# Audio.app

The playground as a Mac app. Recording and export use the playground's existing flow.

```sh
desktop/build.sh install
```

| Piece | Purpose |
|---|---|
| [shell/main.swift](shell/main.swift) | WebKit window, native menus, Finder and Dock opens, file dialogs, downloads and microphone permission. |
| [app.js](app.js) | Fits the editor to the window and connects its menus and panels to the native menu bar and toolbar. |
| [server.js](server.js) | Serves this repo on `127.0.0.1:7781` and local audio/video files by path. |
| [open.html](open.html) | Opens a Finder file in the editor. |

Record with R or the editor's Record button. Export when you want a file.

The app runs this repo in place. Reload Page (⌥⌘R) picks up page changes; restart the app for server changes. Rebuild when `shell/` changes. Web Inspector: right-click › Inspect Element.

Logs: `~/Library/Logs/Audio/app.log` and `server.log`.

macOS arm64, signed ad hoc. Rebuilding the shell can require microphone permission again. Node.js must be installed.
