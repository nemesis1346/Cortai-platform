import { cookies } from "next/headers";
import { HvacClient } from "./hvac-client";

export default function HvacPage({ params }: { params: { locale: string } }) {
  void params;
  const propertyId = cookies().get("cortai_property_id")?.value ?? "";
  return <HvacClient initialPropertyId={propertyId} />;
}
