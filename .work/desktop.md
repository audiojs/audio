# Desktop: Audio.app

Scope: wrap the existing playground as a Mac app.

- Swift WKWebView shell: window, native menus and toolbar, Finder/Dock opens, file dialogs, downloads and microphone permission.
- Node server: serves the existing editor and local media files.
- Recording stays in the playground's existing microphone path. Export creates a file when requested.
- No separate recorder window, automatic WAV recording, warmed native input or recording API in the server.

Build with `desktop/build.sh`; install with `desktop/build.sh install`. The app runs the repo in place.
