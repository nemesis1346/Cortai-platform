import { AdminSubmissionsClient } from "./submissions-client";

export default function SubmissionsPage({ params }: { params: { id: string } }) {
  return <AdminSubmissionsClient formId={params.id} />;
}