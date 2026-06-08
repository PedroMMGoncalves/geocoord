Optional assets for GeoCoord:

- icon.ico   Application icon used by electron-builder for the desktop installer
             (256x256 recommended). If absent, the default Electron icon is used.
- logo.png   Logo shown at the top of the sidebar in the web app. If absent, the
             sidebar shows the app name only.

For the desktop build, add the file name to the "stlite.desktop.files" list in
package.json so it is bundled.
