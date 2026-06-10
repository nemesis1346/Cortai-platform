import { cookies } from "next/headers";
import { PoolSpaClient } from "./pool-spa-client";

export default function PoolSpaPage({ params }: { params: { locale: string } }) {
  void params;
  const propertyId = cookies().get("cortai_property_id")?.value ?? "";
  return <PoolSpaClient initialPropertyId={propertyId} />;
}

