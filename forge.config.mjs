import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { shouldIgnorePackagePath } from './src/security-policy.mjs';

const config = {
  packagerConfig: {
    asar: true,
    // Ship the Vite build only, and drop maps or secrets if they land under .vite.
    ignore: shouldIgnorePackagePath,
    // Without these, tracer.exe reports Electron's "Copyright (C) 2015 GitHub, Inc.".
    appCopyright: 'Copyright © 2026 Tracy Tran',
    // assets/icon.ico on Windows, assets/icon.png on Linux. Rebuild both with
    // npx electron scripts/build-icons.mjs after editing assets/icon.svg.
    icon: 'assets/icon',
    // Copied to resources/, outside the app archive, for anyone who looks.
    extraResource: ['LICENSE', 'THIRD_PARTY_NOTICES.md'],
    win32metadata: {
      FileDescription: 'Tracer',
    },
  },
  rebuildConfig: {},
  makers: [
    // Per-user installer: no administrator rights, installs to
    // %LocalAppData%\tracer, and adds Start menu and desktop shortcuts.
    new MakerSquirrel((arch) => ({
      name: 'tracer',
      authors: 'Tracy Tran',
      title: 'Tracer',
      description: 'Tracer',
      // A stable name keeps .../releases/latest/download/... links working;
      // "-win32" lets update.electronjs.org find it if auto-update is added.
      setupExe: `Tracer-Setup-win32-${arch}.exe`,
      setupIcon: 'assets/icon.ico',
      // Shown in Settings → Apps; Squirrel reads it from this public URL.
      iconUrl:
        'https://raw.githubusercontent.com/enobot/Tracer/main/assets/icon.ico',
      noMsi: true,
    })),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.js',
          config: 'vite.main.config.mjs',
          target: 'main',
        },
        {
          entry: 'src/preload.js',
          config: 'vite.preload.config.mjs',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mjs',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    }),
  ],
};

export default config;
