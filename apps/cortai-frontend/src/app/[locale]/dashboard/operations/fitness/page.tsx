import { cookies } from "next/headers";
import { FitnessClient } from "./fitness-client";

export default function FitnessPage({ params }: { params: { locale: string } }) {
  void params;
  const propertyId = cookies().get("cortai_property_id")?.value ?? "";
  return <FitnessClient initialPropertyId={propertyId} />;
}

