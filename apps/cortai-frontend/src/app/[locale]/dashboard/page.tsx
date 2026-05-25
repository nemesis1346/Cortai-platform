import { redirect } from "next/navigation";

export default function DashboardPage({ params }: { params: { locale: string } }) {
  redirect(`/${params.locale}/dashboard/operations`);
}
