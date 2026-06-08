import { cookies } from "next/headers";
import { RoomMonitorClient } from "./room-monitor-client";

export default function RoomMonitorPage({ params }: { params: { locale: string } }) {
  void params;
  const propertyId = cookies().get("cortai_property_id")?.value ?? "";
  return <RoomMonitorClient initialPropertyId={propertyId} />;
}

