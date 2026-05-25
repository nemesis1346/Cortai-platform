import { CommandCenterClient } from "./CommandCenterClient";

export default function OperationsPage({ params }: { params: { locale: string } }) {
  void params;
  return <CommandCenterClient />;
}

