import { redirect } from "next/navigation";

export default function OperationsPage({ params }: { params: { locale: string } }) {
  redirect(`/${params.locale}/dashboard/live`);
}

