## Mac browser and 3D capture

- Use the preinstalled `playwright-cli` executable from Actions or SSH.
- Keep its default full Chromium channel, headed mode, and Metal launch flags.
- Read `playwright-cli --help` for commands. Do not substitute `npx playwright screenshot` for this configured CLI.
- Start the app in a persistent session. Open its localhost HTTP URL.

```sh
playwright-cli open http://127.0.0.1:3000
playwright-cli snapshot
playwright-cli eval 'async () => { const a = await navigator.gpu?.requestAdapter(); if (!a) throw new Error("No WebGPU adapter"); const d = await a.requestDevice(); const info = { vendor: a.info.vendor, architecture: a.info.architecture, isFallbackAdapter: a.info.isFallbackAdapter }; d.destroy(); return info; }'
playwright-cli screenshot --filename=screenshots/final-mac.png
playwright-cli close
```

- Create `screenshots/` before capture. Wait for the app's scene-ready signal and inspect the screenshot for actual geometry, not only page controls or a canvas border.
- Confirm the application's active WebGPU renderer separately. Adapter availability alone does not prove that the app uses WebGPU.
- Inspect `chrome://gpu` in a separate tab when diagnosis is needed. Record the adapter, Metal backend, browser version, and console errors.
- Report Apple Paravirtual device as virtual Metal acceleration. Do not claim physical GPU performance from this result.
- Treat a missing adapter, failed device creation, or blank scene as a failed GPU test. Preserve diagnostic output.
- Inspect `$HOME/.local/share/omgithub-playwright/metal.json` for the installed configuration. Keep Vulkan flags out of the macOS Metal configuration.
