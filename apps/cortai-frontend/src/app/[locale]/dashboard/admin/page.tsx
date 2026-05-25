import { redirect } from "next/navigation";

export default function AdminRootPage({ params }: { params: { locale: string } }) {
  redirect(`/${params.locale}/dashboard/admin/users`);
}

