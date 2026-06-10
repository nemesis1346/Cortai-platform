import { cookies } from "next/headers";
import { GuestMessagingClient } from "./guest-messaging-client";

export default function GuestMessagingPage({ params }: { params: { locale: string } }) {
  void params;
  const propertyId = cookies().get("cortai_property_id")?.value ?? "";
  return <GuestMessagingClient initialPropertyId={propertyId} />;
}

