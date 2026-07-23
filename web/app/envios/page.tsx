import { redirect } from "next/navigation";

export default function EnviosPage() {
  redirect("/campanhas?tab=individuais");
}
