import { cookies } from "next/headers";
import { FoodBreakfastClient } from "./food-breakfast-client";

export default function FoodBreakfastPage({ params }: { params: { locale: string } }) {
  void params;
  const propertyId = cookies().get("cortai_property_id")?.value ?? "";
  return <FoodBreakfastClient initialPropertyId={propertyId} />;
}

