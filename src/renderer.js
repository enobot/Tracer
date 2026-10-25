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

const analyzeButton = document.getElementById("analyze-button");
const promptInput = document.getElementById("tracer-prompt");

const savedPrompt = localStorage.getItem("tracer:prompt");

if (savedPrompt !== null) {
  promptInput.value = savedPrompt;
}

promptInput.addEventListener("input", () => {
  localStorage.setItem("tracer:prompt", promptInput.value);
});

const resultDisplay = document.getElementById("analysis-result");

analyzeButton.addEventListener("click", async () => {
  if (!latestScreenshot) {
    resultDisplay.textContent = "Please capture a screenshot first.";
    return;
  }

  const prompt = promptInput.value.trim();

  if (!prompt) {
    resultDisplay.textContent = "Please enter a prompt.";
    return;
  }

  analyzeButton.disabled = true;
  resultDisplay.textContent = "Processing screenshot...";

  try {
    const result = await window.tracer.inspectScreenshot(
      latestScreenshot,
      prompt,
    );

    resultDisplay.textContent = `${result.message} (${result.screenshotSize} characters)`;
  } catch (error) {
    console.error("Screenshot analysis failed:", error);
    resultDisplay.textContent = "Analysis failed. Check DevTools.";
  } finally {
    analyzeButton.disabled = false;
  }
});

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

      stream.getTracks().forEach((track) => {
        track.stop();
      });
    };
  } catch (error) {
    console.error("Screen capture failed", error);
  }
});
