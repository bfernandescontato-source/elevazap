import LoteDetail from "../../campanhas/[id]/page";

export default function LoteDetailPage({ params }: { params: { id: string } }) {
  return <LoteDetail params={params} />;
}
