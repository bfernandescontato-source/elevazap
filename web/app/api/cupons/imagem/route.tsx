import { ImageResponse } from "next/og";

export const runtime = "nodejs";

// Imagem do cupom no estilo Shopee (laranja), gerada com o desconto de cada cupom,
// para enviar junto da mensagem e chamar atenção. É pública (só uma imagem, sem dados sensíveis).
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const bold = (q.get("bold") || "CUPOM").slice(0, 40);
  const cat = (q.get("cat") || "").slice(0, 40);
  const laranja = "#ee4d2d";
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: laranja, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#ffffff", borderRadius: 40, width: 680, height: 560, padding: 40 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", background: laranja, color: "#ffffff", fontSize: 40, fontWeight: 800, borderRadius: 999, padding: "10px 34px", letterSpacing: 2 }}>CUPOM SHOPEE</div>
          <div style={{ display: "flex", color: "#ee4d2d", fontSize: 110, fontWeight: 900, marginTop: 36, textAlign: "center", lineHeight: 1.05 }}>{bold}</div>
          {cat ? <div style={{ display: "flex", color: "#3a332e", fontSize: 38, fontWeight: 700, marginTop: 20 }}>{cat}</div> : <div style={{ display: "flex" }} />}
          <div style={{ display: "flex", color: "#8a8a8a", fontSize: 32, marginTop: 30 }}>Corre que é limitado!</div>
        </div>
      </div>
    ),
    { width: 800, height: 800 }
  );
}
