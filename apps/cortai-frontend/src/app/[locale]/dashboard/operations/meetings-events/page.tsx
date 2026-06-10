import { cookies } from "next/headers";
import { MeetingsEventsClient } from "./meetings-events-client";

export default function MeetingsEventsPage({ params }: { params: { locale: string } }) {
  void params;
  const propertyId = cookies().get("cortai_property_id")?.value ?? "";
  return <MeetingsEventsClient initialPropertyId={propertyId} />;
}

