import { CommandCenterClient } from "./CommandCenterClient";
import { cookies } from "next/headers";

export default function OperationsPage({ params }: { params: { locale: string } }) {
  void params;
  const propertyId = cookies().get("cortai_property_id")?.value ?? "";
  return <CommandCenterClient initialPropertyId={propertyId} />;
}

