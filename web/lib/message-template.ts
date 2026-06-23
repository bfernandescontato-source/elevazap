type ApprovedPurchaseVars = {
  nome: string;
  produto: string;
  email: string;
  telefone: string;
  order_id?: string;
  transaction_id?: string;
};

export const defaultApprovedPurchaseMessage = "Olá {{nome}}, sua compra de {{produto}} foi aprovada. Bem-vindo(a)!";

export function renderApprovedPurchaseMessage(template: string, vars: ApprovedPurchaseVars) {
  return template
    .replaceAll("{{nome}}", vars.nome || "")
    .replaceAll("{{produto}}", vars.produto || "")
    .replaceAll("{{email}}", vars.email || "")
    .replaceAll("{{telefone}}", vars.telefone || "")
    .replaceAll("{{order_id}}", vars.order_id || "")
    .replaceAll("{{transaction_id}}", vars.transaction_id || "");
}
