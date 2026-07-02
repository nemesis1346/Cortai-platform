import { FormRunnerClient } from "./form-runner-client";

export default async function FormRunnerPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  return <FormRunnerClient slug={slug} locale={locale} />;
}