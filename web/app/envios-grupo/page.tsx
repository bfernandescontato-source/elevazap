import { redirect } from "next/navigation";

export default function EnviosGrupoPage() {
  redirect("/campanhas?tab=grupos");
}
