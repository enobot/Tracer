/**
 * This file will automatically be loaded by vite and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/process-model
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 */

import "./index.css";
let latestScreenshot = null;

window.tracer
  .ping()
  .then((reply) => {
    console.log("IPC test: ", reply);
  })
  .catch((error) => {
    console.log("IPC test failed", error);
  });

console.log(
  "👋 This message is being logged by the renderer process, included via Vite",
);

window.tracer.onHotkeyPressed(async () => {
  console.log("Hotkey receieved by renderer.");

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });

    console.log("Screen capture started");

    const video = document.getElementById("screenPreview");

    video.srcObject = stream;

    video.onloadeddata = () => {
      const canvas = document.getElementById("screenCapture");
      const context = canvas.getContext("2d");

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      latestScreenshot = canvas.toDataURL("image/png");

      console.log("Screenshot captured");
      console.log("Screenshot size: ", latestScreenshot.length);

      const testPrompt = "Explain what is visible in this screenshot.";

      window.tracer
        .inspectScreenshot(latestScreenshot, testPrompt)
        .then((result) => {
          console.log("Screenshot IPC:", result);
        })
        .catch((error) => {
          console.error("Screenshot IPC failed:", error);
        });

      stream.getTracks().forEach((track) => {
        track.stop();
      });
    };
  } catch (error) {
    console.error("Screen capture failed", error);
  }
});
