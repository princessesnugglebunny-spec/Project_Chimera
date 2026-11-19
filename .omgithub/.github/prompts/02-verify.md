Leave source changes uncommitted. Let the lifecycle save checkpoints and publish the deployment.

Generate `start.sh` for repeatable startup. Change to the project directory, install dependencies, build the static output, declare its absolute directory in deployment-output.json, and serve on PORT defaulting to 3000 in the foreground. Add per-command timing. Test from a stopped app with no installed project dependencies.

Generate `capture.sh` accepting CAPTURE_URL and CAPTURE_DIR. Capture fresh final-desktop.png and final-mobile.png outside source. Close the browser and leave the app running. Exit 75 for temporary browser/navigation failures; exit 1 for script or rendering defects.

Execute every repaired script through the runtime launcher. Confirm local and public readiness. Inspect both screenshots. Keep tunnel setup in the workflow. Keep screenshots in the OmSite deployment and diagnostics in the logs release.

Screenshots for your own checks: save small JPEGs (a .jpg path, viewport at most 1280px wide) and read only the latest one; older images are dropped from context. Read a full-size PNG only when fine detail matters.
