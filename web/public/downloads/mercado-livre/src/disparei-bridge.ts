const CONNECT = "DISPAREI_ML_CONNECT";
const CONNECT_RESULT = "DISPAREI_ML_CONNECTION_RESULT";

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window || event.origin !== window.location.origin || event.data?.type !== CONNECT) return;
  const { nonce, backendOrigin } = event.data;
  if (typeof nonce !== "string" || nonce.length < 32 || backendOrigin !== window.location.origin) return;
  chrome.runtime.sendMessage({ type: CONNECT, nonce, backendOrigin }, (response) => {
    window.postMessage({ type: CONNECT_RESULT, ok: Boolean(response?.ok), error: response?.error }, window.location.origin);
  });
});
