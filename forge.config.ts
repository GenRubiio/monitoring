import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { execSync } from 'node:child_process';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    appBundleId: 'com.monitoring.electron-system-monitor',
    extraResource: ['resources'],
    // Required so macOS Local Network Privacy shows "monitoring" instead of
    // "Electron" and properly associates the permission with this app.
    extendInfo: {
      NSLocalNetworkUsageDescription:
        'monitoring needs local network access to collect metrics from remote SSH servers.',
      // Declaring Bonjour services causes macOS to treat this as a local-network
      // app and show the permission dialog on first run instead of silently
      // returning EHOSTUNREACH for direct TCP connections (macOS 15+ behaviour).
      NSBonjourServices: ['_http._tcp', '_ssh._tcp'],
    },
    // The Vite plugin normally ignores everything except `.vite`. The main
    // process intentionally externalizes runtime dependencies, so include
    // production node_modules as well (Packager prunes devDependencies).
    ignore: (file) => {
      if (!file) return false;
      return !file.startsWith('/.vite') && !file.startsWith('/node_modules');
    },
  },
  hooks: {
    postPackage: async (_config, options) => {
      // Ad-hoc sign the .app so macOS tracks Local Network permission by
      // code signature (stable across builds) instead of binary hash
      // (changes every build, forcing re-grant of the permission).
      if (options.platform !== 'darwin') return;
      for (const outputPath of options.outputPaths) {
        const appPath = `${outputPath}/monitoring.app`;
        console.log(`[postPackage] Ad-hoc signing ${appPath}`);
        // Sign all nested components first (bottom-up), then the top-level bundle.
        // --deep alone fails for Electron because helpers have conflicting requirements.
        execSync(
          `find "${appPath}/Contents/Frameworks" -name "*.framework" -o -name "*.dylib" -o -name "*.app" | sort -r | xargs -I{} codesign --force --sign - "{}" 2>/dev/null; true`,
          { stdio: 'inherit', shell: true },
        );
        execSync(
          `codesign --force --sign - --entitlements "${__dirname}/entitlements.plist" "${appPath}"`,
          { stdio: 'inherit' },
        );
      }
    },
  },
  makers: [
    new MakerSquirrel({}),
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
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    new AutoUnpackNativesPlugin({}),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: false,
    }),
  ],
};

export default config;
