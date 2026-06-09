import { cookies } from "next/headers";
import { FrontDeskClient } from "./front-desk-client";

export default function FrontDeskPage({ params }: { params: { locale: string } }) {
  void params;
  const propertyId = cookies().get("cortai_property_id")?.value ?? "";
  return <FrontDeskClient initialPropertyId={propertyId} />;
}

