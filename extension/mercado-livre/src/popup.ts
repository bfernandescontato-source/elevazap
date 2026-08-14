const CONFIG_KEY = "dispareiMercadoLivre";
const statusElement = document.querySelector<HTMLParagraphElement>("#status")!;
void chrome.storage.local.get(CONFIG_KEY).then((value) => { statusElement.textContent = value[CONFIG_KEY] ? "● Conectada ao Disparei" : "○ Ainda não conectada"; });
document.querySelector("#open")?.addEventListener("click", () => void chrome.tabs.create({ url: "https://www.disparei.pro/piloto-automatico" }));
