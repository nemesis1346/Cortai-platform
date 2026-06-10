import { cookies } from "next/headers";
import { IotSensorsClient } from "./iot-sensors-client";

export default function IotSensorsPage({ params }: { params: { locale: string } }) {
  void params;
  const propertyId = cookies().get("cortai_property_id")?.value ?? "";
  return <IotSensorsClient initialPropertyId={propertyId} />;
}

