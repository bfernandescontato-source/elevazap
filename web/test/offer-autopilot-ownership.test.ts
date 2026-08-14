import { describe, expect, it } from "vitest";
import { assertOwnedGroupSelection } from "../modules/offer-autopilot/ownership";

describe("Piloto Automático ownership", () => {
  it("impede selecionar grupo de outra conta/número", () => {
    expect(() => assertOwnedGroupSelection(["group-a@g.us", "group-b@g.us"], [{ group_jid: "group-a@g.us" }]))
      .toThrow("não são acessíveis");
  });
});
