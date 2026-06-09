import { cookies } from "next/headers";
import { GuestServicesClient } from "./guest-services-client";

export default function GuestServicesPage({ params }: { params: { locale: string } }) {
  void params;
  const propertyId = cookies().get("cortai_property_id")?.value ?? "";
  return <GuestServicesClient initialPropertyId={propertyId} />;
}

