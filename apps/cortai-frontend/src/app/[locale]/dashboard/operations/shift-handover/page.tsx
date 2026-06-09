import { cookies } from "next/headers";
import { ShiftHandoverClient } from "./shift-handover-client";

export default function ShiftHandoverPage({ params }: { params: { locale: string } }) {
  void params;
  const propertyId = cookies().get("cortai_property_id")?.value ?? "";
  return <ShiftHandoverClient initialPropertyId={propertyId} />;
}
