import { describe, expect, it } from "vitest";
import { maskPhone, normalizeBrazilianPhone, phoneToWhatsAppJid, validateGroupJid } from "../utils/phone.js";

describe("utils de telefone", () => {
  it("normaliza, mascara e monta JID", () => {
    expect(normalizeBrazilianPhone("11 99999-9999")).toBe("5511999999999");
    expect(maskPhone("5511999999999")).toBe("55 11 *****-9999");
    expect(phoneToWhatsAppJid("5511999999999")).toBe("5511999999999@s.whatsapp.net");
  });

  it("valida JID de grupo", () => {
    expect(validateGroupJid("120363012345678@g.us")).toBe(true);
    expect(validateGroupJid("bad@s.whatsapp.net")).toBe(false);
  });
});
