# Audio.app

The playground as a Mac app. Recording and export use the playground's existing flow.

```sh
npm run app
```

Builds the app, quits the one running (it asks while recording) and opens the new build. `/Applications/Audio.app` becomes a link to `desktop/build/Audio.app`, so `open -a Audio` runs this repo's build from then on (`desktop/build.sh install` does the same without opening it).

| Piece | Purpose |
|---|---|
| [shell/main.swift](shell/main.swift) | WebKit window, native menus, Finder and Dock opens, file dialogs, downloads and microphone permission. |
| [app.js](app.js) | Connects the editor's menus and panels to the native menu bar and toolbar. The app opens the editor as `/?desktop`, and the editor then lays itself out for the window and loads this file. |
| [server.js](server.js) | Serves this repo on `127.0.0.1:7781` and local audio/video files by path. |
| [open.html](open.html) | Opens a Finder file in the editor. |

Record with R or the editor's Record button. Export when you want a file.

The app runs this repo in place. Reload Page (⌥⌘R) picks up page changes; restart the app for server changes. When `shell/main.swift` has changed since the app was built, the app rebuilds itself as it opens and offers to restart (build log: `~/Library/Logs/Audio/build.log`). Web Inspector: right-click › Inspect Element.

Logs: `~/Library/Logs/Audio/app.log` and `server.log`.

macOS arm64. macOS asks every app once for the microphone; the answer is kept for the app's signature. Signed ad hoc, a rebuilt shell is a new signature and is asked again; with an Apple Development certificate in the keychain (Xcode › Settings › Accounts › Manage Certificates), `build.sh` signs with it and the answer holds across builds. Node.js must be installed.
